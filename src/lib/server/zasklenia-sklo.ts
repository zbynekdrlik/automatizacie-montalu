// #524: PURE-MOVE zo `src/routes/zasklenia/+page.server.ts` — sklo-rozlíšenie (`skloPre`,
// `existujeVCfg`) + tenké rekomputačné wrappre (`recomputeVstup`/`recomputeMultiVstup`, pôvodne
// route-private `compute`/`computeMultiFrom`). Sú ČISTÉ: `loadCfg()` + pure compute, žiadna
// request/DB-write väzba. Route ich re-importuje (aliasy `compute`/`computeMultiFrom`), takže
// správanie je bit-identické (strážia zasklenia testy: golden `zasklenia-posuvspec-golden`,
// `sklo-korekcia-compute`, `compute.test.ts`). Extrahované, aby ten istý autoritatívny nárezák
// vedel znovu spočítať aj backfill (#524) z uloženého `detail.vstupRaw` — JEDEN zdroj pravdy,
// žiadna replikácia sklo-logiky na PROD zápise.
import {
	loadCfg,
	glassTypesForSystem,
	efektivnaKorekcia,
	efektivnaRedukciaZero,
	resolveGlassSystem,
	type GlassType
} from '$lib/server/db';
import { SKLO_INE, ineHrubka, ineHrubkaTrieda, jeSkloTrieda } from '$lib/sklo';
import {
	safeCompute,
	safeComputeMulti,
	buildPosuvSpec,
	type Cfg,
	type ComputeResult,
	type MultiResult,
	type PosuvSpec
} from '$lib/server/compute';
import {
	sysStylPre,
	sklaDoPonuky,
	skloVyberaIzo,
	zakladnyStyl,
	type ExistujeSysStyl,
	type TriedaZaNazov
} from '$lib/styl';
import type { Vstup, MultiVstup } from '$lib/server/vstup';

/**
 * #570: názvy skiel, ktoré MIGRÁCIA z katalógu zmazala, → ich Money-identická náhrada. Kľúč je
 * KANONICKÝ systém katalógu (`resolveGlassSystem` — starý „Štandard"/„Štandard Drevo" zdieľajú
 * Štandard +). Zdroj: v44 `migrateCleanupStandardPlusOrphans` (issue 504, 10.9.) — obe náhrady sú
 * podľa migrácie klasifikované zhodne (non-IZO / IZO trieda 16), takže nárezák je bit-identický.
 * v19 „Kalené 8mm/10mm" (Robust) sem ZÁMERNE nepatrí: zmazané BEZ náhrady a pred oknom rekomputy.
 * Použitie: LEN rekomputa uložených odpisov (backfill + živý nárezák na kiosk) — nikdy nový vstup
 * z formulára, nikdy prepis uloženého `detail`, nikdy Money.
 */
const LEGACY_SKLO: Record<string, Record<string, string>> = {
	'Štandard +': {
		'Izolačné sklo 4.8.4': 'Izolačné sklo 4/8/4 číre',
		'Float sklo 10 mm': 'ESG kalené 10 mm'
	}
};

/** Legacy (migráciou zmazaný) názov skla → aktuálna náhrada pre daný systém; inak nezmenený. */
export function legacySkloNazov(system: string, sklo: string): string {
	return LEGACY_SKLO[resolveGlassSystem(system)]?.[sklo] ?? sklo;
}

/** Kópia jednoposuvového `Vstup` s legacy sklom rozlíšeným na náhradu (vstup sa nemutuje). */
export function vstupSAktualnymSklom(v: Vstup): Vstup {
	const sklo = legacySkloNazov(v.system, v.sklo);
	return sklo === v.sklo ? v : { ...v, sklo };
}

/** Kópia `MultiVstup` s legacy sklom rozlíšeným per posuv (vstup sa nemutuje). */
export function multiVstupSAktualnymSklom(v: MultiVstup): MultiVstup {
	return {
		...v,
		posuvy: v.posuvy.map((p) => {
			const sklo = legacySkloNazov(p.system, p.sklo);
			return sklo === p.sklo ? p : { ...p, sklo };
		})
	};
}

export const existujeVCfg =
	(cfg: Cfg): ExistujeSysStyl =>
	(s) =>
		!!cfg[s];

/** Sklo musí patriť k systému AJ k štýlu (napr. Štandard + opona nemá IZO skladbu).
 *  #443: `sklaDoPonuky` dostáva trieda-lookup (`platne` je práve TENTO systém, takže
 *  `find` podľa mena je jednoznačný) — basic/IZO filter sa rozhoduje primárne triedou,
 *  regex `jeIzoSklo` ostáva fallback len pre neklasifikované sklo. */
export function skloPre(
	cfg: Cfg,
	system: string,
	styl: string,
	sklo: string,
	skloTrieda?: number | null
) {
	// Vlastná (nekatalógová) skladba (#235 slice 2): SYNTETICKÉ sklo z hrúbkovej triedy —
	// počíta sa BIT-IDENTICKY ako katalógové sklo tej istej triedy. `skloKorekcia=null` →
	// efektivnaKorekcia = triedová korekcia (systém × trieda); `redukciaZero` sa pre Slide
	// DERIVUJE z hrubkaTrieda (efektivnaRedukciaZero). `hrubka` (Deluxe kladka/klzný) = 0 mimo
	// Deluxe (bit-identické s katalógom). Cena je honest-null (glassMoneyKod(SKLO_INE)→null,
	// lebo variant je sentinel). Trieda POVINNÁ — bez platnej triedy null (validácia odmietne).
	if (sklo === SKLO_INE) {
		if (!jeSkloTrieda(skloTrieda)) return null;
		const trieda = ineHrubkaTrieda(skloTrieda);
		// RED-1 (#235 slice 2): rovnaký system×štýl gate ako katalóg. `sklaDoPonuky`
		// FILTRUJE izolačné sklá tam, kde pre daný štýl IZO nárezák neexistuje (napr.
		// Štandard + opona 2x2K — cfg nemá „…|2x2K IZO"). Bez tohto by vlastná IZO na
		// takej kombinácii spočítala BASIC nárezák (sysStylPre padne späť) + trieda-16
		// korekciu — stav, aký žiadne katalógové IZO sklo v tej kombinácii nevie. Mirror
		// klienta: SKLO_TRIEDY 16/24 sú v UI odfiltrované keď IZO nárezák chýba.
		if (
			skloVyberaIzo(system) &&
			trieda === 16 &&
			!existujeVCfg(cfg)(`${system}|${zakladnyStyl(styl)} IZO`)
		)
			return null;
		// YELLOW-3 (#235 slice 2): `hrubkaTrieda` je non-null LEN pre systémy, ktoré
		// klasifikujú skladbu (Slide + Štandardy). Robust/Deluxe majú v katalógu NULL
		// (db.ts) → syntetické sklo tiež NULL, inak by `efektivnaKorekcia` sadla triedovú
		// korekciu tam, kde katalóg nikdy. Deluxe rieši hrúbku cez `hrubka` (nie triedu).
		const klasifikuje = system === 'Slide' || skloVyberaIzo(system);
		const g: GlassType = {
			id: -1,
			nazov: SKLO_INE,
			system,
			redukciaZero: false,
			hrubka: ineHrubka(system, skloTrieda),
			skloKorekcia: null,
			hrubkaTrieda: klasifikuje ? trieda : null
		};
		return g;
	}
	const platne = glassTypesForSystem(system);
	const triedaZa: TriedaZaNazov = (nazov) =>
		platne.find((g) => g.nazov === nazov)?.hrubkaTrieda ?? null;
	const povolene = sklaDoPonuky(
		system,
		styl,
		platne.map((g) => g.nazov),
		existujeVCfg(cfg),
		triedaZa
	);
	return povolene.includes(sklo) ? (platne.find((g) => g.nazov === sklo) ?? null) : null;
}

/** Rekomputuj JEDEN posuv z `Vstup` (surové vstupy — nikdy klientské čísla). Pôvodne route-private
 *  `compute()`; extrahované (#524), aby ten istý autoritatívny nárezák vedel spočítať aj backfill. */
export function recomputeVstup(
	vstup: Vstup,
	cfg: Cfg = loadCfg()
): {
	r: ComputeResult | null;
	err: string | null;
	spec: PosuvSpec | null;
} {
	// sklo musí patriť k zvolenému systému (Robust = 4/16/4, Slide = 4/8/4) —
	// nedá sa cez skriptovaný POST poslať cudzie sklo
	const g = skloPre(cfg, vstup.system, vstup.styl, vstup.sklo, vstup.skloTrieda);
	if (!g) return { r: null, err: 'Vyber typ skla platný pre zvolený systém a štýl.', spec: null };
	// hrúbka skla (Deluxe 6/10) vyberá kladka/klzný profil; Robust/Slide = 0
	// prídavná koľajnica: spodná koľajnica o 1 väčšia (compute gejtuje na Štandard +)
	// sysStylPre: v Štandard + vyberá basic/IZO nárezák ZVOLENÁ TRIEDA skla (#443,
	// regex jeIzoSklo len fallback pre neklasifikované sklo)
	// #109: zdieľaný builder pre OBE cesty (compute() aj computeMultiFrom()) — nové
	// pole PosuvSpec, ktoré tu chýba, je teraz kompilačná chyba, nie tichá diera.
	const spec: PosuvSpec = buildPosuvSpec({
		sysStyl: sysStylPre(vstup.system, vstup.styl, vstup.sklo, existujeVCfg(cfg), g.hrubkaTrieda),
		S: vstup.s,
		V: vstup.v,
		// #443: pre klasifikované Slide sklo DERIVOVANÉ z triedy (efektivnaRedukciaZero);
		// inak uložený stĺpec (honest-null fallback)
		redukciaZero: efektivnaRedukciaZero(g),
		skloHrubka: g.hrubka,
		// #443: reťaz precedencie per-sklo (#440) → trieda (systém × 6/16) → systémová
		skloKorekcia: efektivnaKorekcia(g, vstup.system),
		pridavnaKolajnica: vstup.pridavnaKolajnica,
		// ručná dĺžka koľajnice (Patrik): mení rez → mení metre v odpise
		kolajnica: vstup.kolajnica ?? undefined,
		// sieťka (#86–#90, KOREKCIA 2026-08-02) — na Robust/Slide MENÍ odpis
		// (rám+nos+[2K→3K koľajnica]), gate je vo vnútri computeFlat
		sietka: vstup.sietka,
		// jednoposuvová cesta tieto polia zo `spec` NIKDY nečíta — jobFor() číta
		// otvaranie/sklo/kovanie*/klin PRIAMO z `vstup` (jedna sada hodnôt, jeden
		// formulár). Explicitný `undefined` namiesto tichého vynechania poľa —
		// presne dôvod #109 (viď design komentár na tickete).
		otvaranie: undefined,
		sklo: undefined,
		kovanieL: undefined,
		kovanieP: undefined,
		kovanieStred: undefined,
		kovanieStredOkno: undefined,
		kliny: undefined
	});
	const out = safeCompute(
		cfg,
		spec.sysStyl,
		spec.S,
		spec.V,
		spec.redukciaZero,
		spec.skloHrubka,
		spec.pridavnaKolajnica,
		spec.kolajnica,
		spec.sietka,
		spec.skloKorekcia
	);
	return { ...out, spec };
}

// ---- Viac posuvov (zimná záhrada) ----

/** Rekomputuj VIAC posuvov z `MultiVstup`. Pôvodne route-private `computeMultiFrom()` (#524 move). */
export function recomputeMultiVstup(
	vstup: MultiVstup,
	cfg: Cfg = loadCfg()
): {
	r: MultiResult | null;
	err: string | null;
	specs: PosuvSpec[];
} {
	const specs: PosuvSpec[] = [];
	for (const [i, p] of vstup.posuvy.entries()) {
		const g = skloPre(cfg, p.system, p.styl, p.sklo, p.skloTrieda);
		if (!g)
			return {
				r: null,
				err: `Zasklenie ${i + 1}: vyber typ skla platný pre zvolený systém a štýl.`,
				specs: []
			};
		// #109: rovnaký zdieľaný builder ako compute() vyššie — na tejto ceste sú
		// naopak VŠETKY polia potrebné (echo pre plán/tlač cez PosuvInfo, viď design
		// komentár na tickete).
		specs.push(
			buildPosuvSpec({
				sysStyl: sysStylPre(p.system, p.styl, p.sklo, existujeVCfg(cfg), g.hrubkaTrieda),
				S: p.s,
				V: p.v,
				// #443: pre klasifikované Slide sklo DERIVOVANÉ z triedy; inak uložený stĺpec
				redukciaZero: efektivnaRedukciaZero(g),
				skloHrubka: g.hrubka,
				// #443: reťaz precedencie per-sklo (#440) → trieda (systém × 6/16) → systémová
				skloKorekcia: efektivnaKorekcia(g, p.system),
				otvaranie: p.otvaranie,
				// display echo do PosuvInfo.skloNazov (plán/tlač) — pri vlastnej skladbe TEXT
				// (skloPresne); compute glass rieši skloPre() z RAW p.sklo (sentinel) vyššie (#235)
				sklo: p.skloPresne || p.sklo,
				kovanieL: p.kovanieL,
				kovanieP: p.kovanieP,
				kovanieStred: p.kovanieStred,
				kovanieStredOkno: p.kovanieStredOkno,
				kliny: p.kliny,
				// prídavná koľajnica je vstup na úrovni objednávky → platí pre všetky posuvy
				pridavnaKolajnica: vstup.pridavnaKolajnica,
				// ručná dĺžka koľajnice je PER POSUV (každý posuv má vlastnú šírku)
				kolajnica: p.kolajnica ?? undefined,
				// sieťka (#86–#90, KOREKCIA 2026-08-02) — na Robust/Slide MENÍ Money odpis
				// (rám+nos+[2K→3K koľajnica]), gate je vo vnútri computeMulti/computeFlat
				sietka: p.sietka ?? undefined
			})
		);
	}
	return { ...safeComputeMulti(cfg, specs), specs };
}
