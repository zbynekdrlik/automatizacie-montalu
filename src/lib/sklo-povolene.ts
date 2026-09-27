// #573 (meeting výroba 25.9.2026, ROZHODNUTÉ 27.9. na tickete): ktoré sklá smie nárezák
// zasklení per SYSTÉM ponúknuť. JEDINÝ zdroj pravdy — klient ním filtruje ponuku „Sklo
// (základ)" (single aj multi posuv), server (`parseVstup`/`parseMultiVstup`, `znova`) ním
// odmieta nový vstup mimo zoznamu.
//
// ZÁMERNE je to allow-list NAD výpočtovým katalógom `glass_types`, NIE zmena katalógu:
// katalóg ostáva nedotknutý (Money-neutrálne, `money_kod` bez zmeny) a uložené staré odpisy
// so sklom, ktoré už ponuka nemá (napr. Robust 3.3.1), sa dajú ďalej PREPOČÍTAŤ — `skloPre`
// (rekomputa backfill/kiosk) tento zoznam neaplikuje (lekcia #570: zmazané sklo = 0 riadkov
// nárezáku na kiosku).
//
// Systém BEZ záznamu = bez obmedzenia (celý katalóg systému, ako doteraz): starý Štandard
// („bez zmeny" v tabuľke), Drevostavby, Slide. Kľúč = cfg systém (`Štandard +` = Štandard plus).
// Zmena zoznamu (napr. keď Patrik pošle presný zoznam) = úprava LEN tu; názvy musia byť riadky
// katalógu systému (stráži `tests/sklo-povolene.test.ts`).
import { SKLO_INE, SKLO_TRIEDY, type SkloTrieda } from './sklo';

interface PovoleneSkla {
	/** povolené katalógové sklá (`glass_types.nazov` v katalógu systému) */
	readonly nazvy: readonly string[];
	/** povolené hrúbkové triedy vlastnej skladby („Iné (vlastná skladba)", `SKLO_INE`) —
	 *  inak by „Iné" allow-list obišlo */
	readonly triedyIne: readonly SkloTrieda[];
}

export const POVOLENE_SKLA: Readonly<Record<string, PovoleneSkla>> = {
	// 6 mm a 10 mm; predvolené 10 mm rieši `defaultSklo` (#431)
	Deluxe: {
		nazvy: ['Float kalené 6 mm', 'Float kalené 10 mm'],
		triedyIne: [6, 10]
	},
	// LEN skladby 24 mm (4/16/4) číre a mliečne — žiadne 3.3.1/3.3.2/4/6/10 mm ani 4/8/4
	Robust: {
		nazvy: ['Izolačné sklo 4/16/4 číre', 'Izolačné sklo 4/16/4 mliečne'],
		triedyIne: [24]
	},
	// Štandard plus: izolačné (trieda 16 — 4/8/4 aj 4/16/4), 6 mm, 3.3.1 (ako 6 mm, #214);
	// NIE Float/ESG 4 mm (scr_017, ani pri 3K) a NIE 10 mm (#504)
	'Štandard +': {
		nazvy: [
			'Float sklo 6 mm',
			'ESG kalené 6 mm',
			'3.3.1',
			'3.3.1 mliečne',
			'Izolačné sklo 4/8/4 číre',
			'Izolačné sklo 4/8/4 mliečne',
			'Izolačné sklo 4/8/4 stopsol',
			'Izolačné sklo 4/16/4 číre',
			'Izolačné sklo 4/16/4 mliečne',
			'Izolačné sklo 4/16/4 stopsol'
		],
		triedyIne: [6, 16, 24]
	}
};

/** Povolené hrúbkové triedy vlastnej skladby pre systém (bez záznamu = všetky). */
export function povoleneTriedyIne(system: string): readonly number[] {
	return POVOLENE_SKLA[system]?.triedyIne ?? SKLO_TRIEDY;
}

/** Smie nárezák pre `system` ponúknuť/prijať sklo `sklo`? Pri vlastnej skladbe (`SKLO_INE`)
 *  rozhoduje hrúbková trieda; chýbajúca trieda sa tu NEodmieta (tú hlási vlastná validácia
 *  „vyber hrúbkovú triedu"). */
export function skloPovolene(system: string, sklo: string, skloTrieda?: number | null): boolean {
	const p = POVOLENE_SKLA[system];
	if (!p) return true;
	if (sklo === SKLO_INE)
		return skloTrieda == null || (p.triedyIne as readonly number[]).includes(skloTrieda);
	return p.nazvy.includes(sklo);
}

/** Katalógové sklá systému zúžené na allow-list (poradie katalógu zachované). */
export function filtrujPovoleneSkla(system: string, skla: string[]): string[] {
	return skla.filter((g) => skloPovolene(system, g));
}
