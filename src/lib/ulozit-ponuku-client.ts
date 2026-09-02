// #5960: browser-side helper — POST na „Uložiť ponuku" endpoint (`/ulozit-ponuku`), typovaná odpoveď.
// ČISTÝ + injektovateľný (`endpoint`/`fetchImpl` sa dodávajú ako argument — vzor `base-path.ts`, aby
// modul ostal jednoducho unit-testovateľný bez SvelteKit runtime importu). Komponent `UlozitPonuku`
// dodá `endpoint = ${base}/ulozit-ponuku` z `$app/paths`.

/** Príloha ide na drôt ako base64 (JSON nevie niesť bajty). */
export interface SaveQuoteClientAttachment {
	name: string;
	mimetype: string;
	datasBase64: string;
}
export interface SaveQuoteClientLine {
	kod: string;
	nazov: string;
	qty: number;
	mj?: string;
	priceUnit: number;
	discount?: number;
}
export interface SaveQuoteClientCustomer {
	meno?: string;
	email?: string;
	telefon?: string;
	ico?: string;
	vat?: string;
	dic?: string;
	adresa?: string;
	miesto?: string;
	poznamka?: string;
}
export interface SaveQuoteClientInput {
	modul: string;
	url?: string;
	cenaHladina?: string;
	partnerId?: number;
	zakaznik?: SaveQuoteClientCustomer;
	lines: SaveQuoteClientLine[];
	attachments?: SaveQuoteClientAttachment[];
}

/** Odpoveď endpointu — `ok:true` s objednávkou, alebo `ok:false` s kódom + bezpečnou hláškou. */
export type SaveQuoteResponse =
	| { ok: true; created: boolean; name: string; url: string }
	| { ok: false; code: string; error: string };

export interface SaveQuoteOpts {
	/** endpoint (default `/ulozit-ponuku`; komponent dodá `${base}/ulozit-ponuku`). */
	endpoint?: string;
	/** injektovateľný fetch (test/SSR). */
	fetchImpl?: typeof fetch;
}

/**
 * POST-ne `input` na „Uložiť ponuku" endpoint a vráti typovanú odpoveď. NIKDY nehádže — sieťovú chybu
 * / neočakávanú odpoveď zabalí do `{ ok:false }`, takže UI vždy dostane zobraziteľnú hlášku.
 */
export async function saveQuoteRequest(
	input: SaveQuoteClientInput,
	opts: SaveQuoteOpts = {}
): Promise<SaveQuoteResponse> {
	const endpoint = opts.endpoint ?? '/ulozit-ponuku';
	const f = opts.fetchImpl ?? fetch;
	let res: Response;
	try {
		res = await f(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
	} catch {
		return {
			ok: false,
			code: 'network',
			error: 'Nepodarilo sa spojiť so serverom. Skontroluj pripojenie a skús znova.'
		};
	}
	// #5960 review 🟡: adapter-node `BODY_SIZE_LIMIT` vráti holé (ne-JSON) 413 EŠTE pred endpointom —
	// 413 sa DETERMINISTICKY zopakuje, takže žiaden „skús znova" hint (kód `toobig` ho v UI potlačí).
	if (res.status === 413) {
		return {
			ok: false,
			code: 'toobig',
			error: 'Prílohy sú príliš veľké — zmenši ich a skús znova.'
		};
	}
	let data: unknown;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	if (data && typeof data === 'object' && 'ok' in data) {
		return data as SaveQuoteResponse;
	}
	return { ok: false, code: 'network', error: `Neočakávaná odpoveď servera (HTTP ${res.status}).` };
}
