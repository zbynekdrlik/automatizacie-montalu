// 1:1 regresné vektory prenesené z n8n verzie (overené proti pôvodným
// odpisovým Excelom robust_slide.xlsm + živému E2E behu). Tieto čísla sú
// zmluva s Money — NIKDY ich nemeniť bez overenia proti reálnym odpisom.
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	computeFlat,
	computeMulti,
	safeComputeMulti,
	validSys,
	safeCompute,
	inBounds
} from '../src/lib/server/compute';
import type { PosuvSpec } from '../src/lib/server/compute';
import { jeSikmyRez } from '../src/lib/cut';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

const odpisByKod = (r: NonNullable<ReturnType<typeof computeFlat>>) => {
	const o: Record<string, number> = {};
	r.odpis.forEach((x) => (o[x.kod] = x.metre));
	return o;
};

describe('computeFlat — 1:1 s overenými odpismi (Excel ground truth)', () => {
	// tyče sa počítajú reálnym balením (FFD, mieša dĺžky na jednu tyč) — čísla
	// overené proti ručnému rozloženiu; nižšie než pôvodný súčet-po-dĺžkach
	const cases: [string, number, number, boolean, Record<string, number>, { sirka: number; vyska: number } | null][] = [
		['Robust|2K', 5000, 2000, false, { ZASP00014: 15, ZASP00002: 22.5, ZASP00010: 7.5 }, { sirka: 2374, vyska: 1795 }],
		['Robust|3K', 5000, 2150, false, { ZASP00016: 15, ZASP00002: 30, ZASP00010: 15 }, { sirka: 1563, vyska: 1945 }],
		// sklo zaokrúhlené na celé mm (Dominik) — pôvodné 1135.25 / 737.912
		['Robust|2x2K', 5000, 2100, false, { ZASP00014: 15, ZASP00002: 30, ZASP00010: 15, ZASP00006: 7.5 }, { sirka: 1135, vyska: 1895 }],
		['Robust|2x3K', 5000, 2200, false, { ZASP00016: 15, ZASP00002: 37.5, ZASP00010: 22.5, ZASP00006: 7.5 }, { sirka: 738, vyska: 1995 }],
		['Slide|2K', 3500, 2200, false, { ZASP00097: 15, ZASP00088: 22.5, ZASP202410: 7.5, ZASP00091: 22.5 }, null],
		['Slide|3K', 3500, 2001, false, { ZASP00100: 15, ZASP00088: 22.5, ZASP202410: 15 }, null],
		// sklo-závislé profily (Redukcia 6mm) sa pri redukciaZero=true nulujú
		['Slide|2K', 3500, 2200, true, { ZASP00091: 0 }, null],
		// živý E2E beh 2026-07-02 (TEST-AUDIT-9x7) — kotva na nasadené správanie
		['Robust|2K', 2509, 1930, false, { ZASP00014: 15, ZASP00002: 15, ZASP00010: 7.5 }, { sirka: 1129, vyska: 1725 }],
		// Robust 4K — nová koľajnica ZASP20254 (N=4). Sklo 1783×1795 potvrdzuje
		// offset 170.28 (Excel formula E14=(B6+170.28)/4).
		['Robust|4K', 7500, 2000, false, { ZASP20254: 22.5, ZASP00002: 45, ZASP00010: 15 }, { sirka: 1783, vyska: 1795 }],
		// Robust 2x4K (opona, N=8). Sklo 852×1995 = Excel 851,72×1995 zaokrúhlené →
		// offset 393.76 presný. Koľajnica/oponový/nosový = Excel počet tyčí (3/1/4);
		// rámový 52.5 (7 tyčí) = FFD optimalizácia vs Excel-ov naivný počet 8 (menej odpadu).
		['Robust|2x4K', 7500, 2200, false, { ZASP00002: 52.5, ZASP20254: 22.5, ZASP00006: 7.5, ZASP00010: 30 }, { sirka: 852, vyska: 1995 }]
	];

	it.each(cases)('%s %d×%d (redukciaZero=%s)', (sysStyl, S, V, rz, expOdpis, expSklo) => {
		const r = computeFlat(cfg, sysStyl, S, V, rz);
		expect(r).not.toBeNull();
		const got = odpisByKod(r!);
		for (const [kod, metre] of Object.entries(expOdpis)) expect(got[kod], kod).toBe(metre);
		if (expSklo) {
			expect(r!.sklo.sirka).toBe(expSklo.sirka);
			expect(r!.sklo.vyska).toBe(expSklo.vyska);
		}
	});

	it('neznámy systém/štýl vráti null', () => {
		expect(computeFlat(cfg, 'Slide|4K', 3000, 2000, false)).toBeNull();
	});

	// nález užívateľa 2026-07-02: rámový profil 4×2000 + 4×2530 sa má vyrezať
	// z 3 tyčí (2530+2530+2000 dvakrát + 2000+2000), nie 4 — reálne balenie FFD.
	// Robust|2K 5000×2000 dáva presne tento profil rezov na ZASP00002.
	it('rámový profil sa balí reálne (FFD) — 3 tyče, nie 4 (nález užívateľa)', () => {
		const r = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		const ram = r.material.find((m) => m.kod === 'ZASP00002')!;
		// rezy: 4× (5000+22)/2−4 = 2507 (šírka) + 4× 1930−0 = 1930 (výška)
		expect(ram.tyce).toBe(3);
		expect(r.odpis.find((o) => o.kod === 'ZASP00002')!.metre).toBe(22.5);
		// koľajnica 2× 5000 + 2× 2000 = 2 tyče (5000+2000 na jednu), nie 3
		expect(r.material.find((m) => m.kod === 'ZASP00014')!.tyce).toBe(2);
	});

	it('rozpis rezov na tyče — rozloženie kusov + odpad (pre grafický výstup)', () => {
		const r = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		const kolaj = r.material.find((m) => m.kod === 'ZASP00014')!;
		// 2 tyče, každá s 2 kusmi (5000 + 2000), zvyšok 500 mm na tyč
		expect(kolaj.bary.length).toBe(2);
		expect(kolaj.tyce).toBe(2);
		for (const tyc of kolaj.bary) {
			expect(tyc.kusy.length).toBe(2);
			const sucet = tyc.kusy.reduce((s, k) => s + k.dlzka, 0);
			// kusy + 4mm kotúč na každý rez sa musia zmestiť do tyče
			expect(sucet + 4 * tyc.kusy.length).toBeLessThanOrEqual(7500);
			expect(tyc.zvysok).toBeGreaterThanOrEqual(0);
			// zvyšok = tyč − kusy − rezy kotúčom
			expect(tyc.zvysok).toBeCloseTo(7500 - sucet - 4 * tyc.kusy.length, 6);
		}
		// odpad = 2 tyče × 7500 − spotreba; percento konzistentné
		expect(kolaj.odpadMm).toBeGreaterThan(0);
		expect(kolaj.odpadPct).toBeCloseTo((kolaj.odpadMm / (2 * 7500)) * 100, 1);
		// všetky kusy zo všetkých tyčí = pôvodný počet kusov (2×5000 + 2×2000)
		const vsetky = kolaj.bary.flatMap((b) => b.kusy);
		expect(vsetky.length).toBe(4);
	});

	it('počet skiel = N', () => {
		expect(computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!.sklo.pocet).toBe(2);
		expect(computeFlat(cfg, 'Robust|2x3K', 5000, 2200, false)!.sklo.pocet).toBe(6);
	});

	// Slide opona (2x2K/2x3K Slide) — odvodené z Robust opony na Slide profily.
	// Kľúč: má Redukciu 6mm (sklozavislé) navyše oproti Robust opone; oponový je
	// generický ZASP00006; koľajnica je Slide (ZASP00097/ZASP00100).
	it('Slide opona má správne profily + redukcia sa nuluje pri sklo bez redukcie', () => {
		const r = computeFlat(cfg, 'Slide|2x2K', 3500, 2200, false)!;
		const kods = r.odpis.map((o) => o.kod).sort();
		expect(kods).toEqual(['ZASP00006', 'ZASP00088', 'ZASP00091', 'ZASP00097', 'ZASP202410'].sort());
		expect(r.N).toBe(4);
		// oponový profil je prítomný (1 tyč)
		expect(r.odpis.find((o) => o.kod === 'ZASP00006')!.metre).toBe(7.5);
		// redukcia (sklozavislé) sa nuluje keď sklo nuluje redukciu (Slide 4/8/4 číre)
		const rz = computeFlat(cfg, 'Slide|2x2K', 3500, 2200, true)!;
		expect(rz.odpis.find((o) => o.kod === 'ZASP00091')!.metre).toBe(0);
		// 2x3K Slide používa koľajnicu 3K Slide (ZASP00100)
		expect(computeFlat(cfg, 'Slide|2x3K', 3500, 2100, false)!.odpis.some((o) => o.kod === 'ZASP00100')).toBe(true);
	});

	// Dominik: sklo objednávať na celé mm (904,578 → 905). Sklo nie je v Money odpise.
	it('rozmery skla sú vždy celé čísla (zaokrúhlené na mm)', () => {
		for (const [ss, S, V] of [
			['Robust|2x2K', 5000, 2100],
			['Robust|2x3K', 5000, 2200],
			['Robust|2K', 2509, 1930],
			['Slide|2K', 3500, 2200]
		] as [string, number, number][]) {
			const s = computeFlat(cfg, ss, S, V, false)!.sklo;
			expect(Number.isInteger(s.sirka), `${ss} sirka=${s.sirka}`).toBe(true);
			expect(Number.isInteger(s.vyska), `${ss} vyska=${s.vyska}`).toBe(true);
		}
	});
});

describe('Deluxe — per-profil dĺžka tyče (Money-kritické, všetkých 10 štýlov over. proti nárez. workbookom + LIVE Money 2026-07-09)', () => {
	// odpis = tyče × dĺžka tyče toho profilu. Kladka/klzný sú 3600mm články
	// (ZASP2024xx — staré ZASP000417/00066 boli neplatné/0-sklad), 5K horná
	// koľajnica 6000mm, zvyšok 7500. Prírez: 2K (S-26)/2+12, 3K …/3+12, 4K …/4+12,
	// 2x* (S-26-9.5)/N+off, 5K (S+52)/5, 6K (S+65)/6; dorazové V-53 (malé)/V-10 (5K,6K).
	// Excel bol nekonzistentný (odpis hárok fakturoval ×7.5 starým kódom) — appka
	// ráta AJ fakturuje na skutočnú dĺžku článku. Sklo nie je v Money (len plán).
	const cases: [string, number, number, Record<string, number>, { sirka: number; vyska: number }][] = [
		['Deluxe|2K', 5000, 2000, { ZASP00078: 7.5, ZASP00104: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 2498, vyska: 1914 }],
		['Deluxe|3K', 3500, 2100, { ZASP00081: 7.5, ZASP00030: 7.5, ZASP202417: 3.6, ZASP202425: 3.6, ZASP00021: 7.5 }, { sirka: 1168, vyska: 2014 }],
		['Deluxe|4K', 6000, 2300, { ZASP00084: 7.5, ZASP00033: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 1504, vyska: 2214 }],
		// 2x3K = dvojité 3K → spodná koľajnica je 3K (ZASP00030), nie 2K; workbook mal
		// preklep ZASP00104 (over. proti Money 2026-07-09 + 3K single). Množstvo rovnaké.
		['Deluxe|2x3K', 6000, 2200, { ZASP00081: 7.5, ZASP00030: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 1005, vyska: 2114 }],
		// 2x2K prírez = (S-35.5)/4+11 = 0.25·S+2.125; 2x4K = (S-35.5)/8+12 = 0.125·S+7.5625
		// (workbook F43 — iná konštanta než jednoduché 2K/4K, preto pinnuté samostatne)
		['Deluxe|2x2K', 4000, 2200, { ZASP00078: 7.5, ZASP00104: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 1001, vyska: 2114 }],
		['Deluxe|2x4K', 6400, 2400, { ZASP00084: 7.5, ZASP00033: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 806, vyska: 2314 }],
		// 5K: horná koľajnica 6000mm (× 6.0), spodná 7500 (× 7.5); kladka/klzný 3600
		['Deluxe|5K10', 4500, 2400, { ZASP202434: 6.0, ZASP202432: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 908, vyska: 2318 }],
		// 5K6 = tá istá geometria, iba 6mm kladka/klzný (ZASP202416/424)
		['Deluxe|5K6', 4500, 2400, { ZASP202434: 6.0, ZASP202432: 7.5, ZASP202416: 7.2, ZASP202424: 7.2, ZASP00021: 7.5 }, { sirka: 908, vyska: 2318 }],
		['Deluxe|6K6', 5000, 2500, { ZASP202411: 7.5, ZASP202437: 7.5, ZASP202416: 7.2, ZASP202424: 7.2, ZASP00021: 7.5 }, { sirka: 842, vyska: 2418 }],
		['Deluxe|6K10', 5000, 2500, { ZASP202411: 7.5, ZASP202437: 7.5, ZASP202417: 7.2, ZASP202425: 7.2, ZASP00021: 7.5 }, { sirka: 842, vyska: 2418 }]
	];
	it.each(cases)('%s %d×%d', (sysStyl, S, V, expOdpis, expSklo) => {
		const r = computeFlat(cfg, sysStyl, S, V, false);
		expect(r).not.toBeNull();
		const got = odpisByKod(r!);
		// presne 5 profilov v odpise (2 koľajnice + kladka + klzný + dorazové)
		expect(r!.odpis.length, sysStyl).toBe(5);
		for (const [kod, metre] of Object.entries(expOdpis)) expect(got[kod], `${sysStyl} ${kod}`).toBe(metre);
		expect(r!.sklo.sirka, `${sysStyl} sklo.sirka`).toBe(expSklo.sirka);
		expect(r!.sklo.vyska, `${sysStyl} sklo.vyska`).toBe(expSklo.vyska);
	});

	it('kladka/klzný sa počíta na 3600mm tyč, nie 7500 (odpis × 3.6 na tyč)', () => {
		const r = computeFlat(cfg, 'Deluxe|2K', 5000, 2000, false)!;
		const kladka = r.material.find((m) => m.kod === 'ZASP202417')!;
		// 2 kusy 2499mm, každý na vlastnú 3600mm tyč (2×2503 > 3600) → 2 tyče × 3.6
		expect(kladka.tyce).toBe(2);
		expect(r.odpis.find((o) => o.kod === 'ZASP202417')!.metre).toBe(7.2);
		// zvyšok na tyči = 3600 − 2499 − 4(kotúč) = 1097 → dôkaz, že sa balí na 3600, nie 7500
		for (const t of kladka.bary) expect(t.zvysok).toBeCloseTo(3600 - 2499 - 4, 6);
	});

	it('5K horná koľajnica je 6000mm tyč (× 6.0), spodná 7500 (× 7.5)', () => {
		const r = computeFlat(cfg, 'Deluxe|5K10', 4500, 2400, false)!;
		expect(r.odpis.find((o) => o.kod === 'ZASP202434')!.metre).toBe(6.0);
		expect(r.odpis.find((o) => o.kod === 'ZASP202432')!.metre).toBe(7.5);
	});

	it('Robust/Slide ostávajú na 7500mm tyč (default dlzkaTyce) — žiadna regresia', () => {
		const r = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		const kolaj = r.material.find((m) => m.kod === 'ZASP00014')!;
		for (const t of kolaj.bary) {
			const spotreba = t.kusy.reduce((s, k) => s + k.dlzka, 0) + 4 * t.kusy.length;
			expect(t.zvysok).toBeCloseTo(7500 - spotreba, 6);
		}
	});

	it('všetkých 10 Deluxe štýlov je platných a počíta 5 profilov bez chyby', () => {
		for (const st of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K6', '5K10', '6K6', '6K10']) {
			const ss = 'Deluxe|' + st;
			expect(validSys(cfg, ss), ss).toBe(true);
			const { r, err } = safeCompute(cfg, ss, 4000, 2200, false);
			expect(err, ss).toBeNull();
			expect(r!.odpis.length, ss).toBe(5);
			expect(r!.odpis.every((o) => Number.isFinite(o.metre) && o.metre > 0), ss).toBe(true);
			expect(r!.sklo.pocet, ss).toBe(r!.N);
		}
	});

	it('rez dlhší než tyč (5K šírka > 6000mm horná koľajnica) zlyhá — Money sa NEpodhodnotí', () => {
		// 5K horná koľajnica ZASP202434 je 6000mm tyč; šírka 6100 → rez 6100 mm sa
		// fyzicky nedá vyrobiť. Bez guardu by FFD „zabalil" 6100 na 1 tyč (záporný
		// odpad) a odpis by bol 6.0 namiesto ~12.0 → podhodnotenie do Money.
		const { r, err } = safeCompute(cfg, 'Deluxe|5K10', 6100, 2400, false);
		expect(r).toBeNull();
		expect(err).toMatch(/dlhší než tyč/);
		// bežná šírka 5900 (< 6000) prejde bez chyby
		expect(safeCompute(cfg, 'Deluxe|5K10', 5900, 2400, false).err).toBeNull();
		// aj cez computeMulti (zimná záhrada) sa oversize posuv odmietne
		expect(safeComputeMulti(cfg, [{ sysStyl: 'Deluxe|5K10', S: 6100, V: 2400, redukciaZero: false }]).err).toMatch(
			/dlhší než tyč/
		);
	});

	it('MaterialRow nesie per-profil dĺžku tyče (pre grafický rozpis) — nie natvrdo 7500', () => {
		const r = computeFlat(cfg, 'Deluxe|5K10', 4500, 2400, false)!;
		const bar = (kod: string) => r.material.find((m) => m.kod === kod)!.barLen;
		expect(bar('ZASP202434')).toBe(6000); // 5K horná koľajnica
		expect(bar('ZASP202417')).toBe(3600); // kladka 10mm
		expect(bar('ZASP202432')).toBe(7500); // 5K spodná koľajnica
		const rr = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		expect(rr.material[0].barLen).toBe(7500); // Robust ostáva 7500
	});

	it('dlzkaTyce mimo rozsahu (preklep 600 namiesto 6000) je odmietnutá inBounds — Money guard', () => {
		const bad = seed.rez.map((r) => ({ ...r })) as RezRow[];
		const row = bad.find((r) => r.sysStyl === 'Deluxe|5K10' && r.kod === 'ZASP202434')!;
		row.dlzkaTyce = 600; // preklep: malo byť 6000
		const badCfg = buildCFG(seed.sys as SysRow[], bad);
		expect(inBounds(badCfg, 'Deluxe|5K10')).toMatch(/Dĺžka tyče/);
		expect(safeCompute(badCfg, 'Deluxe|5K10', 4500, 2400, false).err).toMatch(/mimo povolených rozsahov/);
	});
});

describe('computeMulti — viac posuvov, zdieľané tyče (zimná záhrada)', () => {
	const P = (S: number, V: number, sysStyl = 'Robust|2K'): PosuvSpec => ({
		sysStyl,
		S,
		V,
		redukciaZero: false
	});

	it('JEDEN posuv dáva IDENTICKÝ odpis a tyče ako computeFlat (Money nezmenené)', () => {
		for (const [ss, S, V] of [
			['Robust|2K', 5000, 2000],
			['Robust|2x3K', 5000, 2200],
			['Slide|3K', 3500, 2001],
			// Deluxe: per-profil dĺžka tyče (kladka 3600) musí prejsť aj cez computeMulti
			['Deluxe|5K10', 4500, 2400],
			['Deluxe|2K', 5000, 2000]
		] as [string, number, number][]) {
			const flat = computeFlat(cfg, ss, S, V, false)!;
			const multi = computeMulti(cfg, [P(S, V, ss)])!;
			// odpis (Money) musí byť bit-identický
			expect(multi.odpis).toEqual(flat.odpis);
			// materiál: rovnaké kódy a rovnaký počet tyčí
			expect(multi.material.map((m) => [m.kod, m.tyce])).toEqual(
				flat.material.map((m) => [m.kod, m.tyce])
			);
		}
	});

	it('3 rovnaké posuvy: spoločné balenie ušetrí tyče vs 3× samostatne', () => {
		const single = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		const multi = computeMulti(cfg, [P(5000, 2000), P(5000, 2000), P(5000, 2000)])!;

		let usporilo = false;
		for (const m of multi.material) {
			const s = single.material.find((x) => x.kod === m.kod)!;
			// spoločné tyče ≤ 3× samostatné (nikdy horšie)
			expect(m.tyce, m.kod).toBeLessThanOrEqual(s.tyce * 3);
			// spolu je toľko kusov, koľko 3× jeden posuv
			const kusovMulti = m.bary.reduce((a, b) => a + b.kusy.length, 0);
			const kusovSingle = s.bary.reduce((a, b) => a + b.kusy.length, 0);
			expect(kusovMulti, m.kod).toBe(kusovSingle * 3);
			if (m.tyce < s.tyce * 3) usporilo = true;
		}
		// aspoň jeden profil sa reálne zoptimalizoval (menej tyčí)
		expect(usporilo, 'žiadna úspora tyčí naprieč posuvmi').toBe(true);
		// spolu menší odpis do Money než 3 samostatné objednávky
		const multiM = multi.odpis.reduce((a, o) => a + o.metre, 0);
		const singleM = single.odpis.reduce((a, o) => a + o.metre, 0) * 3;
		expect(multiM).toBeLessThan(singleM);
	});

	it('každý kus nesie správne číslo posuvu (1..N) pre rozpis', () => {
		const multi = computeMulti(cfg, [P(5000, 2000), P(5000, 2000), P(2509, 1930)])!;
		for (const m of multi.material) {
			const posuvy = new Set<number>();
			let pocet1 = 0;
			for (const b of m.bary)
				for (const k of b.kusy) {
					expect(k.posuv, m.kod).toBeGreaterThanOrEqual(1);
					expect(k.posuv, m.kod).toBeLessThanOrEqual(3);
					posuvy.add(k.posuv!);
					if (k.posuv === 1) pocet1++;
				}
			// posuv 1 a 2 sú rovnaké (5000×2000) → majú rovnaký počet kusov tohto profilu
			const pocet2 = m.bary.flatMap((b) => b.kusy).filter((k) => k.posuv === 2).length;
			expect(pocet1, m.kod).toBe(pocet2);
		}
	});

	it('rôzne systémy sa nemiešajú na jednu tyč (iné kódy profilov)', () => {
		// Robust|2K (ZASP00002…) + Slide|3K (ZASP00088…) — žiadny zdieľaný kód
		const multi = computeMulti(cfg, [P(5000, 2000, 'Robust|2K'), P(3500, 2001, 'Slide|3K')])!;
		for (const m of multi.material) {
			const sys = new Set(m.bary.flatMap((b) => b.kusy).map((k) => k.posuv));
			// každý profil-kód patrí len jednému posuvu (systémy sa nezdieľajú)
			expect(sys.size, m.kod).toBe(1);
		}
	});

	it('safeComputeMulti odmietne neznámy systém posuvu', () => {
		const { r, err } = safeComputeMulti(cfg, [{ sysStyl: 'Slide|4K', S: 3000, V: 2000, redukciaZero: false }]);
		expect(r).toBeNull();
		expect(err).toContain('Posuv 1');
	});

	it('prázdny zoznam posuvov', () => {
		expect(computeMulti(cfg, [])).toBeNull();
		const { r, err } = safeComputeMulti(cfg, []);
		expect(r).toBeNull();
		expect(err).toContain('aspoň jeden posuv');
	});

	it('computeMulti s neznámym systémom vráti null', () => {
		expect(computeMulti(cfg, [P(3000, 2000, 'Slide|4K')])).toBeNull();
	});

	it('safeComputeMulti: druhý posuv mimo rozsahu vzorcov', () => {
		// prvý OK, druhý neznámy systém → chyba viazaná na Posuv 2
		const { r, err } = safeComputeMulti(cfg, [P(5000, 2000), P(3000, 2000, 'Robust|2x9K')]);
		expect(r).toBeNull();
		expect(err).toContain('Posuv 2');
	});
});

describe('jeSikmyRez — nosový a oponový profil sa režú rovno (90°), zvyšok 45°', () => {
	// Dominik: „oponový profil sa reže na 90 stupňov ako nosový u oboch systémov"
	it.each([
		['Nosový profil Surový 7500 mm', false],
		['Nosový profil Slide Surový 7500 mm', false],
		['Oponový profil Surový 7500 mm', false],
		['Rámový profil Surový 7500 mm', true],
		['Rámový profil Slide Surový 7500 mm', true],
		['Koľajnica 2K Surový 7500 mm', true],
		['Redukcia 6mm Surový 7500 mm', true]
	])('%s → šikmý=%s', (nazov, sikmy) => {
		expect(jeSikmyRez(nazov)).toBe(sikmy);
	});
});

describe('validSys — ochrana proti poškodenej konfigurácii', () => {
	it('platná konfigurácia prejde', () => {
		expect(validSys(cfg, 'Robust|2K')).toBe(true);
	});

	it('null offset neprejde (Number(null)=0 pasca)', () => {
		const badRez = (seed.rez as RezRow[]).map((r) =>
			r.sysStyl === 'Robust|2K' && r.poradie === 20 ? { ...r, offset: null as unknown as number } : r
		);
		const bad = buildCFG(seed.sys as SysRow[], badRez);
		expect(validSys(bad, 'Robust|2K')).toBe(false);
		expect(validSys(bad, 'Robust|3K')).toBe(true); // ostatné štýly nedotknuté
	});

	it('chýbajúci sklo riadok neprejde', () => {
		const noGlass = (seed.rez as RezRow[]).filter(
			(r) => !(r.sysStyl === 'Robust|2K' && r.typ === 'sklo' && r.dim === 'S')
		);
		expect(validSys(buildCFG(seed.sys as SysRow[], noGlass), 'Robust|2K')).toBe(false);
	});

	it('neznámy sysStyl neprejde', () => {
		expect(validSys(cfg, 'Slide|4K')).toBe(false);
	});
});

describe('safeCompute — žiadny tichý fallback, chyba sa hlási', () => {
	it('platný config počíta z tabuľky', () => {
		const { r, err } = safeCompute(cfg, 'Robust|2K', 5000, 2000, false);
		expect(err).toBeNull();
		expect(r!.odpis.find((o) => o.kod === 'ZASP00014')!.metre).toBe(15);
	});

	it('poškodený config vráti chybu, nie čísla', () => {
		const badRez = (seed.rez as RezRow[]).map((r) =>
			r.sysStyl === 'Robust|2K' ? { ...r, offset: NaN } : r
		);
		const { r, err } = safeCompute(buildCFG(seed.sys as SysRow[], badRez), 'Robust|2K', 5000, 2000, false);
		expect(r).toBeNull();
		expect(err).toBeTruthy();
	});

	it('offset mimo rozsahu (preklep 2200 namiesto 22) vráti chybu', () => {
		const typoRez = (seed.rez as RezRow[]).map((r) =>
			r.sysStyl === 'Robust|2K' && r.poradie === 20 ? { ...r, offset: 2200 } : r
		);
		const typo = buildCFG(seed.sys as SysRow[], typoRez);
		expect(inBounds(typo, 'Robust|2K')).toBeTruthy();
		const { r, err } = safeCompute(typo, 'Robust|2K', 5000, 2000, false);
		expect(r).toBeNull();
		expect(err).toContain('rozsah');
	});
});
