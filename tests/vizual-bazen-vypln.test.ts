// #405 — mapovanie kategórie polykarbonátovej výplne → vizuálny vzhľad
// (`bazen-vypln.ts`). Pure (žiadny THREE/DOM). Kontraktuálne overuje, že
// heuristika sedí s reálnymi kategóriami z `konfigurator-bazen` (BAZEN_VYPLNE).
import { describe, expect, it } from 'vitest';
import {
	bazenVyplnTyp,
	bazenVyplnVzhlad,
	bazenVyplnVzhladZNazvu,
	BAZEN_VYPLN_TYP_DEFAULT,
	type BazenVyplnTyp
} from '$lib/vizual/bazen-vypln';
import { BAZEN_VYPLNE, BAZEN_VYPLN_DEFAULT } from '$lib/konfigurator-bazen';

describe('bazenVyplnTyp — názov kategórie → typ výplne (#405)', () => {
	it('reálne kategórie z BAZEN_VYPLNE sa mapujú jednoznačne (žiadne 2 na ten istý typ)', () => {
		const typy = BAZEN_VYPLNE.map((v) => bazenVyplnTyp(v.nazov));
		expect(new Set(typy).size).toBe(BAZEN_VYPLNE.length); // každá kategória iný typ
	});

	it('konkrétne mapovanie číry/opál/dymový', () => {
		expect(bazenVyplnTyp('Číry polykarbonát')).toBe('cire');
		expect(bazenVyplnTyp('Opálový (mliečny) polykarbonát')).toBe('opalove');
		expect(bazenVyplnTyp('Dymový (bronzový) polykarbonát')).toBe('dymove');
	});

	it('default výplň (BAZEN_VYPLN_DEFAULT) mapuje na typ `cire`', () => {
		expect(bazenVyplnTyp(BAZEN_VYPLN_DEFAULT)).toBe('cire');
	});

	it('neznámy/prázdny názov → bezpečný default `cire`', () => {
		expect(bazenVyplnTyp('')).toBe(BAZEN_VYPLN_TYP_DEFAULT);
		expect(bazenVyplnTyp(null)).toBe('cire');
		expect(bazenVyplnTyp('niečo neznáme')).toBe('cire');
	});
});

describe('bazenVyplnVzhlad — typ → SkloVzhlad (#405)', () => {
	const TYPY: BazenVyplnTyp[] = ['cire', 'opalove', 'dymove'];

	it('každý typ dáva platný SkloVzhlad (farba + oba tier-páry)', () => {
		for (const t of TYPY) {
			const vz = bazenVyplnVzhlad(t);
			expect(typeof vz.farbaHex).toBe('number');
			expect(typeof vz.opacity).toBe('number');
			expect(typeof vz.roughness).toBe('number');
			expect(typeof vz.attenuationHex).toBe('number');
			expect(typeof vz.attenuationDistanceM).toBe('number');
		}
	});

	it('opálový je najmenej priehľadný a najdrsnejší (mliečny difúzny vzhľad)', () => {
		const cire = bazenVyplnVzhlad('cire');
		const opal = bazenVyplnVzhlad('opalove');
		expect(opal.opacity!).toBeGreaterThan(cire.opacity!);
		expect(opal.roughness!).toBeGreaterThan(cire.roughness!);
	});

	it('neznámy typ padne na default `cire` (nikdy undefined)', () => {
		expect(bazenVyplnVzhlad(undefined)).toEqual(bazenVyplnVzhlad('cire'));
	});

	it('bazenVyplnVzhladZNazvu = skratka názov → vzhľad', () => {
		expect(bazenVyplnVzhladZNazvu('Dymový (bronzový) polykarbonát')).toEqual(
			bazenVyplnVzhlad('dymove')
		);
	});
});
