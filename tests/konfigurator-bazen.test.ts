// #385 — verejný konfigurátor bazénových zastrešení: client-safe zákaznícky modul (modely/koľaj/
// výplne/rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (bazén NEDOSTANE cenu — ani
// opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	BAZEN_MODELY,
	BAZEN_MODEL_DEFAULT,
	BAZEN_KOLAJ,
	BAZEN_VYPLNE,
	BAZEN_RANGES,
	bazenModel,
	bazenKolaj,
	bazenVypln,
	bazenVstupPlatny,
	konfigurujBazen,
	bazenPonukaConfig,
	type BazenVstup
} from '../src/lib/konfigurator-bazen';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP: BazenVstup = {
	model: 'Premier',
	kolaj: 'Dvojkoľajové',
	dlzka: 8000,
	sirka: 4000,
	vyska: 1200,
	segmenty: 4,
	vypln: 'Číry polykarbonát',
	farba: 'RAL 7016 ANTRACIT'
};

describe('#385 katalóg modelov / koľaj / výplne', () => {
	it('3 modely v poradí Premier → Exclusive → Star; default Premier', () => {
		expect(BAZEN_MODELY.map((m) => m.kod)).toEqual(['Premier', 'Exclusive', 'Star']);
		expect(BAZEN_MODEL_DEFAULT).toBe('Premier');
	});

	it('koľaj = jedno/dvoj; výplne = 3 zákaznícke kategórie', () => {
		expect(BAZEN_KOLAJ.map((k) => k.kod)).toEqual(['Jednokoľajové', 'Dvojkoľajové']);
		expect(BAZEN_VYPLNE.length).toBe(3);
		expect(BAZEN_VYPLNE[0]!.nazov).toBe('Číry polykarbonát');
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['dlzka', 'sirka', 'vyska', 'segmenty'] as const) {
			const rng = BAZEN_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});
});

describe('#385 whitelist parsery (neznámy → bezpečný default)', () => {
	it('bazenModel: platný → zachovaný; neznámy/prázdny → Premier', () => {
		expect(bazenModel('Exclusive')).toBe('Exclusive');
		expect(bazenModel('Star')).toBe('Star');
		expect(bazenModel('HACK')).toBe('Premier');
		expect(bazenModel('')).toBe('Premier');
		expect(bazenModel(null)).toBe('Premier');
	});
	it('bazenKolaj: platný → zachovaný; inak Jednokoľajové', () => {
		expect(bazenKolaj('Dvojkoľajové')).toBe('Dvojkoľajové');
		expect(bazenKolaj('xxx')).toBe('Jednokoľajové');
	});
	it('bazenVypln: platný → zachovaný; inak Číry polykarbonát', () => {
		expect(bazenVypln('Opálový (mliečny) polykarbonát')).toBe('Opálový (mliečny) polykarbonát');
		expect(bazenVypln('injekcia<script>')).toBe('Číry polykarbonát');
	});
});

describe('#385 bazenVstupPlatny', () => {
	it('platný vstup → true', () => {
		expect(bazenVstupPlatny(VSTUP)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(bazenVstupPlatny({ ...VSTUP, dlzka: 999 })).toBe(false);
		expect(bazenVstupPlatny({ ...VSTUP, sirka: 999999 })).toBe(false);
		expect(bazenVstupPlatny({ ...VSTUP, vyska: 100 })).toBe(false);
	});
	it('neceločíselný / mimo počet segmentov → false', () => {
		expect(bazenVstupPlatny({ ...VSTUP, segmenty: 4.5 })).toBe(false);
		expect(bazenVstupPlatny({ ...VSTUP, segmenty: 1 })).toBe(false);
		expect(bazenVstupPlatny({ ...VSTUP, segmenty: 99 })).toBe(false);
	});
});

describe('#385 konfigurujBazen (súhrn) + bazenPonukaConfig (mapovanie na dopyt)', () => {
	it('plocha = dĺžka × šírka [m²] zaokrúhlená na 1 desatinu', () => {
		const s = konfigurujBazen(VSTUP);
		// 8000 × 4000 mm = 32,0 m²
		expect(s.plochaM2).toBe(32);
		const s2 = konfigurujBazen({ ...VSTUP, dlzka: 7500, sirka: 4200 }); // 31,5 m²
		expect(s2.plochaM2).toBe(31.5);
	});

	it('PonukaConfig: model v `system`, rozmery (d=dlzka, š=sirka → „Rozmery (d × š)"), výška+koľaj+segmenty v popise', () => {
		const cfg = bazenPonukaConfig(konfigurujBazen(VSTUP));
		expect(cfg.system).toBe('Bazénové zastrešenie — Premier');
		expect(cfg.dlzka).toBe(8000); // dĺžka → neutrálne `dlzka` pole → „Rozmery (d × š)"
		expect(cfg.sirka).toBe(4000); // šírka
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.sklo).toBe('Číry polykarbonát');
		expect(cfg.popis).toContain('Výška zastrešenia 1200 mm');
		expect(cfg.popis).toContain('Dvojkoľajové');
		expect(cfg.popis).toContain('počet segmentov 4');
		expect(cfg.popis).toContain('32 m²');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `hlbka`, ani pergola-špecifické polia', () => {
		const cfg = bazenPonukaConfig(konfigurujBazen(VSTUP));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// dĺžka ide do neutrálneho `dlzka` (nie pergolová `hlbka`) → PDF/stránka zobrazia „d × š"
		expect(cfg).not.toHaveProperty('hlbka');
		// žiadne pergolové polia (model do `system`, žiadna výška vpredu / sklon / počet polí)
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('vyskaPriStene');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — bazén NIKDY nedostane cenu (ani opečiatkovanú, ani prepočítanú),
// aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#385 honest-null cena — bazén bez ceny, pergola s cenou', () => {
	// CFG nesie `hlbka`+`model` = CENOTVORNÝ vstup (keby gate NEbol, `cenaZCfg` by cenu spočítalo);
	// bez `hlbka` by `cenaZCfg` vrátilo null aj bez gate → assercie by boli vákuové (review #389 🟡).
	const CFG_ROZMERY = {
		system: 'Bazénové zastrešenie — Premier',
		sirka: 4000,
		dlzka: 8000,
		hlbka: 3500,
		model: 'LIGHT' as const
	};

	it('opeciatkujCenuPreProdukt(bazen) → cena null + verzia null AJ pri cenotvornom cfg (gate drží)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'bazen');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=bazen) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, { produkt: 'bazen', datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		// subject aj keywords — case-insensitive (keyword je lowercase „orientačná cena")
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je bazénový (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('bazénového zastrešenia');
	});

	it('generatePonukaPdf(produkt=pergola / NULL) → PDF NESIE orientačnú cenu (honest-degrade zachovaný)', async () => {
		const cfgPergola = { system: 'Pergola', model: 'LIGHT' as const, sirka: 4000, hlbka: 3500 };
		const bytes = await generatePonukaPdf(cfgPergola, { produkt: null, datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
	});
});

// DB round-trip: uložený bazén dopyt nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a jeho
// re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download (#385 review 🔵).
describe('#385 honest-null DB round-trip — bazén dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert bazén dopyt (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = bazenPonukaConfig(konfigurujBazen(VSTUP));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'bazen');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'bazen'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('bazen');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('bazénového zastrešenia');
	});
});
