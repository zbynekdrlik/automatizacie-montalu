// #577 (Marek D., Odoo úloha 1181): posledné odoslanie objednávky skla do Odoo per podklad +
// priamy odkaz na vytvorenú `montalu.glass.order` („nech to nemusí hľadať"). Uloží sa po ÚSPEŠNOM
// uploade, ktorý vrátil `glass_order_id` (v2 intake, `parseOdooOutcome`), takže odkaz ostane na
// podklade aj po obnovení stránky. Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { db } from './db';
import { normZak } from './money';
import { logger } from './log';
import { odooJson2Config } from './odoo-json2';
import { formatDatumCasSk, sqliteUtcToIso } from '../datum';

const log = logger('objednavka-skla-odoslanie');

/** Montalu Odoo inštancia — fallback, keď appka nemá Odoo konfiguráciu (`ODOO_JSON2_URL`). */
const ODOO_BASE_URL = 'https://erp.montalu.cloud';
/**
 * Odoo akcia „Objednávky skla" pre JEDNODUCHÉ objednávky (`montalu.glass.order`,
 * `pricing_mode='simple'` — menu „Sales/Orders/Objednávky skla"), ktoré appka zakladá. odoo-erp 7894
 * rozdelil akcie: 1008 je odvtedy CENNÍKOVÁ objednávka (`pricing_mode='cennik'`) — otvorila by našu
 * objednávku v cenníkovom formulári a breadcrumb by viedol na zoznam bez nej. Odkaz sa NEUKLADÁ
 * (v DB je len `glass_order_id`), takže zmena akcie opraví aj odkazy skôr odoslaných podkladov.
 */
const ODOO_AKCIA_OBJEDNAVKY_SKLA = 1015;

export interface OdoslanieOdoo {
	glassOrderId: number;
	/** OSK názov objednávky (prázdny, keď ho Odoo nevrátilo). */
	name: string;
	/** prihlasovacie meno, kto odoslal */
	odoslal: string;
	/** kedy (Europe/Bratislava, „d.m.rrrr h:mm") */
	odoslaneKedy: string;
	url: string | null;
}

/**
 * Odkaz na objednávku skla v Odoo: `<base>/odoo/action-<ODOO_AKCIA_OBJEDNAVKY_SKLA>/<id>`. Base = existujúca Odoo
 * konfigurácia appky (`ODOO_JSON2_URL`, base URL inštancie), inak Montalu Odoo. Neplatné id
 * (nie kladné celé číslo) → `null` (radšej žiadny odkaz než mŕtvy).
 */
export function odooObjednavkaSklaUrl(glassOrderId: number): string | null {
	if (!Number.isInteger(glassOrderId) || glassOrderId <= 0) return null;
	const base = (odooJson2Config()?.url ?? ODOO_BASE_URL).replace(/\/+$/, '');
	return `${base}/odoo/action-${ODOO_AKCIA_OBJEDNAVKY_SKLA}/${glassOrderId}`;
}

const stmtUloz = db.prepare(`
	INSERT INTO objednavka_skla_odoslanie (zak_norm, glass_order_id, name, odoslane_at, odoslal)
	VALUES (?, ?, ?, datetime('now'), ?)
	ON CONFLICT(zak_norm) DO UPDATE SET
		glass_order_id = excluded.glass_order_id,
		name = excluded.name,
		odoslane_at = excluded.odoslane_at,
		odoslal = excluded.odoslal
`);

const stmtPosledne = db.prepare(`
	SELECT glass_order_id, name, odoslane_at, odoslal
	FROM objednavka_skla_odoslanie WHERE zak_norm = ?
`);

/** Uloží (prepíše) posledné odoslanie podkladu zákazky. Neplatné id → throw (nič sa neuloží). */
export function ulozOdoslanieOdoo(
	zak: string,
	odoo: { glassOrderId: number; name?: string },
	odoslal: string
): void {
	if (!Number.isInteger(odoo.glassOrderId) || odoo.glassOrderId <= 0)
		throw new Error(`Neplatné id objednávky skla v Odoo: ${odoo.glassOrderId}`);
	const zakNorm = normZak(zak);
	stmtUloz.run(zakNorm, odoo.glassOrderId, odoo.name ?? '', odoslal);
	log.info('odoslanie objednávky skla uložené k podkladu', {
		zak: zakNorm,
		glassOrderId: odoo.glassOrderId,
		name: odoo.name ?? '',
		odoslal
	});
}

/** Posledné odoslanie podkladu zákazky (s odkazom do Odoo), alebo `null`. */
export function posledneOdoslanieOdoo(zak: string): OdoslanieOdoo | null {
	const r = stmtPosledne.get(normZak(zak)) as
		{ glass_order_id: number; name: string; odoslane_at: string; odoslal: string } | undefined;
	if (!r) return null;
	return {
		glassOrderId: r.glass_order_id,
		name: r.name,
		odoslal: r.odoslal,
		odoslaneKedy: formatDatumCasSk(sqliteUtcToIso(r.odoslane_at)),
		url: odooObjednavkaSklaUrl(r.glass_order_id)
	};
}
