// #154 (fáza 1): cenový zoznam materiálu v náhľade (nahlad/nahladMulti). B2B NESMIE
// vidieť cenový blok VÔBEC — `form.ceny` musí byť `undefined` (nedostane sa ani do
// HTML), nie len skryté v UI (rovnaká disciplína ako Money-write hranica, access-
// control skill §2). Interní naopak MUSIA dostať `ceny` s dátami z material_prices.
// VŠETKY ceny v tomto súbore sú VYMYSLENÉ (repo je verejné).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-zasklenia-ceny-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'p.db');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'ceny.json');
delete process.env.MONEY_LIVE; // len náhľad — nič sa nezapisuje

await import('../src/lib/server/db'); // triggers migrate + seed
const { actions } = await import('../src/routes/zasklenia/+page.server');

const B2B_USER = { id: 1, username: 'vo', role: 'b2b' as const };
const INTERNAL_USER = { id: 2, username: 'admin', role: 'internal' as const };

function nahladEvent(
	fields: Record<string, string>,
	user: typeof B2B_USER | typeof INTERNAL_USER | null
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	return {
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof actions.nahlad>[0];
}

function nahladMultiEvent(posuvy: unknown[], user: typeof B2B_USER | typeof INTERNAL_USER | null) {
	const fd = new FormData();
	fd.append('zak', 'Z1');
	fd.append('op', 'O1');
	fd.append('zakaznik', 'Test');
	fd.append('posuvy', JSON.stringify(posuvy));
	return {
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof actions.nahladMulti>[0];
}

const BASE = {
	zak: 'Z1',
	op: 'O1',
	zakaznik: 'Test',
	system: 'Robust',
	styl: '2K',
	s: '2600',
	v: '2000',
	sklo: 'Izolačné sklo 4/16/4 mliečne',
	otvaranie: 'P - L'
};

describe('nahlad — cenový blok (#154)', () => {
	it('b2b: form.ceny je undefined (cenový blok sa nikdy nedopočíta)', async () => {
		const r = await actions.nahlad(nahladEvent(BASE, B2B_USER));
		expect(r).toMatchObject({ step: 'nahlad' });
		expect((r as { ceny?: unknown }).ceny).toBeUndefined();
	});

	it('interný: form.ceny je definované s riadkami zodpovedajúcimi PRESNE tomu, čo ide do Money (profily + kovanie)', async () => {
		const r = (await actions.nahlad(nahladEvent(BASE, INTERNAL_USER))) as {
			step: string;
			ceny?: { radky: { kod: string }[]; sucty: unknown; snapshot: unknown };
			plan?: { odpis: { kod: string; metre: number }[] };
			kovanie?: { kod: string }[];
		};
		expect(r.step).toBe('nahlad');
		expect(r.ceny).toBeDefined();
		expect(r.ceny!.sucty).toBeDefined();
		expect(r.ceny!.snapshot).toBeDefined();
		// riadky = presne kódy z job.polozky (profily z plánu + kovanie) — presne to,
		// čo by odišlo do Money, bez snapshotu sú všetky ceny "neznáme"
		const planKody = r.plan!.odpis.filter((o) => o.metre > 0).map((o) => o.kod);
		const kovanieKody = (r.kovanie ?? []).map((k) => k.kod);
		const ocakavane = [...planKody, ...kovanieKody].sort();
		const cenyKody = r.ceny!.radky.map((c) => c.kod).sort();
		expect(cenyKody).toEqual(ocakavane);
	});

	it('interný, žiadny snapshot naimportovaný: všetky ceny "neznáme" (null), súčty neúplné', async () => {
		const r = (await actions.nahlad(nahladEvent(BASE, INTERNAL_USER))) as {
			ceny?: {
				radky: { nakupCennik: number | null }[];
				sucty: { nakupCennik: { kompletne: boolean } };
			};
		};
		expect(r.ceny!.radky.every((c) => c.nakupCennik === null)).toBe(true);
		expect(r.ceny!.sucty.nakupCennik.kompletne).toBe(false);
	});
});

describe('nahladMulti — cenový blok (#154)', () => {
	const POSUV_OK = {
		system: 'Robust',
		styl: '2K',
		s: 2600,
		v: 2000,
		sklo: BASE.sklo,
		otvaranie: 'P - L'
	};

	it('b2b: form.ceny je undefined', async () => {
		const r = await actions.nahladMulti(nahladMultiEvent([POSUV_OK], B2B_USER));
		expect(r).toMatchObject({ step: 'nahladMulti' });
		expect((r as { ceny?: unknown }).ceny).toBeUndefined();
	});

	it('interný: form.ceny je definované', async () => {
		const r = (await actions.nahladMulti(nahladMultiEvent([POSUV_OK], INTERNAL_USER))) as {
			step: string;
			ceny?: { radky: unknown[] };
		};
		expect(r.step).toBe('nahladMulti');
		expect(r.ceny).toBeDefined();
	});
});
