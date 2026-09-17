// Kumulatívny odpad naprieč profilmi jedného nárezového plánu (#417, display-only).
// Súčet koncových zvyškov (offcut) cez všetky profily, s rovnakým %-vzorcom ako
// compute-odpis.ts/optimalizator.ts (odpadMm / Σ(tyce×barLen)). ŽIADNY Money odpis,
// žiadne katalógové kódy, žiadny DB zápis — čisté sčítanie už-spočítaných hodnôt.
// Klientsky bezpečné (importuje LEN TYP MaterialRow, ktorý sa pri kompilácii maže),
// aby ho mohol volať klientský komponent RozpisRezov (server modul nesmie do klienta) —
// rovnaká disciplína ako $lib/cut.ts.
import type { MaterialRow } from '$lib/server/compute';

export interface OdpadSpolu {
	/** počet profilov (s aspoň jednou použitou tyčou), z ktorých sa súčet ráta */
	profily: number;
	/** súčet koncových zvyškov (mm) naprieč profilmi */
	odpadMm: number;
	/** celkový použitý materiál (mm) = Σ tyce × barLen */
	materialMm: number;
	/** odpad ako % z použitého materiálu (rovnaký vzorec ako per-profil) */
	odpadPct: number;
}

/**
 * Sčítaj koncový odpad naprieč profilmi. Ráta LEN nad profilmi s `tyce > 0`
 * (rovnaká množina, akú kreslí RozpisRezov). `%` je vážený podiel z použitého
 * materiálu — identický vzorec ako per-profil (odpadMm / (tyce×barLen)),
 * len zovšeobecnený na viac dĺžok tyčí. Prázdny vstup → samé nuly.
 */
export function sumaOdpad(material: MaterialRow[]): OdpadSpolu {
	// barLen aj odpadMm sú v MaterialRow povinné, ale RozpisRezov ich číta obranne
	// (`m.barLen ?? bar`) — držíme rovnakú obranu: nekonečný/NaN riadok vylúčime,
	// aby jeden pokazený profil nevyrobil „NaN mm" v súčte (radšej honest under-report).
	const pouzite = material.filter(
		(m) => m.tyce > 0 && Number.isFinite(m.barLen) && Number.isFinite(m.odpadMm)
	);
	const odpadMm = Math.round(pouzite.reduce((s, m) => s + m.odpadMm, 0));
	const materialMm = pouzite.reduce((s, m) => s + m.tyce * m.barLen, 0);
	const odpadPct = materialMm > 0 ? Math.round((odpadMm / materialMm) * 1000) / 10 : 0;
	return { profily: pouzite.length, odpadMm, materialMm, odpadPct };
}

/**
 * Sumár nárezového plánu (#535) — presne tie čísla, ktoré ukazuje hlavička grafického
 * PDF (`narezak-pdf.ts`): počet profilov s tyčami, počet tyčí spolu, celkový koncový
 * odpad (mm) a jeho % z použitého materiálu. JEDEN zdroj pravdy pre PDF hlavičku aj pre
 * `cut_plan.summary` (tablet pri píle) — papier a dáta sú tak 1:1 bez duplicity.
 *
 * Ráta nad CELÝM nárezákom (všetky profily s `tyce > 0`, aj bez Money kódu) — rovnaká
 * množina, akú kreslí PDF. Preto `bars_total`/`profiles_count` môžu byť VYŠŠIE než
 * `cut_plan.bars[].length`, keď OP nesie aj profily bez kódu (pergola/fix/clip), ktoré
 * `buildCutPlan` z `bars[]` vynecháva — sumár drží papierové čísla zámerne.
 * Money-neutrálne (žiadna cena; len súčty už-spočítaných dĺžok).
 */
export interface NarezakSummary {
	/** počet profilov s aspoň jednou tyčou (= PDF „Profilov"). */
	profiles_count: number;
	/** počet fyzických tyčí spolu (= PDF „Tyčí spolu"). */
	bars_total: number;
	/** celkový koncový odpad (mm, = PDF „Odpad spolu"). */
	waste_total_mm: number;
	/** odpad ako % z použitého materiálu, 1 desatinné miesto (0 keď žiadne tyče). */
	waste_total_pct: number;
}

export function narezakSummary(material: MaterialRow[]): NarezakSummary {
	const spolu = sumaOdpad(material); // odpadMm + odpadPct + počet finite profilov (jediný výpočet odpadu)
	const bars_total = material
		.filter((m) => m.tyce > 0 && Number.isFinite(m.barLen) && Number.isFinite(m.odpadMm))
		.reduce((s, m) => s + m.tyce, 0);
	return {
		profiles_count: spolu.profily,
		bars_total,
		waste_total_mm: spolu.odpadMm,
		waste_total_pct: spolu.odpadPct
	};
}
