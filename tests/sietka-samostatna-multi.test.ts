// Sieťka multi (#473) — viac dodatočných sieťok naraz v JEDNOM odpise (Patrik, kanál
// Appka vyroba msg 1794336, 5.9.2026). Kontrakt: per-kus NEZÁVISLÝ výpočet cez
// existujúci `sietkaSamostatnaVypocet` (rovnaká fyzika, vlastné čerstvé balenie tyčí
// per kus) + metre SČÍTANÉ per Money kód naprieč kusmi. ŽIADNY bin-packing naprieč
// kusmi — rovnaký kontrakt ako `computeClipMulti` (clip.ts, #468 fáza 2). Vektory
// prevzaté z `tests/compute.test.ts`'s jednokusových kontraktných vektorov.
import { describe, it, expect } from 'vitest';
import {
	sietkaSamostatnaVypocet,
	sietkaSamostatnaMultiVypocet,
	buildCFG
} from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

const ROBUST_3K = { system: 'Robust', styl: '3K', otvorS: 4645, otvorV: 2320 };
const ROBUST_2K = { system: 'Robust', styl: '2K', otvorS: 2509, otvorV: 1930 };
const SLIDE_3K = { system: 'Slide', styl: '3K', otvorS: 3500, otvorV: 2001 };

describe('sietkaSamostatnaMultiVypocet — jeden kus = identický s jednokusovým výpočtom (regresná parita)', () => {
	it('single-item multi = sietkaSamostatnaVypocet', () => {
		const single = sietkaSamostatnaVypocet(
			cfg,
			ROBUST_3K.system,
			ROBUST_3K.styl,
			ROBUST_3K.otvorS,
			ROBUST_3K.otvorV
		);
		const multi = sietkaSamostatnaMultiVypocet(cfg, [ROBUST_3K]);
		expect(multi.err).toBeNull();
		expect(multi.r!.kusy).toHaveLength(1);
		expect(multi.r!.kusy[0]!.odpis).toEqual(single.r!.odpis);
		expect(multi.r!.kusy[0]!.material).toEqual(single.r!.material);
		expect(multi.r!.odpis).toEqual(single.r!.odpis);
	});
});

describe('sietkaSamostatnaMultiVypocet — parita: 2× identický kus = presne 2× metre', () => {
	it('2× Robust 3K 4645×2320 = 2× single metre per kód', () => {
		const single = sietkaSamostatnaVypocet(
			cfg,
			ROBUST_3K.system,
			ROBUST_3K.styl,
			ROBUST_3K.otvorS,
			ROBUST_3K.otvorV
		);
		const multi = sietkaSamostatnaMultiVypocet(cfg, [ROBUST_3K, ROBUST_3K]);
		expect(multi.err).toBeNull();
		expect(multi.r!.kusy).toHaveLength(2);
		for (const kus of multi.r!.kusy) {
			expect(kus.odpis).toEqual(single.r!.odpis);
		}
		for (const o of multi.r!.odpis) {
			const singleMetre = single.r!.odpis.find((s) => s.kod === o.kod)!.metre;
			expect(o.metre).toBe(singleMetre * 2);
		}
	});

	it('3× Robust 2K 2509×1930 (3K koľajnica) = 3× single metre per kód', () => {
		const single = sietkaSamostatnaVypocet(
			cfg,
			ROBUST_2K.system,
			ROBUST_2K.styl,
			ROBUST_2K.otvorS,
			ROBUST_2K.otvorV
		);
		const multi = sietkaSamostatnaMultiVypocet(cfg, [ROBUST_2K, ROBUST_2K, ROBUST_2K]);
		expect(multi.err).toBeNull();
		expect(multi.r!.kusy).toHaveLength(3);
		for (const o of multi.r!.odpis) {
			const singleMetre = single.r!.odpis.find((s) => s.kod === o.kod)!.metre;
			expect(o.metre).toBeCloseTo(singleMetre * 3, 6);
		}
	});
});

describe('sietkaSamostatnaMultiVypocet — rôzne kusy (rôzny systém/štýl/rozmer) — merged odpis', () => {
	it('Robust 3K + Robust 2K (3K koľajnica) + Slide 3K — súčet per kód, poradie prvého výskytu', () => {
		const s1 = sietkaSamostatnaVypocet(
			cfg,
			ROBUST_3K.system,
			ROBUST_3K.styl,
			ROBUST_3K.otvorS,
			ROBUST_3K.otvorV
		);
		const s2 = sietkaSamostatnaVypocet(
			cfg,
			ROBUST_2K.system,
			ROBUST_2K.styl,
			ROBUST_2K.otvorS,
			ROBUST_2K.otvorV
		);
		const s3 = sietkaSamostatnaVypocet(
			cfg,
			SLIDE_3K.system,
			SLIDE_3K.styl,
			SLIDE_3K.otvorS,
			SLIDE_3K.otvorV
		);
		const multi = sietkaSamostatnaMultiVypocet(cfg, [ROBUST_3K, ROBUST_2K, SLIDE_3K]);
		expect(multi.err).toBeNull();
		expect(multi.r!.kusy).toHaveLength(3);
		expect(multi.r!.kusy[0]!.odpis).toEqual(s1.r!.odpis);
		expect(multi.r!.kusy[1]!.odpis).toEqual(s2.r!.odpis);
		expect(multi.r!.kusy[2]!.odpis).toEqual(s3.r!.odpis);

		// ZASP00002 (rámový Robust) — v s1 AJ s2, súčet metrov
		const ram1 = s1.r!.odpis.find((o) => o.kod === 'ZASP00002')!.metre;
		const ram2 = s2.r!.odpis.find((o) => o.kod === 'ZASP00002')!.metre;
		expect(multi.r!.odpis.find((o) => o.kod === 'ZASP00002')!.metre).toBe(ram1 + ram2);

		// ZASP00016 (3K koľajnica) — LEN v s2 (Robust 2K), 2× (jeden kus)
		expect(multi.r!.odpis.find((o) => o.kod === 'ZASP00016')!.metre).toBe(
			s2.r!.odpis.find((o) => o.kod === 'ZASP00016')!.metre
		);

		// ZASP00088 (Slide rámový) — LEN v s3
		expect(multi.r!.odpis.find((o) => o.kod === 'ZASP00088')!.metre).toBe(
			s3.r!.odpis.find((o) => o.kod === 'ZASP00088')!.metre
		);

		// poradie: ZASP00002 prvý (z prvého kusu)
		expect(multi.r!.odpis[0]!.kod).toBe('ZASP00002');
	});
});

describe('sietkaSamostatnaMultiVypocet — chyba v ktoromkoľvek kuse je honest a číslovaná', () => {
	it('neznámy systém/štýl v 2. kuse hlási "Sieťka 2: ..."', () => {
		const multi = sietkaSamostatnaMultiVypocet(cfg, [
			ROBUST_3K,
			{ system: 'Robust', styl: '9K', otvorS: 3000, otvorV: 2000 }
		]);
		expect(multi.r).toBeNull();
		expect(multi.err).toMatch(/^Sieťka 2:/);
	});

	it('oversize rozmer v 1. kuse hlási "Sieťka 1: ..."', () => {
		const multi = sietkaSamostatnaMultiVypocet(cfg, [
			{ system: 'Robust', styl: '2K', otvorS: 16000, otvorV: 2000 },
			ROBUST_3K
		]);
		expect(multi.r).toBeNull();
		expect(multi.err).toMatch(/^Sieťka 1:/);
	});

	it('opona (2x*) v ktoromkoľvek kuse je odmietnutá', () => {
		const multi = sietkaSamostatnaMultiVypocet(cfg, [
			{ system: 'Robust', styl: '2x3K', otvorS: 5000, otvorV: 2200 }
		]);
		expect(multi.r).toBeNull();
		expect(multi.err).toMatch(/opon/i);
	});
});
