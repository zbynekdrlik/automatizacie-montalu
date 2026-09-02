// sklo-strecha-cena.ts — €/m² strešného skla pergoly zo snapshotu (#223). VŠETKY ceny TU
// sú VYMYSLENÉ (repo je verejné — nikdy reálnu Money cenu, viď CLAUDE.md). Mapovanie
// typ→TS kód je katalógové (`SKLO_STRECHA_TYPY`, #274); cena = `cenaZaM2` zo snapshotu.
// Honest-null: typ bez potvrdeného kódu, alebo kód bez ceny v snapshote → €/m² null.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-strecha-cena-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { strechaSkloCenaPre } = await import('../src/lib/server/sklo-strecha-cena');
const { db } = await import('../src/lib/server/db');

beforeEach(() => {
	db.exec('DELETE FROM material_prices; DELETE FROM material_prices_meta;');
});

function writeSnapshot(rows: unknown[]) {
	fs.writeFileSync(snapshotPath, JSON.stringify({ generatedAt: '2026-08-19T00:00:00Z', rows }));
}
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('strechaSkloCenaPre — €/m² zo snapshotu, honest-null', () => {
	it('typ nezvolený (null/prázdny) → null (nič sa nepočíta)', () => {
		expect(strechaSkloCenaPre(null)).toBeNull();
		expect(strechaSkloCenaPre('')).toBeNull();
		expect(strechaSkloCenaPre('   ')).toBeNull();
	});

	it('potvrdený typ s cenou v snapshote → €/m² (VYMYSLENÁ cena)', async () => {
		await tick();
		// TS00014 = „IZO 4.4.2-8-6 číre" (potvrdené #274); cena VYMYSLENÁ
		writeSnapshot([
			{
				kod: 'TS00014',
				nakupCennik: 55,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = strechaSkloCenaPre('IZO 4.4.2-8-6 číre');
		expect(r).not.toBeNull();
		expect(r!.moneyKod).toBe('TS00014');
		expect(r!.eurM2).toBe(55);
		expect(r!.mena).toBe('EUR');
	});

	it('typ bez potvrdeného TS kódu (polykarbonát) → kód aj €/m² null (karta v Money neexistuje)', () => {
		const r = strechaSkloCenaPre('polykarbonát 16 mm číry');
		expect(r).not.toBeNull();
		expect(r!.moneyKod).toBeNull();
		expect(r!.eurM2).toBeNull();
	});

	it('potvrdený kód, ale NIE v snapshote → €/m² null (honest-null)', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00070',
				nakupCennik: 40,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = strechaSkloCenaPre('IZO 4.4.2-8-6 číre'); // TS00014 nie je v snapshote
		expect(r!.moneyKod).toBe('TS00014');
		expect(r!.eurM2).toBeNull();
	});

	it('neznámy typ mimo katalógu → kód aj €/m² null', () => {
		const r = strechaSkloCenaPre('nejaké vymyslené sklo');
		expect(r!.moneyKod).toBeNull();
		expect(r!.eurM2).toBeNull();
	});
});

describe('strechaSkloCenaPre — celková cena skiel (cenaSpolu = plocha × €/m², #223)', () => {
	it('€/m² aj plocha známe → cenaSpolu = plocha × €/m² (VYMYSLENÁ cena)', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00014',
				nakupCennik: 55,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		// golden OP260282: celková plocha 15,64 m² × 55 €/m² = 860,20 €
		const r = strechaSkloCenaPre('IZO 4.4.2-8-6 číre', 15.64);
		expect(r!.eurM2).toBe(55);
		expect(r!.cenaSpolu).toBe(860.2);
	});

	it('plocha zadaná, ale €/m² chýba (kód nie v snapshote) → cenaSpolu null (honest-null)', async () => {
		await tick();
		// snapshot má INÝ kód (TS00070), TS00014 v ňom NIE JE → €/m² null → cenaSpolu null
		writeSnapshot([
			{
				kod: 'TS00070',
				nakupCennik: 40,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = strechaSkloCenaPre('IZO 4.4.2-8-6 číre', 15.64); // TS00014 nie je v snapshote
		expect(r!.eurM2).toBeNull();
		expect(r!.cenaSpolu).toBeNull();
	});

	it('€/m² známe, ale plocha nezadaná (honest-null dĺžka) → cenaSpolu null', async () => {
		await tick();
		writeSnapshot([
			{
				kod: 'TS00014',
				nakupCennik: 55,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = strechaSkloCenaPre('IZO 4.4.2-8-6 číre'); // plocha default null
		expect(r!.eurM2).toBe(55);
		expect(r!.cenaSpolu).toBeNull();
	});

	it('typ bez TS kódu (polykarbonát) + plocha → cenaSpolu null (žiadny hádaný náklad)', () => {
		const r = strechaSkloCenaPre('polykarbonát 16 mm číry', 20);
		expect(r!.moneyKod).toBeNull();
		expect(r!.cenaSpolu).toBeNull();
	});
});
