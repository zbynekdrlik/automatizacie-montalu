// #610 (Odoo úloha 1416, Patrik 17.10.2026, priorita naliehavá): Štandard + opona IZO
// (2×2K / 2×3K / 2×4K) dávala sklo o ~7–10 mm širšie. Pravidlo výroby (text úlohy):
// „Rozširujúci profil má byť o 6 mm väčší od skla. Kladkový profil má byť väčší o 10 mm.
// Meniť šírku skla, nie profilov!" → šírka skla na krídlo = kladkový − 10 mm, teda
// `offset_sklo = offset_kladkový − 10·N`. Testovací rozmer z úlohy: 2×3K IZO 6500 × 2070
// → sklo 1020 × 1935 (appka dávala 1027 × 1935, screenshot att 40799).
//
// Profily sa NEMENIA (ani v seede, ani na PROD). PROD má profilové offsety upravené výrobou
// editorom 14.9. (čítanie PROD `cfg_rez` 17.10., telo #610) — seed nesie staršie hodnoty
// (seed sa so živou PROD cfg zámerne nezosúlaďuje, `.claude/rules/testing.md`). Pravidlo
// „kladkový − sklo = 10" Patrik dal voči PROD profilom, preto ho test overuje nad seed cfg
// s PROD profilovými offsetmi; vektor skla 1020 × 1935 platí v seede aj na PROD (offset
// skla je absolútny, profily sa doň nepremietajú) — za predpokladu, že korekcia skla triedy
// 16 mm (`cfg_sklo_trieda` Štandard +/16) ostáva systémová a `cfg_sys.sklo_offset` = 0
// (overené na PROD 17.10.); korekciu triedy výroba v editore meniť smie a posunula by ním sklo.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import { val } from '../src/lib/server/compute-model';
import seed from '../src/lib/server/cfg_seed.json';

const KLADKOVY = 'ZASP202415';
const ROZSIRUJUCI = 'ZASP202439';

/** PROD `cfg_rez` 17.10.2026 (read-only, telo #610): S offsety profilov, ktoré výroba
 *  14.9. doladila editorom a ktoré sú podľa Patrika SPRÁVNE (úloha 1416). */
const PROD_PROFILY: Record<string, { n: number; kladkovy: number; rozsirujuci: number }> = {
	'Štandard +|2x2K IZO': { n: 4, kladkovy: -273, rozsirujuci: -290 },
	'Štandard +|2x3K IZO': { n: 6, kladkovy: -320, rozsirujuci: -342 },
	'Štandard +|2x4K IZO': { n: 8, kladkovy: -380, rozsirujuci: -410 }
};
const STYLY = Object.keys(PROD_PROFILY);

const sys = seed.sys as SysRow[];
const rez = seed.rez as RezRow[];
const cfgSeed = buildCFG(sys, rez);
/** seed cfg + PROD profilové S offsety (sklo riadky a všetko ostatné zo seedu) */
const cfgProd = buildCFG(
	sys,
	rez.map((r) => {
		const p = PROD_PROFILY[r.sysStyl];
		if (!p || r.typ !== 'profil' || r.dim !== 'S') return r;
		if (r.kod === KLADKOVY) return { ...r, offset: p.kladkovy };
		if (r.kod === ROZSIRUJUCI) return { ...r, offset: p.rozsirujuci };
		return r;
	})
);

const riadok = (sysStyl: string, pred: (r: RezRow) => boolean): RezRow => {
	const g = cfgProd[sysStyl];
	expect(g, `${sysStyl} musí existovať v seede`).toBeTruthy();
	const r = g!.rez.find(pred);
	expect(r, `${sysStyl}: chýba hľadaný riadok`).toBeTruthy();
	return r!;
};

describe('#610 Štandard + opona IZO — sklo = kladkový − 10 mm (Odoo úloha 1416)', () => {
	it('[RED] testovací rozmer z úlohy: 2×3K IZO 6500 × 2070 → sklo 1020 × 1935 (seed)', () => {
		const r = computeFlat(cfgSeed, 'Štandard +|2x3K IZO', 6500, 2070, false, 0, true)!;
		expect(r).toBeTruthy();
		expect(r.sklo).toEqual({ sirka: 1020, vyska: 1935, pocet: 6 });
	});

	it('[RED] s PROD profilmi: kladkový 1030, rozširujúci 1026, sklo 1020 × 1935 — presne úloha 1416', () => {
		const r = computeFlat(cfgProd, 'Štandard +|2x3K IZO', 6500, 2070, false, 0, true)!;
		expect(r.sklo).toEqual({ sirka: 1020, vyska: 1935, pocet: 6 });
		const kl = r.material.find((m) => m.kod === KLADKOVY)!;
		expect(kl.rezy).toEqual([{ rozmer: 1030, ks: 12 }]);
		// rozširujúci má dva riadky (šírka S aj výška V) — šírkový rez je o 6 mm väčší než sklo
		const roz = r.material.find((m) => m.kod === ROZSIRUJUCI)!;
		expect(roz.rezy.map((x) => x.rozmer)).toContain(1026);
		expect(kl.rezy[0]!.rozmer - r.sklo.sirka).toBe(10);
	});

	for (const ss of STYLY) {
		it(`[RED] ${ss}: kladkový − sklo = 10 mm presne, rozširujúci − sklo ∈ ⟨5,5; 6,5⟩ (na krídlo, pred zaokrúhlením)`, () => {
			const g = cfgProd[ss]!;
			const N = PROD_PROFILY[ss]!.n;
			expect(g.N).toBe(N);
			const kl = riadok(ss, (r) => r.kod === KLADKOVY && r.dim === 'S');
			const roz = riadok(ss, (r) => r.kod === ROZSIRUJUCI && r.dim === 'S');
			const sklo = g.sklo.s!;
			expect(sklo.nazov).toBe('Sklo šírka');
			for (const S of [3000, 4500, 5000, 6300, 6500, 7000]) {
				// presne tá geometria, ktorou computeFlat počíta rez aj sklo (val + skloOffset)
				const skloMm = val(sklo, S, 2070, N, true) - g.skloOffset;
				const klMm = val(kl, S, 2070, N, true);
				const rozMm = val(roz, S, 2070, N, true);
				expect(klMm - skloMm, `${ss} S=${S}`).toBeCloseTo(10, 9);
				expect(rozMm - skloMm, `${ss} S=${S}`).toBeGreaterThanOrEqual(5.5);
				expect(rozMm - skloMm, `${ss} S=${S}`).toBeLessThanOrEqual(6.5);
			}
		});

		it(`${ss}: výška skla ostáva V − 135 (mení sa LEN šírka)`, () => {
			const r = computeFlat(cfgSeed, ss, 6500, 2070, false, 0, true)!;
			expect(r.sklo.vyska).toBe(1935);
			expect(cfgSeed[ss]!.sklo.v!.offset).toBe(-135);
		});
	}

	it('profily v seede sa NEMENIA (kladkový / rozširujúci S = stav pred #610)', () => {
		const off = (ss: string, kod: string) =>
			rez.find((r) => r.sysStyl === ss && r.kod === kod && r.dim === 'S')!.offset;
		expect(STYLY.map((ss) => off(ss, KLADKOVY))).toEqual([-235, -285, -335]);
		expect(STYLY.map((ss) => off(ss, ROZSIRUJUCI))).toEqual([-251, -309, -367]);
	});

	it('starý „Štandard" opona IZO sa NEMENÍ (úloha hovorí o Štandard +)', () => {
		const sklo = (ss: string) =>
			rez.find((r) => r.sysStyl === ss && r.typ === 'sklo' && r.dim === 'S')!.offset;
		expect(['Štandard|2x2K IZO', 'Štandard|2x3K IZO', 'Štandard|2x4K IZO'].map(sklo)).toEqual([
			-268, -340, -400
		]);
	});
});
