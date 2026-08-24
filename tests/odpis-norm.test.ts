// #294 — normalizácia dedup kľúča op/zak + hláška bloku. Unit testy pre kanonizáciu OP prefixu
// (Money-kritické: 260286 ≡ OP260286, OPOP zdvojenie, OPDL iný typ dokladu).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATABASE_PATH = path.join(
	fs.mkdtempSync(path.join(os.tmpdir(), 'am-norm-')),
	'test.db'
);
const { normOp, normZak, blokHlaska } = await import('../src/lib/server/money');
import type { OdpisOutcome } from '../src/lib/server/money';

describe('normOp — kanonizácia OP prefixu', () => {
	it('bare číslo dostane OP prefix: 260286 → OP260286', () => {
		expect(normOp('260286')).toBe('OP260286');
	});
	it('OP260286 ostáva OP260286 (idempotentné)', () => {
		expect(normOp('OP260286')).toBe('OP260286');
	});
	it('260286 ≡ OP260286 (rovnaký dedup kľúč)', () => {
		expect(normOp('260286')).toBe(normOp('OP260286'));
	});
	it('zdvojený OP z copy-paste: OPOP260233 → OP260233', () => {
		expect(normOp('OPOP260233')).toBe('OP260233');
	});
	it('OPDL je INÝ typ dokladu — ostáva nedotknutý (nie zamenené s OP)', () => {
		expect(normOp('OPDL260092')).toBe('OPDL260092');
		expect(normOp('OPDL260092')).not.toBe(normOp('OP260092'));
	});
	it('trim + uppercase + collapse whitespace', () => {
		expect(normOp('  op 260286 ')).toBe('OP260286');
	});
	it('prázdny reťazec ostáva prázdny', () => {
		expect(normOp('')).toBe('');
		expect(normOp('   ')).toBe('');
	});
	it('ZAK v poli op (prehodené) sa nezmení na OP', () => {
		expect(normOp('ZAK2026499')).toBe('ZAK2026499');
	});
});

describe('normZak', () => {
	it('trim/upper/collapse', () => {
		expect(normZak('  zak2026273 ')).toBe('ZAK2026273');
	});
	it('prázdny ostáva prázdny', () => {
		expect(normZak('')).toBe('');
	});
});

describe('blokHlaska — správna hláška podľa reason', () => {
	const base = { status: 'blocked' as const, live: true, target: '/x', filename: 'x.xlsx' };

	it('ledger-duplicate → hláška o dvojitom importe + „Odoslať aj tak" (#300 koniec dead-endu)', () => {
		const o: OdpisOutcome = { ...base, reason: 'ledger-duplicate', ledgerImportedAt: '2026-07-30' };
		const h = blokHlaska(o, 'ZAK1', '01');
		expect(h).toContain('už bol raz importovaný do Money');
		// #300: hláška smeruje na modulové tlačidlo „Odoslať aj tak" (po „Uvoľniť" už NEEXISTUJE
		// /odpisy riadok na „Povoliť rovnaký" — to bol práve dead-end, ktorý #300 rieši)
		expect(h).toContain('Odoslať aj tak');
	});

	it('unknown-kod (1) → jednotné číslo „kód" + zoznam', () => {
		const o: OdpisOutcome = {
			...base,
			reason: 'unknown-kod',
			chybajuceKody: [{ kod: 'ZASP99999', nazov: 'X', dovod: 'neznamy', popis: '' }]
		};
		const h = blokHlaska(o, 'ZAK1', '01');
		expect(h).toContain('Money nepozná kód: ZASP99999');
		expect(h).toContain('NEODPÍSAL');
	});

	it('unknown-kod (viac) → množné „kódy" + značka bez skladovej karty', () => {
		const o: OdpisOutcome = {
			...base,
			reason: 'unknown-kod',
			chybajuceKody: [
				{ kod: 'ZASP99999', nazov: 'X', dovod: 'neznamy', popis: '' },
				{ kod: 'ZASP00099', nazov: 'Y', dovod: 'bez-skladovej-karty', popis: '' }
			]
		};
		const h = blokHlaska(o, 'ZAK1', '01');
		expect(h).toContain('Money nepozná kódy:');
		expect(h).toContain('ZASP00099 (bez skladovej karty)');
	});
});
