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
	inBounds,
	missingHrubkaProfile
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

describe('Deluxe — hrúbka skla vyberá kladka/klzný profil (Money-kritické, 8 štýlov over. proti nárez. workbookom + LIVE Money 2026-07-10)', () => {
	// Dominik 2026-07-10: 6/10 NIE je štýl — je to vlastnosť SKLA. Každý z 8 štýlov
	// (2K…6K) má dvojicu kladka/klzný pre 6mm (ZASP202416/424) aj 10mm (ZASP202417/425);
	// zvolené sklo (Float kalené 6/10) vyberie tú správnu. Množstvo (metre) je pre 6 aj
	// 10 IDENTICKÉ — mení sa LEN Money kód, aby nárezáky neboli duplicitné. odpis = tyče
	// × dĺžka tyče: kladka/klzný 3600mm, 5K horná koľajnica 6000mm, zvyšok 7500. Sklo nie
	// je v Money (len plán). Prírez a koľajnice over. proti workbookom + LIVE Money 2026-07-10.
	// [styl, S, V, {koľajnice+dorazové: metre}, kladkaKlznyMetre, {sklo}]
	const cases: [string, number, number, Record<string, number>, number, { sirka: number; vyska: number }][] = [
		['Deluxe|2K', 5000, 2000, { ZASP00078: 7.5, ZASP00104: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 2498, vyska: 1914 }],
		['Deluxe|3K', 3500, 2100, { ZASP00081: 7.5, ZASP00030: 7.5, ZASP00021: 7.5 }, 3.6, { sirka: 1168, vyska: 2014 }],
		['Deluxe|4K', 6000, 2300, { ZASP00084: 7.5, ZASP00033: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 1504, vyska: 2214 }],
		// 2x3K = dvojité 3K → spodná koľajnica 3K (ZASP00030); workbook mal preklep ZASP00104
		['Deluxe|2x3K', 6000, 2200, { ZASP00081: 7.5, ZASP00030: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 1005, vyska: 2114 }],
		// 2x2K prírez = (S-35.5)/4+11 = 0.25·S+2.125; 2x4K = (S-35.5)/8+12 = 0.125·S+7.5625
		['Deluxe|2x2K', 4000, 2200, { ZASP00078: 7.5, ZASP00104: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 1001, vyska: 2114 }],
		['Deluxe|2x4K', 6400, 2400, { ZASP00084: 7.5, ZASP00033: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 806, vyska: 2314 }],
		// 5K: horná koľajnica 6000mm (× 6.0), spodná 7500 (× 7.5); kladka/klzný 3600
		['Deluxe|5K', 4500, 2400, { ZASP202434: 6.0, ZASP202432: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 908, vyska: 2318 }],
		['Deluxe|6K', 5000, 2500, { ZASP202411: 7.5, ZASP202437: 7.5, ZASP00021: 7.5 }, 7.2, { sirka: 842, vyska: 2418 }]
	];
	// hrúbka skla → [kladka kód, klzný kód]
	const profilPreHrubku: Record<number, [string, string]> = {
		6: ['ZASP202416', 'ZASP202424'],
		10: ['ZASP202417', 'ZASP202425']
	};
	for (const [sysStyl, S, V, expFixed, kladkaMetre, expSklo] of cases) {
		for (const hrubka of [6, 10] as const) {
			it(`${sysStyl} ${S}×${V} · sklo ${hrubka}mm`, () => {
				const r = computeFlat(cfg, sysStyl, S, V, false, hrubka);
				expect(r).not.toBeNull();
				const got = odpisByKod(r!);
				const [kladka, klzny] = profilPreHrubku[hrubka];
				const [inyKladka, inyKlzny] = profilPreHrubku[hrubka === 6 ? 10 : 6];
				// presne 5 profilov: 2 koľajnice + kladka + klzný + dorazové
				expect(r!.odpis.length, sysStyl).toBe(5);
				// koľajnice + dorazové sú rovnaké pre obe hrúbky
				for (const [kod, metre] of Object.entries(expFixed)) expect(got[kod], `${sysStyl} ${kod}`).toBe(metre);
				// zvolená hrúbka → JEJ kladka/klzný s daným množstvom
				expect(got[kladka], `${sysStyl} ${kladka}`).toBe(kladkaMetre);
				expect(got[klzny], `${sysStyl} ${klzny}`).toBe(kladkaMetre);
				// NIKDY profil druhej hrúbky (nárezák nesmie byť duplicitný pre 6/10)
				expect(got[inyKladka], `${sysStyl} nesmie mať ${inyKladka}`).toBeUndefined();
				expect(got[inyKlzny], `${sysStyl} nesmie mať ${inyKlzny}`).toBeUndefined();
				// sklo (len plán) je rovnaké pre obe hrúbky
				expect(r!.sklo.sirka, `${sysStyl} sklo.sirka`).toBe(expSklo.sirka);
				expect(r!.sklo.vyska, `${sysStyl} sklo.vyska`).toBe(expSklo.vyska);
			});
		}
	}

	it('6mm a 10mm sklo dávajú ROVNAKÉ množstvo, líši sa LEN Money kód (Dominik)', () => {
		// jadro požiadavky: nárezáky nesmú byť duplicitné pre 6/10 — metre identické
		for (const st of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K', '6K']) {
			const r6 = computeFlat(cfg, 'Deluxe|' + st, 4000, 2200, false, 6)!;
			const r10 = computeFlat(cfg, 'Deluxe|' + st, 4000, 2200, false, 10)!;
			const kl6 = r6.odpis.find((o) => o.kod === 'ZASP202416');
			const kl10 = r10.odpis.find((o) => o.kod === 'ZASP202417');
			expect(kl6, st + ' 6mm kladka').toBeDefined();
			expect(kl10, st + ' 10mm kladka').toBeDefined();
			expect(kl6!.metre, st + ' rovnaké množstvo kladka 6 vs 10').toBe(kl10!.metre);
			// klzný tiež — 6mm ZASP202424 == 10mm ZASP202425
			expect(r6.odpis.find((o) => o.kod === 'ZASP202424')!.metre).toBe(
				r10.odpis.find((o) => o.kod === 'ZASP202425')!.metre
			);
		}
	});

	it('Deluxe sa reže na 90° (rovný) — každý profil sikmyRez=false (Zbynek)', () => {
		const r = computeFlat(cfg, 'Deluxe|2K', 5000, 2000, false, 10)!;
		expect(r.material.length).toBeGreaterThan(0);
		for (const m of r.material) expect(m.sikmyRez, `${m.kod} ${m.nazov}`).toBe(false);
	});

	it('Štandard + sa reže na 90° (rovný) — každý profil sikmyRez=false (Dominik/Marek: „štandard reže všetko na 90")', () => {
		const r = computeFlat(cfg, 'Štandard +|2K', 3000, 2400, false)!;
		expect(r.material.length).toBeGreaterThan(0);
		for (const m of r.material) expect(m.sikmyRez, `${m.kod} ${m.nazov}`).toBe(false);
	});

	it('Robust/Slide: sikmyRez podľa profilu (nosový/oponový 90°, zvyšok 45°) — nezmenené', () => {
		const r = computeFlat(cfg, 'Robust|2x3K', 5000, 2200, false)!;
		for (const m of r.material) expect(m.sikmyRez, `${m.kod} ${m.nazov}`).toBe(jeSikmyRez(m.nazov));
		// Robust 2x3K má aj 45° (rámový/koľajnica) aj 90° (nosový/oponový)
		expect(r.material.some((m) => m.sikmyRez)).toBe(true);
		expect(r.material.some((m) => !m.sikmyRez)).toBe(true);
	});

	it('kladka/klzný sa počíta na 3600mm tyč, nie 7500 (odpis × 3.6 na tyč)', () => {
		const r = computeFlat(cfg, 'Deluxe|2K', 5000, 2000, false, 10)!;
		const kladka = r.material.find((m) => m.kod === 'ZASP202417')!;
		// 2 kusy 2499mm, každý na vlastnú 3600mm tyč (2×2503 > 3600) → 2 tyče × 3.6
		expect(kladka.tyce).toBe(2);
		expect(r.odpis.find((o) => o.kod === 'ZASP202417')!.metre).toBe(7.2);
		// zvyšok na tyči = 3600 − 2499 − 4(kotúč) = 1097 → dôkaz, že sa balí na 3600, nie 7500
		for (const t of kladka.bary) expect(t.zvysok).toBeCloseTo(3600 - 2499 - 4, 6);
	});

	it('5K horná koľajnica je 6000mm tyč (× 6.0), spodná 7500 (× 7.5)', () => {
		const r = computeFlat(cfg, 'Deluxe|5K', 4500, 2400, false, 10)!;
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

	it('všetkých 8 Deluxe štýlov je platných a počíta 5 profilov (pre 6 aj 10 mm)', () => {
		for (const st of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K', '6K']) {
			const ss = 'Deluxe|' + st;
			expect(validSys(cfg, ss), ss).toBe(true);
			for (const hrubka of [6, 10]) {
				const { r, err } = safeCompute(cfg, ss, 4000, 2200, false, hrubka);
				expect(err, `${ss} ${hrubka}mm`).toBeNull();
				expect(r!.odpis.length, `${ss} ${hrubka}mm`).toBe(5);
				expect(r!.odpis.every((o) => Number.isFinite(o.metre) && o.metre > 0), ss).toBe(true);
				expect(r!.sklo.pocet, ss).toBe(r!.N);
			}
		}
	});

	it('fail-loud: Deluxe s neplatnou hrúbkou skla (0/8) zlyhá — NEpodhodnotí odpis', () => {
		// bez zvolenej 6/10 hrúbky by profilCuts vynechal kladku+klzný → 3-profilový
		// odpis s err=null (podhodnotenie ~40 % do Money). missingHrubkaProfile to zachytí.
		for (const bad of [0, 8]) {
			const { r, err } = safeCompute(cfg, 'Deluxe|2K', 5000, 2000, false, bad);
			expect(r, `hrubka ${bad}`).toBeNull();
			expect(err, `hrubka ${bad}`).toMatch(/hrúbku skla/);
		}
		// guard priamo: Deluxe blokuje 0/8, púšťa 6/10; Robust (bez hrúbko-závislých) nikdy
		expect(missingHrubkaProfile(cfg, 'Deluxe|2K', 0)).toMatch(/hrúbku skla/);
		expect(missingHrubkaProfile(cfg, 'Deluxe|2K', 6)).toBeNull();
		expect(missingHrubkaProfile(cfg, 'Deluxe|2K', 10)).toBeNull();
		expect(missingHrubkaProfile(cfg, 'Robust|2K', 0)).toBeNull();
		// aj cez computeMulti (zimná záhrada)
		expect(
			safeComputeMulti(cfg, [{ sysStyl: 'Deluxe|2K', S: 5000, V: 2000, redukciaZero: false, skloHrubka: 0 }]).err
		).toMatch(/hrúbku skla/);
	});

	it('rez dlhší než tyč (5K šírka > 6000mm horná koľajnica) zlyhá — Money sa NEpodhodnotí', () => {
		// 5K horná koľajnica ZASP202434 je 6000mm tyč; šírka 6100 → rez 6100 mm sa
		// fyzicky nedá vyrobiť. Bez guardu by FFD „zabalil" 6100 na 1 tyč (záporný
		// odpad) a odpis by bol 6.0 namiesto ~12.0 → podhodnotenie do Money.
		const { r, err } = safeCompute(cfg, 'Deluxe|5K', 6100, 2400, false, 10);
		expect(r).toBeNull();
		expect(err).toMatch(/dlhší než tyč/);
		// bežná šírka 5900 (< 6000) prejde bez chyby
		expect(safeCompute(cfg, 'Deluxe|5K', 5900, 2400, false, 10).err).toBeNull();
		// aj cez computeMulti (zimná záhrada) sa oversize posuv odmietne
		expect(
			safeComputeMulti(cfg, [{ sysStyl: 'Deluxe|5K', S: 6100, V: 2400, redukciaZero: false, skloHrubka: 10 }]).err
		).toMatch(/dlhší než tyč/);
	});

	it('MaterialRow nesie per-profil dĺžku tyče (pre grafický rozpis) — nie natvrdo 7500', () => {
		const r = computeFlat(cfg, 'Deluxe|5K', 4500, 2400, false, 10)!;
		const bar = (kod: string) => r.material.find((m) => m.kod === kod)!.barLen;
		expect(bar('ZASP202434')).toBe(6000); // 5K horná koľajnica
		expect(bar('ZASP202417')).toBe(3600); // kladka 10mm
		expect(bar('ZASP202432')).toBe(7500); // 5K spodná koľajnica
		const rr = computeFlat(cfg, 'Robust|2K', 5000, 2000, false)!;
		expect(rr.material[0].barLen).toBe(7500); // Robust ostáva 7500
	});

	it('dlzkaTyce mimo rozsahu (preklep 600 namiesto 6000) je odmietnutá inBounds — Money guard', () => {
		const bad = seed.rez.map((r) => ({ ...r })) as RezRow[];
		const row = bad.find((r) => r.sysStyl === 'Deluxe|5K' && r.kod === 'ZASP202434')!;
		row.dlzkaTyce = 600; // preklep: malo byť 6000
		const badCfg = buildCFG(seed.sys as SysRow[], bad);
		expect(inBounds(badCfg, 'Deluxe|5K')).toMatch(/Dĺžka tyče/);
		expect(safeCompute(badCfg, 'Deluxe|5K', 4500, 2400, false, 6).err).toMatch(/mimo povolených rozsahov/);
	});
});

// Štandard + — nový systém (basic 2K…6K / IZO 2K IZO…6K IZO / opona 2x2K…2x4K).
// Čísla NEZÁVISLE odvodené z docs/standard-plus-spec.md formúl (X(N)=27N+76,
// d(N), gap 21.5/10.5, G=(W−gap−X)/N) + z REÁLNEHO odpisu overeného live v
// Money (docs/standard-plus-spec.md zdroj: "2K s U PLUS.xlsx" — IZO 2K S=3000
// V=2400 dáva PRESNE ZASP00107=7.5, ZASP00030=7.5, ZASP202415=7.2, ZASP20244=7.5,
// ZASP00024=7.5, ZASP202419=7.5, ZASP202439=21.6 — tento test to potvrdzuje 1:1).
describe('Štandard + — basic/IZO/opona (nový systém, formuly overené proti Money odpisu)', () => {
	describe('BASIC (2K…6K) — S=3000 V=2400', () => {
		const cases: [string, number, number, Record<string, number>, { sirka: number; vyska: number }][] = [
			['Štandard +|2K', 3000, 2400, { ZASP00107: 7.5, ZASP00104: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 7.5, ZASP202419: 7.5 }, { sirka: 1438, vyska: 2285 }],
			['Štandard +|3K', 3000, 2400, { ZASP00027: 7.5, ZASP00030: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 15, ZASP202419: 7.5 }, { sirka: 955, vyska: 2285 }],
			['Štandard +|4K', 3000, 2400, { ZASP00036: 7.5, ZASP00033: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 15, ZASP202419: 7.5 }, { sirka: 713, vyska: 2285 }],
			['Štandard +|5K', 3000, 2400, { ZASP202433: 7.5, ZASP202432: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 22.5, ZASP202419: 7.5 }, { sirka: 568, vyska: 2285 }],
			['Štandard +|6K', 3000, 2400, { ZASP202438: 7.5, ZASP202437: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 30, ZASP202419: 7.5 }, { sirka: 471, vyska: 2285 }],
			// extra vektory (iné rozmery)
			['Štandard +|2K', 4500, 2100, { ZASP00107: 7.5, ZASP00104: 7.5, ZASP202415: 14.4, ZASP20244: 7.5, ZASP00024: 7.5, ZASP202419: 7.5 }, { sirka: 2188, vyska: 1985 }],
			['Štandard +|6K', 6500, 2600, { ZASP202438: 7.5, ZASP202437: 7.5, ZASP202415: 14.4, ZASP20244: 7.5, ZASP00024: 37.5, ZASP202419: 7.5 }, { sirka: 1054, vyska: 2485 }]
		];
		it.each(cases)('%s %d×%d', (sysStyl, S, V, expOdpis, expSklo) => {
			const r = computeFlat(cfg, sysStyl, S, V, false);
			expect(r).not.toBeNull();
			const got = odpisByKod(r!);
			for (const [kod, metre] of Object.entries(expOdpis)) expect(got[kod], `${sysStyl} ${kod}`).toBe(metre);
			expect(r!.odpis.length, sysStyl).toBe(Object.keys(expOdpis).length);
			expect(r!.sklo.sirka, sysStyl + ' sirka').toBe(expSklo.sirka);
			expect(r!.sklo.vyska, sysStyl + ' vyska').toBe(expSklo.vyska);
		});

		it('overený anchor zo spec.md: 2K prírez kus (S=3000) = 1426,25 mm pred zaokrúhlením na rez', () => {
			const r = computeFlat(cfg, 'Štandard +|2K', 3000, 2400, false)!;
			const kus = r.material.find((m) => m.kod === 'ZASP202415')!.bary.flatMap((b) => b.kusy)[0];
			expect(kus.rozmer).toBe(1426); // Math.round(1426.25) — rozmer je zaokrúhlený na celé mm
		});
	});

	describe('IZO (2K IZO…6K IZO) — S=3000 V=2400 (+ extra 3K IZO 3600×2000)', () => {
		const cases: [string, number, number, Record<string, number>, { sirka: number; vyska: number }][] = [
			['Štandard +|2K IZO', 3000, 2400, { ZASP00107: 7.5, ZASP00030: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 7.5, ZASP202419: 7.5, ZASP202439: 21.6 }, { sirka: 1415, vyska: 2265 }],
			['Štandard +|3K IZO', 3000, 2400, { ZASP00027: 7.5, ZASP00033: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 15, ZASP202419: 7.5, ZASP202439: 21.6 }, { sirka: 932, vyska: 2265 }],
			['Štandard +|4K IZO', 3000, 2400, { ZASP00036: 7.5, ZASP202432: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 15, ZASP202419: 7.5, ZASP202439: 28.8 }, { sirka: 690, vyska: 2265 }],
			['Štandard +|5K IZO', 3000, 2400, { ZASP202433: 7.5, ZASP202437: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 22.5, ZASP202419: 7.5, ZASP202439: 36 }, { sirka: 545, vyska: 2265 }],
			['Štandard +|6K IZO', 3000, 2400, { ZASP202438: 7.5, ZASP202437: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 30, ZASP202419: 7.5, ZASP202439: 43.2 }, { sirka: 448, vyska: 2265 }],
			['Štandard +|3K IZO', 3600, 2000, { ZASP00027: 7.5, ZASP00033: 7.5, ZASP202415: 7.2, ZASP20244: 7.5, ZASP00024: 15, ZASP202419: 7.5, ZASP202439: 21.6 }, { sirka: 1132, vyska: 1865 }]
		];
		it.each(cases)('%s %d×%d', (sysStyl, S, V, expOdpis, expSklo) => {
			const r = computeFlat(cfg, sysStyl, S, V, false);
			expect(r).not.toBeNull();
			const got = odpisByKod(r!);
			for (const [kod, metre] of Object.entries(expOdpis)) expect(got[kod], `${sysStyl} ${kod}`).toBe(metre);
			expect(r!.odpis.length, sysStyl).toBe(Object.keys(expOdpis).length);
			expect(r!.sklo.sirka, sysStyl + ' sirka').toBe(expSklo.sirka);
			expect(r!.sklo.vyska, sysStyl + ' vyska').toBe(expSklo.vyska);
		});

		it('IZO spodná koľajnica je "o veľkosť väčšia" než horná (Dominik) — 5K aj 6K IZO zdieľajú ZASP202437 (6K je už max)', () => {
			expect(computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP00030')).toBe(true);
			expect(computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP00033')).toBe(true);
			expect(computeFlat(cfg, 'Štandard +|4K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP202432')).toBe(true);
			expect(computeFlat(cfg, 'Štandard +|5K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP202437')).toBe(true);
			expect(computeFlat(cfg, 'Štandard +|6K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP202437')).toBe(true);
			// horná OSTÁVA rovnaká ako basic štýl (nie upsize)
			expect(computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!.odpis.some((o) => o.kod === 'ZASP00107')).toBe(true);
		});

		it('Rozširujúci U profil (ZASP202439) spája vodorovný aj zvislý kus pod JEDEN kód (odpis = kombinovaný)', () => {
			const r = computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!;
			const u = r.material.find((m) => m.kod === 'ZASP202439')!;
			// 4 vodorovné (2N) + 4 zvislé (2N) kusy = 8 kusov spolu, na 3600mm tyči
			const kusy = u.bary.flatMap((b) => b.kusy);
			expect(kusy.length).toBe(8);
			expect(u.barLen).toBe(3600);
		});

		it('IZO sklo je MENŠIE než basic (šírka −9, výška −135 vs. basic −115) pri rovnakom rozmere', () => {
			const basicR = computeFlat(cfg, 'Štandard +|2K', 3000, 2400, false)!;
			const izoR = computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!;
			expect(izoR.sklo.sirka).toBeLessThan(basicR.sklo.sirka);
			expect(izoR.sklo.vyska).toBeLessThan(basicR.sklo.vyska);
		});
	});

	describe('OPONA (2x2K/2x3K/2x4K) — S=5000 V=2400 (+ extra 2x2K 6000×2200)', () => {
		const cases: [string, number, number, Record<string, number>, { sirka: number; vyska: number }][] = [
			['Štandard +|2x2K', 5000, 2400, { ZASP00107: 7.5, ZASP00104: 7.5, ZASP202415: 10.8, ZASP20244: 15, ZASP00024: 15, ZASP202419: 7.5 }, { sirka: 1194, vyska: 2285 }],
			['Štandard +|2x3K', 5000, 2400, { ZASP00027: 7.5, ZASP00030: 7.5, ZASP202415: 10.8, ZASP20244: 15, ZASP00024: 22.5, ZASP202419: 7.5 }, { sirka: 792, vyska: 2285 }],
			['Štandard +|2x4K', 5000, 2400, { ZASP00036: 7.5, ZASP00033: 7.5, ZASP202415: 10.8, ZASP20244: 15, ZASP00024: 30, ZASP202419: 7.5 }, { sirka: 590, vyska: 2285 }],
			['Štandard +|2x2K', 6000, 2200, { ZASP00107: 7.5, ZASP00104: 7.5, ZASP202415: 14.4, ZASP20244: 15, ZASP00024: 15, ZASP202419: 7.5 }, { sirka: 1444, vyska: 2085 }]
		];
		it.each(cases)('%s %d×%d', (sysStyl, S, V, expOdpis, expSklo) => {
			const r = computeFlat(cfg, sysStyl, S, V, false);
			expect(r).not.toBeNull();
			const got = odpisByKod(r!);
			for (const [kod, metre] of Object.entries(expOdpis)) expect(got[kod], `${sysStyl} ${kod}`).toBe(metre);
			expect(r!.odpis.length, sysStyl).toBe(Object.keys(expOdpis).length);
			expect(r!.sklo.sirka, sysStyl + ' sirka').toBe(expSklo.sirka);
			expect(r!.sklo.vyska, sysStyl + ' vyska').toBe(expSklo.vyska);
		});

		it('opona rail kódy NIE sú upsized (rovnaké ako zodpovedajúci basic štýl)', () => {
			const r2x = computeFlat(cfg, 'Štandard +|2x2K', 5000, 2400, false)!;
			const r2 = computeFlat(cfg, 'Štandard +|2K', 3000, 2400, false)!;
			const railyOpony = new Set(r2x.odpis.map((o) => o.kod));
			const railyBasic = new Set(r2.odpis.map((o) => o.kod).filter((k) => k === 'ZASP00107' || k === 'ZASP00104'));
			for (const k of railyBasic) expect(railyOpony.has(k), k).toBe(true);
		});

		it('opona N = 2× počet krídel na polovicu (2x2K→4, 2x3K→6, 2x4K→8) — sklo počet = N', () => {
			expect(computeFlat(cfg, 'Štandard +|2x2K', 5000, 2400, false)!.N).toBe(4);
			expect(computeFlat(cfg, 'Štandard +|2x2K', 5000, 2400, false)!.sklo.pocet).toBe(4);
			expect(computeFlat(cfg, 'Štandard +|2x3K', 5000, 2400, false)!.N).toBe(6);
			expect(computeFlat(cfg, 'Štandard +|2x4K', 5000, 2400, false)!.N).toBe(8);
		});

		it('centrálne kusy opony (K-M08039 stredová lišta, jokel) NIE sú v odpise (nie sú ZASP profily → nie v Money) — zámerne vynechané', () => {
			const r = computeFlat(cfg, 'Štandard +|2x2K', 5000, 2400, false)!;
			expect(r.odpis.some((o) => o.kod === 'K-M08039')).toBe(false);
			expect(r.odpis.length).toBe(6);
		});
	});

	describe('spoločné pre všetkých 13 štýlov', () => {
		const vsetky = [
			'2K', '3K', '4K', '5K', '6K',
			'2K IZO', '3K IZO', '4K IZO', '5K IZO', '6K IZO',
			'2x2K', '2x3K', '2x4K'
		];

		it('validSys + safeCompute prejde pre všetky štýly (S=3000/5000, V=2400)', () => {
			for (const st of vsetky) {
				const sysStyl = 'Štandard +|' + st;
				expect(validSys(cfg, sysStyl), sysStyl).toBe(true);
				const S = st.startsWith('2x') ? 5000 : 3000;
				const { r, err } = safeCompute(cfg, sysStyl, S, 2400, false);
				expect(err, sysStyl).toBeNull();
				expect(r!.odpis.every((o) => Number.isFinite(o.metre) && o.metre > 0), sysStyl).toBe(true);
				expect(r!.sklo.pocet, sysStyl).toBe(r!.N);
			}
		});

		it('Štandard + sa reže CELÝ na 90° (rovný) — každý profil sikmyRez=false (Dominik/Marek: „štandard reže všetko na 90"; predtým rám/koľajnica 45°)', () => {
			const r = computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!;
			expect(r.material.length).toBeGreaterThan(0);
			// vrátane nosového (ZASP00024) — celý systém rovno, ako Deluxe
			for (const m of r.material) expect(m.sikmyRez, `${m.kod} ${m.nazov}`).toBe(false);
		});

		it('kladkový prírez a IZO U-profil sa balia na 3600mm tyč, zvyšok (koľajnice/krajová/nos/dorazovka) na 7500mm', () => {
			const r = computeFlat(cfg, 'Štandard +|2K IZO', 3000, 2400, false)!;
			expect(r.material.find((m) => m.kod === 'ZASP202415')!.barLen).toBe(3600);
			expect(r.material.find((m) => m.kod === 'ZASP202439')!.barLen).toBe(3600);
			expect(r.material.find((m) => m.kod === 'ZASP00107')!.barLen).toBe(7500);
			expect(r.material.find((m) => m.kod === 'ZASP20244')!.barLen).toBe(7500);
		});
	});
});

describe('computeMulti — viac posuvov, zdieľané tyče (zimná záhrada)', () => {
	const P = (S: number, V: number, sysStyl = 'Robust|2K', skloHrubka = 0): PosuvSpec => ({
		sysStyl,
		S,
		V,
		redukciaZero: false,
		skloHrubka
	});

	it('JEDEN posuv dáva IDENTICKÝ odpis a tyče ako computeFlat (Money nezmenené)', () => {
		for (const [ss, S, V, hrubka] of [
			['Robust|2K', 5000, 2000, 0],
			['Robust|2x3K', 5000, 2200, 0],
			['Slide|3K', 3500, 2001, 0],
			// Deluxe: per-profil dĺžka tyče (kladka 3600) + hrúbko-závislý kladka/klzný
			// (10mm) musí prejsť rovnako aj cez computeMulti
			['Deluxe|5K', 4500, 2400, 10],
			['Deluxe|2K', 5000, 2000, 6]
		] as [string, number, number, number][]) {
			const flat = computeFlat(cfg, ss, S, V, false, hrubka)!;
			const multi = computeMulti(cfg, [P(S, V, ss, hrubka)])!;
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
