// b2b šírkový blok + výškové upozornenie v NÁHĽADOVÝCH akciách (nahlad,
// nahladMulti) — priama integrácia b2b-limits.ts do zasklenia flow (Task 6).
// Interní users musia prejsť flow bit-identicky (limity sa preskočia).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-b2bpreview-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'p.db');
delete process.env.MONEY_LIVE; // len náhľad — nič sa nezapisuje, ale istota
await import('../src/lib/server/db'); // triggers migrate + seed (all systems/styles)
const { actions } = await import('../src/routes/zasklenia/+page.server');

const B2B_USER = { id: 1, username: 'vo', role: 'b2b' as const };
const INTERNAL_USER = { id: 2, username: 'admin', role: 'internal' as const };

function nahladEvent(
	fields: Record<string, string>,
	user: typeof B2B_USER | typeof INTERNAL_USER | null
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries({ farbaKovania: 'R9005', ...fields })) fd.append(k, v);
	return {
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof actions.nahlad>[0];
}

const BASE = {
	zak: 'Z1',
	op: 'O1',
	zakaznik: 'Test',
	system: 'Robust',
	styl: '2K',
	sklo: 'Izolačné sklo 4/16/4 mliečne',
	otvaranie: 'P - L'
};

describe('nahlad — b2b šírkový blok + výškové upozornenie', () => {
	it('b2b, panel nad max (Robust 2K@5000 → panel 2500 > 1500) → blok, error, žiadny plán', async () => {
		const r = await actions.nahlad(nahladEvent({ ...BASE, s: '5000', v: '2000' }, B2B_USER));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string }).error).toMatch(/Zvoľ/);
		expect((r as { plan?: unknown }).plan).toBeUndefined();
	});

	it('b2b, šírka v poriadku ale výška nad limit (Robust 2K@2600×2700 → nad 2600) → nahlad + heightWarn, NEblokuje', async () => {
		const r = await actions.nahlad(nahladEvent({ ...BASE, s: '2600', v: '2700' }, B2B_USER));
		expect(r).toMatchObject({ step: 'nahlad' });
		expect((r as { error?: string }).error).toBeUndefined();
		expect((r as { heightWarn?: string }).heightWarn).toContain('BEZ ZÁRUKY');
	});

	it('b2b, šírka aj výška v poriadku → nahlad, žiadny heightWarn', async () => {
		const r = await actions.nahlad(nahladEvent({ ...BASE, s: '2600', v: '2000' }, B2B_USER));
		expect(r).toMatchObject({ step: 'nahlad' });
		expect((r as { heightWarn?: string }).heightWarn).toBeUndefined();
	});

	it('interný účet: rovnaké oversize hodnoty NEblokujú (limity platia len pre b2b, flow nezmenený)', async () => {
		const r = await actions.nahlad(nahladEvent({ ...BASE, s: '5000', v: '2700' }, INTERNAL_USER));
		expect(r).toMatchObject({ step: 'nahlad' });
		expect((r as { heightWarn?: string }).heightWarn).toBeUndefined();
	});
});

const POSUV1 = {
	system: 'Robust',
	styl: '2K',
	s: 5000,
	v: 2000,
	sklo: BASE.sklo,
	otvaranie: 'P - L'
};
const POSUV2_HEIGHT = {
	system: 'Robust',
	styl: '2K',
	s: 2600,
	v: 2700,
	sklo: BASE.sklo,
	otvaranie: 'P - L'
};
const POSUV_OK = {
	system: 'Robust',
	styl: '2K',
	s: 2600,
	v: 2000,
	sklo: BASE.sklo,
	otvaranie: 'P - L'
};

function nahladMultiEvent(posuvy: unknown[], user: typeof B2B_USER | typeof INTERNAL_USER | null) {
	const fd = new FormData();
	fd.append('zak', 'Z1');
	fd.append('op', 'O1');
	fd.append('zakaznik', 'Test');
	fd.append('posuvy', JSON.stringify(posuvy));
	fd.append('farbaKovania', 'R9005');
	return {
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof actions.nahladMulti>[0];
}

describe('nahladMulti — b2b per-posuv šírkový blok + agregované výškové upozornenie', () => {
	it('b2b, prvý posuv má panel nad max → blok CELÉHO náhľadu na prvej chybe', async () => {
		const r = await actions.nahladMulti(nahladMultiEvent([POSUV1, POSUV_OK], B2B_USER));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string }).error).toMatch(/Zvoľ/);
	});

	it('b2b, šírky OK ale jeden posuv nad výškový limit → nahladMulti + agregovaný heightWarn', async () => {
		const r = await actions.nahladMulti(nahladMultiEvent([POSUV_OK, POSUV2_HEIGHT], B2B_USER));
		expect(r).toMatchObject({ step: 'nahladMulti' });
		expect((r as { heightWarn?: string }).heightWarn).toContain('BEZ ZÁRUKY');
	});

	it('interný účet: rovnaké oversize posuvy NEblokujú (limity platia len pre b2b)', async () => {
		const r = await actions.nahladMulti(nahladMultiEvent([POSUV1, POSUV2_HEIGHT], INTERNAL_USER));
		expect(r).toMatchObject({ step: 'nahladMulti' });
		expect((r as { heightWarn?: string }).heightWarn).toBeUndefined();
	});
});
