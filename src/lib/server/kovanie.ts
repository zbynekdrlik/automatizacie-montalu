// Kovanie do Money odpisu — mostík medzi nárezovým plánom a položkami do xlsx.
//
// Prečo cez `computeFlat` per posuv a nie z `computeMulti`: multi-výsledok materiál
// POOLUJE po kóde naprieč posuvmi (zdieľané tyče), takže z neho už nevytiahneš, koľko
// krídel/nosových profilov mal ktorý posuv. Kovanie sa preto počíta pre každý posuv
// samostatne a až potom zlúči — kusy sa sčítajú, nič sa nezdieľa.
//
// MONEY-KRITICKÉ: keď sa počet nedá určiť (systém bez tabuľky, štýl bez konštanty),
// vracia sa CHYBA a odpis sa neodošle. Tichá nula by znamenala, že kovanie zo skladu
// nikdy neodíde a nikto si to nevšimne.
import { pocitajKomponenty, pocetUzaverov, zlucKomponenty } from '$lib/komponenty';
import type { PolozkaKomponentu, Farba } from '$lib/komponenty';
import { computeFlat, zakladPoctov, type Cfg, type PosuvSpec } from './compute';
import { komponentyPre, KOVANIE_NEUPLNE } from './komponenty-cfg';
import type { Polozka } from './money';

/**
 * Kód uzáveru/zámku daného systému — kotva, na ktorej visí počet ďalších položiek
 * (podložka, protikus…). Pri Štandarde je zámok farebne rozdelený na dva RAL kódy
 * (ZASK202531/202532) s IDENTICKÝM `konstPreStyl` — kotva ukazuje na jeden z nich,
 * počet zámkov je farbo-nezávislý (invariant drží config-test), takže je jedno,
 * ktorý variant sa nájde.
 */
const KOD_UZAVERU: Record<string, string> = {
	Robust: 'ZASK00029',
	Slide: 'ZASK20254',
	Štandard: 'ZASK202531'
};

/**
 * Položky kovania pre celú zákazku (jeden alebo viac posuvov).
 *
 * @param jednostrannaFab výnimka, ktorú zaškrtne dielňa — Dominik: „jednostranná FAB
 *   chodí jeden zo 100", takže predvolené je obojstranné (2 ks kľučky a krytky vložky).
 * @param farbaKovania zvolená RAL farba kovania — vyberá, ktorý farebný variant
 *   položky ide do odpisu (kľučka/krytka vložky R9005 vs R7016, Štandard zámok).
 *   Keď systém má farebnú položku a farba nie je zvolená → HLASNÁ chyba.
 * @returns `polozky` do Money xlsx (prázdne, keď systém kovanie zatiaľ nedáva — napr.
 *   Slide, kým jeho kódy nemajú skladovú zásobu), `err` s prvou chybou a `warn` s
 *   upozornením na neúplné kovanie (Štandard: chýbajú tesnenia/kefy).
 */
export function kovanieDoOdpisu(
	cfg: Cfg,
	specs: PosuvSpec[],
	jednostrannaFab: boolean,
	farbaKovania?: Farba
): { polozky: Polozka[]; err: string | null; warn: string | null } {
	const davky: PolozkaKomponentu[][] = [];
	const varovania = new Set<string>();

	for (const [i, spec] of specs.entries()) {
		const system = spec.sysStyl.split('|')[0] ?? '';
		const komponenty = komponentyPre(system);
		if (!komponenty) continue; // systém kovanie do odpisu (zatiaľ) nedáva
		// KOVANIE_NEUPLNE hodnota je buď pevný text (Štandard), alebo funkcia hrúbky
		// skla (Deluxe: neúplné len pri 6mm, #354 review nález) — obe tvary tu
		// vyhodnotíme rovnako, nikdy natvrdo neporovnávaj `system === 'Deluxe'`.
		const neuplneRaw = KOVANIE_NEUPLNE[system];
		const neuplne = typeof neuplneRaw === 'function' ? neuplneRaw(spec.skloHrubka) : neuplneRaw;
		if (neuplne) varovania.add(neuplne);

		// VEDOME sa sem neposiela `spec.sietka` — sieťka mení len profily (rám/nos/
		// koľajnica, #86 korekcia 2026-08-02), NIE kovanie. Patrik nikdy nepotvrdil
		// žiadnu hardvérovú položku naviac za sieťku, takže `zakladPoctov(r)` nižšie
		// musí vychádzať z počtov BEZ sieťky — pridanie by bolo hádanie kusov, presne
		// to, čo tento modul zakazuje (fail-loud namiesto tichého čísla).
		const r = computeFlat(
			cfg,
			spec.sysStyl,
			spec.S,
			spec.V,
			spec.redukciaZero,
			spec.skloHrubka ?? 0,
			spec.pridavnaKolajnica ?? false,
			spec.kolajnica
		);
		if (!r)
			return {
				polozky: [],
				err: `Kovanie: posuv ${i + 1} (${spec.sysStyl}) sa nedá spočítať — chýba konfigurácia nárezáka.`,
				warn: null
			};

		const uzaver = komponenty.find((k) => k.kod === KOD_UZAVERU[system]);
		const { polozky, chyby } = pocitajKomponenty(
			komponenty,
			spec.sysStyl,
			zakladPoctov(r),
			uzaver ? pocetUzaverov(uzaver, spec.sysStyl) : null,
			!jednostrannaFab,
			farbaKovania,
			// Deluxe krytky majú Money kód aj per hrúbka skla (#354) — rovnaký vstup,
			// ktorý si už berie `computeFlat` vyššie na výber kladkového/klzného profilu.
			spec.skloHrubka
		);
		if (chyby.length)
			return { polozky: [], err: `Kovanie, posuv ${i + 1}: ${chyby[0]!.sprava}`, warn: null };
		davky.push(polozky);
	}

	return {
		polozky: zlucKomponenty(davky).map((p) => ({
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj
		})),
		err: null,
		warn: varovania.size ? [...varovania].join(' ') : null
	};
}
