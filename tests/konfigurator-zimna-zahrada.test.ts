// #386 — verejný konfigurátor zimných záhrad: client-safe zákaznícky modul (modely/zasklenia/systémy
// stien/rozmedzia/súhrn/PonukaConfig) + honest-null cenový gate (zimná záhrada NEDOSTANE cenu — ani
// opečiatkovanú, ani prepočítanú v PDF). Money-neutralita import-grafu stráži
// `konfigurator-money-safety.test.ts` (A); TU overujeme SPRÁVNOSŤ + honest-null kontrakt.
// #429: systém stien je TERAZ cenotvorný — pack/unpack (`zzSystemKod`/`parseZzSystemKod`) sa testuje
// tu, presná cenová parita v `konfigurator-zimna-zahrada-cena.test.ts`.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	ZZ_MODELY,
	ZZ_MODEL_DEFAULT,
	ZZ_ZASKLENIA,
	ZZ_SYSTEMY_STIEN,
	ZZ_SYSTEM_STIEN_DEFAULT,
	ZZ_RANGES,
	zzModel,
	zzZasklenie,
	zzSystemStien,
	zzSystemKod,
	parseZzSystemKod,
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
	zasklenie: 'Bezpečnostné sklo',
	systemStien: 'Robust - 24mm IZO sklo',
	farba: 'RAL 7016 ANTRACIT'
};

describe('#386 katalóg modelov / zasklenie', () => {
	it('2 modely v poradí ROBUST → MASSIVE; default ROBUST', () => {
		expect(ZZ_MODELY.map((m) => m.kod)).toEqual(['ROBUST', 'MASSIVE']);
		expect(ZZ_MODEL_DEFAULT).toBe('ROBUST');
	});

	it('zasklenie = 4 zákaznícke kategórie (DOSLOVNÁ montalu.sk terminológia — žiadne vymyslené „dvojsklo/trojsklo")', () => {
		expect(ZZ_ZASKLENIA.length).toBe(4);
		expect(ZZ_ZASKLENIA.map((z) => z.nazov)).toEqual([
			'Izolačné sklo',
			'Bezpečnostné sklo',
			'Polykarbonát',
			'Panel ISODOMUS'
		]);
	});

	it('rozmedzia majú min < max a krok > 0', () => {
		for (const kluc of ['sirka', 'hlbka', 'vyska'] as const) {
			const rng = ZZ_RANGES[kluc];
			expect(rng.min).toBeLessThan(rng.max);
			expect(rng.krok).toBeGreaterThan(0);
		}
	});

	it('#429 systém stien = 6 kombinácií (DOSLOVNÁ montalu.sk cenového konfigurátora terminológia — network capture)', () => {
		expect(ZZ_SYSTEMY_STIEN.length).toBe(6);
		expect(ZZ_SYSTEMY_STIEN.map((s) => s.nazov)).toEqual([
			'Deluxe bezrámový - 10mm sklo',
			'Štandard plus - 6mm sklo',
			'Štandard plus - 16mm sklo',
			'Slide - 6mm sklo',
			'Slide - 16mm sklo',
			'Robust - 24mm IZO sklo'
		]);
		// default = dnešná (#408) báza — non-breaking
		expect(ZZ_SYSTEM_STIEN_DEFAULT).toBe('Slide - 16mm sklo');
		expect(ZZ_SYSTEMY_STIEN.map((s) => s.nazov)).toContain(ZZ_SYSTEM_STIEN_DEFAULT);
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
	it('zzZasklenie: platný → zachovaný; inak Izolačné sklo', () => {
		expect(zzZasklenie('Panel ISODOMUS')).toBe('Panel ISODOMUS');
		expect(zzZasklenie('Bezpečnostné sklo')).toBe('Bezpečnostné sklo');
		expect(zzZasklenie('injekcia<script>')).toBe('Izolačné sklo');
	});
	it('#429 zzSystemStien: platný → zachovaný; neznámy/prázdny → báza Slide 16mm', () => {
		expect(zzSystemStien('Robust - 24mm IZO sklo')).toBe('Robust - 24mm IZO sklo');
		expect(zzSystemStien('Deluxe bezrámový - 10mm sklo')).toBe('Deluxe bezrámový - 10mm sklo');
		expect(zzSystemStien('injekcia<script>')).toBe('Slide - 16mm sklo');
		expect(zzSystemStien('')).toBe('Slide - 16mm sklo');
		expect(zzSystemStien(null)).toBe('Slide - 16mm sklo');
	});
});

// --------------------------------------------------------------------------- //
// #429 kompozitný `systemKod` pack/unpack — vzor #410 oplotenie. Model (DISPLAY) + systém stien
// (CENOTVORNÝ) zbalené do jedného neutrálneho `PonukaConfig.systemKod` poľa.
// --------------------------------------------------------------------------- //
describe('#429 zzSystemKod / parseZzSystemKod (kompozitný systemKod)', () => {
	it('zbalí a rozbalí model + systém stien bezstratovo', () => {
		const kod = zzSystemKod('MASSIVE', 'Robust - 24mm IZO sklo');
		expect(kod).toBe('MASSIVE|Robust - 24mm IZO sklo');
		expect(parseZzSystemKod(kod)).toEqual({
			model: 'MASSIVE',
			systemStien: 'Robust - 24mm IZO sklo'
		});
	});

	it('STARÝ riadok (spred #429, LEN model, žiadny „|") sa degraduje na bázový systém stien', () => {
		// presne to, čo `zimnaZahradaPonukaConfig` písalo pred #429 (`systemKod: s.model`)
		expect(parseZzSystemKod('ROBUST')).toEqual({
			model: 'ROBUST',
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
	});

	it('neznámy model/systém stien v kompozitnom kóde → whitelist honest-degrade na oboch stranách', () => {
		expect(parseZzSystemKod('HACK|neznamy systém')).toEqual({
			model: ZZ_MODEL_DEFAULT,
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
	});

	it('prázdny/undefined systemKod → default model + default systém stien', () => {
		expect(parseZzSystemKod('')).toEqual({
			model: ZZ_MODEL_DEFAULT,
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
		expect(parseZzSystemKod(undefined)).toEqual({
			model: ZZ_MODEL_DEFAULT,
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
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

	it('PonukaConfig: model v `system`, KOMPOZITNÝ systemKod (model+systém stien, #429), rozmery (š=sirka, h=hlbka → „Rozmery (š × h)"), výška+plocha+systém stien v popise, zasklenie v `sklo`', () => {
		const cfg = zimnaZahradaPonukaConfig(konfigurujZimnaZahradu(VSTUP));
		expect(cfg.system).toBe('Zimná záhrada — ROBUST');
		// #429: systemKod je TERAZ kompozitný "model|systémStien" (vzor #410 oplotenie)
		expect(cfg.systemKod).toBe('ROBUST|Robust - 24mm IZO sklo');
		expect(cfg.sirka).toBe(5000); // šírka → `sirka`
		expect(cfg.hlbka).toBe(4000); // hĺbka → `hlbka` → „Rozmery (š × h)" (izbový tvar)
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.sklo).toBe('Bezpečnostné sklo');
		expect(cfg.popis).toContain('Výška 2800 mm');
		expect(cfg.popis).toContain('20 m²');
		expect(cfg.popis).toContain('Robust - 24mm IZO sklo');
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
// #408 ORIENTAČNÁ cena — zimná záhrada TERAZ dostane cenu (matica montalu.sk, systemKod-gated).
// Pergola nezmenená (regresná istota). Honest-degrade: cfg BEZ systemKod (starý riadok pred #408)
// → null (starému honest-null dopytu sa ticho nepriradí cena).
// --------------------------------------------------------------------------- //
describe('#408 orientačná cena — zimná záhrada s cenou, pergola nezmenená', () => {
	// cfg z reálneho mapovania (nesie systemKod='ROBUST' + hlbka + sirka + sklo → cenotvorné pre modul)
	const CFG = zimnaZahradaPonukaConfig(konfigurujZimnaZahradu(VSTUP));

	it('opeciatkujCenuPreProdukt(zimna-zahrada) → cena opečiatkovaná + verzia cenníka zimnej záhrady', () => {
		const s = opeciatkujCenuPreProdukt(CFG, 'zimna-zahrada');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('opeciatkujCenuPreProdukt(zimna-zahrada) bez systemKod (starý riadok) → cena null (honest-degrade); verzia je audit', () => {
		// starý honest-null zimná dopyt (pred #408) nemá systemKod → cena sa NEspočíta (cena null →
		// re-download honest-degrade nedostane cenu). `cennikVerzia` je LEN audit (z ktorej matice bol
		// dopyt podaný) — cena_druh ostáva NULL, takže žiadna cena sa nezobrazí (vzor bazén/pergola).
		const s = opeciatkujCenuPreProdukt(
			{ system: 'Zimná záhrada — ROBUST', sirka: 5000, hlbka: 4000 },
			'zimna-zahrada'
		);
		expect(s.cena).toBeNull();
	});

	it('opeciatkujCenuPreProdukt(pergola) → cena opečiatkovaná (nerozbité pergola pricing)', () => {
		const s = opeciatkujCenuPreProdukt({ model: 'LIGHT', sirka: 4000, hlbka: 3500 }, 'pergola');
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=zimna-zahrada) → PDF NESIE orientačnú cenu, VO/Money NIE (subject+keywords)', async () => {
		const bytes = await generatePonukaPdf(CFG, {
			produkt: 'zimna-zahrada',
			datum: '1. 1. 2026'
		});
		const doc = await PDFDocument.load(bytes);
		// PDF nesie orientačnú (MO) cenu
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
		// nadpis dokumentu je zimno-záhradový (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('zimnej záhrady');
		// VO cena / Money kód sa na verejnú plochu NIKDY nedostanú
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/veľkoobchodná cena|priceB2B/i);
	});

	it('generatePonukaPdf(produkt=pergola / NULL) → PDF NESIE orientačnú cenu (honest-degrade zachovaný)', async () => {
		const cfgPergola = { system: 'Pergola', model: 'LIGHT' as const, sirka: 4000, hlbka: 3500 };
		const bytes = await generatePonukaPdf(cfgPergola, { produkt: null, datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
	});
});

// DB round-trip (#408): uložený dopyt zimnej záhrady nesie OPEČIATKOVANÚ cenu (cena_druh='cena' +
// cennik_verzia) a jeho re-download (regeneratePonukaPdf) reprodukuje PDF S orientačnou cenou platnou
// pri podaní — priced kontrakt prežije celý tok submit → uloženie → re-download (#385/#404 vzor).
describe('#408 DB round-trip — dopyt zimnej záhrady s cenou, re-download s cenou', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert dopyt zimnej záhrady (opečiatkovaná cena) → cena_druh=cena + cennik_verzia → regen PDF s cenou', async () => {
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
		expect(row.cena_druh).toBe('cena');
		expect(row.cennik_verzia).not.toBeNull();

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		// re-download reprodukuje orientačnú (MO) cenu; VO/Money kód NIKDY
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/veľkoobchodná cena|priceB2B/i);
		expect(doc.getTitle() ?? '').toContain('zimnej záhrady');
	});
});
