// #386 — verejný konfigurátor zimných záhrad: client-safe zákaznícky modul (modely/zasklenia/
// rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (zimná záhrada NEDOSTANE cenu — ani
// opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	ZZ_MODELY,
	ZZ_MODEL_DEFAULT,
	ZZ_ZASKLENIA,
	ZZ_RANGES,
	zzModel,
	zzZasklenie,
	zzVstupPlatny,
	konfigurujZimnaZahradu,
	zimnaZahradaPonukaConfig,
	type ZzVstup
} from '../src/lib/konfigurator-zimna-zahrada';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP: ZzVstup = {
	model: 'ROBUST',
	sirka: 5000,
	hlbka: 4000,
	vyska: 2800,
	zasklenie: 'Izolačné trojsklo',
	farba: 'RAL 7016 ANTRACIT'
};

describe('#386 katalóg modelov / zasklenie', () => {
	it('2 modely v poradí ROBUST → MASSIVE; default ROBUST', () => {
		expect(ZZ_MODELY.map((m) => m.kod)).toEqual(['ROBUST', 'MASSIVE']);
		expect(ZZ_MODEL_DEFAULT).toBe('ROBUST');
	});

	it('zasklenie = 4 zákaznícke kategórie (montalu.sk terminológia)', () => {
		expect(ZZ_ZASKLENIA.length).toBe(4);
		expect(ZZ_ZASKLENIA.map((z) => z.nazov)).toEqual([
			'Izolačné dvojsklo',
			'Izolačné trojsklo',
			'Bezpečnostné sklo',
			'Polykarbonát'
		]);
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['sirka', 'hlbka', 'vyska'] as const) {
			const rng = ZZ_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});
});

describe('#386 whitelist parsery (neznámy → bezpečný default)', () => {
	it('zzModel: platný → zachovaný; neznámy/prázdny → ROBUST', () => {
		expect(zzModel('MASSIVE')).toBe('MASSIVE');
		expect(zzModel('ROBUST')).toBe('ROBUST');
		expect(zzModel('HACK')).toBe('ROBUST');
		expect(zzModel('')).toBe('ROBUST');
		expect(zzModel(null)).toBe('ROBUST');
	});
	it('zzZasklenie: platný → zachovaný; inak Izolačné dvojsklo', () => {
		expect(zzZasklenie('Izolačné trojsklo')).toBe('Izolačné trojsklo');
		expect(zzZasklenie('Bezpečnostné sklo')).toBe('Bezpečnostné sklo');
		expect(zzZasklenie('injekcia<script>')).toBe('Izolačné dvojsklo');
	});
});

describe('#386 zzVstupPlatny', () => {
	it('platný vstup → true', () => {
		expect(zzVstupPlatny(VSTUP)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(zzVstupPlatny({ ...VSTUP, sirka: 999 })).toBe(false);
		expect(zzVstupPlatny({ ...VSTUP, hlbka: 999999 })).toBe(false);
		expect(zzVstupPlatny({ ...VSTUP, vyska: 100 })).toBe(false);
	});
});

describe('#386 konfigurujZimnaZahradu (súhrn) + zimnaZahradaPonukaConfig (mapovanie na dopyt)', () => {
	it('plocha = šírka × hĺbka [m²] zaokrúhlená na 1 desatinu', () => {
		const s = konfigurujZimnaZahradu(VSTUP);
		// 5000 × 4000 mm = 20,0 m²
		expect(s.plochaM2).toBe(20);
		const s2 = konfigurujZimnaZahradu({ ...VSTUP, sirka: 4500, hlbka: 3500 }); // 15,75 → 15,8 m²
		expect(s2.plochaM2).toBe(15.8);
	});

	it('PonukaConfig: model v `system`, rozmery (š=sirka, h=hlbka → „Rozmery (š × h)"), výška+plocha v popise, zasklenie v `sklo`', () => {
		const cfg = zimnaZahradaPonukaConfig(konfigurujZimnaZahradu(VSTUP));
		expect(cfg.system).toBe('Zimná záhrada — ROBUST');
		expect(cfg.sirka).toBe(5000); // šírka → `sirka`
		expect(cfg.hlbka).toBe(4000); // hĺbka → `hlbka` → „Rozmery (š × h)" (izbový tvar)
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.sklo).toBe('Izolačné trojsklo');
		expect(cfg.popis).toContain('Výška 2800 mm');
		expect(cfg.popis).toContain('20 m²');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `dlzka`, ani pergola-špecifické polia', () => {
		const cfg = zimnaZahradaPonukaConfig(konfigurujZimnaZahradu(VSTUP));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// zimná záhrada používa `sirka`+`hlbka` (izbový š × h), NIE bazénové neutrálne `dlzka`
		expect(cfg).not.toHaveProperty('dlzka');
		// žiadne pergolové polia (model do `system`, žiadna výška vpredu / pri stene / počet polí)
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('vyskaPriStene');
		expect(cfg).not.toHaveProperty('pocetPoli');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — zimná záhrada NIKDY nedostane cenu (ani opečiatkovanú, ani
// prepočítanú), aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#386 honest-null cena — zimná záhrada bez ceny, pergola s cenou', () => {
	const CFG_ROZMERY = { system: 'Zimná záhrada — ROBUST', sirka: 5000, hlbka: 4000 };

	it('opeciatkujCenuPreProdukt(zimna-zahrada) → cena null + verzia null (žiadna pergolová cena)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'zimna-zahrada');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=zimna-zahrada) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, {
			produkt: 'zimna-zahrada',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		// subject aj keywords — case-insensitive (keyword je lowercase „orientačná cena")
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je zimno-záhradový (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('zimnej záhrady');
	});

	it('generatePonukaPdf(produkt=pergola / NULL) → PDF NESIE orientačnú cenu (honest-degrade zachovaný)', async () => {
		const cfgPergola = { system: 'Pergola', model: 'LIGHT' as const, sirka: 4000, hlbka: 3500 };
		const bytes = await generatePonukaPdf(cfgPergola, { produkt: null, datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
	});
});

// DB round-trip: uložený dopyt zimnej záhrady nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a
// jeho re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download (#385 review 🔵 vzor).
describe('#386 honest-null DB round-trip — dopyt zimnej záhrady bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert dopyt zimnej záhrady (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = zimnaZahradaPonukaConfig(konfigurujZimnaZahradu(VSTUP));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'zimna-zahrada');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'zimna-zahrada'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('zimna-zahrada');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('zimnej záhrady');
	});
});
