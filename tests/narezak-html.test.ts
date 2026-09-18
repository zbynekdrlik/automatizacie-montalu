// #542: `cut_plan.render_html` (v3) — serverový HTML renderer celého nárezáku (`narezak-html.ts`),
// ktorý ZRKADLÍ sekcie grafického PDF (`narezak-pdf.ts`) a ZDIEĽA jeho helpery (`renderBarSvg`,
// `profilPngB64`, `narezakSummary`, `renderQrSvg`). Odoo fáza C ho vloží do Shadow DOM a odškrtáva
// cez `data-bar-id`/`data-piece-id`. Testuje: id-zhoda s `cut_plan.bars[]`, `data-profile-kod`,
// ikony (raz per kód, vynechané bez obrázka), QR, allow-list sanitizer-safety, súhrn = `narezakSummary`,
// size-guard degradáciu (ikony preč → kľúč vynechaný), `render_svg` per-bar byte-identický (opts off).
// Money-NEUTRÁLNE (žiadna cena).
import { describe, it, expect } from 'vitest';
import {
	renderNarezakHtml,
	renderNarezakHtmlCapped,
	escapeHtml,
	NAREZAK_HTML_MAX_BYTES,
	type NarezakHtmlMeta
} from '../src/lib/server/narezak-html';
import { buildCutPlan, renderBarSvg, type CutPlan } from '../src/lib/server/narezak-cut-plan';
import { narezakSummary } from '../src/lib/odpad';
import { KOTUC, type MaterialRow, type Tyc } from '../src/lib/server/compute';

// ZASP20244 + BPP00054 majú ikonu v `profil-png.ts`; NOICON001 ju NEMÁ (test vynechania).
const material: MaterialRow[] = [
	{
		kod: 'ZASP20244',
		nazov: 'RÁMOVÝ',
		rezy: [
			{ rozmer: 2500, ks: 3 },
			{ rozmer: 1800, ks: 1 }
		],
		tyce: 2,
		bary: [
			{
				kusy: [
					{ rozmer: 2500, dlzka: 2504, posuv: 1 },
					{ rozmer: 2500, dlzka: 2504, posuv: 1 }
				],
				zvysok: 2492
			},
			{
				kusy: [
					{ rozmer: 1800, dlzka: 1804, posuv: 1 },
					{ rozmer: 2500, dlzka: 2504, posuv: 2 }
				],
				zvysok: 3192
			}
		],
		odpadMm: 5684,
		odpadPct: 37.9,
		barLen: 7500,
		sikmyRez: true
	},
	{
		kod: 'BPP00054',
		nazov: 'ROVNÝ',
		rezy: [{ rozmer: 2000, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 2000, dlzka: 2004 }], zvysok: 3996 }],
		odpadMm: 3996,
		odpadPct: 66.6,
		barLen: 6000,
		sikmyRez: false
	},
	{
		kod: 'NOICON001',
		nazov: 'BEZ IKONY',
		rezy: [{ rozmer: 1200, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 1200, dlzka: 1204 }], zvysok: 6296 }],
		odpadMm: 6296,
		odpadPct: 83.9,
		barLen: 7500,
		sikmyRez: false
	},
	{
		// TEN ISTÝ kód ako 2. profil → druhý blok NESMIE zopakovať ikonu (raz per kód)
		kod: 'BPP00054',
		nazov: 'ROVNÝ 2',
		rezy: [{ rozmer: 1500, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 1500, dlzka: 1504 }], zvysok: 4496 }],
		odpadMm: 4496,
		odpadPct: 74.9,
		barLen: 6000,
		sikmyRez: false
	},
	{
		// bez kódu — vypadne z bars[], ale RÁTA sa do summary (papierové čísla)
		kod: '',
		nazov: 'BEZ KÓDU',
		rezy: [{ rozmer: 1000, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 1000, dlzka: 1004 }], zvysok: 6496 }],
		odpadMm: 6496,
		odpadPct: 86.6,
		barLen: 7500,
		sikmyRez: false
	},
	{
		// tyce=0 — vypadne úplne
		kod: 'ZASP99999',
		nazov: 'PRÁZDNY',
		rezy: [],
		tyce: 0,
		bary: [],
		odpadMm: 0,
		odpadPct: 0,
		barLen: 7500,
		sikmyRez: false
	}
];

const meta: NarezakHtmlMeta = {
	zak: 'ZAK2026542',
	op: 'OP260397',
	zakaznik: 'Test s.r.o.',
	now: new Date('2026-09-18T10:00:00Z')
};

describe('renderNarezakHtml — data-bar-id / data-piece-id zhodné s cut_plan.bars[]', () => {
	const plan = buildCutPlan(material, KOTUC, meta) as CutPlan;
	const html = plan.render_html as string;

	it('render_html je fragment `<div class="narezak">` (bez <html>/<head>)', () => {
		expect(typeof html).toBe('string');
		expect(html.startsWith('<div class="narezak">')).toBe(true);
		// žiadny dokumentový wrapper (Odoo vkladá fragment do Shadow DOM). `<head[\s>]` zámerne
		// NEmatchne `<header>` (vlastnú hlavičku fragmentu).
		expect(html).not.toMatch(/<html[\s>]|<head[\s>]|<!DOCTYPE/i);
	});

	it('presne bars.length × data-bar-id, ids == cut_plan.bars[].bar_id v poradí', () => {
		const barIds = [...html.matchAll(/data-bar-id="([^"]+)"/g)].map((m) => m[1]);
		expect(barIds.length).toBe(plan.bars.length);
		expect(barIds).toEqual(plan.bars.map((b) => b.bar_id));
		expect(barIds).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
	});

	it('Σ pieces × data-piece-id, ids == `<bar_id>:<seq>` z cut_plan.bars[].pieces', () => {
		const pieceIds = [...html.matchAll(/data-piece-id="([^"]+)"/g)].map((m) => m[1]);
		const expected = plan.bars.flatMap((b) => b.pieces.map((p) => `${b.bar_id}:${p.seq}`));
		expect(pieceIds.length).toBe(plan.bars.reduce((s, b) => s + b.pieces.length, 0));
		expect(pieceIds).toEqual(expected);
	});

	it('data-profile-kod per profilový blok (aj opakovaný kód má vlastný blok)', () => {
		const kods = [...html.matchAll(/data-profile-kod="([^"]+)"/g)].map((m) => m[1]);
		expect(kods).toEqual(['ZASP20244', 'BPP00054', 'NOICON001', 'BPP00054']);
	});
});

describe('renderNarezakHtml — ikony, QR, súhrn', () => {
	const html = renderNarezakHtml({ material, kerfMm: KOTUC, meta });

	it('ikona data:image/png RAZ per kód; vynechaná keď obrázok chýba', () => {
		// ZASP20244 (1×) + BPP00054 (1×, druhý blok neopakuje) + NOICON001 (0×) = 2
		const icons = [...html.matchAll(/src="data:image\/png;base64,/g)];
		expect(icons.length).toBe(2);
	});

	it('QR <svg> je prítomné keď je OP; chýba bez OP', () => {
		expect(html).toContain('class="qr"');
		const bezOp = renderNarezakHtml({ material, kerfMm: KOTUC, meta: { ...meta, op: undefined } });
		expect(bezOp).not.toContain('class="qr"');
	});

	it('súhrn = narezakSummary(material) (počíta aj bez-kódu profil, ako papier)', () => {
		const sum = narezakSummary(material);
		expect(html).toContain(`Profilov: ${sum.profiles_count}`);
		expect(html).toContain(`Tyčí spolu: ${sum.bars_total}`);
		expect(html).toContain(String(sum.waste_total_mm));
		// bez-kódu profil je v summary, ale NIE v bars → summary.bars_total > bars.length
		const plan = buildCutPlan(material, KOTUC, meta) as CutPlan;
		expect(sum.bars_total).toBeGreaterThan(plan.bars.length);
	});
});

describe('renderNarezakHtml — allow-list sanitizer-safety (Odoo Shadow DOM)', () => {
	const html = renderNarezakHtml({ material, kerfMm: KOTUC, meta });

	it('žiadny <script, on*= handler, javascript:, externé URL v src/href, url(), @import', () => {
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/\son[a-z]+\s*=/i);
		expect(html).not.toMatch(/javascript:/i);
		expect(html).not.toMatch(/(?:src|href)\s*=\s*["'][^"']*https?:\/\//i);
		expect(html).not.toMatch(/url\(/i);
		expect(html).not.toMatch(/@import/i);
	});

	it('obrázky výhradne data:image/png; jediné http(s) je SVG xmlns namespace (nie src/href)', () => {
		const imgs = [...html.matchAll(/<img[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1] ?? '');
		expect(imgs.length).toBeGreaterThan(0);
		for (const s of imgs) expect(s.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('dynamický text je escapovaný (profile_name s <script> sa neprejaví ako značka)', () => {
		const zlo: MaterialRow[] = [
			{
				kod: 'ZASP20244',
				nazov: 'A<script>x</script>',
				rezy: [{ rozmer: 1000, ks: 1 }],
				tyce: 1,
				bary: [{ kusy: [{ rozmer: 1000, dlzka: 1004 }], zvysok: 6496 }],
				odpadMm: 6496,
				odpadPct: 86.6,
				barLen: 7500,
				sikmyRez: false
			}
		];
		const out = renderNarezakHtml({ material: zlo, kerfMm: KOTUC, meta });
		expect(out).toContain('A&lt;script&gt;x&lt;/script&gt;');
		expect(out).not.toMatch(/<script/i);
	});

	it('escapeHtml: &<>"\' → entity', () => {
		expect(escapeHtml(`<b>&"'</b>`)).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
	});
});

describe('renderBarSvg — opts.barId pridá data-piece-id; opts off je byte-identické (fixúra)', () => {
	const fixtureTyc: Tyc = {
		kusy: [
			{ rozmer: 2500, dlzka: 2504, posuv: 1 },
			{ rozmer: 1800, dlzka: 1804 }
		],
		zvysok: 3188
	};
	// zachytené z PÔVODNEJ renderBarSvg (pred #542) — musí ostať 1:1 (render_svg kontrakt Odoo)
	const EXPECTED_OFF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 30" width="600" height="30"><rect x="0" y="1" width="600" height="28" fill="#f8fafc" stroke="#475569" stroke-width="0.7"/><polygon class="rez" points="20,1 180.32,1 200.32,29 0,29" fill="#f5ede2" stroke="#475569" stroke-width="0.7"/><text x="100.16" y="18" text-anchor="middle" font-size="8" font-family="'DejaVu Sans',sans-serif" fill="#0f172a">Z1 2500</text><polygon class="rez" points="220.32,1 324.64,1 344.64,29 200.32,29" fill="#f5ede2" stroke="#475569" stroke-width="0.7"/><text x="272.48" y="18" text-anchor="middle" font-size="8" font-family="'DejaVu Sans',sans-serif" fill="#0f172a">1800</text><polygon class="odpad" points="324.64,1 600,1 600,29 344.64,29" fill="#f1f5f9" stroke="#475569" stroke-width="0.7"/><text x="472.32" y="18" text-anchor="middle" font-size="8" font-family="'DejaVu Sans',sans-serif" fill="#64748b">odpad 3188</text></svg>`;

	it('bez opts (a s prázdnym opts) je výstup byte-identický s pôvodným', () => {
		expect(renderBarSvg(fixtureTyc, 7500, true)).toBe(EXPECTED_OFF);
		expect(renderBarSvg(fixtureTyc, 7500, true, {})).toBe(EXPECTED_OFF);
	});

	it('s opts.barId každý segment kusu (class="rez") nesie data-piece-id; odpad NIE', () => {
		const withIds = renderBarSvg(fixtureTyc, 7500, true, { barId: 'B7' });
		expect(withIds).toContain('data-piece-id="B7:1"');
		expect(withIds).toContain('data-piece-id="B7:2"');
		expect((withIds.match(/class="rez"/g) ?? []).length).toBe(2);
		expect((withIds.match(/data-piece-id/g) ?? []).length).toBe(2); // len 2 kusy, NIE odpad
		expect(withIds).not.toMatch(/class="odpad"[^>]*data-piece-id/);
	});

	it('cut_plan.bars[].render_svg (base64) NEOBSAHUJE data-piece-id (opts off — kontrakt Odoo)', () => {
		const plan = buildCutPlan(material, KOTUC, meta) as CutPlan;
		for (const b of plan.bars) {
			const svg = Buffer.from(b.render_svg, 'base64').toString('utf8');
			expect(svg).not.toContain('data-piece-id');
		}
	});
});

describe('renderNarezakHtmlCapped — size guard (1,4 MB → ikony preč → kľúč vynechaný)', () => {
	it('konštanta stropu = 1 400 000 B (rezerva pod 1,5 MB)', () => {
		expect(NAREZAK_HTML_MAX_BYTES).toBe(1_400_000);
	});

	it('bežný plán pod stropom → html s ikonami, degraded=false, omitted=false', () => {
		const res = renderNarezakHtmlCapped({ material, kerfMm: KOTUC, meta });
		expect(res.omitted).toBe(false);
		expect(res.degraded).toBe(false);
		expect(res.html).toBeDefined();
		expect(res.html).toContain('data:image/png');
	});

	it('strop medzi (bezIkon, sIkonami) → degraduje: ikony preč, html ostáva', () => {
		const sIkonami = Buffer.byteLength(
			renderNarezakHtml({ material, kerfMm: KOTUC, meta }, true),
			'utf8'
		);
		const bezIkon = Buffer.byteLength(
			renderNarezakHtml({ material, kerfMm: KOTUC, meta }, false),
			'utf8'
		);
		expect(sIkonami).toBeGreaterThan(bezIkon); // ikony pridávajú bajty
		const cap = Math.floor((sIkonami + bezIkon) / 2);
		const res = renderNarezakHtmlCapped({ material, kerfMm: KOTUC, meta }, cap);
		expect(res.degraded).toBe(true);
		expect(res.omitted).toBe(false);
		expect(res.html).toBeDefined();
		expect(res.html).not.toContain('data:image/png');
	});

	it('strop pod bez-ikon veľkosťou → render_html sa vynechá (Odoo fallback na fázu B)', () => {
		const bezIkon = Buffer.byteLength(
			renderNarezakHtml({ material, kerfMm: KOTUC, meta }, false),
			'utf8'
		);
		const res = renderNarezakHtmlCapped({ material, kerfMm: KOTUC, meta }, bezIkon - 1);
		expect(res.omitted).toBe(true);
		expect(res.html).toBeUndefined();
	});
});

describe('buildCutPlan — render_html VNÚTRI cut_plan (aditívne, version=1)', () => {
	it('plan-rezov shape (kerf = input.reznaMedzera) → cut_plan.render_html prítomný', () => {
		const p = buildCutPlan(material, 3, meta) as CutPlan;
		expect(p.version).toBe(1);
		expect(typeof p.render_html).toBe('string');
		expect(p.render_html).toContain('data-bar-id="B1"');
	});

	it('backfill shape (default kerf) → cut_plan.render_html prítomný', () => {
		const p = buildCutPlan(material, undefined, meta) as CutPlan;
		expect(typeof p.render_html).toBe('string');
		expect(p.render_html).toContain('class="narezak"');
	});

	it('žiadny coded bar → undefined (žiadny render_html)', () => {
		expect(buildCutPlan([], KOTUC, meta)).toBeUndefined();
	});
});
