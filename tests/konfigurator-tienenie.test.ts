// #389 — verejný konfigurátor tienenia (markízy + screenové rolety): client-safe zákaznícky modul
// (typy/ovládanie/PER-MODEL rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (tienenie NEDOSTANE
// cenu — ani opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	TIENENIE_MODELY,
	TIENENIE_MODEL_DEFAULT,
	TIENENIE_OVLADANIE,
	TIENENIE_OVLADANIE_DEFAULT,
	tienenieModel,
	tienenieOvladanie,
	tienenieModelInfo,
	tienenieRanges,
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
	ovladanie: 'Elektrické',
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

	it('ovládanie je PER MODEL (montalu.sk): XLINE/ZIPLINE len motorické, XLIGHT aj ručné', () => {
		expect(tienenieModelInfo('XLINE').ovladanie).toEqual(['Elektrické']);
		expect(tienenieModelInfo('ZIPLINE').ovladanie).toEqual(['Elektrické']);
		expect(tienenieModelInfo('XLIGHT').ovladanie).toEqual(['Elektrické', 'Ručné']);
		// katalóg má oba (s ASCII id pre testidy) a default je motorické
		expect(TIENENIE_OVLADANIE.map((o) => o.id)).toEqual(['elektricke', 'rucne']);
		expect(TIENENIE_OVLADANIE_DEFAULT).toBe('Elektrické');
	});
});

describe('#389 PER-MODEL rozmerové limity (reálne z montalu.sk — nič nevymyslené)', () => {
	it('šírka: XLINE 7500 / XLIGHT 6000 / ZIPLINE 4000; druhý rozmer: 6000 / 5000 / 3000', () => {
		expect(tienenieRanges('XLINE').sirka.max).toBe(7500);
		expect(tienenieRanges('XLIGHT').sirka.max).toBe(6000);
		expect(tienenieRanges('ZIPLINE').sirka.max).toBe(4000);
		expect(tienenieRanges('XLINE').rozmer2.max).toBe(6000);
		expect(tienenieRanges('XLIGHT').rozmer2.max).toBe(5000);
		expect(tienenieRanges('ZIPLINE').rozmer2.max).toBe(3000);
	});
	it('všetky rozmedzia majú min < max a krok 500', () => {
		for (const m of TIENENIE_MODELY) {
			const rng = tienenieRanges(m.kod);
			for (const kluc of ['sirka', 'rozmer2'] as const) {
				expect(rng[kluc].min).toBeLessThan(rng[kluc].max);
				expect(rng[kluc].krok).toBe(500);
			}
		}
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
	it('tienenieOvladanie je PER MODEL: „Ručné" platí pri XLIGHT, ale nie pri ZIPLINE/XLINE', () => {
		expect(tienenieOvladanie('Ručné', 'XLIGHT')).toBe('Ručné');
		// ZIPLINE/XLINE ručné neponúkajú → fallback na prvé dostupné (Elektrické) — žiadny vymyslený variant
		expect(tienenieOvladanie('Ručné', 'ZIPLINE')).toBe('Elektrické');
		expect(tienenieOvladanie('Ručné', 'XLINE')).toBe('Elektrické');
		expect(tienenieOvladanie('<script>', 'XLIGHT')).toBe('Elektrické');
	});
});

describe('#389 tienenieVstupPlatny (PER-MODEL rozmedzia)', () => {
	it('platný vstup → true (markíza aj roleta)', () => {
		expect(tienenieVstupPlatny(VSTUP_MARKIZA)).toBe(true);
		expect(tienenieVstupPlatny(VSTUP_ROLETA)).toBe(true);
	});
	it('rozmer nad reálnym per-model limitom → false (spec risk, review #389 🟡)', () => {
		// ZIPLINE výška max 3000 → 6000 je nemožné
		expect(tienenieVstupPlatny({ ...VSTUP_ROLETA, rozmer2: 6000 })).toBe(false);
		// ZIPLINE šírka max 4000 → 7500 je nemožné (pri XLINE by 7500 bolo OK)
		expect(tienenieVstupPlatny({ ...VSTUP_ROLETA, sirka: 7500 })).toBe(false);
		// XLIGHT šírka max 6000 → 7500 je nemožné
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, model: 'XLIGHT', sirka: 7500 })).toBe(false);
		// XLINE šírka 7500 JE platné (najväčší model)
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, sirka: 7500 })).toBe(true);
	});
	it('rozmer pod minimom / mimo → false', () => {
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, sirka: 999 })).toBe(false);
		expect(tienenieVstupPlatny({ ...VSTUP_MARKIZA, rozmer2: 500 })).toBe(false);
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
// aj keď dostane FORGED pergola-tvar konfiguráciu (`hlbka`+`model`, ktorú `sanitizePonukaConfig`
// prijme). Bez `hlbka` by `cenaZCfg` vrátilo null aj bez gate → test by bol vákuový (review #389 🟡).
// Preto CFG nesie `hlbka`+`model`: keby gate NEbol, `opeciatkujCenu`/`ponuka-pdf` by cenu SPOČÍTALO.
// Pergola s tým istým cfg cenu MÁ = pozitívna kontrola, že vstup je reálne cenotvorný.
// --------------------------------------------------------------------------- //
describe('#389 honest-null cena — tienenie bez ceny (aj pri forged pergola-tvare), pergola s cenou', () => {
	const CFG_FORGED = {
		system: 'Tienenie — Markíza XLINE',
		sirka: 4000,
		hlbka: 3500,
		model: 'LIGHT' as const
	};

	it('POZITÍVNA kontrola: ten istý cfg s produktom pergola → cena je opečiatkovaná (cfg JE cenotvorný)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_FORGED, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('opeciatkujCenuPreProdukt(tienenie) → cena null + verzia null AJ pri cenotvornom cfg (gate drží)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_FORGED, 'tienenie');
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBeNull();
	});

	it('generatePonukaPdf(produkt=tienenie) → PDF NENESIE cenu AJ pri cenotvornom cfg (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG_FORGED, { produkt: 'tienenie', datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/orientačná cena|veľkoobchodná cena|€/i);
		// nadpis dokumentu je tienenie (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('tienenia');
	});

	it('generatePonukaPdf(produkt=pergola) s tým istým cfg → PDF cenu MÁ (pozitívna kontrola)', async () => {
		const bytes = await generatePonukaPdf(CFG_FORGED, { produkt: 'pergola', datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
	});
});

// DB round-trip: uložený tienenie dopyt nesie NULOVÚ cenu (cena_druh aj cennik_verzia null) a jeho
// re-download (regeneratePonukaPdf) reprodukuje PDF BEZ ceny — honest-null prežije celý tok
// submit → uloženie → re-download, aj keď je uložený cfg cenotvorný (hlbka+model).
describe('#389 honest-null DB round-trip — tienenie dopyt bez ceny, re-download bez ceny', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert tienenie dopyt (cenotvorný cfg, honest-null pečiatka) → cena_druh+cennik_verzia null → regen PDF bez ceny', async () => {
		// cenotvorný cfg (hlbka+model) — ale opečiatkujeme na produkt tienenie → honest-null (gate drží)
		const cfg = {
			system: 'Tienenie — Markíza XLINE',
			sirka: 5000,
			hlbka: 3500,
			model: 'LIGHT' as const
		};
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
