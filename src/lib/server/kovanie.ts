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
import { komponentyPre, KOVANIE_NEUPLNE, platneFarbyPre, predvolenaFarba } from './komponenty-cfg';
import type { Polozka } from './money';

/**
 * Rozlíšenie farby krytiek/komponentov pre JEDEN posuv (#537 / gk #6413, design r2).
 * `farbaKovania` je jedno objednávkové pole zdieľané všetkými posuvmi; systémy majú
 * RÔZNE farebné dvojice (Robust R9005/R7016, Deluxe 10mm R9006/R7016, 6mm R9006/R9005,
 * Slide len R7016), preto sa farba musí vyriešiť PER SPEC:
 *
 *  - systém bez farebných variantov pri tejto hrúbke → farbo-neutrálny, `farbaKovania`
 *    prejde nedotknutá (napr. chýbajúca hrúbka → chyba padne až v `pocitajKomponenty`);
 *  - `farbaKovania` platná pre tento systém+hrúbku → použije sa;
 *  - `farbaKovania` nezvolená (`undefined`) → nechá sa `undefined` (obrana in-depth:
 *    `pocitajKomponenty` vyhlási „nezvolená farba" — NIKDY tichý default na jednu z farieb);
 *  - `farbaKovania` zvolená, tomuto posuvu nesedí, ale sedí INÉMU posuvu objednávky
 *    (`platneVObjednavke`) → legitímna objednávková farba, len na tento systém neplatí →
 *    `predvolenaFarba(system)`, ak je platná; inak HLASNÁ chyba menujúca systém + platné farby;
 *  - `farbaKovania` nesedí ŽIADNEMU posuvu objednávky → operátorská voľba je zlá →
 *    HLASNÁ chyba (zachováva #354: nikdy tichý odpis bez farebnej rodiny).
 *
 * Nikdy sa netvorí druhý zoznam validity — číta sa z `platneFarbyPre` (komponenty-cfg).
 */
export function farbaPreSpec(
	system: string,
	skloHrubka: number | undefined,
	farbaKovania: Farba | undefined,
	platneVObjednavke: ReadonlySet<Farba>
): { farba?: Farba; chyba?: string } {
	const platne = platneFarbyPre(system, skloHrubka);
	if (platne.length === 0) return { farba: farbaKovania }; // farbo-neutrálny systém
	if (farbaKovania !== undefined && platne.includes(farbaKovania)) return { farba: farbaKovania };
	if (farbaKovania === undefined) return { farba: undefined }; // obrana in-depth v pocitajKomponenty
	// farbaKovania je zvolená, ale tomuto posuvu nesedí:
	if (platneVObjednavke.has(farbaKovania)) {
		// sedí INÉMU posuvu objednávky → tento posuv dostane svoju predvolenú farbu
		const pred = predvolenaFarba(system);
		if (pred !== undefined && platne.includes(pred)) return { farba: pred };
		return {
			chyba: `systém ${system} — zvolená farba ${farbaKovania} preň nie je platná (platné: ${platne.join(', ')}) a systém nemá predvolenú farbu krytiek; vyber platnú RAL farbu.`
		};
	}
	// farbaKovania nesedí ŽIADNEMU posuvu objednávky → zlá operátorská voľba
	return {
		chyba: `zvolená farba ${farbaKovania} nesedí na žiadnu farebnú položku (systém ${system}, platné: ${platne.join(', ')}) — skontroluj RAL voľbu, inak by odpis nedostal žiadnu z týchto položiek.`
	};
}

/**
 * Kód uzáveru/zámku daného systému — kotva, na ktorej visí počet ďalších položiek
 * (podložka, protikus…). Pri Štandarde AJ Slide (#353) je zámok farebne rozdelený na
 * dva RAL kódy s IDENTICKÝM `konstPreStyl` — kotva ukazuje na jeden z nich, počet
 * zámkov je farbo-nezávislý (invariant drží config-test), takže je jedno, ktorý
 * variant sa nájde. Slide: pôvodná ZASK20254 zrušená (#353), nahradená
 * ZASK202538 (R7016) / ZASK202537 (R9005) — kotva ukazuje na R7016.
 */
const KOD_UZAVERU: Record<string, string> = {
	Robust: 'ZASK00029',
	Slide: 'ZASK202538',
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

	// #537 (r2): objednávková množina platných farieb — únia platných farieb VŠETKÝCH
	// posuvov. Rozhoduje, či je zvolená `farbaKovania` legitímna objednávková voľba
	// (sedí aspoň jednému posuvu → nesediaci posuv spadne na predvolenú), alebo úplne
	// zlá voľba (nesedí žiadnemu → hlasná chyba). Pozri `farbaPreSpec`.
	const platneVObjednavke = new Set<Farba>();
	for (const spec of specs)
		for (const f of platneFarbyPre(spec.sysStyl.split('|')[0] ?? '', spec.skloHrubka))
			platneVObjednavke.add(f);

	for (const [i, spec] of specs.entries()) {
		const system = spec.sysStyl.split('|')[0] ?? '';
		const komponenty = komponentyPre(system);
		if (!komponenty) continue; // systém kovanie do odpisu (zatiaľ) nedáva

		// #537 (r2): farba sa rieši PER SPEC (jedno objednávkové pole, rôzne farebné
		// dvojice per systém) — JEDEN zdroj pravdy rezolúcie. Deluxe posuv, ktorému
		// zvolená farba nesedí (napr. R9005 na 10mm), dostane predvolenú R9006; systém
		// bez predvolenej (Robust/Štandard/Slide) s nesediacou farbou → hlasná chyba.
		const { farba: efektivnaFarba, chyba: farbaChyba } = farbaPreSpec(
			system,
			spec.skloHrubka,
			farbaKovania,
			platneVObjednavke
		);
		if (farbaChyba)
			return { polozky: [], err: `Kovanie, posuv ${i + 1}: ${farbaChyba}`, warn: null };

		// KOVANIE_NEUPLNE hodnota je buď pevný text (Štandard), alebo funkcia hrúbky
		// skla + farby kovania (Slide: madlo vždy, zámok len pri R9005, #357) — obe
		// tvary tu vyhodnotíme rovnako, nikdy natvrdo neporovnávaj `system ===
		// 'Deluxe'`/`'Slide'`. Deluxe kľúč tu NIE JE (#431 kolo 2: 6mm aj 10mm krytky
		// sú v odpise → Deluxe kovanie je kompletné), `KOVANIE_NEUPLNE[system]` je vtedy
		// undefined = žiadne varovanie. Používa už ROZLÍŠENÚ `efektivnaFarba` (#537).
		const neuplneRaw = KOVANIE_NEUPLNE[system];
		const neuplne =
			typeof neuplneRaw === 'function' ? neuplneRaw(spec.skloHrubka, efektivnaFarba) : neuplneRaw;
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
			efektivnaFarba,
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
