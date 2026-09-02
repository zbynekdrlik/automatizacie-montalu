// #5824: jednotný Odoo backend seam pre OBE integrácie (lead + zakazka) — env-gated výber
// medzi novým `/json/2` klientom (`odoo-json2.ts`) a legacy XML-RPC (`odoo-rpc.ts`, ponechané
// ako fallback počas „aj-aj" cutoveru, kým odoo sidecar nenastaví nový env). Consumeri volajú
// LEN toto rozhranie — payload/retry/dedup/serializer/durable store ostávajú nezmenené.
//
// VÝBER: json2 sa aktivuje LEN keď je nastavené `ODOO_URL` A `ODOO_API_KEY` (nové názvy, distinct
// od starých `ODOO_LEAD_*`). Inak fallback XML-RPC (`ODOO_LEAD_*`, „staré názvy sa ešte čítajú").
// Live appka má dnes len `ODOO_LEAD_*` → ostáva na XML-RPC, kým owner nepridá nový env → žiadny
// tichý auto-switch, žiadna závislosť na tom, či starý kľúč funguje ako json2 bearer.
import {
	authenticate,
	createRecord,
	executeKw,
	odooConfig,
	type OdooConfig,
	type XmlRpcValue
} from './odoo-rpc';
import { json2Config, odooJson2, OdooJson2Error, type Json2Config } from './odoo-json2';

/** Transport-neutrálny alias — seam sa neviaže na legacy XML-RPC názov (#5824 review S3). */
export type OdooValue = XmlRpcValue;

/** Operácie, ktoré obe integrácie reálne konzumujú (create / search / message_post). */
export interface OdooBackend {
	create(model: string, values: Record<string, OdooValue>): Promise<number>;
	search(model: string, domain: OdooValue[], limit: number): Promise<number[]>;
	messagePost(model: string, id: number, kwargs: Record<string, OdooValue>): Promise<void>;
}

const asIntArray = (res: unknown): number[] =>
	Array.isArray(res) ? res.filter((x): x is number => typeof x === 'number') : [];

// ---- XML-RPC backend (tenký wrapper nad NEZMENENÝM odoo-rpc.ts) ----------------------
// Lazy `authenticate` + cache uid PER INŠTANCIU: každá operačná skupina (jeden lead =
// create+create, jedna zakazka = search+N×message_post) dostane čerstvý backend a
// authentikuje sa raz — presne ako pôvodný kód (`const uid = await authenticate(cfg)` raz).
class XmlRpcBackend implements OdooBackend {
	private uid: number | null = null;
	constructor(private readonly cfg: OdooConfig) {}
	private async ensureUid(): Promise<number> {
		if (this.uid === null) this.uid = await authenticate(this.cfg);
		return this.uid;
	}
	async create(model: string, values: Record<string, OdooValue>): Promise<number> {
		return createRecord(this.cfg, await this.ensureUid(), model, values);
	}
	async search(model: string, domain: OdooValue[], limit: number): Promise<number[]> {
		return asIntArray(
			await executeKw(this.cfg, await this.ensureUid(), model, 'search', [domain], { limit })
		);
	}
	async messagePost(model: string, id: number, kwargs: Record<string, OdooValue>): Promise<void> {
		await executeKw(this.cfg, await this.ensureUid(), model, 'message_post', [[id]], kwargs);
	}
}

// ---- JSON-2 backend (bearer, žiadny uid) ---------------------------------------------
/** Vytiahne id z návratu `create` — json2 môže vrátiť skalár, `[id]` alebo `{id}`. */
function extractId(res: unknown): number | null {
	const n =
		typeof res === 'number'
			? res
			: Array.isArray(res) && typeof res[0] === 'number'
				? res[0]
				: res && typeof res === 'object' && typeof (res as { id?: unknown }).id === 'number'
					? (res as { id: number }).id
					: null;
	// #5824 review S2: rovnaká parita ako createRecord (odoo-rpc.ts) — 0/negatívne NIE je platné id
	// (inak by sa `0` uložilo cez markLeadCreated a dopyt sa navždy preskočil).
	return typeof n === 'number' && n > 0 ? n : null;
}

class Json2Backend implements OdooBackend {
	constructor(private readonly cfg: Json2Config) {}
	async create(model: string, values: Record<string, OdooValue>): Promise<number> {
		// `create` je @api.model_create_multi → `vals_list` je POLE dictov (jeden záznam).
		const res = await odooJson2(this.cfg, model, 'create', { vals_list: [values] });
		const id = extractId(res);
		if (id === null)
			throw new OdooJson2Error(`create ${model} nevrátil id (dostal: ${JSON.stringify(res)})`);
		return id;
	}
	async search(model: string, domain: OdooValue[], limit: number): Promise<number[]> {
		return asIntArray(await odooJson2(this.cfg, model, 'search', { domain, limit }));
	}
	async messagePost(model: string, id: number, kwargs: Record<string, OdooValue>): Promise<void> {
		// instance metóda → záznam ide cez rezervované `ids`; ostatné (body/subtype/…) sú pomenované.
		await odooJson2(this.cfg, model, 'message_post', { ids: [id], ...kwargs });
	}
}

/**
 * Vyberie backend podľa env: json2 (`ODOO_URL`+`ODOO_API_KEY`) prednostne, inak XML-RPC fallback
 * (`ODOO_LEAD_*`), inak `null` (integrácia vypnutá — chýba všetok env). Čítané LAZY (test vie env
 * nastaviť za behu), rovnako ako pôvodné `odooConfig()`/`leadConfig()`.
 */
export function odooBackend(): OdooBackend | null {
	const j = json2Config();
	if (j) return new Json2Backend(j);
	const x = odooConfig();
	if (x) return new XmlRpcBackend(x);
	return null;
}

/** `true` keď je nastavený ktorýkoľvek backend (json2 alebo XML-RPC) — pre „je feature zapnutá" checky. */
export function odooBackendConfigured(): boolean {
	return json2Config() !== null || odooConfig() !== null;
}
