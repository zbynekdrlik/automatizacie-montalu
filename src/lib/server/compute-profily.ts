// Profilové rezy (nárezový plán jedného profilu) + fail-loud guardy
// (oversize/undersize/hrúbka) + „prídavná koľajnica" (rail upsize). Rozdelené
// z compute.ts (#249). Importuj verejné cez fasádu `$lib/server/compute`.
import { rolaKolajnice, type KolajnicaRucne } from '$lib/kolajnica';
import { plusRailEligible } from '$lib/styl';
import {
	BAR,
	KOTUC,
	sietkaExtraPocetKs,
	val,
	type Cfg,
	type CfgGroup,
	type Kus,
	type RezRow
} from './compute-model';

/** Rezy jedného profilu (naprieč rez-riadkami S aj V) pre jeden posuv — BEZ
 *  balenia. `posuv` (1-based) sa vloží do každého kusu, aby ho vedel rozpis
 *  označiť pri viac-posuvovom pláne. Zdieľané computeFlat aj computeMulti. */
export interface ProfilCuts {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	kusy: Kus[];
	/** dĺžka tyče tohto profilu (mm) — z RezRow.dlzkaTyce, default BAR */
	barLen: number;
}

export function profilCuts(
	g: CfgGroup,
	S: number,
	V: number,
	N: number,
	redukciaZero: boolean,
	skloHrubka: number,
	posuv?: number,
	rucnaKolajnica?: KolajnicaRucne,
	sietkaOn = false,
	system = ''
): ProfilCuts[] {
	const order: string[] = [];
	const byKod: Record<string, RezRow[]> = {};
	const sh = Number(skloHrubka) || 0; // normalizuj (SQLite INTEGER, ale buď odolný voči '6')
	for (const r of g.rez) {
		// hrúbka-závislý riadok (Deluxe kladka/klzný pre 6mm alebo 10mm sklo) sa
		// zahrnie LEN keď sedí zvolená hrúbka skla; 0 = platí vždy (Robust/Slide)
		const rh = Number(r.skloHrubka) || 0;
		if (rh !== 0 && rh !== sh) continue;
		let bucket = byKod[r.kod];
		if (!bucket) {
			bucket = [];
			byKod[r.kod] = bucket;
			order.push(r.kod);
		}
		bucket.push(r);
	}
	return order.map((kod) => {
		// INVARIANT: `order` obsahuje len kódy, ktorých `byKod[kod]` sa VYTVORIL a
		// dostal aspoň jeden riadok v tej istej iterácii vyššie → `rows` je neprázdne.
		const rows = byKod[kod]!;
		const first = rows[0]!;
		const rezy: { rozmer: number; ks: number }[] = [];
		// dĺžka pre balenie je bez prerezu; zobrazený rozmer je s prerezom
		const kusy: Kus[] = [];
		// ručne zadaná dĺžka koľajnice (Patrik): nahradí vypočítanú dĺžku pre TÚTO
		// rolu (horná / spodná). Koľajnice majú kerf 0, takže rezaná = balená dĺžka.
		const rola = rolaKolajnice(first.nazov);
		const rucne = rola ? Number(rucnaKolajnica?.[rola]) || 0 : 0;
		for (const r of rows) {
			const t =
				(Number(r.sklozavisle) && redukciaZero ? 0 : Number(r.pocetKs)) +
				sietkaExtraPocetKs(system, r, sietkaOn);
			const q = rucne > 0 ? rucne : val(r, S, V, N, false);
			const rozmer = rucne > 0 ? rucne : Math.round(val(r, S, V, N, true));
			// SYNC-POINT (#216): `q <= 0` sa tu TICHO zahodí. `undersizeCut` musí mať
			// identický inklúzny predikát (`t` vyššie), aby taký kus zachytil PRED zápisom.
			for (let i = 0; i < t; i++)
				if (q > 0) kusy.push(posuv ? { dlzka: q, rozmer, posuv } : { dlzka: q, rozmer });
			rezy.push({ rozmer, ks: t });
		}
		// dĺžka tyče je vlastnosť profilu (Money článku) — všetky rez-riadky toho
		// istého kódu ju majú rovnakú; ber ju z prvého riadku, default BAR
		const barLen = Number(first.dlzkaTyce) || BAR;
		return { kod, nazov: first.nazov, rezy, kusy, barLen };
	});
}

/**
 * Kus dlhší než jeho tyč sa fyzicky NEDÁ vyrobiť (napr. 6500 mm rez z 6000 mm
 * 5K hornej koľajnice). FFD by taký kus „zabalil" na jednu tyč so záporným
 * odpadom → tyce=1 → odpis do Money PODHODNOTENÝ na polovicu. Preto to zachytíme
 * a výpočet zlyhá s konkrétnou chybou (namiesto tichého zlého odpisu). Vráti
 * správu pre prvý taký profil, inak null. Volá sa v safeCompute PRED zápisom.
 */
export function oversizeCut(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka: number,
	rucnaKolajnica?: KolajnicaRucne
): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	for (const c of profilCuts(g, S, V, g.N, redukciaZero, skloHrubka, undefined, rucnaKolajnica)) {
		for (const k of c.kusy) {
			if (k.dlzka + KOTUC > c.barLen)
				return `Rez ${Math.round(k.rozmer)} mm (${c.nazov}) je dlhší než tyč ${c.barLen} mm — tento rozmer sa z daného profilu nedá vyrobiť. Zmenši rozmer alebo zvoľ iný systém.`;
		}
	}
	return null;
}

/**
 * Zrkadlový SPODNÝ guard k `oversizeCut` (#216). Keď je rozmer priMALÝ, `val()`
 * vráti pre niektorý profil ZÁPORNÚ/nulovú dĺžku a `profilCuts` taký kus TICHO
 * zahodí (`if (q > 0) kusy.push(...)`) → do Money by šiel odpis s CHÝBAJÚCIM
 * profilom (napr. Štandard +|2K 130×130 → kladka ZASP202415 = 0 m, bez chyby).
 * Namiesto tichého zlého odpisu zlyhá NAHLAS s konkrétnou hláškou. Volá sa v
 * safeCompute/safeComputeMulti PRED zápisom, hneď za `oversizeCut`.
 *
 * ⚠️ SYNC-POINT: predikát „ktorý riadok prispieva kusom" (hrúbka-gate, sklozavisle
 * +redukciaZero, `sietkaExtraPocetKs`, ručná koľajnica) MUSÍ ostať 1:1 s `profilCuts`
 * (compute.ts, `t`+`if (q > 0) kusy.push`). Guard nemôže volať `profilCuts` ako
 * `oversizeCut` — potrebuje vidieť práve tie kusy, ktoré `profilCuts` ZAHODÍ (q≤0) —
 * preto sa loop duplikuje; keď meníš inklúziu v `profilCuts`, uprav aj tu. `sietka`
 * sa preto prevlieka až sem (kryje aj hypotetický Robust/Slide rámový/nosový riadok,
 * ktorý by aktivovala až sieťka). Sklová vetva nie je Money-safety (sklo NIE je v
 * Money odpise — viď `computeFlat`), ale záporný rozmer skla = nezmyselný nárez/plán.
 */
export function undersizeCut(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka: number,
	rucnaKolajnica?: KolajnicaRucne,
	sietkaOn = false,
	// #440: per-sklo override korekcie rozmeru skla (NULL → systémový skloOffset) — MUSÍ byť
	// identický ako v computeFlat, inak by sklo-guard testoval iný rozmer než sa reálne vypočíta.
	skloKorekcia: number | null = null
): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	const system = sysStyl.split('|')[0] ?? '';
	const sh = Number(skloHrubka) || 0;
	// Profilové rezy — rovnaká inklúzia riadkov ako `profilCuts` (viď SYNC-POINT).
	for (const r of g.rez) {
		const rh = Number(r.skloHrubka) || 0;
		if (rh !== 0 && rh !== sh) continue; // hrúbko-závislý riadok pre iné sklo
		const pocet =
			(Number(r.sklozavisle) && redukciaZero ? 0 : Number(r.pocetKs)) +
			sietkaExtraPocetKs(system, r, sietkaOn);
		if (pocet <= 0) continue; // riadok neprispieva žiadnym kusom
		// ručne zadaná koľajnica nahradí vypočítanú dĺžku a je vždy > 0 (validované vo vstupe)
		const rola = rolaKolajnice(r.nazov);
		if (rola && Number(rucnaKolajnica?.[rola]) > 0) continue;
		const dlzka = val(r, S, V, g.N, false);
		if (dlzka <= 0)
			return `Rozmer ${S}×${V} mm je pri systéme ${system} priMALÝ — profil ${r.nazov} by vyšiel ${Math.round(dlzka)} mm (≤ 0) a odpis by bol neúplný. Zväčši rozmer alebo zvoľ iný systém.`;
	}
	// Sklo — rovnaká geometria ako `computeFlat` (`Math.round(val(...) - korekcia)`).
	// #440: per-sklo override (NULL → systémový skloOffset) — MUSÍ byť rovnaký ako v computeFlat.
	for (const key of ['s', 'v'] as const) {
		const sr = g.sklo[key];
		if (!sr) continue;
		const dim = Math.round(val(sr, S, V, g.N, true) - (skloKorekcia ?? Number(g.skloOffset)));
		if (dim <= 0)
			return `Rozmer ${S}×${V} mm je pri systéme ${system} priMALÝ — sklo by malo rozmer ≤ 0 mm. Zväčši rozmer alebo zvoľ iný systém.`;
	}
	return null;
}

/**
 * Fail-loud guard: ak systém MÁ hrúbko-závislé profily (Deluxe kladka/klzný pre
 * 6/10 mm), ale pre zvolenú hrúbku skla ani jeden nesedí, `profilCuts` by ticho
 * VYNECHAL kladku aj klzný → odpis do Money podhodnotený o ~40 %. Namiesto tichého
 * fallbacku (bar codebase: „chyba sa hlási nahlas") to zachytíme a výpočet zlyhá.
 * Dnes nedosiahnuteľné cez UI (glassTypesForSystem púšťa pre Deluxe len sklá s
 * hrúbkou 6/10), ale bráni tichej regresii, ak by tá záruka niekedy padla.
 */
export function missingHrubkaProfile(cfg: Cfg, sysStyl: string, skloHrubka: number): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	const sh = Number(skloHrubka) || 0;
	const hrubkaRows = g.rez.filter((r) => (Number(r.skloHrubka) || 0) !== 0);
	if (!hrubkaRows.length) return null; // žiadne hrúbko-závislé profily (Robust/Slide) → OK
	if (hrubkaRows.some((r) => (Number(r.skloHrubka) || 0) === sh)) return null;
	return `Pre zvolenú hrúbku skla (${sh} mm) tento systém nemá kladka/klzný profil — vyber platné sklo (6 alebo 10 mm).`;
}

// „Prídavná koľajnica" (Dominik 2026-07-15, rozšírené #456 Patrik 2026-09-05):
// checkbox → koľajnica o 1 veľkosť vyššia. Pôvodne LEN Štandard + (spodná), od #456
// rozšírené na Deluxe (zdieľa spodné kódy), Slide a Robust (obvodová koľajnica).
// Dĺžka tyče je rovnaká (7500 mm) → metre v odpise ostávajú, mení sa len KÓD + názov.
// NEZÁVISLÉ od typu skla (IZO aj obyčajné — Dominik: „to že je IZO nie je podmienka").
export const RAIL_UPSIZE: Record<string, { kod: string; nazov: string }> = {
	// Štandard + / Deluxe — spodná koľajnica (hornú nemení)
	ZASP00104: { kod: 'ZASP00030', nazov: 'Koľajnica spodná 3K Surový 7500 mm' },
	ZASP00030: { kod: 'ZASP00033', nazov: 'Koľajnica spodná 4K Surový 7500 mm' },
	ZASP00033: { kod: 'ZASP202432', nazov: 'Koľajnica spodná 5K Surový 7500 mm' },
	ZASP202432: { kod: 'ZASP202437', nazov: 'Koľajnica spodná 6K Surový 7500 mm' },
	// 6K (ZASP202437) nemá +1 — 7K koľajnica neexistuje.

	// Slide — obvodová koľajnica (jedna, rezaná na šírku aj výšku)
	ZASP00097: { kod: 'ZASP00100', nazov: 'Koľajnica 3K Slide Surový 7500 mm' },
	// 3K Slide (ZASP00100) nemá +1 — 4K Slide neexistuje.

	// Robust — obvodová koľajnica (jedna, rezaná na šírku aj výšku)
	ZASP00014: { kod: 'ZASP00016', nazov: 'Koľajnica 3K Surový 7500 mm' },
	ZASP00016: { kod: 'ZASP20254', nazov: 'Koľajnica 4K Surový 7500mm' }
	// 4K Robust (ZASP20254) nemá +1 — 5K Robust neexistuje.
};
export function railUpsize(
	system: string,
	styl: string,
	pridavna: boolean,
	kod: string,
	nazov: string
): { kod: string; nazov: string } {
	// Gate zjednotený s checkbox visibility (+page.svelte) cez `plusRailEligible`
	// (#134 → #456: rozšírenie na Slide/Deluxe/Robust). `pridavnaKolajnicaDefault`
	// (auto-default IZO) ostáva len pre Štandard + (`standardPlusRailEligible`).
	if (pridavna && plusRailEligible(system, styl) && RAIL_UPSIZE[kod]) {
		return RAIL_UPSIZE[kod];
	}
	return { kod, nazov };
}

/**
 * Systémy, kde sa dá koľajnica zadať RUČNE — tie, ktoré majú v konfigurácii
 * ODDELENÚ hornú a spodnú koľajnicu (Deluxe, Štandard +, Štandard). Robust a Slide
 * majú jednu obvodovú koľajnicu, takže „iná horná / iná spodná" tam nemá zmysel
 * (Patrik: „Robust a slide sa to stať nemôže max ešte delux"). Zoznam sa NEZADÁVA
 * natvrdo — vyplýva z názvov profilov v cfg, takže nový systém ho zdedí sám.
 */
export function systemyRucnaKolajnica(cfg: Cfg): string[] {
	const roly: Record<string, Set<string>> = {};
	for (const sysStyl in cfg) {
		const system = sysStyl.split('|')[0] ?? '';
		const entry = cfg[sysStyl];
		if (!entry) continue; // for…in nad cfg — vždy prítomné; guard len pre typ
		for (const r of entry.rez) {
			const rola = rolaKolajnice(r.nazov);
			if (!rola) continue;
			(roly[system] ??= new Set()).add(rola);
		}
	}
	return Object.keys(roly).filter((s) => {
		const set = roly[s]; // s ∈ Object.keys(roly) → vždy prítomné
		return !!set && set.has('horna') && set.has('spodna');
	});
}
