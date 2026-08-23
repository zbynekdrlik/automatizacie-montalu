// Verejný konfigurátor pergoly (#275) — parser + validácia vstupu. Overuje rozmedzia,
// odmietnutie neznámeho typu skla / neplatnej farby (žiadna injekcia ľubovoľného reťazca
// do súhrnu), a dopočet výšky pri stene mimo konštrukčného rozmedzia enginu.
import { describe, it, expect } from 'vitest';
import { parseKonfiguratorVstup } from '../src/lib/server/konfigurator-vstup';
import { SKLO_STRECHA_TYPY } from '../src/lib/sklo-strecha';
import { RAL_PALETA } from '../src/lib/vykres/ral';

const PLATNE_SKLO = SKLO_STRECHA_TYPY[0]!.nazov;
const PLATNA_FARBA = RAL_PALETA[0]!.kod; // '7016'

function fd(o: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
}

const platny = (o: Record<string, string> = {}) =>
	fd({
		sirka: '4000',
		hlbka: '3500',
		vyskaVpredu: '2500',
		sklonDeg: '6',
		sklo: PLATNE_SKLO,
		farba: PLATNA_FARBA,
		...o
	});

describe('parseKonfiguratorVstup — platný vstup', () => {
	it('sparsuje kompletný platný formulár + preloží farbu na RAL label', () => {
		const r = parseKonfiguratorVstup(platny());
		expect('vstup' in r).toBe(true);
		if ('vstup' in r) {
			expect(r.vstup.sirka).toBe(4000);
			expect(r.vstup.hlbka).toBe(3500);
			expect(r.vstup.vyskaVpredu).toBe(2500);
			expect(r.vstup.sklonDeg).toBe(6);
			expect(r.vstup.sklo).toBe(PLATNE_SKLO);
			expect(r.vstup.farba).toBe(`RAL ${RAL_PALETA[0]!.kod} ${RAL_PALETA[0]!.nazov}`);
		}
	});

	it('akceptuje desatinnú čiarku a medzery v číslach', () => {
		const r = parseKonfiguratorVstup(platny({ sirka: '4 000', sklonDeg: '6,5' }));
		expect('vstup' in r).toBe(true);
		if ('vstup' in r) {
			expect(r.vstup.sirka).toBe(4000);
			expect(r.vstup.sklonDeg).toBe(6.5);
		}
	});
});

describe('parseKonfiguratorVstup — rozmedzia', () => {
	it.each([
		['sirka', '100'],
		['sirka', '999999'],
		['hlbka', '100'],
		['hlbka', '99999'],
		['vyskaVpredu', '100'],
		['vyskaVpredu', '99999'],
		['sklonDeg', '-1'],
		['sklonDeg', '90']
	])('odmietne %s mimo rozmedzia (%s)', (pole, hodnota) => {
		const r = parseKonfiguratorVstup(platny({ [pole]: hodnota }));
		expect('error' in r).toBe(true);
	});

	it('odmietne kombináciu výška+hĺbka+sklon, ktorá pri stene presiahne max enginu', () => {
		// 4000 + tan(30°)*6000 ≈ 7464 mm >> VYSKA_MAX (4500)
		const r = parseKonfiguratorVstup(
			platny({ vyskaVpredu: '4000', hlbka: '6000', sklonDeg: '30' })
		);
		expect('error' in r).toBe(true);
		if ('error' in r) expect(r.error).toMatch(/stene/i);
	});
});

describe('parseKonfiguratorVstup — katalóg (žiadna injekcia)', () => {
	it('odmietne neznámy názov strešného skla', () => {
		const r = parseKonfiguratorVstup(platny({ sklo: 'neexistujúce sklo' }));
		expect('error' in r).toBe(true);
	});

	it('odmietne pokus o injekciu ľubovoľného reťazca ako sklo', () => {
		const r = parseKonfiguratorVstup(platny({ sklo: '<script>alert(1)</script>' }));
		expect('error' in r).toBe(true);
	});

	it('odmietne neplatný RAL kód farby', () => {
		const r = parseKonfiguratorVstup(platny({ farba: 'ZZZZ' }));
		expect('error' in r).toBe(true);
	});

	it('KAŽDÝ platný typ skla z katalógu prejde (len názvy, žiadny moneyKod)', () => {
		for (const t of SKLO_STRECHA_TYPY) {
			const r = parseKonfiguratorVstup(platny({ sklo: t.nazov }));
			expect('vstup' in r).toBe(true);
		}
	});
});
