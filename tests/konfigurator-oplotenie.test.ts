// #388 — verejný konfigurátor hliníkového oplotenia a brán: client-safe zákaznícky modul (typy/modely/
// rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (oplotenie NEDOSTANE cenu — ani opečiatkovanú,
// ani prepočítanú v PDF). Money-neutralita import-grafu stráži `konfigurator-money-safety.test.ts` (A);
// TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	OPLOTENIE_TYPY,
	OPLOTENIE_TYP_DEFAULT,
	OPLOTENIE_MODELY,
	OPLOTENIE_MODEL_DEFAULT,
	OPLOTENIE_RANGES,
	oplotenieTyp,
	oplotenieModel,
	oplotenieTypNazov,
	oplotenieVstupPlatny,
	konfigurujOplotenie,
	oploteniePonukaConfig,
	type OplotenieVstup
} from '../src/lib/konfigurator-oplotenie';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const VSTUP: OplotenieVstup = {
	typ: 'posuvna',
	model: 'PANDORA',
	vyska: 1800,
	sirka: 4000,
	pocet: 1,
	farba: 'RAL 7016 ANTRACIT'
};

describe('#388 katalóg typov / modelov / rozmedzia', () => {
	it('5 typov prvkov v poradí; default Plotový diel', () => {
		expect(OPLOTENIE_TYPY.map((t) => t.kod)).toEqual([
			'diel',
			'kridlova',
			'posuvna',
			'samonosna',
			'branka'
		]);
		expect(OPLOTENIE_TYP_DEFAULT).toBe('diel');
		expect(oplotenieTypNazov('posuvna')).toBe('Brána posuvná');
		expect(oplotenieTypNazov('diel')).toBe('Plotový diel');
	});

	it('7 modelov výplne v poradí ARIEL…ATYP; default ARIEL', () => {
		expect(OPLOTENIE_MODELY.map((m) => m.kod)).toEqual([
			'ARIEL',
			'BIANCA',
			'LUNA',
			'NARVI',
			'PANDORA',
			'REA',
			'ATYP'
		]);
		expect(OPLOTENIE_MODEL_DEFAULT).toBe('ARIEL');
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['vyska', 'sirka', 'pocet'] as const) {
			const rng = OPLOTENIE_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});
});

describe('#388 whitelist parsery (neznámy → bezpečný default)', () => {
	it('oplotenieTyp: platný → zachovaný; neznámy/prázdny → diel', () => {
		expect(oplotenieTyp('kridlova')).toBe('kridlova');
		expect(oplotenieTyp('branka')).toBe('branka');
		expect(oplotenieTyp('HACK')).toBe('diel');
		expect(oplotenieTyp('')).toBe('diel');
		expect(oplotenieTyp(null)).toBe('diel');
	});
	it('oplotenieModel: platný → zachovaný; inak ARIEL', () => {
		expect(oplotenieModel('NARVI')).toBe('NARVI');
		expect(oplotenieModel('ATYP')).toBe('ATYP');
		expect(oplotenieModel('injekcia<script>')).toBe('ARIEL');
	});
});

describe('#388 oplotenieVstupPlatny', () => {
	it('platný vstup → true', () => {
		expect(oplotenieVstupPlatny(VSTUP)).toBe(true);
	});
	it('rozmer mimo rozmedzia → false', () => {
		expect(oplotenieVstupPlatny({ ...VSTUP, vyska: 100 })).toBe(false);
		expect(oplotenieVstupPlatny({ ...VSTUP, sirka: 999999 })).toBe(false);
	});
	it('neceločíselný / mimo počet kusov → false', () => {
		expect(oplotenieVstupPlatny({ ...VSTUP, pocet: 4.5 })).toBe(false);
		expect(oplotenieVstupPlatny({ ...VSTUP, pocet: 0 })).toBe(false);
		expect(oplotenieVstupPlatny({ ...VSTUP, pocet: 99 })).toBe(false);
	});
});

describe('#388 konfigurujOplotenie (súhrn) + oploteniePonukaConfig (mapovanie na dopyt)', () => {
	it('súhrn nesie display názov typu + rozmery + počet', () => {
		const s = konfigurujOplotenie(VSTUP);
		expect(s.typNazov).toBe('Brána posuvná');
		expect(s.model).toBe('PANDORA');
		expect(s.vyska).toBe(1800);
		expect(s.sirka).toBe(4000);
		expect(s.pocet).toBe(1);
	});

	it('PonukaConfig: typ v `system`, šírka → `sirka` (→ „Šírka" riadok), model+výška+počet v popise', () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		expect(cfg.system).toBe('Hliníkové oplotenie — Brána posuvná');
		expect(cfg.sirka).toBe(4000);
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.popis).toContain('Dizajn výplne PANDORA');
		expect(cfg.popis).toContain('výška 1800 mm');
		expect(cfg.popis).toContain('počet 1 ks');
	});

	it('PonukaConfig NENESIE žiadnu cenu, `dlzka`/`hlbka`, ani pergola-špecifické polia (výška NEjde do vyskaVpredu)', () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		const json = JSON.stringify(cfg);
		expect(json).not.toMatch(/€|EUR\b|cena|bezDph|sDph|priceB2B/i);
		// šírka ide do neutrálneho `sirka` (žiadna `dlzka`/`hlbka` → zhrnutieRiadky vykreslí „Šírka")
		expect(cfg).not.toHaveProperty('dlzka');
		expect(cfg).not.toHaveProperty('hlbka');
		// žiadne pergolové polia (výška NEjde do `vyskaVpredu` — inak by PDF ukázalo „Výška vpredu")
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('vyskaPriStene');
		expect(cfg).not.toHaveProperty('sklo');
	});
});

// --------------------------------------------------------------------------- //
// HONEST-NULL cenový kontrakt — oplotenie NIKDY nedostane cenu (ani opečiatkovanú, ani prepočítanú),
// aj keď má rozmery. Pergola áno (regresná istota, že sme cenu pergole nerozbili).
// --------------------------------------------------------------------------- //
describe('#388 honest-null cena — oplotenie bez ceny, pergola s cenou', () => {
	const CFG_ROZMERY = { system: 'Hliníkové oplotenie — Brána posuvná', sirka: 4000 };

	it('opeciatkujCenuPreProdukt(oplotenie) → cena null + verzia null (žiadna pergolová cena)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_ROZMERY, 'oplotenie');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=oplotenie) → PDF NENESIE žiadnu cenu, aj s rozmermi (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_ROZMERY, {
			produkt: 'oplotenie',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		// subject aj keywords — case-insensitive (keyword je lowercase „orientačná cena")
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je oplotenie (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('oplotenia');
	});
});

// DB round-trip: uložený oplotenie dopyt nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a jeho
// re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download.
describe('#388 honest-null DB round-trip — oplotenie dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert oplotenie dopyt (honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		const stamp = opeciatkujCenuPreProdukt(cfg, 'oplotenie');
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(cfg),
				meno: 'TEST',
				email: 't@example.com',
				telefon: '',
				miesto: '',
				poznamka: '',
				produkt: 'oplotenie'
			},
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.produkt).toBe('oplotenie');
		expect(row.cena_druh).toBeNull();
		expect(row.cennik_verzia).toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		expect(doc.getTitle() ?? '').toContain('oplotenia');
	});
});
