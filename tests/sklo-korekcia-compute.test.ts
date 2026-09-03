// #440 (HOTFIX): korekcia rozmeru skla musí byť nastaviteľná PER SKLO (16 mm vs 6 mm
// v Slide), nie len per systém. Doteraz je korekcia `cfg_sys.sklo_offset` — JEDNA hodnota
// na systém, odčítaná vo vzorci `Math.round(val(...) - g.skloOffset)`. Compute musí prijať
// per-volanie override `skloKorekcia` (absolútny; NULL = systémový `skloOffset`) a použiť ho
// na 4 vzorcových miestach. RED: bez opravy computeFlat/computeMulti override IGNORUJÚ → oba
// rozmery vyjdú rovnako ako pri NULL. Kontrakt Money-neutrality (NULL = bit-identické) je
// pokrytý `tests/compute.test.ts`, ktorý ostáva bez zmeny.
import { describe, it, expect } from 'vitest';
import { loadCfg } from '../src/lib/server/db';
import {
	computeFlat,
	computeMulti,
	safeCompute,
	sietkaSamostatnaVypocet
} from '../src/lib/server/compute';

const SYS = 'Slide|2K';
const S = 2551;
const V = 1601;
const KOR = 40; // != systémový skloOffset (Slide = 83) → posun musí byť viditeľný

describe('#440 per-sklo korekcia rozmeru skla — compute override', () => {
	const cfg = loadCfg();
	const skloOffset = cfg[SYS]!.skloOffset;

	it('systémový offset Slide je 83 (fixný predpoklad testu)', () => {
		expect(skloOffset).toBe(83);
	});

	it('computeFlat: NULL override = dnešné správanie (systémový skloOffset)', () => {
		const withNull = computeFlat(cfg, SYS, S, V, false, 0, false, undefined, null, null)!;
		const bezParam = computeFlat(cfg, SYS, S, V, false)!;
		// NULL override = bit-identický rozmer skla ako doterajšie volanie bez parametra
		expect(withNull.sklo.sirka).toBe(bezParam.sklo.sirka);
		expect(withNull.sklo.vyska).toBe(bezParam.sklo.vyska);
	});

	it('computeFlat: absolútny override sa použije NAMIESTO skloOffset', () => {
		const withNull = computeFlat(cfg, SYS, S, V, false, 0, false, undefined, null, null)!;
		const withKor = computeFlat(cfg, SYS, S, V, false, 0, false, undefined, null, KOR)!;
		// override 40 odčíta o (83-40)=43 mm menej → rozmer je o 43 mm väčší
		expect(withKor.sklo.sirka).toBe(withNull.sklo.sirka + (skloOffset - KOR));
		expect(withKor.sklo.vyska).toBe(withNull.sklo.vyska + (skloOffset - KOR));
	});

	it('safeCompute prevlieka override do rozmeru skla', () => {
		const bez = safeCompute(cfg, SYS, S, V, false, 0, false, undefined, null, null).r!;
		const so = safeCompute(cfg, SYS, S, V, false, 0, false, undefined, null, KOR).r!;
		expect(so.sklo.sirka).toBe(bez.sklo.sirka + (skloOffset - KOR));
	});

	it('computeMulti: override na PosuvSpec sa použije per posuv', () => {
		const spec = (kor: number | null) => [
			{ sysStyl: SYS, S, V, redukciaZero: false, skloKorekcia: kor }
		];
		const withNull = computeMulti(cfg, spec(null))!;
		const withKor = computeMulti(cfg, spec(KOR))!;
		expect(withKor.posuvy[0]!.sklo.sirka).toBe(withNull.posuvy[0]!.sklo.sirka + (skloOffset - KOR));
		expect(withKor.posuvy[0]!.sklo.vyska).toBe(withNull.posuvy[0]!.sklo.vyska + (skloOffset - KOR));
	});

	it('sietkaSamostatnaVypocet: override sa použije na referenčný rozmer skla', () => {
		// Slide|3K má overený samostatný sieťkový výpočet (compute.test.ts); skloOffset Slide = 83
		const off = cfg['Slide|3K']!.skloOffset;
		const bez = sietkaSamostatnaVypocet(cfg, 'Slide', '3K', 3500, 2001, null).r!;
		const so = sietkaSamostatnaVypocet(cfg, 'Slide', '3K', 3500, 2001, KOR).r!;
		expect(so.sklo.sirka).toBe(bez.sklo.sirka + (off - KOR));
	});
});
