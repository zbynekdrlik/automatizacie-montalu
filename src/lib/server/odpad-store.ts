// #417 faza 2: ukladanie per-profil odpadu z narezov do DB pri odpise, aby Odoo note builder
// (`pushZakazkaToOdoo`) ich vedel precitat pri re-derivacii a retry (#349).
//
// Money-NEUTRALNE: importuje LEN `db` + ciste `normZak/normOp` (rovnaka disciplina ako
// `odoo-zakazka-store.ts`). Ziadny import `money.ts` modulu, ziadne zmeny dedup/import cesty.
//
// Volane z form akcii zasklenia/sietka PO uspesnom `writeOdpis` (status='written') —
// money.ts sa NEMENI (tvrda hranica dispatchu).
import { db } from './db';
import { normZak, normOp } from './money';
import { logger } from './log';

const log = logger('odpad-store');

export interface OdpadRow {
	profilKod: string;
	profilNazov: string;
	odpadMm: number;
	materialMm: number;
	tyce: number;
}

/**
 * Ulozi per-profil odpad z narezov priradeny k najnovsiemu `odpis_log` zaznamu
 * pre dany zak/op. Volane z form akcie PO `writeOdpis` (nie z money.ts — tvrda
 * hranica). Replace semantika: existujuce odpad riadky sa zmazou a nahradia novymi
 * (posledny odpis vyhranova — rovnaky princip ako note snapshot v odoo-zakazka).
 *
 * `material` je pole `MaterialRow` z compute vysledku — len profily s `tyce > 0`
 * sa ulozia (rovnaka filter logika ako `sumaOdpad` v display vrstve).
 */
export function saveOdpisOdpad(
	zakRaw: string,
	opRaw: string,
	material: { kod: string; nazov: string; odpadMm: number; tyce: number; barLen: number }[]
): void {
	const zakN = normZak(zakRaw);
	const opN = normOp(opRaw);
	// Najdi najnovsie odpis_log.id pre tento zak/op (prave insertovane writeOdpis-om).
	const row = db
		.prepare('SELECT id FROM odpis_log WHERE zak_norm = ? AND op_norm = ? ORDER BY id DESC LIMIT 1')
		.get(zakN, opN) as { id: number } | undefined;
	if (!row) {
		log.warn('saveOdpisOdpad: odpis_log sa nenasiel (neocakavane)', { zak: zakRaw, op: opRaw });
		return;
	}
	const odpisLogId = row.id;
	const pouzite = material.filter(
		(m) => m.tyce > 0 && Number.isFinite(m.barLen) && Number.isFinite(m.odpadMm)
	);
	db.transaction(() => {
		// Replace semantika: zmaz existujuce riadky pre toto odpis_log.id
		db.prepare('DELETE FROM odpis_odpad WHERE odpis_log_id = ?').run(odpisLogId);
		const ins = db.prepare(
			'INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES (?, ?, ?, ?, ?, ?)'
		);
		for (const m of pouzite) {
			ins.run(
				odpisLogId,
				m.kod,
				m.nazov,
				Math.round(m.odpadMm),
				Math.round(m.tyce * m.barLen),
				m.tyce
			);
		}
	})();
	log.info('saveOdpisOdpad: ulozene', {
		zak: zakRaw,
		op: opRaw,
		odpisLogId,
		profilov: pouzite.length
	});
}

/**
 * Precita agregovany odpad napriec odpis_log idckami (scope odpisy zakazky).
 * GROUP BY profil_kod, SUM(odpad_mm), SUM(material_mm), SUM(tyce); nazov
 * z najnovsieho vyskytu (rovnaky vzor ako polozky v zakazkaPrehlad).
 * Prazdne pole ak ziadne odpisy nemaju odpadove data.
 */
export function getOdpadForOdpisy(odpisLogIds: number[]): OdpadRow[] {
	if (odpisLogIds.length === 0) return [];
	// SQLite nema array parameter — pouzijeme IN s placeholdermi
	const placeholders = odpisLogIds.map(() => '?').join(',');
	// MAX(profil_nazov) namiesto bare stĺpca — SQLite GROUP BY bez agregátu
	// vracia nedeterministicky; MAX dáva najnovší abecedne (funguje pre rovnaké
	// kódy s mierne odlišným názvom; rovnaký vzor ako zakazkaPrehlad prepisuje
	// nazov najnovším výskytom).
	const rows = db
		.prepare(
			`SELECT profil_kod, MAX(profil_nazov) AS profil_nazov, SUM(odpad_mm) AS odpad_mm,
			        SUM(material_mm) AS material_mm, SUM(tyce) AS tyce
			 FROM odpis_odpad
			 WHERE odpis_log_id IN (${placeholders})
			 GROUP BY profil_kod
			 ORDER BY profil_kod`
		)
		.all(...odpisLogIds) as {
		profil_kod: string;
		profil_nazov: string;
		odpad_mm: number;
		material_mm: number;
		tyce: number;
	}[];
	return rows.map((r) => ({
		profilKod: r.profil_kod,
		profilNazov: r.profil_nazov,
		odpadMm: r.odpad_mm,
		materialMm: r.material_mm,
		tyce: r.tyce
	}));
}
