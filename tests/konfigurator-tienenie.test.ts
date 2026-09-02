// #389 — verejný konfigurátor tienenia (markízy + screenové rolety): client-safe zákaznícky modul
// (typy/ovládanie/rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (tienenie NEDOSTANE cenu —
// ani opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	TIENENIE_MODELY,
	TIENENIE_MODEL_DEFAULT,
	TIENENIE_OVLADANIE,
	TIENENIE_OVLADANIE_DEFAULT,
	TIENENIE_RANGES,
	tienenieModel,
	tienenieOvladanie,
	tienenieModelInfo,
	rozmer2Popis,
	rozmer2Akuzativ,
	tienenieVstupPlatny,
	konfigurujTienenie,
	tieneniePonukaConfig,
	type TienenieVstup
} from '../src/lib/konfigurator-tienenie';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP_MARKIZA: TienenieVstup = {
	model: 'XLINE',
	ovladanie: 'Elektrické',
	sirka: 5000,
	rozmer2: 3500,
	farba: 'RAL 7016 ANTRACIT'
};
const VSTUP_ROLETA: TienenieVstup = {
	model: 'ZIPLINE',
	ovladanie: 'Ručné',
	sirka: 3000,
	rozmer2: 2500,
	farba: 'RAL 9016 BIELA'
};

describe('#389 katalóg typov / ovládanie', () => {
	it('3 reálne modely z montalu.sk v poradí XLINE → XLIGHT → ZIPLINE; default XLINE', () => {
		expect(TIENENIE_MODELY.map((m) => m.kod)).toEqual(['XLINE', 'XLIGHT', 'ZIPLINE']);
		expect(TIENENIE_MODEL_DEFAULT).toBe('XLINE');
	});

	it('XLINE/XLIGHT sú markízy (výsun), ZIPLINE je roleta (výška)', () => {
		expect(tienenieModelInfo('XLINE').druh).toBe('markiza');
		expect(tienenieModelInfo('XLIGHT').druh).toBe('markiza');
		expect(tienenieModelInfo('ZIPLINE').druh).toBe('roleta');
	});

	it('ovládanie = elektrické/ručné; default elektrické', () => {
		expect(TIENENIE_OVLADANIE.map((o) => o.kod)).toEqual(['Elektrické', 'Ručné']);
		expect(TIENENIE_OVLADANIE_DEFAULT).toBe('Elektrické');
	});

	it('rozmedzia majú min < max a krok > 0; šírka do 7500 mm (montalu.sk XLINE max)', () => {
		for (const kluc of ['sirka', 'rozmer2'] as const) {
			const rng = TIENENIE_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
		expect(TIENENIE_RANGES.sirka.max).toBe(7500);
	});
});

describe('#389 label druhého rozmeru podľa druhu', () => {
	it('markíza → Výsun/výsun; roleta → Výška/výšku', () => {
		expect(rozmer2Popis('markiza')).toBe('Výsun');
		expect(rozmer2Akuzativ('markiza')).toBe('výsun');
		expect(rozmer2Popis('roleta')).toBe('Výška');
		expect(rozmer2Akuzativ('roleta')).toBe('výšku');
	});
});

describe('#389 whitelist parsery (neznámy → bezpečný default)', () => {
	it('tienenieModel: platný → zachovaný; neznámy/prázdny → XLINE', () => {
		expect(tienenieModel('XLIGHT')).toBe('XLIGHT');
		expect(tienenieModel('ZIPLINE')).toBe('ZIPLINE');
		expect(tienenieModel('HACK')).toBe('XLINE');
		expect(tienenieModel('')).toBe('XLINE');
		expect(tienenieModel(null)).toBe('XLINE');
	});
	it('tienenieOvladanie: platný → zachovaný; inak Elektrické', () => {
		expect(tienenieOvladanie('Ručné')).toBe('Ručné');
		expect(tienenieOvladanie('<script>')).toBe('Elektrické');
	});
});

describe('#389 tienenieVstupPlatny', () => {
	it('platný vstup → true (markíza aj roleta)', () => {
		expect(tienenieVstupPlatny(VSTUP_MARKIZA)).toBe(true);
		expect(tienenieVstupPlatny(VSTUP_ROLETA)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, sirka: 999 })).toBe(false);
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, sirka: 999999 })).toBe(false);
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, rozmer2: 500 })).toBe(false);
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, rozmer2: 99999 })).toBe(false);
	});
});

describe('#389 konfigurujTienenie (súhrn) + tieneniePonukaConfig (mapovanie na dopyt)', () => {
	it('súhrn nesie druh + názov z whitelistu modelu', () => {
		const s = konfigurujTienenie(VSTUP_MARKIZA);
		expect(s.druh).toBe('markiza');
		expect(s.nazov).toBe('Markíza XLINE');
		const s2 = konfigurujTienenie(VSTUP_ROLETA);
		expect(s2.druh).toBe('roleta');
		expect(s2.nazov).toBe('Screenová roleta ZIPLINE');
	});

	it('PonukaConfig: typ v `system`, šírka v `sirka`, druhý rozmer (výsun/výška) + ovládanie v popise', () => {
		const cfg = tieneniePonukaConfig(konfigurujTienenie(VSTUP_MARKIZA));
		expect(cfg.system).toBe('Tienenie — Markíza XLINE');
		expect(cfg.sirka).toBe(5000);
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.popis).toContain('Výsun 3500 mm');
		expect(cfg.popis).toContain('ovládanie Elektrické');
		expect(cfg.popis).toContain('vzorkovníka');

		// roleta → druhý rozmer je „Výška"
		const cfgR = tieneniePonukaConfig(konfigurujTienenie(VSTUP_ROLETA));
		expect(cfgR.system).toBe('Tienenie — Screenová roleta ZIPLINE');
		expect(cfgR.popis).toContain('Výška 2500 mm');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `hlbka`/`dlzka`/`sklo`, ani pergola-špecifické polia', () => {
		const cfg = tieneniePonukaConfig(konfigurujTienenie(VSTUP_MARKIZA));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// šírka ide do `sirka`; druhý rozmer je len v popise → PDF vykreslí čistú „Šírka" (nie zavádzajúce „š × h")
		expect(cfg).not.toHaveProperty('hlbka');
		expect(cfg).not.toHaveProperty('dlzka');
		expect(cfg).not.toHaveProperty('sklo');
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — tienenie NIKDY nedostane cenu (ani opečiatkovanú, ani prepočítanú),
// aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#389 honest-null cena — tienenie bez ceny, pergola s cenou', () => {
	const CFG_ROZMERY = { system: 'Tienenie — Markíza XLINE', sirka: 5000 };

	it('opeciatkujCenuPreProdukt(tienenie) → cena null + verzia null (žiadna pergolová cena)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'tienenie');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=tienenie) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, {
			produkt: 'tienenie',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je tienenie (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('tienenia');
	});
});

// DB round-trip: uložený tienenie dopyt nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a jeho
// re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download.
describe('#389 honest-null DB round-trip — tienenie dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert tienenie dopyt (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = tieneniePonukaConfig(konfigurujTienenie(VSTUP_MARKIZA));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'tienenie');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'tienenie'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('tienenie');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('tienenia');
	});
});
