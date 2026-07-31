// Editor vzorcov: zmeny sa aplikujú v JEDNEJ transakcii (žiadny polovičný
// update), každá zmena sa loguje do cfg_audit (kto/kedy/čo, staré → nové).
import { db, loadCfg } from './db';
import { BOUNDS, validSys, inBounds } from './compute';

export interface EditRow {
	id: number;
	kod: string;
	nazov: string;
	dim: 'S' | 'V';
	poradie: number;
	offset: number;
}

export interface CfgZmena {
	pole: string;
	stara: number;
	nova: number;
}

// „Kladkový profil 6 mm Surový 3600 mm" → „Kladkový profil" — základná rola profilu
// bez hrúbky (6/10) a dĺžky, aby sa 6mm a 10mm dvojča spárovali ako jeden vzorec.
const baseRole = (nazov: string) =>
	nazov
		.replace(/\s*\d+\s*mm/gi, '')
		.replace(/\s*Surov[ýy]/gi, '') // bez \b — ý nie je ASCII \w, hranica by nesadla
		.replace(/\s+/g, ' ')
		.trim();

export function getEditableRows(sysStyl: string): { rows: EditRow[]; skloOffset: number } | null {
	const sys = db.prepare('SELECT sklo_offset FROM cfg_sys WHERE sys_styl = ?').get(sysStyl) as
		{ sklo_offset: number } | undefined;
	if (!sys) return null;
	const raw = db
		.prepare(
			`SELECT id, kod, nazov, dim, poradie, offset, sklo_hrubka FROM cfg_rez
			 WHERE sys_styl = ? AND typ = 'profil' ORDER BY poradie`
		)
		.all(sysStyl) as (EditRow & { sklo_hrubka: number })[];
	// Deluxe: kladka/klzný má DVA riadky (6mm+10mm) s IDENTICKOU geometriou — hrúbka
	// skla vyberá len Money kód. V editore ukáž LEN jeden kanonický (6mm), edit sa pri
	// uložení zrkadlí na 10mm dvojča (inak by 6/10 mohli rozísť → iné množstvo do Money).
	const rows: EditRow[] = raw
		.filter((r) => Number(r.sklo_hrubka) !== 10)
		.map((r) => ({
			id: r.id,
			kod: r.kod,
			// pri hrúbko-závislom profile zahoď hrúbku z názvu — vzorec platí pre 6 aj 10
			nazov: Number(r.sklo_hrubka) ? baseRole(r.nazov) : r.nazov,
			dim: r.dim,
			poradie: r.poradie,
			offset: r.offset
		}));
	return { rows, skloOffset: sys.sklo_offset };
}

export interface SaveInput {
	sysStyl: string;
	username: string;
	offsets: Map<number, number>; // row id → nový offset
	skloOffset: number;
	glassRedukcia?: Map<string, boolean>; // nazov skla → nuluje Redukciu?
}

export function saveCfgChanges(input: SaveInput): { zmeny: CfgZmena[]; error: string | null } {
	const cur = getEditableRows(input.sysStyl);
	if (!cur) return { zmeny: [], error: 'Neznámy systém/štýl.' };

	// bounds na vstupe — preklep sa odmietne skôr, než sa čohokoľvek dotkne
	for (const [id, off] of input.offsets) {
		if (!Number.isFinite(off) || off < BOUNDS.offset.min || off > BOUNDS.offset.max)
			return { zmeny: [], error: `Odsadenie ${off} je mimo rozsahu ±${BOUNDS.offset.max} mm.` };
		if (!cur.rows.find((r) => r.id === id))
			return { zmeny: [], error: 'Neplatný riadok konfigurácie.' };
	}
	if (
		!Number.isFinite(input.skloOffset) ||
		input.skloOffset < BOUNDS.skloOffset.min ||
		input.skloOffset > BOUNDS.skloOffset.max
	)
		return {
			zmeny: [],
			error: `Sklo odsadenie musí byť ${BOUNDS.skloOffset.min}–${BOUNDS.skloOffset.max} mm.`
		};

	const zmeny: CfgZmena[] = [];
	for (const r of cur.rows) {
		const nova = input.offsets.get(r.id);
		if (nova !== undefined && nova !== r.offset)
			zmeny.push({
				pole: `${r.nazov} · ${r.dim === 'S' ? 'šírka' : 'výška'}`,
				stara: r.offset,
				nova
			});
	}
	if (input.skloOffset !== cur.skloOffset)
		zmeny.push({ pole: 'Sklo — konečné zmenšenie', stara: cur.skloOffset, nova: input.skloOffset });

	const glassZmeny: { nazov: string; stara: number; nova: number }[] = [];
	if (input.glassRedukcia) {
		const glass = db.prepare('SELECT nazov, redukcia_zero FROM glass_types').all() as {
			nazov: string;
			redukcia_zero: number;
		}[];
		for (const g of glass) {
			const want = input.glassRedukcia.get(g.nazov);
			if (want !== undefined && (want ? 1 : 0) !== g.redukcia_zero) {
				glassZmeny.push({ nazov: g.nazov, stara: g.redukcia_zero, nova: want ? 1 : 0 });
				zmeny.push({
					pole: `Sklo „${g.nazov}" nuluje Redukciu 6mm`,
					stara: g.redukcia_zero,
					nova: want ? 1 : 0
				});
			}
		}
	}

	if (!zmeny.length) return { zmeny: [], error: null };

	// všetky profil riadky (vrátane skrytého 10mm dvojčaťa) — na zrkadlenie 6→10 offsetu
	const allProfil = db
		.prepare(`SELECT id, nazov, sklo_hrubka FROM cfg_rez WHERE sys_styl = ? AND typ = 'profil'`)
		.all(input.sysStyl) as { id: number; nazov: string; sklo_hrubka: number }[];

	const updRez = db.prepare('UPDATE cfg_rez SET offset = ? WHERE id = ?');
	const updSkloRez = db.prepare(
		`UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND typ = 'sklo' AND dim = ?`
	);
	const updSys = db.prepare('UPDATE cfg_sys SET sklo_offset = ? WHERE sys_styl = ?');
	const updGlass = db.prepare('UPDATE glass_types SET redukcia_zero = ? WHERE nazov = ?');
	const insAudit = db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)');

	try {
		db.transaction(() => {
			for (const [id, off] of input.offsets) {
				updRez.run(off, id);
				// sklo riadky zdieľajú offsety s rámovým profilom rovnakej dimenzie
				// (rovnaká väzba ako v pôvodnom odpisovom Exceli) — drží ich v synchróne
				const row = cur.rows.find((r) => r.id === id)!;
				if (/rámový/i.test(row.nazov)) updSkloRez.run(off, input.sysStyl, row.dim);
				// Deluxe: editovaný kanonický (6mm) profil → zrkadli offset na 10mm dvojča
				// (rovnaká rola), aby 6/10 mali IDENTICKÉ množstvo do Money
				const edited = allProfil.find((r) => r.id === id);
				if (edited && Number(edited.sklo_hrubka) !== 0) {
					const role = baseRole(edited.nazov);
					for (const sib of allProfil)
						if (sib.id !== id && Number(sib.sklo_hrubka) !== 0 && baseRole(sib.nazov) === role)
							updRez.run(off, sib.id);
				}
			}
			updSys.run(input.skloOffset, input.sysStyl);
			for (const g of glassZmeny) updGlass.run(g.nova, g.nazov);
			insAudit.run(input.username, input.sysStyl, JSON.stringify(zmeny));

			// invariant: hrúbko-závislé dvojča (6/10) MUSÍ mať rovnaký offset — inak by
			// tá istá zákazka písala do Money iné množstvo pre 6mm vs 10mm sklo
			const after = db
				.prepare(
					`SELECT nazov, offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'profil' AND sklo_hrubka <> 0`
				)
				.all(input.sysStyl) as { nazov: string; offset: number }[];
			const byRole: Record<string, Set<number>> = {};
			for (const r of after) (byRole[baseRole(r.nazov)] ??= new Set()).add(r.offset);
			for (const role in byRole)
				if (byRole[role].size > 1)
					throw new Error(
						`Profil „${role}" má rozdielne odsadenie pre 6/10 mm — musí byť rovnaké.`
					);

			// poistka: nová konfigurácia MUSÍ byť platná, inak sa celá transakcia vráti
			const cfg = loadCfg();
			if (!validSys(cfg, input.sysStyl)) throw new Error('Nová konfigurácia je neplatná.');
			const boundErr = inBounds(cfg, input.sysStyl);
			if (boundErr) throw new Error(boundErr);
		})();
	} catch (e) {
		return { zmeny: [], error: e instanceof Error ? e.message : 'Uloženie zlyhalo.' };
	}

	return { zmeny, error: null };
}

export function getAuditLog(limit = 50) {
	return db
		.prepare('SELECT ts, username, sys_styl, zmeny FROM cfg_audit ORDER BY id DESC LIMIT ?')
		.all(limit) as { ts: string; username: string; sys_styl: string; zmeny: string }[];
}
