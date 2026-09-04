// #448 — predodpisové SKLADOVÉ VAROVANIE (honest signál, NIE tvrdý blok). `skladoveVarovania`
// (ceny vrstva) vráti pre položky odpisu varovanie za KAŽDÝ kód, ktorého denný Money snapshot hlási
// `sklad != null && sklad < požadované`. Presná rovnosť / `sklad === null` / kód mimo snapshotu /
// nulové množstvo → žiadne varovanie (appka sklad NEVLASTNÍ, záporný sklad je v Money legitímny,
// snapshot je 1×denne stale → tvrdý blok by dával falošné poplachy). Množstvo sa AGREGUJE za kód
// (Money kontroluje sklad na CELKOVÝ dopyt kódu v doklade).
//
// VŠETKY ceny/skladové čísla sú VYMYSLENÉ (repo je verejné — CLAUDE.md). Vlastný snapshot súbor →
// top-level env + dynamický import (vzor `ceny.test.ts`); DATABASE_PATH tiež vlastné (izolácia snapshotu).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklad-var-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { skladoveVarovania, maybeImportSnapshot } = await import('../src/lib/server/ceny');
const { db } = await import('../src/lib/server/db');

// istota inej mtime medzi dvoma zápismi (mtime má rozlíšenie ~1-10ms) — lazy import je mtime-gated
const tick = () => new Promise((r) => setTimeout(r, 15));

async function seed(rows: { kod: string; sklad: number | null }[]) {
	await tick();
	fs.writeFileSync(
		snapshotPath,
		JSON.stringify({
			generatedAt: '2026-09-04T00:00:00Z',
			rows: rows.map((r) => ({ kod: r.kod, nakupCennik: 1, mena: 'EUR', sklad: r.sklad }))
		})
	);
	maybeImportSnapshot();
}

beforeEach(() => {
	db.prepare('DELETE FROM material_prices').run();
	db.prepare('DELETE FROM material_prices_meta').run();
});

describe('#448 skladoveVarovania — predodpisové skladové varovanie', () => {
	it('sklad < požadované → varovanie {kod, sklad, mnozstvo}', async () => {
		await seed([{ kod: 'ZASP20244', sklad: 6.82 }]);
		expect(skladoveVarovania([{ kod: 'ZASP20244', mnozstvo: 15 }])).toEqual([
			{ kod: 'ZASP20244', sklad: 6.82, mnozstvo: 15 }
		]);
	});

	it('sklad == požadované → žiadne varovanie (presná rovnosť)', async () => {
		await seed([{ kod: 'ZASP1', sklad: 10 }]);
		expect(skladoveVarovania([{ kod: 'ZASP1', mnozstvo: 10 }])).toEqual([]);
	});

	it('sklad > požadované → žiadne varovanie', async () => {
		await seed([{ kod: 'ZASP1', sklad: 100 }]);
		expect(skladoveVarovania([{ kod: 'ZASP1', mnozstvo: 15 }])).toEqual([]);
	});

	it('sklad === null (Money nemá skladovú kartu) → žiadne varovanie', async () => {
		await seed([{ kod: 'ZASP1', sklad: null }]);
		expect(skladoveVarovania([{ kod: 'ZASP1', mnozstvo: 5 }])).toEqual([]);
	});

	it('kód mimo snapshotu (Money ho nepozná) → žiadne varovanie', async () => {
		await seed([{ kod: 'ZASP1', sklad: 1 }]);
		expect(skladoveVarovania([{ kod: 'NEZNAMY', mnozstvo: 5 }])).toEqual([]);
	});

	it('nulové množstvo → žiadne varovanie aj pri zápornom sklade', async () => {
		await seed([{ kod: 'ZASP1', sklad: -5 }]);
		expect(skladoveVarovania([{ kod: 'ZASP1', mnozstvo: 0 }])).toEqual([]);
	});

	it('viac kódov: len tie s sklad < mnozstvo (zvyšok vynechá)', async () => {
		await seed([
			{ kod: 'A', sklad: 2 },
			{ kod: 'B', sklad: 50 },
			{ kod: 'C', sklad: 0 }
		]);
		expect(
			skladoveVarovania([
				{ kod: 'A', mnozstvo: 5 },
				{ kod: 'B', mnozstvo: 5 },
				{ kod: 'C', mnozstvo: 1 }
			])
		).toEqual([
			{ kod: 'A', sklad: 2, mnozstvo: 5 },
			{ kod: 'C', sklad: 0, mnozstvo: 1 }
		]);
	});

	it('rovnaký kód viackrát → množstvo sa agreguje (celkový dopyt kódu)', async () => {
		await seed([{ kod: 'A', sklad: 7 }]);
		expect(
			skladoveVarovania([
				{ kod: 'A', mnozstvo: 4 },
				{ kod: 'A', mnozstvo: 5 }
			])
		).toEqual([{ kod: 'A', sklad: 7, mnozstvo: 9 }]);
	});
});
