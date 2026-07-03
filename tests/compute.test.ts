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
		['Robust|2K', 2509, 1930, false, { ZASP00014: 15, ZASP00002: 15, ZASP00010: 7.5 }, { sirka: 1129, vyska: 1725 }]
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
		expect(computeFlat(cfg, 'Slide|2x2K', 3000, 2000, false)).toBeNull();
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
			['Slide|3K', 3500, 2001]
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
		const { r, err } = safeComputeMulti(cfg, [{ sysStyl: 'Slide|2x2K', S: 3000, V: 2000, redukciaZero: false }]);
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
		expect(computeMulti(cfg, [P(3000, 2000, 'Slide|2x2K')])).toBeNull();
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
		expect(validSys(cfg, 'Slide|2x2K')).toBe(false);
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
