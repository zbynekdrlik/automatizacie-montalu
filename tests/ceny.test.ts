// ceny.ts — import snapshotu (lazy, validácia, idempotencia) + enrichPolozky
// (JOIN na položky + súčty). VŠETKY ceny v tomto súbore sú VYMYSLENÉ (repo je
// verejné — nikdy sem nepíš reálnu Money cenu, viď CLAUDE.md).
//
// Jedna DB + jeden snapshot súbor pre celý súbor (db.ts je modulový singleton —
// rovnaký vzor ako money.test.ts/zasklenia-b2b-preview.test.ts): testy pribúdajú
// SEKVENČNE, každý používa VLASTNÉ `kod` hodnoty, aby sa navzájom nekolidovali.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-ceny-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { maybeImportSnapshot, getSnapshotMeta, enrichPolozky } =
	await import('../src/lib/server/ceny');
const { db } = await import('../src/lib/server/db');

function writeSnapshot(generatedAt: string, rows: unknown[]) {
	fs.writeFileSync(snapshotPath, JSON.stringify({ generatedAt, rows }));
}

// istota inej mtime medzi dvoma zápismi na rýchlom FS (mtime má rozlíšenie ~1-10ms)
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('maybeImportSnapshot + getSnapshotMeta', () => {
	it('chýbajúci súbor: no-op, žiadna chyba, meta prázdna (nikdy neimportované)', () => {
		expect(fs.existsSync(snapshotPath)).toBe(false);
		expect(maybeImportSnapshot()).toEqual({ imported: false, reason: 'no-file' });
		expect(getSnapshotMeta()).toEqual({
			generatedAt: null,
			importedAt: null,
			daysOld: null,
			rowCount: 0,
			rejectedCount: 0
		});
	});

	it('platný snapshot sa naimportuje, riadky sa upsertnú do material_prices', () => {
		writeSnapshot('2026-08-10T00:00:00Z', [
			{
				kod: 'ZASP-TEST-1',
				nakupCennik: 5.5,
				nakupPoslednaFaktura: 6.9,
				predajVo: 8.1,
				mena: 'EUR',
				sklad: 100
			}
		]);
		expect(maybeImportSnapshot()).toEqual({
			imported: true,
			reason: 'ok',
			rowCount: 1,
			rejectedCount: 0,
			generatedAt: '2026-08-10T00:00:00Z'
		});
		const row = db.prepare("SELECT * FROM material_prices WHERE kod = 'ZASP-TEST-1'").get();
		expect(row).toMatchObject({
			kod: 'ZASP-TEST-1',
			nakup_cennik: 5.5,
			nakup_posledna_faktura: 6.9,
			predaj_vo: 8.1,
			mena: 'EUR',
			sklad: 100
		});
	});

	it('opätovné volanie BEZ zmeny mtime súboru je no-op ("not-newer")', () => {
		expect(maybeImportSnapshot()).toEqual({ imported: false, reason: 'not-newer' });
	});

	it('zmena obsahu + mtime → nový import PREPÍŠE starú hodnotu (upsert, nie duplicitný riadok)', async () => {
		await tick();
		writeSnapshot('2026-08-11T00:00:00Z', [
			{
				kod: 'ZASP-TEST-1',
				nakupCennik: 5.9,
				nakupPoslednaFaktura: 7.0,
				predajVo: 8.3,
				mena: 'EUR',
				sklad: 90
			}
		]);
		const r = maybeImportSnapshot();
		expect(r.imported).toBe(true);
		const count = (
			db.prepare("SELECT COUNT(*) c FROM material_prices WHERE kod = 'ZASP-TEST-1'").get() as {
				c: number;
			}
		).c;
		expect(count).toBe(1); // upsert, nie druhý riadok
		expect(
			db.prepare("SELECT nakup_cennik FROM material_prices WHERE kod = 'ZASP-TEST-1'").get()
		).toEqual({ nakup_cennik: 5.9 });
	});

	it('cena 0 v snapshote sa uloží ako NULL ("cena neznáma", nikdy nula) — sklad 0 ostáva 0', async () => {
		await tick();
		writeSnapshot('2026-08-12T00:00:00Z', [
			{
				kod: 'ZASP-NULA',
				nakupCennik: 0,
				nakupPoslednaFaktura: 0,
				predajVo: 0,
				mena: 'EUR',
				sklad: 0
			}
		]);
		maybeImportSnapshot();
		const row = db.prepare("SELECT * FROM material_prices WHERE kod = 'ZASP-NULA'").get();
		expect(row).toMatchObject({
			nakup_cennik: null,
			nakup_posledna_faktura: null,
			predaj_vo: null,
			sklad: 0 // sklad 0 je PLATNÁ hodnota (skutočne vypredané), nikdy null
		});
	});

	it('ZASK* kód: predajVo sa VŽDY vynuluje na NULL, aj keby snapshot poslal číslo (defense in depth)', async () => {
		await tick();
		writeSnapshot('2026-08-13T00:00:00Z', [
			{ kod: 'ZASK-KOVANIE', nakupCennik: 1.2, predajVo: 99, mena: 'EUR', sklad: 5 }
		]);
		maybeImportSnapshot();
		const row = db.prepare("SELECT * FROM material_prices WHERE kod = 'ZASK-KOVANIE'").get();
		expect(row).toMatchObject({ nakup_cennik: 1.2, predaj_vo: null, sklad: 5 });
	});

	it('zlý riadok (chýbajúci kod) sa zamietne, OSTATNÉ riadky sa naimportujú', async () => {
		await tick();
		writeSnapshot('2026-08-14T00:00:00Z', [
			{ kod: '', nakupCennik: 5, sklad: 1 },
			{ kod: 'ZASP-OK', nakupCennik: 5, sklad: 1, mena: 'EUR' }
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ imported: true, rowCount: 1, rejectedCount: 1 });
		expect(db.prepare("SELECT 1 FROM material_prices WHERE kod = 'ZASP-OK'").get()).toBeTruthy();
	});

	it('riadok, ktorý NIE JE objekt (napr. holý string v poli "rows"), sa zamietne bez pádu', async () => {
		await tick();
		writeSnapshot('2026-08-14T12:00:00Z', [
			'toto nie je objekt',
			{ kod: 'ZASP-OK-2', nakupCennik: 5, sklad: 1 }
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ imported: true, rowCount: 1, rejectedCount: 1 });
		expect(db.prepare("SELECT 1 FROM material_prices WHERE kod = 'ZASP-OK-2'").get()).toBeTruthy();
	});

	it('ZÁPORNÝ sklad je PLATNÁ hodnota (Money to vie vrátiť — rezervované > fyzicky na sklade, overené live), nikdy sa nezamieta', async () => {
		await tick();
		writeSnapshot('2026-08-15T12:00:00Z', [
			{ kod: 'ZASK-ZAPORNY-SKLAD', nakupCennik: 2, sklad: -3.5, mena: 'EUR' }
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ imported: true, rowCount: 1, rejectedCount: 0 });
		const row = db.prepare("SELECT * FROM material_prices WHERE kod = 'ZASK-ZAPORNY-SKLAD'").get();
		expect(row).toMatchObject({ sklad: -3.5 });
	});

	it('zlý riadok (neplatný sklad) sa CELÝ zamietne', async () => {
		await tick();
		writeSnapshot('2026-08-15T00:00:00Z', [
			{ kod: 'ZASP-BAD-SKLAD', nakupCennik: 5, sklad: 'veľa' },
			{ kod: 'ZASP-DOBRY', nakupCennik: 5, sklad: 1 }
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ rowCount: 1, rejectedCount: 1 });
		expect(
			db.prepare("SELECT 1 FROM material_prices WHERE kod = 'ZASP-BAD-SKLAD'").get()
		).toBeFalsy();
	});

	it('sklad `null` (Money pre kód nemá skladovú kartu) sa PRIJME — neznáma dostupnosť, nie zamietnutý riadok, nie 0 (#154 review nález)', async () => {
		await tick();
		writeSnapshot('2026-08-15T06:00:00Z', [
			{ kod: 'ZASP-SKLAD-NULL', nakupCennik: 5, sklad: null, mena: 'EUR' },
			{ kod: 'ZASP-SKLAD-CHYBA', nakupCennik: 5, mena: 'EUR' } // sklad úplne chýba = to isté ako null
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ imported: true, rowCount: 2, rejectedCount: 0 });
		expect(
			db.prepare("SELECT sklad FROM material_prices WHERE kod = 'ZASP-SKLAD-NULL'").get()
		).toEqual({ sklad: null });
		expect(
			db.prepare("SELECT sklad FROM material_prices WHERE kod = 'ZASP-SKLAD-CHYBA'").get()
		).toEqual({ sklad: null });
		// a odlišuje sa od SKUTOČNEJ nuly (vypredané) — nezlievajú sa do jednej hodnoty
		const r2 = enrichPolozky([
			{ kod: 'ZASP-SKLAD-NULL', nazov: 'X', qty: 1, mj: 'm' },
			{ kod: 'ZASP-NULA', nazov: 'Y', qty: 1, mj: 'm' } // z predošlého testu vyššie, sklad=0 reálne
		]);
		expect(r2.radky[0].sklad).toBeNull();
		expect(r2.radky[1].sklad).toBe(0);
	});

	it('neplatná JEDNOTLIVÁ cena (string namiesto čísla) nezhodí celý riadok — len tá cena je neznáma', async () => {
		await tick();
		writeSnapshot('2026-08-16T00:00:00Z', [
			{ kod: 'ZASP-BAD-CENA', nakupCennik: 'draho', nakupPoslednaFaktura: 6, sklad: 3 }
		]);
		const r = maybeImportSnapshot();
		expect(r).toMatchObject({ imported: true, rowCount: 1, rejectedCount: 0 });
		const row = db.prepare("SELECT * FROM material_prices WHERE kod = 'ZASP-BAD-CENA'").get();
		expect(row).toMatchObject({ nakup_cennik: null, nakup_posledna_faktura: 6, sklad: 3 });
	});

	it('poškodený JSON súbor: no-op ("parse-error"), appka nespadne, staré dáta ostávajú', async () => {
		await tick();
		fs.writeFileSync(snapshotPath, '{ toto nie je json');
		expect(maybeImportSnapshot()).toEqual({ imported: false, reason: 'parse-error' });
		// staré dáta (napr. ZASP-OK z predošlého importu) ostali nedotknuté
		expect(db.prepare("SELECT 1 FROM material_prices WHERE kod = 'ZASP-OK'").get()).toBeTruthy();
	});

	it('getSnapshotMeta: po sérii importov vráti dátum + N dní staré (nikdy záporné)', async () => {
		await tick();
		const dvaDniSpat = new Date(Date.now() - 2 * 86400000 - 3600000).toISOString();
		writeSnapshot(dvaDniSpat, []);
		const meta = getSnapshotMeta();
		expect(meta.generatedAt).toBe(dvaDniSpat);
		expect(meta.daysOld).toBe(2);
		expect(meta.rowCount).toBe(0);
	});
});

describe('enrichPolozky', () => {
	it('položka BEZ cenových dát v material_prices → "cena neznáma" (null) všade, vylúčená zo súčtu', () => {
		const r = enrichPolozky([{ kod: 'NEZNAMY-KOD-ENRICH', nazov: 'Test', qty: 10, mj: 'm' }]);
		expect(r.radky).toEqual([
			{
				kod: 'NEZNAMY-KOD-ENRICH',
				nazov: 'Test',
				qty: 10,
				mj: 'm',
				nakupCennik: null,
				nakupPoslednaFaktura: null,
				predajVo: null,
				marza: null,
				sklad: null,
				mena: 'EUR'
			}
		]);
		expect(r.sucty.nakupCennik).toEqual({ suma: 0, kompletne: false });
		expect(r.sucty.marza).toEqual({ suma: 0, kompletne: false });
	});

	it('m/ks: cena × množstvo funguje rovnako pre metrážovú aj kusovú položku (Money cena je vždy per-MJ)', async () => {
		await tick();
		writeSnapshot('2026-08-17T00:00:00Z', [
			{ kod: 'ZASP-ENRICH-M', nakupCennik: 2, mena: 'EUR', sklad: 50 },
			{ kod: 'ZASK-ENRICH-KS', nakupCennik: 3, mena: 'EUR', sklad: 20 }
		]);
		maybeImportSnapshot();
		const r = enrichPolozky([
			{ kod: 'ZASP-ENRICH-M', nazov: 'Profil', qty: 7.5, mj: 'm' },
			{ kod: 'ZASK-ENRICH-KS', nazov: 'Kladka', qty: 4, mj: 'ks' }
		]);
		// 2 €/m × 7.5 m = 15; 3 €/ks × 4 ks = 12 → spolu 27
		expect(r.sucty.nakupCennik).toEqual({ suma: 27, kompletne: true });
	});

	it('marža sa počíta z CENNÍKOVEJ nákupnej ceny (nie z poslednej faktúry)', async () => {
		await tick();
		writeSnapshot('2026-08-18T00:00:00Z', [
			{
				kod: 'ZASP-ENRICH-MARZA',
				nakupCennik: 5,
				nakupPoslednaFaktura: 9, // úmyselne iná, aby test odhalil zámenu
				predajVo: 8,
				mena: 'EUR',
				sklad: 10
			}
		]);
		maybeImportSnapshot();
		const r = enrichPolozky([{ kod: 'ZASP-ENRICH-MARZA', nazov: 'X', qty: 2, mj: 'm' }]);
		expect(r.radky[0].marza).toBe(3); // 8 − 5, NIE 8 − 9
		expect(r.sucty.marza).toEqual({ suma: 6, kompletne: true }); // 3 × 2 ks
	});

	it('sucty.kompletne=false len keď chýbajúca cena patrí položke s NENULOVÝM množstvom (bazén posiela aj nulové riadky)', () => {
		const r = enrichPolozky([{ kod: 'NEZNAMY-KOD-QTY0', nazov: 'X', qty: 0, mj: 'm' }]);
		expect(r.sucty.nakupCennik.kompletne).toBe(true);
		expect(r.sucty.nakupCennik.suma).toBe(0);
	});

	it('vracia aktuálny snapshot meta spolu s výsledkom (appka to zobrazí vedľa tabuľky)', () => {
		const r = enrichPolozky([{ kod: 'ZASP-ENRICH-M', nazov: 'Profil', qty: 1, mj: 'm' }]);
		expect(r.snapshot.generatedAt).toBe('2026-08-18T00:00:00Z');
		expect(typeof r.snapshot.daysOld).toBe('number');
	});

	it('sklad: reálna hodnota z Money (aj 0/záporná) sa zobrazí, chýbajúci kód dá null ("neznáma")', async () => {
		await tick();
		writeSnapshot('2026-08-19T00:00:00Z', [{ kod: 'ZASP-ENRICH-SKLAD', sklad: 42, mena: 'EUR' }]);
		maybeImportSnapshot();
		const r = enrichPolozky([
			{ kod: 'ZASP-ENRICH-SKLAD', nazov: 'X', qty: 1, mj: 'm' },
			{ kod: 'NEZNAMY-KOD-SKLAD', nazov: 'Y', qty: 1, mj: 'm' }
		]);
		expect(r.radky[0].sklad).toBe(42);
		expect(r.radky[1].sklad).toBeNull();
	});
});
