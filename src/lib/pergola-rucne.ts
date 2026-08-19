// Pergola — RUČNÉ POLOŽKY do rezervačného odpisu (#234). „Pometrané" položky (napr.
// kotviace profily), ktoré Dominik napočíta/zmeria a zadá RUČNE, alebo položka, na
// ktorú ešte nie je vzorec. Idú do Money odpisu SPOLU so spočítanými — po tom istom
// explicitnom potvrdení.
//
// Čistý TS engine bez závislosti na Svelte/DOM/serveri — plne unit-testovateľný
// (tests/pergola-rucne.test.ts). NEIMPORTUJE `$lib/server/money` ani `$lib/server/pergola`
// (Money odpisová cesta) — validácia dostáva množinu katalógových kódov ako parameter,
// modul sa neviaže na server. Ručné riadky OBÍDU CAD transform: zadávajú sa priamo v MJ
// položky (m / ks) ako Money množstvá, nie ako CAD dĺžky rezu.
import type { MJ } from '$lib/komponenty';

/** Jeden ručne pridaný riadok rezervačného odpisu. Money kód + názov + množstvo v MJ
 *  položky (m alebo ks). Žiadne hádanie MJ — MJ zadáva používateľ. */
export interface RucnaPolozka {
	kod: string;
	nazov: string;
	mnozstvo: number;
	mj: MJ;
}

/** Verdikt validácie kódu proti dostupnému katalógu. */
export interface RucnaValidacia {
	/** kód je v dostupnom katalógu (známy)? */
	znamy: boolean;
	/** null = OK (známy alebo prázdny); inak VAROVANIE (neznámy kód — prijme sa, nie tiché). */
	warning: string | null;
}

/** Validácia jedného Money kódu proti dostupnému katalógu pergoly. Neznámy kód =
 *  VAROVANIE, NIKDY odmietnutie — kotviace profily „pometrané" môžu byť mimo pergola PRP
 *  setu (evidence-strict: nehádžeme, len upozorníme). Prázdny kód nevaruje (rieši ho
 *  parse ako chýbajúci). */
export function rucnaValidacia(kod: string, catalogCodes: Set<string>): RucnaValidacia {
	const k = (kod ?? '').trim();
	if (!k) return { znamy: false, warning: null };
	if (catalogCodes.has(k)) return { znamy: true, warning: null };
	return {
		znamy: false,
		warning: `Kód „${k}" nie je v katalógu pergoly — over, či je správny (do odpisu sa aj tak zahrnie).`
	};
}

/** Zaokrúhlenie množstva na 0,001 (rovnaká disciplína ako `applyEdits` v money.ts). */
const R3 = (x: number) => Math.round(x * 1000) / 1000;

/** Horný obranný limit množstva (rovnaký ako `applyEdits`) — chráni pred preklepom. */
export const RUCNE_MNOZSTVO_MAX = 100000;

/**
 * Parsuje ručné riadky zo serializovaného JSON (hidden input formulára — round-trip vzor
 * PR #81 klín/koľajnica). Vyhodí PRÁZDNE riadky (prázdny kód aj množstvo, alebo množstvo
 * ≤ 0). Vráti CHYBU (nie tiché prázdno) pri: kóde bez množstva a naopak, neplatnej MJ,
 * nečíselnom/zápornom/absurdnom množstve — nikdy zlé číslo do Money.
 */
export function parseRucnePolozky(raw: string | null | undefined): {
	rows: RucnaPolozka[];
	error: string | null;
} {
	if (!raw || !String(raw).trim()) return { rows: [], error: null };
	let data: unknown;
	try {
		data = JSON.parse(String(raw));
	} catch {
		return { rows: [], error: 'Ručné položky sa nepodarilo prečítať (poškodený formát).' };
	}
	if (!Array.isArray(data)) return { rows: [], error: 'Ručné položky majú neplatný formát.' };

	const rows: RucnaPolozka[] = [];
	for (const it of data) {
		if (!it || typeof it !== 'object') continue;
		const o = it as Record<string, unknown>;
		const kod = String(o.kod ?? '').trim();
		const nazov = String(o.nazov ?? '').trim();
		// #234 review — MJ sa NEHÁDA: chýbajúca/prázdna MJ je chyba (nie tichý default 'm').
		const mj = String(o.mj ?? '').trim();
		const mnozRaw = String(o.mnozstvo ?? '')
			.replace(',', '.')
			.trim();

		// úplne prázdny riadok (bez kódu aj množstva) = ignoruj, nie chyba
		if (!kod && !mnozRaw) continue;
		if (!kod) return { rows: [], error: 'Ručná položka bez Money kódu.' };
		if (mj !== 'm' && mj !== 'ks')
			return { rows: [], error: `Chýbajúca alebo neplatná MJ pri ${kod} (povolené: m / ks).` };
		if (!mnozRaw) return { rows: [], error: `Ručná položka ${kod} bez množstva.` };

		const mnozstvo = parseFloat(mnozRaw);
		if (!Number.isFinite(mnozstvo))
			return { rows: [], error: `Neplatné množstvo „${mnozRaw}" pri ${kod}.` };
		if (mnozstvo < 0)
			return {
				rows: [],
				error: `Záporné množstvo (${mnozstvo}) pri ${kod} — do Money nesmie ísť.`
			};
		if (mnozstvo === 0) continue; // nulový riadok = vylúč (prázdny)
		if (mnozstvo > RUCNE_MNOZSTVO_MAX)
			return { rows: [], error: `Podozrivo veľké množstvo (${mnozstvo}) pri ${kod}.` };

		rows.push({ kod, nazov: nazov || kod, mnozstvo: R3(mnozstvo), mj: mj as MJ });
	}
	return { rows, error: null };
}
