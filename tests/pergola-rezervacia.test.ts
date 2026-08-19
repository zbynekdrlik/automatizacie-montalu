// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221): mapovanie rozpis → Money odpis.
// Overuje, že:
//  1. do odpisu idú LEN potvrdené položky s istou dĺžkou rezu; honest-null (napr.
//     priečka 18004 = HH krovu #161) sa čestne VYNECHAJÚ (nikdy tiché číslo),
//  2. rezervácia prechádza tým istým na Money pároch overeným `transformRows`
//     jadrom → PRP metre sú bit-presne ako CAD odpis pre tie isté rezy,
//  3. rezervačný `OdpisJob` je označený (modul='pergola' zdieľaný dedup,
//     rezervacia:true, doklad „REZ", detail nesie rozmery + vylúčené kódy),
//  4. názov súboru dostane marker „REZ" (párovateľnosť pre #227).
import { describe, it, expect } from 'vitest';
import {
	narezToCadRows,
	vylucenePolozky,
	buildRezervaciaRozpis,
	rezervaciaJob
} from '../src/lib/server/pergola-rezervacia';
import {
	spocitajNarez,
	PREDNA_SVETLOST_STD,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';
import { filenameFor } from '../src/lib/server/money';

// štandardná pergola z callu: Robust, na stenu, zasklená (default svelte formulára)
const STD: PergolaNarezVstup = {
	system: 'Robust',
	sirka: 5000,
	hlbka: 3500,
	prednaSvetlost: PREDNA_SVETLOST_STD, // 2200
	vyskaZadna: 2900,
	pocetPrednychNoh: 4,
	uchytenie: 'stena',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: false,
	sklonStrechy: null,
	jednoduchaBezZasklenia: false,
	vystuhaProfil: null,
	zvodFrezovat: false,
	zvodFrezovanieSHmm: null,
	strechaSklo: '',
	obvodoveZasklenie: ''
};

const IDENT = { zak: 'ZAK2026999', op: 'OP260999', zakaznik: 'E2E Test' };

describe('narezToCadRows — honest-null vylúčenie', () => {
	it('priečka 18004 (dĺžka = HH krovu, null) sa NEDOSTANE do CadRows', () => {
		const rows = narezToCadRows(spocitajNarez(STD));
		expect(rows.some((r) => r.code === '18004')).toBe(false);
		// ale potvrdené profily áno (predná noha 18013, žľab 18021, kotviaci 18019, 110x43)
		const kody = new Set(rows.map((r) => r.code));
		expect(kody.has('18013')).toBe(true); // predná noha (Robust stĺp)
		expect(kody.has('18021')).toBe(true); // žľab
		expect(kody.has('18019')).toBe(true); // kotviaci
		expect(kody.has('18016')).toBe(true); // bočný 110x43
	});

	it('každý CadRow má istú (číselnú, kladnú) dĺžku rezu — žiadny null/0', () => {
		const rows = narezToCadRows(spocitajNarez(STD));
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(typeof r.cut_mm).toBe('number');
			expect(r.cut_mm).toBeGreaterThan(0);
			expect(r.qty).toBeGreaterThan(0);
		}
	});

	it('predná noha = svetlosť + 15 (2215), 4 ks — overený vektor ZAK2026302', () => {
		const rows = narezToCadRows(spocitajNarez(STD));
		const noha = rows.find((r) => r.code === '18013' && r.name.includes('predná noha'));
		expect(noha).toBeDefined();
		expect(noha!.cut_mm).toBe(2215);
		expect(noha!.qty).toBe(4);
	});
});

describe('vylucenePolozky — „zatiaľ nepočítané"', () => {
	it('honest-null priečka je vo vylúčených s dôvodom, nie v odpise', () => {
		const vyl = vylucenePolozky(spocitajNarez(STD));
		const priecka = vyl.find((v) => v.kod === '18004');
		expect(priecka).toBeDefined();
		expect(priecka!.dovod.length).toBeGreaterThan(0);
	});
});

describe('buildRezervaciaRozpis — Money PRP metre (cez overený transformRows)', () => {
	it('štandardná pergola: PRP metre sedia s bin-packingom (1:1 ako CAD odpis)', () => {
		const { rozpis, error } = buildRezervaciaRozpis(STD, IDENT);
		expect(error).toBeNull();
		expect(rozpis).not.toBeNull();
		const q = Object.fromEntries(rozpis!.nonzero.map((o) => [o.kod, o.qty]));
		// 18013 (110x110) — 4×2215 do 7,5 m tyčí = 2 tyče = 15 m
		expect(q['PRP20242']).toBe(15);
		// 18021 žľab 5000 → 6 m tyč
		expect(q['PRP202525']).toBe(6);
		// 18019 kotviaci 5000 → 6 m tyč
		expect(q['PRP20259']).toBe(6);
		// 18016 110x43 (2×3347 + 2×2710) do 7,5 m = 2 tyče = 15 m
		expect(q['PRP202410']).toBe(15);
	});

	it('priečka NIE JE v Money odpise (žiadne tiché číslo za honest-null)', () => {
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT);
		// katalóg priečky = PRP00044 (105 surový 7500) — nesmie mať nenulové množstvo
		const priecka = rozpis!.nonzero.find((o) => o.kod === 'PRP00044');
		expect(priecka).toBeUndefined();
		// a je vidieť ako „zatiaľ nepočítané"
		expect(rozpis!.vylucene.some((v) => v.kod === '18004')).toBe(true);
	});

	it('polozky = všetkých 25 katalógových riadkov (aj nulové), ako CAD/bazén', () => {
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT);
		expect(rozpis!.polozky.length).toBe(25);
		expect(rozpis!.polozky.every((p) => p.qty >= 0)).toBe(true);
	});

	it('chýbajúci ZAK/OP/zákazník = chyba, nie tichý prázdny odpis', () => {
		expect(buildRezervaciaRozpis(STD, { ...IDENT, zak: '' }).error).toMatch(/ZAK/);
		expect(buildRezervaciaRozpis(STD, { ...IDENT, op: '' }).error).toMatch(/OP/);
		expect(buildRezervaciaRozpis(STD, { ...IDENT, zakaznik: '' }).error).toMatch(/zákazník/i);
	});
});

describe('rezervaciaJob + filenameFor — označenie rezervácie (párovateľnosť #227)', () => {
	it('job je označený ako rezervácia a nekoliduje s dedup zmenou', () => {
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT);
		const job = rezervaciaJob(STD, IDENT, rozpis!, 'tester');
		expect(job.modul).toBe('pergola'); // zdieľaný dedup s CAD odpisom
		expect(job.rezervacia).toBe(true);
		expect(job.caka).toBe(false); // rezervuje TERAZ, nie do čaká-priečinka
		expect(job.popis.startsWith('REZ ')).toBe(true); // doklad označený
		// detail nesie podklad na napárovanie (#227)
		expect(job.detail.rezervacia).toBe(true);
		expect(job.detail.sirka).toBe(5000);
		expect(Array.isArray(job.detail.vylucene)).toBe(true);
		expect((job.detail.vylucene as string[]).includes('18004')).toBe(true);
	});

	it('názov súboru nesie marker „REZ" (a beze zmeny pri bežnom odpise)', () => {
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT);
		const job = rezervaciaJob(STD, IDENT, rozpis!, 'tester');
		const meno = filenameFor(job);
		expect(meno).toMatch(/ZAK2026999 - E2E Test REZ \[[0-9a-f]{8}\]\.xlsx/);
		// bežný odpis (bez rezervacia) marker NEMÁ — spätná kompatibilita
		const bezRez = filenameFor({ ...job, rezervacia: false });
		expect(bezRez).not.toContain('REZ');
		expect(bezRez).toMatch(/ZAK2026999 - E2E Test \[[0-9a-f]{8}\]\.xlsx/);
	});
});
