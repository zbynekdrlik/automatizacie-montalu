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

// --- #606: odpad aj v KILOGRAMOCH (Odoo úloha 1366, vzorec 1:1 s odoo-erp 9076) -------------- //
// kg/m prináša server (`odoo-katalog.ts` `planSKgNaM` → `MaterialRow.kgNaM`, LEN z Odoo karty —
// žiadna druhá pravda o kg/m). Tu je len čistý výpočet nad už-spočítaným plánom, client-safe.

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Platné kg/m riadku: kladné konečné číslo; inak `null` (chýba / 0 / nezisťované). */
function kgNaMRiadku(m: MaterialRow): number | null {
	const k = m.kgNaM;
	return typeof k === 'number' && Number.isFinite(k) && k > 0 ? k : null;
}

/** Rovnaká množina profilov ako `sumaOdpad` (s tyčou, bez NaN/nekonečna). */
function pouziteProfily(material: MaterialRow[]): MaterialRow[] {
	return material.filter(
		(m) => m.tyce > 0 && Number.isFinite(m.barLen) && Number.isFinite(m.odpadMm)
	);
}

/**
 * kg odpadu jedného profilu = `odpadMm / 1000 × kg/m` (2 desatinné). `null` = kg/m chýba
 * (Odoo nedostupné, karta bez kg/m, 0) — honest-null, NIKDY 0 kg.
 */
export function odpadKgProfilu(m: MaterialRow): number | null {
	const kg = kgNaMRiadku(m);
	return kg === null ? null : r2((m.odpadMm / 1000) * kg);
}

export interface OdpadKgSpolu {
	/** aspoň jeden profil s tyčou má kg/m → kg sa ukážu; `false` = zobrazenie ako pred #606
	 *  (dnešný PROD 403 / CI bez Odoo / karty bez kg/m) — žiadny kg text, ani „kg/m chýba" */
	zobrazit: boolean;
	/** Σ odpad kg profilov s kg/m (2 desatinné) */
	odpadKg: number;
	/** Σ materiál kg = tyče × dĺžka tyče / 1000 × kg/m (2 desatinné) */
	materialKg: number;
	/** % podľa hmotnosti = Σ odpad kg / Σ materiál kg — VÁŽENÉ, nie priemer % (2 desatinné) */
	hmotnostPct: number;
	/** profily s tyčou BEZ kg/m (kód, inak názov) — súčet kg je NEÚPLNÝ */
	chybaKgNaM: string[];
}

/**
 * Súčet odpadu v kg naprieč profilmi (#606). Profily bez kg/m sa do kg NEzarátajú (ako Odoo:
 * tyč bez kg/m má 0 v oboch súčtoch) a sú menovite v `chybaKgNaM`. % sa ráta z NEzaokrúhlených
 * súčtov. Dĺžkové % (`sumaOdpad`) ostáva nezmenené vedľa.
 */
export function sumaOdpadKg(material: MaterialRow[]): OdpadKgSpolu {
	let odpad = 0;
	let mat = 0;
	let sKg = 0;
	const chybaKgNaM: string[] = [];
	for (const m of pouziteProfily(material)) {
		const kg = kgNaMRiadku(m);
		if (kg === null) {
			chybaKgNaM.push(m.kod || m.nazov);
			continue;
		}
		sKg++;
		odpad += (m.odpadMm / 1000) * kg;
		mat += ((m.tyce * m.barLen) / 1000) * kg;
	}
	if (sKg === 0)
		return { zobrazit: false, odpadKg: 0, materialKg: 0, hmotnostPct: 0, chybaKgNaM: [] };
	return {
		zobrazit: true,
		odpadKg: r2(odpad),
		materialKg: r2(mat),
		hmotnostPct: mat > 0 ? r2((odpad / mat) * 100) : 0,
		chybaKgNaM
	};
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
