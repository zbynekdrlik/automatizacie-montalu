// „Prídavná koľajnica" z HISTÓRIE odpisu (#618, Odoo úloha 1459).
//
// Starý „Štandard" IZO mal do v60 prídavnú (o veľkosť väčšiu) spodnú koľajnicu NATVRDO vo vzorci
// a checkbox „Prídavná koľajnica" sa pri ňom neukázal — uložený odpis má preto v `detail`
// `pridavnaKolajnica: false`, hoci do Money išla zväčšená spodná. Od v60 je vo vzorci základná a
// zväčšenú pridá len checkbox. Kto starý odpis znova počíta („Použiť znova", rekomputa nárezáka
// pre kiosk / backfill), musí flag ODVODIŤ, inak by dal inú koľajnicu, než išla do Money.
//
// Hranica „starý odpis": nové odpisy zasklení nesú v `detail` príznak `PRIDAVNA_VOLBA_DETAIL`
// (`+page.server.ts` `jobFor`/`jobForMulti`); bez neho = odpis spred zmeny. Samotný flag hranicu
// určiť nevie (pri starom Štandarde bol vždy false) a dátum ani verzia v `detail` nie sú.
//
// Money: modul nič nezapisuje — len vráti flag, ktorý sa pošle do rovnakého výpočtu ako pri
// novom zadaní (obsluha výsledok vidí v náhľade pred odoslaním).
import { plusRailEligible, zakladnyStyl, STANDARD } from '$lib/styl';
import { potrebuje3KKolajnicu, type Sietka } from '$lib/sietka';
import { jeSietkaMoneyRelevant } from './compute-sietka';

/** Príznak nového pravidla v `odpis_log.detail` zasklení (spread do detailu pri odpise). */
export const PRIDAVNA_VOLBA_DETAIL = { pridavnaVolbaStandard: true } as const;

/** Upozornenie pre obsluhu pri „Použiť znova", keď sa starý odpis jednou voľbou zopakovať nedá. */
export const POZOR_PRIDAVNA_Z_HISTORIE =
	'Prídavná koľajnica: pôvodný odpis sa počítal podľa staršieho pravidla (pri izolačnom skle ' +
	'starého Štandardu bola spodná koľajnica zväčšená vždy) a teraz sa nedá zopakovať presne — ' +
	'pred odoslaním skontroluj spodné koľajnice v náhľade (voľba „Prídavná koľajnica" platí pre ' +
	'celú objednávku, pri sieťke na 2K určuje koľajnice sieťka).';

interface PosuvHistorie {
	system: string;
	/** VYPOČÍTANÝ štýl (s príponou „ IZO", ako ho uložil odpis — `ComputeResult.styl`) */
	styl: string;
	sietka: Sietka | null;
}

const text = (x: unknown): string => (typeof x === 'string' ? x : '');
const sietkaZ = (x: unknown): Sietka | null => (x && typeof x === 'object' ? (x as Sietka) : null);

/** Posuvy z uloženého detailu — viac posuvov (`posuvy`) alebo jeden (polia na vrchu). */
function posuvyZDetailu(detail: Record<string, unknown>): PosuvHistorie[] {
	const zoznam = Array.isArray(detail.posuvy)
		? (detail.posuvy as Record<string, unknown>[])
		: [detail];
	return zoznam
		.map((p) => ({ system: text(p.system), styl: text(p.styl), sietka: sietkaZ(p.sietka) }))
		.filter((p) => p.system && p.styl);
}

/**
 * Hodnota checkboxu „Prídavná koľajnica", ktorá ZOPAKUJE uložený odpis pod dnešným pravidlom.
 *
 * - nový odpis (príznak) → `ulozena` bez zmeny;
 * - starý odpis: posuv starého Štandardu IZO potrebuje `true` (spodná bola natvrdo zväčšená),
 *   basic `false` (prídavná tam nikdy nebola), iný systém `ulozena` (pravidlo sa preň nezmenilo);
 *   posuv, kde koľajnicu určuje sieťka na 2K, flag NEPOTREBUJE (nehlasuje — inak by vyrobil
 *   falošný konflikt s ostatnými posuvmi); starý Štandard IZO tam ale dostal 4K spodnú, dnes
 *   (rovnako ako Štandard +) 3K → `presne: false`, a keď nič iné flag neurčí, predvyplní sa
 *   `true` (pôvodný význam — platí, keď obsluha sieťku vypne);
 * - posuvy potrebujú rôzne hodnoty (checkbox je jeden na objednávku) → `ulozena`, `presne: false`.
 */
export function pridavnaKolajnicaZHistorie(
	detail: Record<string, unknown>,
	ulozena: boolean
): { pridavna: boolean; presne: boolean } {
	if (detail.pridavnaVolbaStandard === true) return { pridavna: ulozena, presne: true };
	const potrebne = new Set<boolean>();
	let presne = true;
	let sietkaStaryIzo = false;
	for (const p of posuvyZDetailu(detail)) {
		if (!plusRailEligible(p.system, p.styl)) continue;
		const staryIzo = p.system === STANDARD && zakladnyStyl(p.styl) !== p.styl;
		if (jeSietkaMoneyRelevant(p.system, p.styl, p.sietka) && potrebuje3KKolajnicu(p.styl)) {
			if (staryIzo) {
				sietkaStaryIzo = true;
				presne = false;
			}
			continue;
		}
		potrebne.add(p.system === STANDARD ? staryIzo : ulozena);
	}
	if (potrebne.size > 1) return { pridavna: ulozena, presne: false };
	const [jedina] = potrebne;
	return { pridavna: jedina ?? (sietkaStaryIzo || ulozena), presne };
}
