// #388/#410 — verejný konfigurátor hliníkového oplotenia a brán: client-safe zákaznícky modul (typy/
// modely/rozmedzia/súhrn/PonukaConfig, vrátane cenotvorného `systemKod` kľúča) + #410 ORIENTAČNÁ cena
// (oplotenie MÁ interim cenový zdroj — reálna cfg dostane cenu na submite AJ re-downloade; dispatch je
// produkt-izolovaný). Money-neutralita import-grafu stráži `konfigurator-money-safety.test.ts` (A);
// parita matice + DPH `konfigurator-oplotenie-cena.test.ts`; TU overujeme SPRÁVNOSŤ modulu + cena tok.
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
import { zhrnutieRiadky } from '../src/lib/ponuka';
import { opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { CENNIK_VERZIA_OPLOTENIE } from '../src/lib/server/konfigurator-oplotenie-cena';
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

	it('PonukaConfig: typ v `system`, cenotvorný kľúč v `systemKod`, šírka → `sirka` (→ „Šírka" riadok), model+výška+počet v popise', () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		expect(cfg.system).toBe('Hliníkové oplotenie — Brána posuvná');
		// #410: cenotvorný kľúč = "typKod|model|vyskaMm|pocet" (typKod/model neobsahujú `|`)
		expect(cfg.systemKod).toBe('posuvna|PANDORA|1800|1');
		expect(cfg.sirka).toBe(4000);
		expect(cfg.farba).toBe('RAL 7016 ANTRACIT');
		expect(cfg.popis).toContain('Dizajn výplne PANDORA');
		expect(cfg.popis).toContain('výška 1800 mm');
		expect(cfg.popis).toContain('počet 1 ks');
	});

	it('PonukaConfig NENESIE žiadnu cenovú HODNOTU, `dlzka`/`hlbka`, ani pergola-špecifické polia (výška NEjde do vyskaVpredu)', () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		const json = JSON.stringify(cfg);
		// systemKod nesie cenotvorný KĽÚČ (typ|model|výška|počet), NIE cenovú hodnotu (€/bezDph/sDph)
		expect(json).not.toMatch(/€|EUR\b|bezDph|sDph|priceB2B/i);
		// šírka ide do neutrálneho `sirka` (žiadna `dlzka`/`hlbka` → zhrnutieRiadky vykreslí „Šírka")
		expect(cfg).not.toHaveProperty('dlzka');
		expect(cfg).not.toHaveProperty('hlbka');
		// žiadne pergolové polia (výška NEjde do `vyskaVpredu` — inak by PDF ukázalo „Výška vpredu")
		expect(cfg).not.toHaveProperty('model');
		expect(cfg).not.toHaveProperty('vyskaVpredu');
		expect(cfg).not.toHaveProperty('vyskaPriStene');
		expect(cfg).not.toHaveProperty('sklo');
	});

	// #388 review 🔵: overuj kontrakt „žiadny zavádzajúci label" NA RENDER VRSTVE (`zhrnutieRiadky`),
	// nielen ako absenciu poľa na cfg — inak by budúca zmena poradia/logiky riadkov v `ponuka.ts`
	// (napr. reinterpretácia `sirka`) prešla nezachytená. Šírka → „Šírka" (nie „Výška vpredu").
	it('zhrnutieRiadky(cfg) renderuje presne Systém/Šírka/Farba/Popis — žiadny zavádzajúci pergolový label', () => {
		const cfg = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
		const rows = zhrnutieRiadky(cfg);
		expect(rows.map((r) => r.label)).toEqual(['Systém', 'Šírka', 'Farba konštrukcie', 'Popis']);
		const sirkaRow = rows.find((r) => r.label === 'Šírka');
		expect(sirkaRow?.value).toBe('4000 mm');
		// žiadny pergolový výškový/hĺbkový/rozmerový-pár label
		expect(rows.map((r) => r.label)).not.toContain('Výška vpredu');
		expect(rows.map((r) => r.label)).not.toContain('Rozmery (š × h)');
		expect(rows.map((r) => r.label)).not.toContain('Rozmery (d × š)');
	});
});

// --------------------------------------------------------------------------- //
// ORIENTAČNÁ cena (#410) — oplotenie MÁ interim cenový zdroj: reálna oplotenie cfg (nesie `systemKod`)
// dostane oplotenie cenu na submite AJ re-downloade. Dispatch je PRODUKT-IZOLOVANÝ: pergolotvarová cfg
// (model+hlbka, BEZ oplotenie `systemKod`) pod 'oplotenie' NEDOSTANE cenu (číta sa oplotenie `systemKod`),
// hoci tá istá cfg pod 'pergola' cenu DOSTANE — netautologický gate test (vzor #404). Detailná parita
// matice + DPH je v `konfigurator-oplotenie-cena.test.ts`.
// --------------------------------------------------------------------------- //
describe('#410 orientačná cena — oplotenie s cenou (produkt-izolovaný dispatch)', () => {
	// reálna oplotenie cfg (nesie `systemKod = "posuvna|PANDORA|1800|1"` + `sirka`)
	const CFG = oploteniePonukaConfig(konfigurujOplotenie(VSTUP));
	// pergolotvarová cfg (`model`+`hlbka`, BEZ oplotenie `systemKod`) — TAKÁ cfg BY dala PERGOLOVÚ cenu;
	// pod 'oplotenie' ju NESMIE dostať (oplotenie dispatch číta `systemKod`, ktorý tu chýba). Klient ju
	// môže sfalšovať v POST `konfiguracia` → dispatch produkt-izolácia musí držať na submite AJ re-downloade.
	const CFG_PERGOLA_FORGED = {
		system: 'Hliníkové oplotenie — Brána posuvná',
		model: 'LIGHT' as const,
		sirka: 4000,
		hlbka: 3500
	};

	it('opeciatkujCenuPreProdukt(oplotenie) reálnej cfg → cena OPEČIATKOVANÁ + oplotenie verzia cenníka', () => {
		const s = opeciatkujCenuPreProdukt(CFG, 'oplotenie');
		expect(s.cena?.druh).toBe('cena');
		expect(s.cennikVerzia).toBe(CENNIK_VERZIA_OPLOTENIE);
	});

	it('pergolotvarová cfg (bez systemKod) pod „oplotenie" → cena null (pergolová cena NEúniká do oplotenia)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_PERGOLA_FORGED, 'oplotenie');
		expect(s.cena).toBeNull();
	});

	it('KONTROLA: TÁ ISTÁ pergolotvarová cfg pod „pergola" → cena OPEČIATKOVANÁ (dispatch nie je no-op)', () => {
		const s = opeciatkujCenuPreProdukt(CFG_PERGOLA_FORGED, 'pergola');
		expect(s.cena?.druh).toBe('cena');
		expect(s.cennikVerzia).not.toBeNull();
	});

	it('generatePonukaPdf(produkt=oplotenie, reálna cfg) → PDF NESIE orientačnú (MO) cenu, žiadnu VO', async () => {
		const bytes = await generatePonukaPdf(CFG, { produkt: 'oplotenie', datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
		// nadpis dokumentu je oplotenie (produkt-aware)
		expect(doc.getTitle() ?? '').toContain('oplotenia');
		// VO cena sa na verejnú/MO plochu NIKDY nedostane
		const meta = `${doc.getSubject() ?? ''} ${(doc.getKeywords() ?? '').toString()}`;
		expect(meta).not.toMatch(/veľkoobchodná cena|priceB2B/i);
	});

	// #410 review 🟡: off-grid ŠÍRKA (2300 mm; stepper píše na 100 mm mriežku, cenová mriežka je 0,5 m)
	// → cena sa počíta pre najbližší katalógový rozmer (2,5 m) a PDF čestne doplní „katalógový rozmer".
	// PIN poradia „šírka × výška" (`sirkaGridM × hlbkaGridM`) — budúca zmena `cenaRiadky` by inak
	// mohla poradie prehodiť na „1,5 × 2,5" (× = U+00D7 byte-identické).
	it('generatePonukaPdf: off-grid šírka → PDF grid-note „katalógový rozmer 2,5 × 1,5 m" (poradie š × v)', async () => {
		const cfg = oploteniePonukaConfig(
			konfigurujOplotenie({
				typ: 'diel',
				model: 'ARIEL',
				vyska: 1500,
				sirka: 2300,
				pocet: 1,
				farba: 'RAL 7016 ANTRACIT'
			})
		);
		const bytes = await generatePonukaPdf(cfg, { produkt: 'oplotenie', datum: '1. 1. 2026' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('katalógový rozmer 2,5 × 1,5 m');
	});
});

// DB round-trip: uložený oplotenie dopyt s reálnou cfg nesie OPEČIATKOVANÚ oplotenie cenu (cena_druh
// 'cena' + oplotenie cennik_verzia) a jeho re-download (regeneratePonukaPdf) reprodukuje PDF S cenou —
// celý tok submit → uloženie → re-download reprodukuje historickú cenu.
describe('#410 cena DB round-trip — oplotenie dopyt s cenou, re-download reprodukuje cenu', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('insert oplotenie dopyt (reálna cfg) → cena_druh=cena + oplotenie verzia → regen PDF s cenou', async () => {
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
		expect(row.cena_druh).toBe('cena');
		expect(row.cennik_verzia).toBe(CENNIK_VERZIA_OPLOTENIE);

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const doc = await PDFDocument.load(out!.bytes);
		expect(doc.getSubject() ?? '').toContain('Orientačná cena');
		expect(doc.getTitle() ?? '').toContain('oplotenia');
	});
});
