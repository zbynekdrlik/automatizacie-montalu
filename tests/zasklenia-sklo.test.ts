// #524: `zasklenia-sklo.ts` je PURE-MOVE sklo-rozlíšenia + rekomputy z route (predtým merané len
// E2E, nie vitestom). Priame unit testy pre `skloPre` (vrátane SKLO_INE vlastnej skladby vetiev)
// + `recomputeVstup`/`recomputeMultiVstup` — seedovaná per-file DB (loadCfg + sklo katalóg).
import { describe, it, expect } from 'vitest';
import { skloPre, recomputeVstup } from '../src/lib/server/zasklenia-sklo';
import { loadCfg } from '../src/lib/server/db';
import { SKLO_INE } from '../src/lib/sklo';
import type { Vstup } from '../src/lib/server/vstup';

const cfg = loadCfg();

function vstup(over: Partial<Vstup>): Vstup {
	return {
		zak: 'ZAK',
		op: 'OP1',
		zakaznik: 'T',
		system: 'Robust',
		styl: '2K',
		s: 2000,
		v: 1000,
		sklo: 'Izolačné sklo 4/16/4 číre',
		skloPresne: '',
		skloTrieda: null,
		otvaranie: '',
		kovanieL: '',
		kovanieP: '',
		kovanieStred: '',
		kovanieStredOkno: 'L',
		vrtanieZamku: 1050,
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		kliny: [],
		kolajnica: null,
		sietka: null,
		...over
	};
}

describe('skloPre — katalógové sklo', () => {
	it('platné katalógové sklo → vráti GlassType', () => {
		const g = skloPre(cfg, 'Robust', '2K', 'Izolačné sklo 4/16/4 číre');
		expect(g).not.toBeNull();
		expect(g?.nazov).toBe('Izolačné sklo 4/16/4 číre');
	});
	it('neplatné sklo pre systém → null', () => {
		expect(skloPre(cfg, 'Robust', '2K', 'NEEXISTUJE-SKLO')).toBeNull();
	});
});

describe('skloPre — vlastná skladba (SKLO_INE)', () => {
	it('Robust + trieda 6 → syntetické sklo, hrubkaTrieda null (Robust neklasifikuje)', () => {
		const g = skloPre(cfg, 'Robust', '2K', SKLO_INE, 6);
		expect(g).not.toBeNull();
		expect(g?.nazov).toBe(SKLO_INE);
		expect(g?.hrubkaTrieda).toBeNull();
	});
	it('Slide + trieda 6 → syntetické sklo, hrubkaTrieda podľa triedy (Slide klasifikuje)', () => {
		const g = skloPre(cfg, 'Slide', '3K', SKLO_INE, 6);
		expect(g).not.toBeNull();
		expect(g?.nazov).toBe(SKLO_INE);
		expect(g?.hrubkaTrieda).toBe(6); // klasifikuje=true → trieda
	});
	it('bez platnej triedy → null (vlastná skladba vyžaduje triedu)', () => {
		expect(skloPre(cfg, 'Robust', '2K', SKLO_INE, 99)).toBeNull();
		expect(skloPre(cfg, 'Robust', '2K', SKLO_INE, null)).toBeNull();
	});
});

describe('recomputeVstup — default cfg (loadCfg) vs explicitné', () => {
	it('bez cfg parametra (default loadCfg) dá rovnaký materiál ako s cfg', () => {
		const v = vstup({});
		const a = recomputeVstup(v); // default cfg = loadCfg()
		const b = recomputeVstup(v, cfg); // explicitné cfg
		expect(a.r).not.toBeNull();
		expect(a.r?.material).toEqual(b.r?.material);
	});
	it('neplatné sklo → r null + chyba', () => {
		const out = recomputeVstup(vstup({ sklo: 'NEEXISTUJE' }), cfg);
		expect(out.r).toBeNull();
		expect(out.err).toBeTruthy();
	});
});
