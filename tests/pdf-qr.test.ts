// #528: drawQrZakazkaPdf — kreslí QR zákazky do pdf-lib stránky obdĺžnikmi. Testujeme cez FAKE
// PDFPage, ktorá zaznamená volania drawRectangle (custom-font/telo PDF sa nečíta — viď
// plan-rezov-kiosk.md). Prázdny payload → nič sa nekreslí (výstup byte-identický).
import { describe, it, expect, vi } from 'vitest';
import type { PDFPage } from 'pdf-lib';
import {
	drawQrZakazkaPdf,
	qrZakazkaHeaderXY,
	qrHeaderTextWidth,
	A4_W,
	MARGIN,
	CONTENT_W
} from '../src/lib/server/pdf-common';
import { buildQrMatrix } from '../src/lib/qr-zakazka';

function fakePage() {
	const calls: Array<Record<string, unknown>> = [];
	const page = {
		drawRectangle: vi.fn((opts: Record<string, unknown>) => calls.push(opts))
	} as unknown as PDFPage;
	return { page, calls };
}

// počet tmavých modulov pre daný payload — očakávaný počet „čiernych" obdĺžnikov
function darkCount(payload: string): number {
	const m = buildQrMatrix(payload)!;
	let n = 0;
	for (let r = 0; r < m.count; r++) for (let c = 0; c < m.count; c++) if (m.isDark(r, c)) n++;
	return n;
}

describe('drawQrZakazkaPdf', () => {
	it('prázdny payload → nekreslí nič a vráti false (byte-identický výstup)', () => {
		const { page, calls } = fakePage();
		expect(drawQrZakazkaPdf(page, '', 100, 100, 68)).toBe(false);
		expect(calls.length).toBe(0);
	});

	it('OP payload → biele pozadie + presne toľko čiernych modulov ako matica, vráti true', () => {
		const { page, calls } = fakePage();
		expect(drawQrZakazkaPdf(page, 'OP260397', 500, 700, 68)).toBe(true);
		// 1 biele pozadie (full štvorec) + N tmavých modulov
		expect(calls.length).toBe(1 + darkCount('OP260397'));
		// prvý draw = biele pozadie celého QR štvorca v (x,y) s rozmerom size×size
		expect(calls[0]).toMatchObject({ x: 500, y: 700, width: 68, height: 68 });
		// existuje aspoň jeden modul (finder pattern) — QR nie je prázdny
		expect(calls.length).toBeGreaterThan(50);
	});

	it('OPDL payload sa tiež nakreslí (iný typ dokladu)', () => {
		const { page } = fakePage();
		expect(drawQrZakazkaPdf(page, 'OPDL260222', 0, 0, 68)).toBe(true);
	});

	it('moduly sú vnútri štvorca [x, x+size] × [y, y+size] (quiet zóna nevytŕča)', () => {
		const { page, calls } = fakePage();
		const x = 200,
			y = 300,
			size = 68;
		drawQrZakazkaPdf(page, 'OP260397', x, y, size);
		for (const c of calls) {
			const cx = c.x as number,
				cy = c.y as number,
				w = c.width as number,
				h = c.height as number;
			expect(cx).toBeGreaterThanOrEqual(x - 1e-6);
			expect(cy).toBeGreaterThanOrEqual(y - 1e-6);
			expect(cx + w).toBeLessThanOrEqual(x + size + 1e-6);
			expect(cy + h).toBeLessThanOrEqual(y + size + 1e-6);
		}
	});
});

// #528 review (correctness): text hlavičky (kreslený PO QR bielom pozadí) nikdy nesmie zasiahnuť pod
// QR — inak by dlhé meno zákazníka pretlačilo QR moduly a sken by zlyhal. Toto je geometrický invariant
// nezávislý od obsahu (silnejší než render-konkrétneho-mena): pravý okraj zalomeného textu hlavičky je
// VŽDY vľavo od ľavého okraja QR.
describe('QR header geometry — text nikdy nepretlačí QR', () => {
	it('bez QR: plná šírka hlavičky (výstup nezmenený)', () => {
		expect(qrHeaderTextWidth(false)).toBe(CONTENT_W);
	});
	it('s QR: pravý okraj textu hlavičky je vľavo od ľavého okraja QR (s medzerou)', () => {
		const qr = qrZakazkaHeaderXY();
		const textRight = MARGIN + qrHeaderTextWidth(true);
		expect(textRight).toBeLessThan(qr.x);
	});
	it('QR sa celý zmestí do pravého horného rohu stránky', () => {
		const qr = qrZakazkaHeaderXY();
		expect(qr.x).toBeGreaterThanOrEqual(MARGIN);
		expect(qr.x + qr.size).toBeLessThanOrEqual(A4_W - MARGIN + 1e-6);
	});
});
