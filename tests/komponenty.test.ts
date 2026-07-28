// Kovanie do Money odpisu (Dominik 2026-07-28) — základ výpočtu.
// MONEY-KRITICKÉ: každé číslo tu je výdaj zo skladu. Testy držia dve veci:
//   1. počty sa odvodia z REÁLNEJ konfigurácie (nie z odhadu v teste),
//   2. nenakonfigurovaný štýl je HLASNÁ chyba, nikdy tichá nula.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat, zakladPoctov } from '../src/lib/server/compute';
import {
	pocitajKomponenty,
	pocetUzaverov,
	zlucKomponenty,
	type Komponent
} from '../src/lib/komponenty';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);
const zaklad = (sysStyl: string, S = 3000, V = 2200) =>
	zakladPoctov(computeFlat(cfg, sysStyl, S, V, false)!);

// Podmnožina Robust tabuľky, ktorej pravidlá Dominik dal jednoznačne.
// Uzáver má počty LEN pre 2K/3K/2x2K — presne ako v tabuľke; 4K/2x3K/2x4K čakajú
// na jeho odpoveď, a práve to musí padnúť, nie vyjsť 0.
const UZAVER: Komponent = {
	kod: 'ZASK00029',
	nazov: 'Uzáver RS ROBSUT',
	mj: 'ks',
	pravidlo: { typ: 'konstPreStyl', ks: { 'Robust|2K': 2, 'Robust|3K': 2, 'Robust|2x2K': 3 } }
};
const ROBUST: Komponent[] = [
	{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 2 } },
	UZAVER,
	{ kod: 'ZASK00031', nazov: 'Podložka uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 5 } },
	{ kod: 'ZASK00032', nazov: 'Protikus uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 2 } },
	{ kod: 'ZASK00034', nazov: 'Upevňovacia sada', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
	{ kod: 'ZASK00036', nazov: 'Krytka krídla', mj: 'ks', pravidlo: { typ: 'naNosovyProfil', koef: 2 } },
	{ kod: 'ZASK00038', nazov: 'Rohovník krídla', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 4 } },
	{ kod: 'ZASK00039', nazov: 'Rohovník zarovnávací', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 8 } },
	{
		kod: 'ZASK20242',
		nazov: 'Tesnenie zasklievacie 12',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'ramovy', koef: 1 }
	},
	{
		kod: 'ZASK00042',
		nazov: 'Kefové tesnenie 7x5,00',
		mj: 'm',
		pravidlo: { typ: 'dlzkaRozdiel', koef: 2 }
	}
];

const spocitaj = (sysStyl: string, komp = ROBUST) =>
	pocitajKomponenty(komp, sysStyl, zaklad(sysStyl), pocetUzaverov(UZAVER, sysStyl));
const q = (r: ReturnType<typeof spocitaj>, kod: string) =>
	r.polozky.find((p) => p.kod === kod)?.qty;

describe('zakladPoctov — čísla sa berú z konfigurácie, nie z odhadu', () => {
	it('Robust|2K: 2 krídla, 2 nosové profily (podľa cfg_seed BOM)', () => {
		const z = zaklad('Robust|2K');
		expect(z.kridla).toBe(2);
		expect(z.nosoveProfily).toBe(2);
		expect(z.dlzkaOponovehoMm).toBe(0);
	});

	it('Robust|3K má viac krídel aj nosových profilov než 2K', () => {
		const dva = zaklad('Robust|2K');
		const tri = zaklad('Robust|3K');
		expect(tri.kridla).toBe(3);
		expect(tri.nosoveProfily).toBeGreaterThan(dva.nosoveProfily);
	});

	it('dĺžka rámového profilu = súčet rezov rámového profilu z plánu', () => {
		const r = computeFlat(cfg, 'Robust|2K', 3000, 2200, false)!;
		const ramovy = r.material.filter((m) => /Rámový/i.test(m.nazov));
		const rucne = ramovy.reduce(
			(s, m) => s + m.rezy.reduce((a, x) => a + x.rozmer * x.ks, 0),
			0
		);
		expect(ramovy.length).toBeGreaterThan(0);
		expect(zakladPoctov(r).dlzkaRamovehoMm).toBe(rucne);
	});

	it('opona (Robust|2x2K) má krídla z oboch strán', () => {
		expect(zaklad('Robust|2x2K').kridla).toBe(4);
	});
});

describe('pocitajKomponenty — Robustove pravidlá od Dominika', () => {
	it('Robust|2K: kladka 2 ks/krídlo = 4 ks (Dominikov príklad „2K 4ks")', () => {
		expect(q(spocitaj('Robust|2K'), 'ZASK00027')).toBe(4);
	});

	it('uzáver je konštanta štýlu: 2K→2, 3K→2, 2x2K→3', () => {
		expect(q(spocitaj('Robust|2K'), 'ZASK00029')).toBe(2);
		expect(q(spocitaj('Robust|3K'), 'ZASK00029')).toBe(2);
		expect(q(spocitaj('Robust|2x2K'), 'ZASK00029')).toBe(3);
	});

	it('položky viazané na uzáver: podložka 5×, protikus 2×, sada 1×', () => {
		const r = spocitaj('Robust|2K'); // 2 uzávery
		expect(q(r, 'ZASK00031')).toBe(10);
		expect(q(r, 'ZASK00032')).toBe(4);
		expect(q(r, 'ZASK00034')).toBe(2);
	});

	it('OPRAVA z 2026-07-28: protikus je 2 ks na uzáver, NIE 5', () => {
		// prvá verzia tabuľky mala pri ZASK00032 „5ks" (copy-paste z podložky nad ním)
		const r = spocitaj('Robust|2x2K'); // 3 uzávery
		expect(q(r, 'ZASK00032')).toBe(6);
		expect(q(r, 'ZASK00032')).not.toBe(15);
	});

	it('krytka krídla = 2 ks × každý nosový profil', () => {
		const z = zaklad('Robust|3K');
		expect(q(spocitaj('Robust|3K'), 'ZASK00036')).toBe(2 * z.nosoveProfily);
	});

	it('rohovník krídla 4 ks a zarovnávací 8 ks na každé krídlo', () => {
		const r = spocitaj('Robust|3K');
		expect(q(r, 'ZASK00038')).toBe(12);
		expect(q(r, 'ZASK00039')).toBe(24);
	});

	it('zasklievacie tesnenie = dĺžka rámového profilu v METROCH', () => {
		const z = zaklad('Robust|2K');
		expect(q(spocitaj('Robust|2K'), 'ZASK20242')).toBe(
			Math.round((z.dlzkaRamovehoMm / 1000) * 1000) / 1000
		);
	});

	it('kefové 7x5 = (rámový − nosový) × 2, v metroch a nikdy záporné', () => {
		const z = zaklad('Robust|2K');
		const cakane = Math.round(((z.dlzkaRamovehoMm - z.dlzkaNosovehoMm) * 2) / 1000 * 1000) / 1000;
		expect(q(spocitaj('Robust|2K'), 'ZASK00042')).toBe(cakane);
		expect(cakane).toBeGreaterThan(0);
	});

	it('každá kusová položka má MJ „ks" a metrážová „m"', () => {
		const r = spocitaj('Robust|2K');
		expect(r.polozky.find((p) => p.kod === 'ZASK00027')!.mj).toBe('ks');
		expect(r.polozky.find((p) => p.kod === 'ZASK20242')!.mj).toBe('m');
	});
});

describe('fail-loud: nenakonfigurovaný štýl NESMIE dať tichú nulu', () => {
	it('Robust|4K (Dominik počet uzáverov nedal) → chyby, nie 0 ks', () => {
		const r = spocitaj('Robust|4K');
		expect(r.chyby.length).toBeGreaterThan(0);
		expect(r.chyby.map((c) => c.kod)).toContain('ZASK00029');
		// a ani jedna z položiek závislých na uzávere sa nesmie objaviť s nulou
		for (const kod of ['ZASK00029', 'ZASK00031', 'ZASK00032', 'ZASK00034'])
			expect(r.polozky.find((p) => p.kod === kod)).toBeUndefined();
	});

	it('položky nezávislé na uzávere sa spočítajú aj tak (kladka, rohovníky)', () => {
		const r = spocitaj('Robust|4K');
		expect(q(r, 'ZASK00027')).toBe(8);
		expect(q(r, 'ZASK00038')).toBe(16);
	});

	it('chybová správa menuje kód aj štýl, aby dielňa vedela čo chýba', () => {
		const r = spocitaj('Robust|2x4K');
		expect(r.chyby[0].sprava).toMatch(/ZASK00029/);
		expect(r.chyby[0].sprava).toMatch(/Robust\|2x4K/);
	});
});

describe('zlucKomponenty — viac posuvov na jednej zákazke', () => {
	it('kusy aj metre sa sčítajú po kóde', () => {
		const a = spocitaj('Robust|2K').polozky;
		const b = spocitaj('Robust|3K').polozky;
		const spolu = zlucKomponenty([a, b]);
		const kladka = spolu.find((p) => p.kod === 'ZASK00027')!;
		expect(kladka.qty).toBe(4 + 6);
		const tesnenie = spolu.find((p) => p.kod === 'ZASK20242')!;
		const cakane =
			a.find((p) => p.kod === 'ZASK20242')!.qty + b.find((p) => p.kod === 'ZASK20242')!.qty;
		expect(tesnenie.qty).toBeCloseTo(cakane, 3);
	});

	it('jeden posuv sa zlúčením nezmení', () => {
		const a = spocitaj('Robust|2K').polozky;
		expect(zlucKomponenty([a])).toEqual(a);
	});
});
