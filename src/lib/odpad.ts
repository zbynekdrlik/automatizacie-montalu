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
	const pouzite = material.filter((m) => m.tyce > 0);
	const odpadMm = Math.round(pouzite.reduce((s, m) => s + m.odpadMm, 0));
	const materialMm = pouzite.reduce((s, m) => s + m.tyce * m.barLen, 0);
	const odpadPct = materialMm > 0 ? Math.round((odpadMm / materialMm) * 1000) / 10 : 0;
	return { profily: pouzite.length, odpadMm, materialMm, odpadPct };
}
