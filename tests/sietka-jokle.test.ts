// Jokle sieťky Robust (#555, Patrik Odoo úloha 1010, príloha ir.attachment 37652).
// Výroba reže jokle (oceľová výstuha rámu sieťky 12×8 mm) z NÁŠHO nárezáku — LEN Robust
// (Patrik: „pre robust"). 4 ks šírka + 4 ks výška na JEDNU sieťku. Rozmer sa odvodzuje zo
// SIEŤOVINY: šírka = sietovina.šírka + 10, výška = sietovina.výška − 22 (Excel Robust 3K
// zasklenie 5000×2150, sklo 1563×1945, sieťka 1565×1946 → jokel šírka 4 ks 1575, výška
// 4 ks 1924). Money kód dnes NEEXISTUJE → honest-null: zobrazí sa, do odpisu NEVSTUPUJE.
import { describe, it, expect } from 'vitest';
import { rozmerJokle, jeJokleSystem, JOKLE_PROFIL, JOKLE_DELTA, JOKLE_KS } from '../src/lib/sietka';
import {
	buildCFG,
	sietkaSamostatnaVypocet,
	sietkaSamostatnaMultiVypocet
} from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

describe('rozmerJokle — vzorec zo sieťoviny (Excel 1:1, príloha 37652)', () => {
	it('sieťovina 1565×1946 → jokel šírka 4 ks 1575, výška 4 ks 1924', () => {
		expect(rozmerJokle({ sirka: 1565, vyska: 1946 })).toEqual({
			profil: JOKLE_PROFIL,
			sirka: 1575,
			vyska: 1924,
			ks: 4
		});
	});

	it('vzorec je šírka +10 / výška −22, vždy 4 ks', () => {
		const j = rozmerJokle({ sirka: 1000, vyska: 2000 });
		expect(j.sirka).toBe(1010);
		expect(j.vyska).toBe(1978);
		expect(j.ks).toBe(4);
		expect(j.profil).toBe('Jokel 12x8');
	});
});

// #555 HOTFIX: post-deploy E2E beží proti ŽIVEJ PROD cfg (Robust vzorce upravené
// editorom → sklo/sieťovina o pár mm inak než seed) — preto E2E jokle asercie ODVODZUJÚ
// očakávané hodnoty z rozmeru sieťoviny zobrazeného na stránke a duplikujú deltu v helperi
// `jokleZoSietoviny` (e2e/helpers.ts). Tento test drží PARITU tej E2E delty s jediným
// zdrojom pravdy `JOKLE_DELTA`/`JOKLE_KS` — keď sa konštanty zmenia, aktualizuj aj helper.
describe('JOKLE_DELTA / JOKLE_KS — parita s E2E helperom jokleZoSietoviny', () => {
	it('delta je šírka +10 / výška −22, ks 4 (jediný zdroj vzorca)', () => {
		expect(JOKLE_DELTA).toEqual({ sirka: 10, vyska: -22 });
		expect(JOKLE_KS).toBe(4);
	});
});

describe('jeJokleSystem — LEN Robust nesie jokle (Patrik: „pre robust")', () => {
	it('Robust → true', () => expect(jeJokleSystem('Robust')).toBe(true));
	it('Slide/Štandard/Deluxe → false', () => {
		expect(jeJokleSystem('Slide')).toBe(false);
		expect(jeJokleSystem('Štandard')).toBe(false);
		expect(jeJokleSystem('Štandard +')).toBe(false);
		expect(jeJokleSystem('Deluxe')).toBe(false);
	});
});

describe('sietkaSamostatnaVypocet — jokle pre Robust (honest-null, Money-neutrálne)', () => {
	it('Robust 3K 5000×2150: jokle {4×1575, 4×1924}, 2 material riadky kod:null', () => {
		const { r, err } = sietkaSamostatnaVypocet(cfg, 'Robust', '3K', 5000, 2150);
		expect(err).toBeNull();
		// sklo 1563×1945, sieťovina 1565×1946 (validácia z prílohy 37652)
		expect(r!.sklo).toEqual({ sirka: 1563, vyska: 1945 });
		expect(r!.rozmerSietoviny).toEqual({ sirka: 1565, vyska: 1946 });
		// jokle na výsledku
		expect(r!.jokle).toEqual({ profil: JOKLE_PROFIL, sirka: 1575, vyska: 1924, ks: 4 });
		// PRÁVE 2 material riadky s kod:null (jokle) — honest-null, do odpisu nejdú
		const jokleRiadky = r!.material.filter((m) => m.kod === null);
		expect(jokleRiadky).toHaveLength(2);
		expect(jokleRiadky[0]!.rezy).toEqual([{ rozmer: 1575, ks: 4 }]);
		expect(jokleRiadky[1]!.rezy).toEqual([{ rozmer: 1924, ks: 4 }]);
		for (const jr of jokleRiadky) {
			expect(jr.nazov).toContain('Jokel 12x8');
			expect(jr.poznamka).toBeTruthy();
			expect(jr.tyce).toBeGreaterThan(0);
		}
	});

	it('Money-neutralita: odpis NEOBSAHUJE jokle ani žiadny kod:null', () => {
		const { r } = sietkaSamostatnaVypocet(cfg, 'Robust', '3K', 5000, 2150);
		expect(r!.odpis.every((o) => typeof o.kod === 'string' && o.kod.length > 0)).toBe(true);
		expect(r!.odpis.some((o) => o.nazov.includes('Jokel'))).toBe(false);
	});

	it('Slide NEMÁ jokle (jokle:null, žiadny kod:null riadok)', () => {
		const { r, err } = sietkaSamostatnaVypocet(cfg, 'Slide', '3K', 3500, 2001);
		expect(err).toBeNull();
		expect(r!.jokle).toBeNull();
		expect(r!.material.some((m) => m.kod === null)).toBe(false);
	});

	it('multi: každý Robust kus nesie vlastné jokle, spoločný odpis bez joklov', () => {
		const { r, err } = sietkaSamostatnaMultiVypocet(cfg, [
			{ system: 'Robust', styl: '3K', otvorS: 5000, otvorV: 2150 },
			{ system: 'Slide', styl: '3K', otvorS: 3500, otvorV: 2001 }
		]);
		expect(err).toBeNull();
		expect(r!.kusy[0]!.jokle).toEqual({ profil: JOKLE_PROFIL, sirka: 1575, vyska: 1924, ks: 4 });
		expect(r!.kusy[1]!.jokle).toBeNull();
		expect(r!.odpis.some((o) => o.nazov.includes('Jokel'))).toBe(false);
	});
});
