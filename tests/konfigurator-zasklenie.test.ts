// #387 — verejný konfigurátor zasklenia terás a balkónov: client-safe zákaznícky modul
// (umiestnenie/modely/výplne/rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (zasklenie
// NEDOSTANE cenu — ani opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	ZASKLENIE_MODELY,
	ZASKLENIE_UMIESTNENIA,
	ZASKLENIE_VYPLNE,
	ZASKLENIE_RANGES,
	zaskleniModelyPre,
	zaskleniModelDefault,
	zaskleniUmiestnenie,
	zaskleniModel,
	zaskleniVypln,
	zaskleniSystem,
	zaskleniVstupPlatny,
	konfigurujZasklenie,
	zaskleniePonukaConfig,
	type ZaskleniVstup
} from '../src/lib/konfigurator-zasklenie';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP: ZaskleniVstup = {
	umiestnenie: 'Terasa',
	model: 'SLIDE',
	sirka: 5000,
	vyska: 2500,
	kridla: 5,
	vypln: 'Číre kalené sklo',
	farba: 'RAL 7016 ANTRACIT'
};

describe('#387 katalóg umiestnenia / modely / výplne', () => {
	it('umiestnenia = Terasa + Balkón; terasa má 4 modely, balkón 2 (reálna ponuka montalu.sk)', () => {
		expect(ZASKLENIE_UMIESTNENIA).toEqual(['Terasa', 'Balkón']);
		expect(zaskleniModelyPre('Terasa').map((m) => m.kod)).toEqual([
			'ROBUST',
			'SLIDE',
			'STANDARD PLUS',
			'DELUX'
		]);
		expect(zaskleniModelyPre('Balkón').map((m) => m.kod)).toEqual(['STANDARD', 'LUX']);
	});

	it('každý model nesie umiestnenie + systém (rámový/bezrámový) label + popis', () => {
		for (const m of ZASKLENIE_MODELY) {
			expect(['Terasa', 'Balkón']).toContain(m.umiestnenie);
			expect(m.system.length).toBeGreaterThan(0);
			expect(m.popis.length).toBeGreaterThan(0);
		}
		// LUX je bezrámový (reálna montalu ponuka), STANDARD PLUS rámový posuvný
		expect(zaskleniSystem('LUX', 'Balkón')).toMatch(/bezrámov/i);
		expect(zaskleniSystem('STANDARD PLUS', 'Terasa')).toMatch(/rámov/i);
	});

	it('výplne = 3 zákaznícke kategórie skla (prvá Číre kalené sklo)', () => {
		expect(ZASKLENIE_VYPLNE.length).toBe(3);
		expect(ZASKLENIE_VYPLNE[0]!.nazov).toBe('Číre kalené sklo');
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['sirka', 'vyska', 'kridla'] as const) {
			const rng = ZASKLENIE_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});

	it('zaskleniModelDefault vráti prvý model umiestnenia', () => {
		expect(zaskleniModelDefault('Terasa')).toBe('ROBUST');
		expect(zaskleniModelDefault('Balkón')).toBe('STANDARD');
	});
});

describe('#387 whitelist parsery (neznámy → bezpečný default)', () => {
	it('zaskleniUmiestnenie: platný → zachovaný; neznámy/prázdny → Terasa', () => {
		expect(zaskleniUmiestnenie('Balkón')).toBe('Balkón');
		expect(zaskleniUmiestnenie('HACK')).toBe('Terasa');
		expect(zaskleniUmiestnenie('')).toBe('Terasa');
		expect(zaskleniUmiestnenie(null)).toBe('Terasa');
	});
	it('zaskleniModel: platný pre umiestnenie → zachovaný; z iného umiestnenia / neznámy → default umiestnenia', () => {
		expect(zaskleniModel('DELUX', 'Terasa')).toBe('DELUX');
		expect(zaskleniModel('LUX', 'Balkón')).toBe('LUX');
		// LUX je balkónový → pre Terasu nevalidný → default Terasy (ROBUST)
		expect(zaskleniModel('LUX', 'Terasa')).toBe('ROBUST');
		// STANDARD PLUS je terasový → pre Balkón nevalidný → default Balkóna (STANDARD)
		expect(zaskleniModel('STANDARD PLUS', 'Balkón')).toBe('STANDARD');
		expect(zaskleniModel('injekcia<script>', 'Terasa')).toBe('ROBUST');
	});
	it('zaskleniVypln: platný → zachovaný; inak Číre kalené sklo', () => {
		expect(zaskleniVypln('Matné (satináto) sklo')).toBe('Matné (satináto) sklo');
		expect(zaskleniVypln('xxx')).toBe('Číre kalené sklo');
	});
});

describe('#387 zaskleniVstupPlatny', () => {
	it('platný vstup → true', () => {
		expect(zaskleniVstupPlatny(VSTUP)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(zaskleniVstupPlatny({ ...VSTUP, sirka: 999 })).toBe(false);
		expect(zaskleniVstupPlatny({ ...VSTUP, sirka: 999999 })).toBe(false);
		expect(zaskleniVstupPlatny({ ...VSTUP, vyska: 100 })).toBe(false);
	});
	it('neceločíselný / mimo počet krídel → false', () => {
		expect(zaskleniVstupPlatny({ ...VSTUP, kridla: 4.5 })).toBe(false);
		expect(zaskleniVstupPlatny({ ...VSTUP, kridla: 1 })).toBe(false);
		expect(zaskleniVstupPlatny({ ...VSTUP, kridla: 99 })).toBe(false);
	});
});

describe('#387 konfigurujZasklenie (súhrn) + zaskleniePonukaConfig (mapovanie na dopyt)', () => {
	it('plocha = šírka × výška [m²] zaokrúhlená na 1 desatinu', () => {
		const s = konfigurujZasklenie(VSTUP);
		// 5000 × 2500 mm = 12,5 m²
		expect(s.plochaM2).toBe(12.5);
		const s2 = konfigurujZasklenie({ ...VSTUP, sirka: 4000, vyska: 3000 }); // 12,0 m²
		expect(s2.plochaM2).toBe(12);
	});

	it('súhrn nesie systém (rámový/bezrámový) label zvoleného modelu', () => {
		expect(konfigurujZasklenie(VSTUP).system).toMatch(/rámov/i);
		expect(konfigurujZasklenie({ ...VSTUP, umiestnenie: 'Balkón', model: 'LUX' }).system).toMatch(
			/bezrámov/i
		);
	});

	it('PonukaConfig: model+umiestnenie v `system`, šírka → „Šírka", výška+krídla+plocha v popise', () => {
		const cfg = zaskleniePonukaConfig(konfigurujZasklenie(VSTUP));
		expect(cfg.system).toContain('Zasklenie terasy — SLIDE');
		expect(cfg.sirka).toBe(5000); // šírka → neutrálne `sirka` pole → riadok „Šírka"
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.sklo).toBe('Číre kalené sklo');
		expect(cfg.popis).toContain('Výška 2500 mm');
		expect(cfg.popis).toContain('počet krídel 5');
		expect(cfg.popis).toContain('12,5 m²');
	});

	it('balkón LUX → „Zasklenie balkóna — LUX" v system', () => {
		const cfg = zaskleniePonukaConfig(
			konfigurujZasklenie({ ...VSTUP, umiestnenie: 'Balkón', model: 'LUX' })
		);
		expect(cfg.system).toContain('Zasklenie balkóna — LUX');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `dlzka`/`hlbka` ani pergola-špecifické polia', () => {
		const cfg = zaskleniePonukaConfig(konfigurujZasklenie(VSTUP));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// zasklenie mapuje LEN šírku do `sirka` (žiadna dlzka/hlbka → PDF ukáže „Šírka", nie „Rozmery")
		expect(cfg).not.toHaveProperty('dlzka');
		expect(cfg).not.toHaveProperty('hlbka');
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('pocetPoli');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — zasklenie NIKDY nedostane cenu (ani opečiatkovanú, ani prepočítanú),
// aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#387 honest-null cena — zasklenie bez ceny, pergola s cenou', () => {
	const CFG_ROZMERY = { system: 'Zasklenie terasy — SLIDE', sirka: 5000 };

	it('opeciatkujCenuPreProdukt(zasklenie) → cena null + verzia null (žiadna pergolová cena)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'zasklenie');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=zasklenie) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, {
			produkt: 'zasklenie',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je zasklenie (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('zasklenia');
	});
});

// DB round-trip: uložený zasklenie dopyt nesie NULOVÚ cenu a jeho re-download (regeneratePonukaPdf)
// reprodukuje PDF BEZ ceny — honest-null prežije celý tok submit → uloženie → re-download.
describe('#387 honest-null DB round-trip — zasklenie dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert zasklenie dopyt (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = zaskleniePonukaConfig(konfigurujZasklenie(VSTUP));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'zasklenie');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'zasklenie'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('zasklenie');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('zasklenia');
	});
});
