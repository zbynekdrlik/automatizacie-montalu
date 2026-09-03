// Editor vzorcov: zmeny sa aplikujú v JEDNEJ transakcii (žiadny polovičný
// update), každá zmena sa loguje do cfg_audit (kto/kedy/čo, staré → nové).
import { db, loadCfg, glassTypesForSystem, systemFromSysStyl } from './db';
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
	// #440: `string` variant nesie per-sklo korekciu, kde NULL = „systémová" (bez override).
	// Číselné polia (offset/skloOffset/redukcia 0-1) ostávajú číslami; display `{stara} → {nova}`
	// funguje pre oba.
	stara: number | string;
	nova: number | string;
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
	glassRedukcia?: Map<number, boolean>; // row id skla → nuluje Redukciu?
	// #440: row id skla → per-sklo korekcia rozmeru (číslo = absolútny override, NULL = zruš
	// override → systémový skloOffset). Prázdne pole v editore MUSÍ mapovať na NULL, NIE 0.
	glassKorekcia?: Map<number, number | null>;
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

	// #440: per-sklo korekcia — rovnaké medze ako systémový skloOffset (0–500). NULL (zrušenie
	// override) sa NEvaliduje. Preklep sa odmietne skôr, než sa čohokoľvek dotkne.
	if (input.glassKorekcia) {
		for (const [, kor] of input.glassKorekcia) {
			if (kor === null) continue;
			if (!Number.isFinite(kor) || kor < BOUNDS.skloOffset.min || kor > BOUNDS.skloOffset.max)
				return {
					zmeny: [],
					error: `Korekcia rozmeru skla musí byť ${BOUNDS.skloOffset.min}–${BOUNDS.skloOffset.max} mm (alebo prázdne pole = systémová).`
				};
		}
	}

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

	const glassZmeny: { id: number; nazov: string; stara: number; nova: number }[] = [];
	if (input.glassRedukcia) {
		// #438: prepínač redukcie je PER SYSTÉM a kľúčovaný ROW ID (nie názvom). To isté
		// sklo môže žiť vo viacerých systémoch pod tým istým názvom (napr. „3.3.1" je Slide
		// aj Štandard +, #214, UNIQUE(nazov, system)). Iterujeme LEN sklá tohto systému
		// (glassTypesForSystem rieši alias starý Štandard → Štandard +) a zapisujeme
		// `WHERE id=?` — jednoznačná identita riadka, takže rovnaké meno v inom systéme
		// (ani prípadné budúce 'ALL' sklo s kolidujúcim názvom) sa nikdy nedotkne (predtým
		// GROUP BY nazov + WHERE nazov=? prehodil obidva riadky, prod cfg_audit 16).
		for (const g of glassTypesForSystem(systemFromSysStyl(input.sysStyl))) {
			const curVal = g.redukciaZero ? 1 : 0;
			const want = input.glassRedukcia.get(g.id);
			if (want !== undefined && (want ? 1 : 0) !== curVal) {
				glassZmeny.push({ id: g.id, nazov: g.nazov, stara: curVal, nova: want ? 1 : 0 });
				zmeny.push({
					pole: `Sklo „${g.nazov}" nuluje Redukciu 6mm`,
					stara: curVal,
					nova: want ? 1 : 0
				});
			}
		}
	}

	// #440: per-sklo korekcia rozmeru skla — rovnaký per-systém, ROW-ID kľúčovaný princíp ako
	// redukcia vyššie (to isté meno skla môže žiť vo viacerých systémoch — UNIQUE(nazov, system);
	// zapisujeme `WHERE id=?`, takže rovnaký názov v inom systéme sa nikdy nedotkne). NULL = zruš
	// override (systémový skloOffset), 0 je legitímna explicitná hodnota — preto porovnávame
	// identitou (číslo vs NULL), nie truthiness.
	const glassKorekciaZmeny: { id: number; nova: number | null }[] = [];
	if (input.glassKorekcia) {
		for (const g of glassTypesForSystem(systemFromSysStyl(input.sysStyl))) {
			const cur = g.skloKorekcia; // number | null
			const want = input.glassKorekcia.get(g.id);
			if (want !== undefined && want !== cur) {
				glassKorekciaZmeny.push({ id: g.id, nova: want });
				zmeny.push({
					pole: `Sklo „${g.nazov}" korekcia rozmeru`,
					stara: cur ?? 'systémová',
					nova: want ?? 'systémová'
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
	const updGlass = db.prepare('UPDATE glass_types SET redukcia_zero = ? WHERE id = ?');
	const updGlassKorekcia = db.prepare('UPDATE glass_types SET sklo_korekcia = ? WHERE id = ?');
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
			for (const g of glassZmeny) updGlass.run(g.nova, g.id);
			// #440: NULL sa zapíše ako SQL NULL (better-sqlite3 viaže JS null → NULL) → zruší override
			for (const g of glassKorekciaZmeny) updGlassKorekcia.run(g.nova, g.id);
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
			// role ∈ Object.keys(byRole) → byRole[role] je vždy definované
			for (const role in byRole)
				if (byRole[role]!.size > 1)
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
