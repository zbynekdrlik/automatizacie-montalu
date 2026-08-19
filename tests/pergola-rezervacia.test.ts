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

// #234 — ručné („pometrané") položky: merge so spočítanými, MJ, validácia, golden xlsx tvar
describe('buildRezervaciaRozpis — ručné položky (#234)', () => {
	it('ručný riadok sa pridá do nonzero SPOLU so spočítanými, s odznakom rucne + MJ', () => {
		const rucne = [
			{ kod: 'PRP20259', nazov: 'Kotviaci profil ručne', mnozstvo: 3, mj: 'm' as const }
		];
		const { rozpis, error } = buildRezervaciaRozpis(STD, IDENT, rucne);
		expect(error).toBeNull();
		// spočítané ostávajú
		expect(rozpis!.nonzero.some((o) => o.kod === 'PRP20242' && !o.rucne)).toBe(true);
		// ručný riadok pribudol, označený rucne=true, MJ nesie
		const r = rozpis!.nonzero.find((o) => o.rucne);
		expect(r).toBeDefined();
		expect(r).toMatchObject({ kod: 'PRP20259', nazov: 'Kotviaci profil ručne', qty: 3, mj: 'm' });
		// je aj v polozky (ide do xlsx) so svojou MJ
		expect(rozpis!.polozky.some((p) => p.nazov === 'Kotviaci profil ručne' && p.mj === 'm')).toBe(
			true
		);
	});

	it('kusová ručná položka (MJ=ks) prejde s ks, nie s vymyslenou m', () => {
		const rucne = [{ kod: 'ZASK9', nazov: 'Kľučka FAB', mnozstvo: 4, mj: 'ks' as const }];
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT, rucne);
		const p = rozpis!.polozky.find((x) => x.nazov === 'Kľučka FAB');
		expect(p).toMatchObject({ kod: 'ZASK9', qty: 4, mj: 'ks' });
	});

	it('neznámy kód = VAROVANIE (nie tiché prijatie, nie odmietnutie); riadok sa aj tak zahrnie', () => {
		const rucne = [{ kod: 'NEZNAMY123', nazov: 'X', mnozstvo: 2, mj: 'm' as const }];
		const { rozpis, error } = buildRezervaciaRozpis(STD, IDENT, rucne);
		expect(error).toBeNull(); // neodmietnuté
		expect(rozpis!.manualWarnings.length).toBe(1);
		expect(rozpis!.manualWarnings[0]).toMatch(/NEZNAMY123/);
		expect(rozpis!.nonzero.some((o) => o.kod === 'NEZNAMY123' && o.rucne)).toBe(true);
	});

	it('známy katalógový kód → žiadne varovanie', () => {
		const rucne = [{ kod: 'PRP20259', nazov: 'Kotviaci', mnozstvo: 6, mj: 'm' as const }];
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT, rucne);
		expect(rozpis!.manualWarnings).toEqual([]);
	});

	it('prázdny/nulový ručný riadok sa NEZAHRNIE (množstvo <= 0)', () => {
		const rucne = [{ kod: 'PRP20259', nazov: 'X', mnozstvo: 0, mj: 'm' as const }];
		const { rozpis } = buildRezervaciaRozpis(STD, IDENT, rucne);
		expect(rozpis!.nonzero.some((o) => o.rucne)).toBe(false);
	});

	it('pocetPolozok zahŕňa ručné riadky (2 ručné → +2)', () => {
		const bez = buildRezervaciaRozpis(STD, IDENT).rozpis!.pocetPolozok;
		const rucne = [
			{ kod: 'PRP20259', nazov: 'A', mnozstvo: 1, mj: 'm' as const },
			{ kod: 'ZASK1', nazov: 'B', mnozstvo: 2, mj: 'ks' as const }
		];
		const s = buildRezervaciaRozpis(STD, IDENT, rucne).rozpis!.pocetPolozok;
		expect(s).toBe(bez + 2);
	});

	it('GOLDEN xlsx tvar ručného riadku: [ZAK, kód, názov, qty, MJ] priamo z buffra (bez DB/zápisu)', async () => {
		const ExcelJS = (await import('exceljs')).default;
		const { buildXlsx } = await import('../src/lib/server/money');

		const rucne = [
			{ kod: 'ZASK-KLUCKA', nazov: 'Kľučka FAB pravá', mnozstvo: 4, mj: 'ks' as const }
		];
		const { rozpis } = buildRezervaciaRozpis(STD, { ...IDENT, zak: 'ZAK-G-1' }, rucne);
		const job = rezervaciaJob(STD, { ...IDENT, zak: 'ZAK-G-1' }, rozpis!, 'vitest');

		const buf = await buildXlsx(job);
		const wb = new ExcelJS.Workbook();
		// ArrayBuffer (nie Node Buffer) — obíde generic Buffer<ArrayBufferLike> mismatch v typoch
		await wb.xlsx.load(new Uint8Array(buf).buffer);
		const ws = wb.worksheets[0];
		// hlavička = 6 stĺpcov (číslo zakázky, Kód, Název, Množství v m, MJ, Popis dokladu)
		expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
			'číslo zakázky',
			'Kód položky',
			'Název položky',
			'Množství v m',
			'MJ',
			'Popis dokladu'
		]);
		// nájdi riadok ručnej položky a over presný tvar bunky [zak, kód, názov, qty, MJ]
		let found: unknown[] | null = null;
		ws.eachRow((row) => {
			const v = (row.values as unknown[]).slice(1);
			if (v[1] === 'ZASK-KLUCKA') found = v;
		});
		expect(found).not.toBeNull();
		expect(found![0]).toBe('ZAK-G-1'); // číslo zakázky
		expect(found![1]).toBe('ZASK-KLUCKA'); // Money kód
		expect(found![2]).toBe('Kľučka FAB pravá'); // názov
		expect(found![3]).toBe(4); // množstvo
		expect(found![4]).toBe('ks'); // MJ — kusová, NIE vymyslené 'm'
	});
});
