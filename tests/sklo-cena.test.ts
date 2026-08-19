// sklo-cena.ts — náklad na sklo v nárezáku (#225): plocha × cena/m² zo snapshotu,
// honest-null keď cena/mapovanie chýba, súhrn za viac plánov. VŠETKY ceny TU sú
// VYMYSLENÉ (repo je verejné — nikdy sem reálnu Money cenu, viď CLAUDE.md). TS kódy
// sú katalógové identifikátory (rovnaká trieda ako ZASP/ZASK), nie ceny.
//
// Jedna DB + jeden snapshot pre celý súbor (db.ts je modulový singleton, rovnaký
// vzor ako ceny.test.ts). glass_types.money_kod je seednutý migráciou v23.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-cena-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { skloCenaPre } = await import('../src/lib/server/sklo-cena');
const { glassMoneyKod } = await import('../src/lib/server/db');
const { db } = await import('../src/lib/server/db');

// material_prices je UPSERT (nemaže staré kódy) a db.ts je singleton → bez resetu by
// cena z predošlého testu prežila do ďalšieho (viď rovnaká pasca v ceny.test.ts).
// Čistý štart cien pred KAŽDÝM testom, aby „kód nie je v snapshote" bol naozaj prázdny.
beforeEach(() => {
	db.exec('DELETE FROM material_prices; DELETE FROM material_prices_meta;');
});

function writeSnapshot(rows: unknown[]) {
	fs.writeFileSync(snapshotPath, JSON.stringify({ generatedAt: '2026-08-19T00:00:00Z', rows }));
}
// mtime musí byť čerstvejšia než predošlý import (lazy import gejtuje na mtime)
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('glassMoneyKod (mapovanie variantu skla na Money TS kód, v23 seed)', () => {
	it('jednoznačné izolačné varianty majú namapovaný TS kód', () => {
		expect(glassMoneyKod('Robust', 'Izolačné sklo 4/16/4 číre')).toBe('TS00016');
		expect(glassMoneyKod('Robust', 'Izolačné sklo 4/16/4 mliečne')).toBe('TS00017');
		expect(glassMoneyKod('Slide', 'Izolačné sklo 4/8/4 číre')).toBe('TS00021');
		expect(glassMoneyKod('Slide', 'Izolačné sklo 4/8/4 mliečne')).toBe('TS00022');
	});
	it('nejednoznačné / jednoduché sklá NIE sú namapované (null → honest-null)', () => {
		expect(glassMoneyKod('Štandard +', 'Float sklo 6 mm')).toBeNull();
		expect(glassMoneyKod('Štandard +', 'Izolačné sklo 4.8.4')).toBeNull();
		expect(glassMoneyKod('Slide', '3.3.1')).toBeNull();
		expect(glassMoneyKod('Deluxe', 'Float kalené 6 mm')).toBeNull();
	});
	it('neexistujúci variant → null (nikdy nehádže)', () => {
		expect(glassMoneyKod('Robust', 'nič také')).toBeNull();
	});
});

describe('skloCenaPre — plocha × cena/m², honest-null', () => {
	it('bez snapshotu: cena nedostupná, plocha sa aj tak spočíta, súhrn neúplný', () => {
		fs.rmSync(snapshotPath, { force: true });
		const r = skloCenaPre([
			{
				label: '',
				system: 'Robust',
				variant: 'Izolačné sklo 4/16/4 číre',
				sirka: 1000,
				vyska: 2000,
				pocet: 2
			}
		]);
		expect(r.radky).toHaveLength(1);
		expect(r.radky[0].m2).toBe(4); // 1000×2000×2 / 1e6
		expect(r.radky[0].eurM2).toBeNull();
		expect(r.radky[0].spolu).toBeNull();
		expect(r.kompletne).toBe(false);
		expect(r.spolu).toBe(0);
		expect(r.snapshot.generatedAt).toBeNull();
	});

	it('so snapshotom: namapovaný variant s cenou → plocha × cena/m²', async () => {
		await tick();
		// TS00016 = Money kód pre „Izolačné sklo 4/16/4 číre" (v23 seed); cena VYMYSLENÁ
		writeSnapshot([
			{
				kod: 'TS00016',
				nakupCennik: 40,
				nakupPoslednaFaktura: 42,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = skloCenaPre([
			{
				label: '',
				system: 'Robust',
				variant: 'Izolačné sklo 4/16/4 číre',
				sirka: 1000,
				vyska: 2000,
				pocet: 2
			}
		]);
		expect(r.radky[0].m2).toBe(4);
		expect(r.radky[0].eurM2).toBe(40);
		expect(r.radky[0].spolu).toBe(160); // 4 m² × 40 €/m²
		expect(r.radky[0].mena).toBe('EUR');
		expect(r.kompletne).toBe(true);
		expect(r.spolu).toBe(160);
	});

	it('namapovaný variant, ale kód NIE JE v snapshote → cena nedostupná (honest-null)', async () => {
		await tick();
		// snapshot má len TS00021, nie TS00016 → 4/16/4 číre ostáva bez ceny
		writeSnapshot([
			{
				kod: 'TS00021',
				nakupCennik: 33,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = skloCenaPre([
			{
				label: '',
				system: 'Robust',
				variant: 'Izolačné sklo 4/16/4 číre',
				sirka: 1000,
				vyska: 1000,
				pocet: 1
			}
		]);
		expect(r.radky[0].eurM2).toBeNull();
		expect(r.radky[0].spolu).toBeNull();
		expect(r.kompletne).toBe(false);
	});

	it('nenamapovaný variant → cena nedostupná aj keď snapshot má iné ceny', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00016',
				nakupCennik: 40,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = skloCenaPre([
			{
				label: '',
				system: 'Štandard +',
				variant: 'Float sklo 6 mm',
				sirka: 1000,
				vyska: 1000,
				pocet: 1
			}
		]);
		expect(r.radky[0].eurM2).toBeNull();
		expect(r.radky[0].spolu).toBeNull();
		expect(r.kompletne).toBe(false);
	});

	it('viac plánov: súhrn sčíta len dostupné ceny a prizná neúplnosť', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00016',
				nakupCennik: 50,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
			// TS00021 zámerne CHÝBA → druhý posuv bez ceny
		]);
		const r = skloCenaPre([
			{
				label: 'Posuv 1',
				system: 'Robust',
				variant: 'Izolačné sklo 4/16/4 číre',
				sirka: 1000,
				vyska: 1000,
				pocet: 2
			},
			{
				label: 'Posuv 2',
				system: 'Slide',
				variant: 'Izolačné sklo 4/8/4 číre',
				sirka: 1000,
				vyska: 1000,
				pocet: 1
			}
		]);
		expect(r.radky).toHaveLength(2);
		expect(r.radky[0].spolu).toBe(100); // 2 m² × 50
		expect(r.radky[1].spolu).toBeNull(); // TS00021 nie je v snapshote
		expect(r.spolu).toBe(100); // len dostupný posuv
		expect(r.kompletne).toBe(false);
	});

	it('cena 0 v Money sa berie ako neznáma (honest-null), nie 0 €', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00016',
				nakupCennik: 0,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = skloCenaPre([
			{
				label: '',
				system: 'Robust',
				variant: 'Izolačné sklo 4/16/4 číre',
				sirka: 1000,
				vyska: 1000,
				pocet: 1
			}
		]);
		expect(r.radky[0].eurM2).toBeNull(); // 0 → null v ceny.ts
		expect(r.radky[0].spolu).toBeNull();
		expect(r.kompletne).toBe(false);
	});
});
