// #390 — verejný konfigurátor prístreškov a altánkov: client-safe zákaznícky modul (typy/krytiny/
// rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (prístrešky NEDOSTANÚ cenu — ani
// opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	PRISTRESOK_TYPY,
	PRISTRESOK_TYP_DEFAULT,
	PRISTRESOK_KRYTINY,
	PRISTRESOK_RANGES,
	pristresokTyp,
	pristresokTypNazov,
	pristresokKrytina,
	pristresokVstupPlatny,
	konfigurujPristresok,
	pristresokPonukaConfig,
	type PristresokVstup
} from '../src/lib/konfigurator-pristresok';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP: PristresokVstup = {
	typ: 'auto',
	krytina: 'Polykarbonát',
	dlzka: 6000,
	sirka: 3000,
	vyska: 2500,
	farba: 'RAL 7016 ANTRACIT'
};

describe('#390 katalóg typov / krytín', () => {
	it('5 typov (členenie montalu.sk); default auto (carport, hero fotka)', () => {
		expect(PRISTRESOK_TYPY.map((t) => t.kod)).toEqual([
			'auto',
			'terasa',
			'altanok',
			'sklenik',
			'sauna'
		]);
		expect(PRISTRESOK_TYP_DEFAULT).toBe('auto');
	});

	it('krytiny = 4 reálne montalu.sk možnosti; prvá Polykarbonát', () => {
		expect(PRISTRESOK_KRYTINY.map((k) => k.nazov)).toEqual([
			'Polykarbonát',
			'Izolačné sklo',
			'Bezpečnostné sklo',
			'Panel ISODOMUS'
		]);
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['dlzka', 'sirka', 'vyska'] as const) {
			const rng = PRISTRESOK_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});
});

describe('#390 whitelist parsery (neznámy → bezpečný default)', () => {
	it('pristresokTyp: platný → zachovaný; neznámy/prázdny → auto', () => {
		expect(pristresokTyp('altanok')).toBe('altanok');
		expect(pristresokTyp('sauna')).toBe('sauna');
		expect(pristresokTyp('HACK')).toBe('auto');
		expect(pristresokTyp('')).toBe('auto');
		expect(pristresokTyp(null)).toBe('auto');
	});
	it('pristresokTypNazov: kód → nominatívny názov; neznámy → názov defaultu', () => {
		expect(pristresokTypNazov('altanok')).toBe('Hliníkový záhradný altánok');
		expect(pristresokTypNazov('auto')).toBe('Hliníkový prístrešok na auto');
		expect(pristresokTypNazov('xxx')).toBe('Hliníkový prístrešok na auto');
		expect(pristresokTypNazov(null)).toBe('Hliníkový prístrešok na auto');
	});
	it('pristresokKrytina: platný → zachovaný; inak Polykarbonát', () => {
		expect(pristresokKrytina('Izolačné sklo')).toBe('Izolačné sklo');
		expect(pristresokKrytina('injekcia<script>')).toBe('Polykarbonát');
	});
});

describe('#390 pristresokVstupPlatny', () => {
	it('platný vstup → true', () => {
		expect(pristresokVstupPlatny(VSTUP)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(pristresokVstupPlatny({ ...VSTUP, dlzka: 999 })).toBe(false);
		expect(pristresokVstupPlatny({ ...VSTUP, sirka: 999999 })).toBe(false);
		expect(pristresokVstupPlatny({ ...VSTUP, vyska: 100 })).toBe(false);
	});
});

describe('#390 konfigurujPristresok (súhrn) + pristresokPonukaConfig (mapovanie na dopyt)', () => {
	it('typ → nominatívny názov; plocha = dĺžka × šírka [m²] zaokrúhlená na 1 desatinu', () => {
		const s = konfigurujPristresok(VSTUP);
		expect(s.typ).toBe('Hliníkový prístrešok na auto');
		// 6000 × 3000 mm = 18,0 m²
		expect(s.plochaM2).toBe(18);
		const s2 = konfigurujPristresok({ ...VSTUP, dlzka: 5000, sirka: 3500 }); // 17,5 m²
		expect(s2.plochaM2).toBe(17.5);
	});

	it('PonukaConfig: typ v `system`, rozmery (d=dlzka, š=sirka → „Rozmery (d × š)"), krytina v `sklo`, výška+plocha v popise', () => {
		const cfg = pristresokPonukaConfig(konfigurujPristresok(VSTUP));
		expect(cfg.system).toBe('Hliníkový prístrešok na auto');
		expect(cfg.dlzka).toBe(6000); // dĺžka → neutrálne `dlzka` pole → „Rozmery (d × š)"
		expect(cfg.sirka).toBe(3000); // šírka
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.sklo).toBe('Polykarbonát'); // krytina → „Sklo / výplň"
		expect(cfg.popis).toContain('Výška 2500 mm');
		expect(cfg.popis).toContain('18 m²');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `hlbka`, ani pergola-špecifické polia', () => {
		const cfg = pristresokPonukaConfig(konfigurujPristresok(VSTUP));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// dĺžka ide do neutrálneho `dlzka` (nie pergolová `hlbka`) → PDF/stránka zobrazia „d × š"
		expect(cfg).not.toHaveProperty('hlbka');
		// žiadne pergolové polia (typ do `system`, žiadny model / výška vpredu / počet polí)
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('vyskaPriStene');
		expect(cfg).not.toHaveProperty('pocetPoli');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — prístrešok NIKDY nedostane cenu (ani opečiatkovanú, ani prepočítanú),
// aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#390 honest-null cena — prístrešok bez ceny, pergola s cenou', () => {
	const CFG_ROZMERY = { system: 'Hliníkový prístrešok na auto', sirka: 3000, dlzka: 6000 };

	it('opeciatkujCenuPreProdukt(pristresok) → cena null + verzia null (žiadna pergolová cena)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'pristresok');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=pristresok) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, {
			produkt: 'pristresok',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		// subject aj keywords — case-insensitive (keyword je lowercase „orientačná cena")
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je prístreškový (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('prístrešku');
	});
});

// DB round-trip: uložený prístreškový dopyt nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a
// jeho re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download (vzor #385 review 🔵).
describe('#390 honest-null DB round-trip — prístreškový dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert prístreškový dopyt (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = pristresokPonukaConfig(konfigurujPristresok(VSTUP));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'pristresok');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'pristresok'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('pristresok');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('prístrešku');
	});
});
