// #528: QR zákazky v tlačených výstupoch. Payload = HOLÉ `sale.order.name` (Odoo A6 štítok,
// `company_montalu_install_config` `_montalu_order_label_qr_src`) = `normOp(op)`. Appka už má
// invariant `sale.order.name === normOp(op)` (odoo-zakazka.ts). Kiosk (`_order_by_scan`) robí
// trim + case-insensitive substring proti `sale.order.name` → tento reťazec objednávku otvorí.
import { describe, it, expect } from 'vitest';
import {
	qrZakazkaPayload,
	renderQrSvg,
	buildQrMatrix,
	QR_ZAKAZKA_TESTID
} from '../src/lib/qr-zakazka';
import { normOp } from '../src/lib/server/money';

describe('qrZakazkaPayload — presný formát Odoo štítku (sale.order.name)', () => {
	it('OP číslo ostáva nedotknuté', () => {
		expect(qrZakazkaPayload('OP260397')).toBe('OP260397');
	});
	it('OPDL (iný typ dokladu) ostáva nedotknuté — NEpridá sa OP', () => {
		expect(qrZakazkaPayload('OPDL260222')).toBe('OPDL260222');
	});
	it('holé číslo → kanonický OP prefix (ako normOp)', () => {
		expect(qrZakazkaPayload('260286')).toBe('OP260286');
	});
	it('zdvojený OP z copy-paste → jeden OP', () => {
		expect(qrZakazkaPayload('OPOP260233')).toBe('OP260233');
	});
	it('whitespace + lowercase sa normalizuje (trim/upper/collapse)', () => {
		expect(qrZakazkaPayload('  op 260 397 ')).toBe('OP260397');
	});
	it('prázdne / null / undefined → prázdny reťazec (žiaden QR)', () => {
		expect(qrZakazkaPayload('')).toBe('');
		expect(qrZakazkaPayload('   ')).toBe('');
		expect(qrZakazkaPayload(null)).toBe('');
		expect(qrZakazkaPayload(undefined)).toBe('');
	});

	// DRIFT GUARD: qrZakazkaPayload je client-safe dvojník server-only `normOp` (money.ts).
	// Ak sa niekedy rozídu, tento test zlyhá a obe treba zladiť.
	it('cross-check: qrZakazkaPayload(x) === normOp(x) na batérii vstupov', () => {
		const battery = [
			'OP260397',
			'OPDL260222',
			'260286',
			'OPOP260233',
			'  op 260 397 ',
			'op260500',
			'OP-DL260222',
			'',
			'   ',
			'ZAK123',
			'OPI2026',
			'12345'
		];
		for (const x of battery) {
			expect(qrZakazkaPayload(x)).toBe(normOp(x));
		}
	});
});

describe('buildQrMatrix', () => {
	it('null pri prázdnom payloade', () => {
		expect(buildQrMatrix('')).toBeNull();
	});
	it('deterministická matica pre daný payload (21 modulov pre krátke OP)', () => {
		const m = buildQrMatrix('OP260397');
		expect(m).not.toBeNull();
		expect(m!.count).toBe(21);
		// prvý modul finder-patternu je vždy tmavý
		expect(m!.isDark(0, 0)).toBe(true);
	});
	it('rovnaký payload → identická matica (determinizmus)', () => {
		const a = buildQrMatrix('OPDL260222')!;
		const b = buildQrMatrix('OPDL260222')!;
		expect(a.count).toBe(b.count);
		for (let r = 0; r < a.count; r++)
			for (let c = 0; c < a.count; c++) expect(a.isDark(r, c)).toBe(b.isDark(r, c));
	});
});

describe('renderQrSvg', () => {
	it('prázdny payload → prázdny reťazec', () => {
		expect(renderQrSvg('')).toBe('');
	});
	it('neprázdny payload → SVG s bielym pozadím + quiet zónou, deterministický', () => {
		const svg = renderQrSvg('OP260397');
		expect(svg).toContain('<svg');
		expect(svg).toContain('viewBox');
		expect(svg).toContain('fill="white"');
		expect(renderQrSvg('OP260397')).toBe(svg); // determinizmus
	});
	it('rôzny payload → rôzny SVG', () => {
		expect(renderQrSvg('OP260397')).not.toBe(renderQrSvg('OPDL260222'));
	});
});

describe('QR_ZAKAZKA_TESTID', () => {
	it('je stabilný kontrakt pre E2E', () => {
		expect(QR_ZAKAZKA_TESTID).toBe('qr-zakazka');
	});
});
