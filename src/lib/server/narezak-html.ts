// #542 (cut_plan v3): serverový HTML renderer CELÉHO nárezáku (`cut_plan.render_html`). Owner 18.9.
// (odoo-erp #7431 fáza C): „appka je zdroj celého vzhľadu nárezáku, Odoo nič nekreslí". Appka NEMÁ
// HTML šablónu za PDF — `narezak-pdf.ts` kreslí vektorovo cez pdf-lib. Tento modul preto generuje
// NOVÝ self-contained HTML fragment, ktorý ZRKADLÍ sekcie PDF (hlavička zak/op/zákazník/dátum + QR,
// blok per profil s ikonou a kódom, pásy tyčí s kusmi/uhlami/odpadom, súhrn per profil + celkový) a
// ZDIEĽA s ním existujúce helpery: `renderBarSvg` (narezak-cut-plan.ts) pre pásy, `profilPngB64`
// (profil-png.ts) → data:image/png raz per kód, `narezakSummary` ($lib/odpad) pre súhrn,
// `qrZakazkaPayload`/`renderQrSvg` (qr-zakazka.ts) inline QR SVG.
//
// Odoo ho vloží do IZOLOVANÉHO Shadow DOM a odškrtáva cez `data-bar-id`/`data-piece-id` (rovnaké id
// ako `cut_plan.bars[]`/`pieces[]`) + `data-profile-kod` na bloku. Allow-list sanitizer (odoo-erp
// `kiosk_html_sanitize.py`): žiadny `<script>`/`on*`/`javascript:`/externé URL v src/href, žiadny
// `url(`/`@import` v `style`; obrázky VÝHRADNE `data:image/png` a inline `<svg>`. Systémové fonty
// (bez url()). Money-NEUTRÁLNE (žiadna cena, žiadny import z Money/price modulov).
//
// PDF (`narezak-pdf.ts`) ostáva REFERENCIA (ownerov vzor), HTML ho ZRKADLÍ cez zdieľané helpery —
// dva renderery, jeden zdroj geometrie. `narezak-pdf.ts` sa NEMENÍ.
import type { MaterialRow } from './compute';
import { KOTUC } from './compute';
import { renderBarSvg } from './narezak-cut-plan';
import { profilPngB64 } from './profil-png';
import { narezakSummary } from '$lib/odpad';
import { qrZakazkaPayload, renderQrSvg } from '$lib/qr-zakazka';
import { logger } from './log';

const log = logger('narezak-html');

/**
 * Strop veľkosti `render_html` (bajty UTF-8). Rezerva pod 1,5 MB Odoo limitom (#7431). Nad stropom
 * sa najprv vynechajú IKONY (najväčšia položka), potom celý `render_html` (Odoo fallback na fázu B).
 */
export const NAREZAK_HTML_MAX_BYTES = 1_400_000;

/** Hlavička nárezáku pre HTML (rovnaké polia ako `NarezakPdfHeader`, všetky voliteľné pre robustnosť). */
export interface NarezakHtmlMeta {
	zak?: string;
	op?: string;
	zakaznik?: string;
	/** voliteľný názov uloženého plánu (#505). */
	nazov?: string;
	/** čas do hlavičky „Dátum" (default `new Date()`). */
	now?: Date;
}

export interface NarezakHtmlInput {
	material: MaterialRow[];
	/** rezná medzera (mm) do súhrnnej hlavičky — TÁ ISTÁ, ktorou sa tyče zbalili. Default `KOTUC`. */
	kerfMm?: number;
	meta?: NarezakHtmlMeta;
}

/** Výsledok size-guardu. `html` undefined = nad stropom aj bez ikon (kľúč sa vynechá). */
export interface NarezakHtmlResult {
	html?: string;
	/** true = ikony boli vynechané, aby sa HTML zmestilo pod strop. */
	degraded: boolean;
	/** true = HTML prekročilo strop aj bez ikon → `render_html` sa vynecháva (Odoo fallback fáza B). */
	omitted: boolean;
}

/** Escapuje `&<>"'` na HTML entity — každý dynamický text (kódy, názvy, popisky) cez toto. */
export function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** číslo na 1 desatinné miesto so slovenskou čiarkou (1:1 s `narezak-pdf.ts` / `narezak-cut-plan.ts`). */
const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

/**
 * Inline CSS (systémové fonty, žiadny `url()`/`@import`/`expression()`). Farby zrkadlia PDF
 * (`narezak-pdf.ts`: INK #0f172a, MUTED #64748b, ACCENT #1d4ed8, BAR/CUT/ODPAD/STROKE). Jediný
 * `<style>` na fragment.
 */
const CSS =
	".narezak{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;" +
	'font-size:13px;line-height:1.4;max-width:900px;margin:0 auto;padding:8px;background:#fff}' +
	'.narezak h1{color:#1d4ed8;font-size:18px;margin:0 0 4px}' +
	'.narezak .hlavicka{border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:10px}' +
	'.narezak .nadpis{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
	'.narezak .qr{flex:0 0 auto;width:72px;height:72px}' +
	'.narezak .qr svg{width:100%;height:100%;display:block}' +
	'.narezak .meta{margin:2px 0}.narezak .datum{color:#64748b;margin:2px 0}' +
	'.narezak .suhrn{margin:4px 0 0;font-weight:700}' +
	'.narezak .profil{margin:12px 0;padding-top:8px;border-top:1px solid #eef2f7}' +
	'.narezak .profil-head{display:flex;align-items:center;gap:10px;margin-bottom:4px}' +
	'.narezak img.ikona{width:40px;height:40px;object-fit:contain;border:1px solid #e2e8f0;background:#fff}' +
	'.narezak .profil-titul{font-weight:700}.narezak .profil-stat{color:#64748b;font-size:12px}' +
	'.narezak .pas{display:flex;align-items:center;gap:6px;margin:4px 0}' +
	'.narezak .pas-no{color:#64748b;font-size:11px;min-width:22px;text-align:right}' +
	'.narezak .pas svg{flex:1 1 auto;max-width:100%;height:auto}' +
	'.narezak table.rezy{border-collapse:collapse;margin:4px 0 0;font-size:12px}' +
	'.narezak table.rezy th,.narezak table.rezy td{text-align:left;padding:1px 14px 1px 0}' +
	'.narezak table.rezy th{color:#64748b;font-weight:600}' +
	'.narezak .odpad-spolu{color:#64748b;margin-top:10px}';

/**
 * Postaví HTML fragment nárezáku. Iteruje `material` ROVNAKO ako `buildCutPlan` (len profily s
 * `tyce>0` A Money kódom, v tom istom poradí), takže `data-bar-id="B<n>"` a `data-piece-id="B<n>:<seq>"`
 * sú 1:1 s `cut_plan.bars[]`/`pieces[]` (guard test v `narezak-html.test.ts`). Súhrn = `narezakSummary`
 * (nad CELÝM nárezákom, aj profily bez kódu — papierové čísla).
 *
 * `withIcons=false` (size-guard) vynechá `data:image/png` ikony (len kódy).
 */
export function renderNarezakHtml(input: NarezakHtmlInput, withIcons = true): string {
	const { material } = input;
	const meta = input.meta ?? {};
	const kerfMm = input.kerfMm ?? KOTUC;
	const now = meta.now ?? new Date();

	const pouzite = material.filter((m) => m.tyce > 0);
	const sum = narezakSummary(material);
	const dlzkaTyce = pouzite[0]?.barLen ?? 0;

	const parts: string[] = ['<div class="narezak">', '<style>', CSS, '</style>'];

	// --- hlavička (zrkadlí PDF: nadpis + QR, meta, dátum, súhrn) ------------------------------------ //
	const qrPayload = qrZakazkaPayload(meta.op);
	const qrSvg = qrPayload ? renderQrSvg(qrPayload) : '';
	parts.push('<header class="hlavicka"><div class="nadpis"><h1>Nárezový plán</h1>');
	if (qrSvg) parts.push(`<span class="qr">${qrSvg}</span>`);
	parts.push('</div>');
	parts.push(
		`<p class="meta">Zákazka: ${escapeHtml(meta.zak ?? '')}  ·  Objednávka: ${escapeHtml(meta.op ?? '')}  ·  Zákazník: ${escapeHtml(meta.zakaznik ?? '')}</p>`
	);
	if (meta.nazov) parts.push(`<p class="meta">Plán: ${escapeHtml(meta.nazov)}</p>`);
	const stav = now.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
	parts.push(
		`<p class="datum">Dátum: ${escapeHtml(stav)}  ·  nahrádza predchádzajúce  ·  zdroj: automatizácie Montalu (nárezový plán).</p>`
	);
	parts.push(
		`<p class="suhrn">Profilov: ${sum.profiles_count}  ·  Tyčí spolu: ${sum.bars_total}  ·  Odpad spolu: ${fmt(sum.waste_total_mm)} mm (${fmt(sum.waste_total_pct)} %)  ·  Dĺžka tyče: ${fmt(dlzkaTyce)} mm  ·  Rezná medzera: ${fmt(kerfMm)} mm</p>`
	);
	parts.push('</header>');

	// --- blok per profil (len kódované, tyce>0) — poradie + bar_id 1:1 s buildCutPlan -------------- //
	const seenIcon = new Set<string>();
	let n = 0;
	for (const m of material) {
		if (!(m.tyce > 0)) continue;
		if (!m.kod) continue; // Money kód povinný (rovnako ako buildCutPlan) — bez kódu žiadny data-bar-id
		if (m.bary.length === 0) continue;
		const sikmy = m.sikmyRez ?? true;
		const barLen = m.barLen;

		parts.push(`<section class="profil" data-profile-kod="${escapeHtml(m.kod)}">`);
		parts.push('<div class="profil-head">');
		// ikona RAZ per kód (na prvom bloku kódu s obrázkom); vynechaná bez obrázka / v degradovanom móde.
		// `typeof === 'string'` guard: `PROFIL_PNG_B64[kod]` je plain-object lookup — kód rovný
		// prototype kľúču (`constructor`, `toString`…) by vrátil zdedenú FUNKCIU; guard ju odmietne
		// (nikdy neemitujeme non-base64 do src). Money kódy také reťazce nie sú, ale je to lacná obrana.
		if (withIcons && !seenIcon.has(m.kod)) {
			const icon = profilPngB64(m.kod);
			if (typeof icon === 'string' && icon)
				parts.push(`<img class="ikona" alt="" src="data:image/png;base64,${icon}">`);
		}
		seenIcon.add(m.kod);
		const titul = `${escapeHtml(m.kod)}${m.nazov ? ' · ' + escapeHtml(m.nazov) : ''}`;
		parts.push(`<div><div class="profil-titul">${titul}</div>`);
		parts.push(
			`<div class="profil-stat">Počet tyčí: ${m.tyce}  ·  dĺžka tyče ${fmt(barLen)} mm  ·  kotúč ${fmt(kerfMm)} mm  ·  odpad ${fmt(m.odpadMm)} mm (${fmt(m.odpadPct)} %)  ·  rez ${sikmy ? '45°' : 'rovný'}</div></div></div>`
		);

		// pásy tyčí — každý nesie data-bar-id, SVG so segmentmi kusov (data-piece-id) cez zdieľaný helper
		m.bary.forEach((tyc, ti) => {
			n++;
			const barId = `B${n}`;
			const svg = renderBarSvg(tyc, barLen, sikmy, { barId });
			parts.push(
				`<div class="pas" data-bar-id="${escapeHtml(barId)}"><span class="pas-no">/${ti + 1}/</span>${svg}</div>`
			);
		});

		// tabuľka rezov (Dĺžka / Kusov / Rez) — ako PDF
		const rezy = m.rezy.filter((r) => r.ks > 0);
		if (rezy.length > 0) {
			parts.push(
				'<table class="rezy"><thead><tr><th>Dĺžka (mm)</th><th>Kusov</th><th>Rez</th></tr></thead><tbody>'
			);
			for (const r of rezy) {
				parts.push(
					`<tr><td>${fmt(r.rozmer)}</td><td>${r.ks}</td><td>${sikmy ? '45° / 45°' : 'rovný'}</td></tr>`
				);
			}
			parts.push('</tbody></table>');
		}
		parts.push('</section>');
	}

	// --- odpad spolu (≥2 profily) ------------------------------------------------------------------ //
	if (sum.profiles_count > 1) {
		parts.push(
			`<p class="odpad-spolu">Odpad spolu (naprieč ${sum.profiles_count} profilmi): ${fmt(sum.waste_total_mm)} mm (${fmt(sum.waste_total_pct)} %)</p>`
		);
	}

	parts.push('</div>');
	return parts.join('');
}

/**
 * `renderNarezakHtml` so size-guardom (#542, kontrakt owner/#7431). Poradie:
 *  1. render s ikonami; ak ≤ strop → OK.
 *  2. nad stropom → render BEZ ikon (len kódy) + warn; ak ≤ strop → degradované OK.
 *  3. stále nad stropom → `html` undefined (Odoo fallback na fázu B) + warn.
 *
 * `capBytes` je testovací override stropu (default `NAREZAK_HTML_MAX_BYTES`).
 */
export function renderNarezakHtmlCapped(
	input: NarezakHtmlInput,
	capBytes: number = NAREZAK_HTML_MAX_BYTES
): NarezakHtmlResult {
	const full = renderNarezakHtml(input, true);
	if (Buffer.byteLength(full, 'utf8') <= capBytes) {
		return { html: full, degraded: false, omitted: false };
	}
	const noIcons = renderNarezakHtml(input, false);
	if (Buffer.byteLength(noIcons, 'utf8') <= capBytes) {
		log.warn('render_html nad stropom — ikony vynechané (len kódy)', {
			op: input.meta?.op,
			bytesWithIcons: Buffer.byteLength(full, 'utf8'),
			bytesNoIcons: Buffer.byteLength(noIcons, 'utf8'),
			capBytes
		});
		return { html: noIcons, degraded: true, omitted: false };
	}
	log.warn('render_html nad stropom aj bez ikon — vynechané (Odoo fallback na fázu B)', {
		op: input.meta?.op,
		bytesNoIcons: Buffer.byteLength(noIcons, 'utf8'),
		capBytes
	});
	return { degraded: false, omitted: true };
}
