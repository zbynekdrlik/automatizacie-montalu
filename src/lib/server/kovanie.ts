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
import type { PolozkaKomponentu } from '$lib/komponenty';
import { computeFlat, zakladPoctov, type Cfg, type PosuvSpec } from './compute';
import { komponentyPre } from './komponenty-cfg';
import type { Polozka } from './money';

/** Kód uzáveru/zámku daného systému — kotva, na ktorej visí 6 ďalších položiek. */
const KOD_UZAVERU: Record<string, string> = { Robust: 'ZASK00029', Slide: 'ZASK20254' };

/**
 * Položky kovania pre celú zákazku (jeden alebo viac posuvov).
 *
 * @param jednostrannaFab výnimka, ktorú zaškrtne dielňa — Dominik: „jednostranná FAB
 *   chodí jeden zo 100", takže predvolené je obojstranné (2 ks kľučky a krytky vložky).
 * @returns `polozky` do Money xlsx (prázdne, keď systém kovanie zatiaľ nedáva — napr.
 *   Slide, kým jeho kódy nemajú skladovú zásobu) a `err` s prvou chybou.
 */
export function kovanieDoOdpisu(
	cfg: Cfg,
	specs: PosuvSpec[],
	jednostrannaFab: boolean
): { polozky: Polozka[]; err: string | null } {
	const davky: PolozkaKomponentu[][] = [];

	for (let i = 0; i < specs.length; i++) {
		const spec = specs[i];
		const system = spec.sysStyl.split('|')[0];
		const komponenty = komponentyPre(system);
		if (!komponenty) continue; // systém kovanie do odpisu (zatiaľ) nedáva

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
				err: `Kovanie: posuv ${i + 1} (${spec.sysStyl}) sa nedá spočítať — chýba konfigurácia nárezáka.`
			};

		const uzaver = komponenty.find((k) => k.kod === KOD_UZAVERU[system]);
		const { polozky, chyby } = pocitajKomponenty(
			komponenty,
			spec.sysStyl,
			zakladPoctov(r),
			uzaver ? pocetUzaverov(uzaver, spec.sysStyl) : null,
			!jednostrannaFab
		);
		if (chyby.length) return { polozky: [], err: `Kovanie, posuv ${i + 1}: ${chyby[0].sprava}` };
		davky.push(polozky);
	}

	return {
		polozky: zlucKomponenty(davky).map((p) => ({
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj
		})),
		err: null
	};
}
