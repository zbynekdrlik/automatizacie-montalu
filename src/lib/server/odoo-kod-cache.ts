// Per-kód cache jedného Odoo readu (#599) — zdieľaná mechanika pre všetky Odoo ready podľa kódu:
// katalóg + sklad (`odoo-katalog.ts`) a kanál cien (`odoo-prices.ts`). Nový Odoo read podľa kódu =
// ďalšia INŠTANCIA, nie kópia logiky (`.claude/rules/odoo-katalog.md`).
import type { Logger } from './log';
import { OdooJson2Error } from './odoo-json2';

/** Po chybe readu je Odoo „nedostupné" toľkoto ms — počas nej sa NEvolá (žiadny fan-out). */
export const FALLBACK_TTL_MS = 60 * 1000;

/**
 * Per-kód cache jedného Odoo readu: platnosť `ttlMs` pri úspechu (aj „Odoo kód nepozná" = `null`),
 * pri chybe globálna nedostupnosť `FALLBACK_TTL_MS` (počas nej sa Odoo NEvolá), single-flight a warn
 * raz za výpadok. `nacitaj` vráti hodnoty LEN pre nájdené kódy a pri chybe HÁDŽE; `zabezpec` a
 * `hodnota` nehádžu.
 */
export class KodCache<T> {
	private cache = new Map<string, { v: T | null; exp: number }>();
	private inflight: Promise<void> | null = null;
	/** Do kedy (ms) je Odoo považované za nedostupné. */
	private nedostupneDo = 0;
	private warned = false;

	constructor(
		private readonly model: string,
		private readonly ttlMs: number,
		private readonly nacitaj: (kody: string[], timeoutMs: number) => Promise<Map<string, T>>,
		/** logger volajúceho modulu — warn/info výpadku ide pod JEHO menom (napr. `odoo-katalog`) */
		private readonly log: Logger
	) {}

	reset(): void {
		this.cache.clear();
		this.inflight = null;
		this.nedostupneDo = 0;
		this.warned = false;
	}

	/** Hodnota z cache (bez ohľadu na platnosť) — `null` = Odoo kód nepozná / nie je v cache. */
	hodnota(kod: string): T | null {
		return this.cache.get(kod)?.v ?? null;
	}

	private async dotiahni(kody: string[], timeoutMs: number): Promise<void> {
		try {
			const najdene = await this.nacitaj(kody, timeoutMs);
			const exp = Date.now() + this.ttlMs;
			for (const kod of kody) this.cache.set(kod, { v: najdene.get(kod) ?? null, exp });
			if (this.warned) {
				// zotavenie po výpadku — ďalší výpadok sa zaloguje znova (warn raz za VÝPADOK)
				this.log.info(`Odoo ${this.model} opäť dostupné`);
				this.warned = false;
			}
		} catch (e) {
			this.nedostupneDo = Date.now() + FALLBACK_TTL_MS;
			if (!this.warned) {
				this.log.warn(`Odoo ${this.model} nedostupné — volajúci použije fallback`, {
					status: e instanceof OdooJson2Error ? e.status : 0,
					err: e instanceof Error ? e.message : String(e)
				});
				this.warned = true;
			}
		}
	}

	/**
	 * `true` = všetky `kody` majú v cache platnú hodnotu (dotiahnuté JEDNÝM readom pre chýbajúce);
	 * `false` = Odoo nedostupné. Výpadok sa týka LEN kódov, ktoré treba dotiahnuť — požiadavku celú
	 * pokrytú platnou cache obslúži aj počas nedostupnosti (review #599).
	 */
	async zabezpec(kody: readonly string[], timeoutMs: number): Promise<boolean> {
		if (kody.length === 0) return true;
		// single-flight: počkaj na KAŽDÝ bežiaci read (môže pokryť aj naše kódy), až potom dotiahni zvyšok
		while (this.inflight) await this.inflight;
		const now = Date.now();
		const chybajuce = kody.filter((k) => {
			const c = this.cache.get(k);
			return !c || c.exp <= now;
		});
		if (chybajuce.length === 0) return true;
		if (now < this.nedostupneDo) return false;
		const p = this.dotiahni(chybajuce, timeoutMs);
		this.inflight = p;
		try {
			await p;
		} finally {
			if (this.inflight === p) this.inflight = null;
		}
		return Date.now() >= this.nedostupneDo;
	}
}
