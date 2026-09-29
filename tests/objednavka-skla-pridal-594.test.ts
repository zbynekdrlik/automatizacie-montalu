// #594 (Odoo úloha 1219, Marek 29.9.: „robil iba zasklenie pre tie dva a preco tam je to zasklenie
// 1"): riadok „Zasklenie 1" na podklade ZAK „test" pridal INÝ používateľ (palo@montalu.sk 25.9.) —
// podklad je kľúčovaný zákazkou (#571). Podklad preto pri KAŽDOM riadku ukáže, kto a kedy ho
// pridal: „pridal <created_by> · <dátum čas>" — server-side, Europe/Bratislava (timestamps.md:
// SQLite `created_at` je UTC „YYYY-MM-DD HH:MM:SS" → `sqliteUtcToIso` → `formatDatumCasSk`).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pridal-594-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { pridajSklo, pridalRiadku } = await import('../src/lib/server/objednavka-skla');
const { load } = await import('../src/routes/objednavka-skla/[zak]/+page.server');
const { db } = await import('../src/lib/server/db');

function seedRiadok(zak: string, autor: string, createdAt: string): number {
	const id = pridajSklo({
		zak,
		modul: 'manual',
		popis: 'V.O.',
		sirkaMm: 500,
		vyskaMm: 400,
		pocet: 1,
		typSkla: 'Float 4',
		createdBy: autor
	});
	db.prepare('UPDATE objednavka_skla SET created_at = ? WHERE id = ?').run(createdAt, id);
	return id;
}

async function nacitaj(zak: string, username: string) {
	return (await load({
		params: { zak },
		url: new URL(`http://x/objednavka-skla/${encodeURIComponent(zak)}`),
		locals: { user: { id: 1, username, role: 'internal' } }
	} as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
}

describe('#594 pridalRiadku — kto a kedy pridal riadok podkladu', () => {
	it('autor + čas v Europe/Bratislava (SQLite UTC 05:52 v lete = 07:52)', () => {
		expect(pridalRiadku({ createdBy: 'palo@montalu.sk', createdAt: '2026-09-25 05:52:00' })).toBe(
			'pridal palo@montalu.sk · 25.9.2026 07:52'
		);
	});
	it('zimný čas (UTC+1) a deň cez polnoc v UTC', () => {
		expect(pridalRiadku({ createdBy: 'vyroba', createdAt: '2026-01-05 23:30:00' })).toBe(
			'pridal vyroba · 6.1.2026 00:30'
		);
	});
	it('riadok bez autora (legacy) → len čas, nikdy „pridal  ·"', () => {
		expect(pridalRiadku({ createdBy: '', createdAt: '2026-09-25 05:52:00' })).toBe(
			'pridané 25.9.2026 07:52'
		);
	});
});

describe('#594 podklad load — `pridal` pre každý riadok (aj cudzí)', () => {
	it('riadky od dvoch používateľov → každý nesie svojho autora a čas', async () => {
		const zak = 'ZAK-594-PRIDAL';
		const a = seedRiadok(zak, 'palo@montalu.sk', '2026-09-25 05:52:00');
		const b = seedRiadok(zak, 'vyroba', '2026-09-29 06:12:00');
		const d = await nacitaj(zak, 'vyroba');
		expect(d.pridal).toEqual({
			[a]: 'pridal palo@montalu.sk · 25.9.2026 07:52',
			[b]: 'pridal vyroba · 29.9.2026 08:12'
		});
	});
});
