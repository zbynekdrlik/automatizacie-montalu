// Zákaznícky 3D vizuál pergoly (#276) — unit testy mapovania typu skla na
// vzhľad (`pergola-sklo.ts`). Čistá logika, žiadny THREE/DOM.
import { describe, expect, it } from 'vitest';
import {
	pergolaSkloVzhlad,
	PERGOLA_SKLA_NAZVY,
	PERGOLA_TYP_SKLA_DEFAULT,
	type PergolaTypSkla
} from '../src/lib/vizual/pergola-sklo';

const VSETKY: PergolaTypSkla[] = ['cire', 'dymove', 'bronzove', 'matne'];

describe('pergolaSkloVzhlad — každý typ má úplný, platný vzhľad', () => {
	it('všetky typy vracajú kompletné číselné polia (farba/opacity/útlm/drsnosť)', () => {
		for (const typ of VSETKY) {
			const v = pergolaSkloVzhlad(typ);
			expect(typeof v.farbaHex).toBe('number');
			expect(typeof v.opacity).toBe('number');
			expect(typeof v.attenuationHex).toBe('number');
			expect(typeof v.attenuationDistanceM).toBe('number');
			expect(typeof v.roughness).toBe('number');
			expect(v.opacity!).toBeGreaterThan(0);
			expect(v.opacity!).toBeLessThanOrEqual(1);
			expect(v.attenuationDistanceM!).toBeGreaterThan(0);
		}
	});

	it('undefined / neznámy typ → default (číre)', () => {
		expect(pergolaSkloVzhlad(undefined)).toEqual(pergolaSkloVzhlad(PERGOLA_TYP_SKLA_DEFAULT));
		expect(PERGOLA_TYP_SKLA_DEFAULT).toBe('cire');
		// neplatný typ (mimo enumu) tiež padne na default, nikdy undefined
		expect(pergolaSkloVzhlad('xxx' as PergolaTypSkla)).toEqual(pergolaSkloVzhlad('cire'));
	});
});

describe('pergolaSkloVzhlad — typy sa vizuálne líšia (priehľadnosť per typ)', () => {
	it('číre je najpriehľadnejšie (najnižšie opacity), matné najmenej (najvyššie)', () => {
		const cire = pergolaSkloVzhlad('cire').opacity!;
		const matne = pergolaSkloVzhlad('matne').opacity!;
		const dymove = pergolaSkloVzhlad('dymove').opacity!;
		const bronzove = pergolaSkloVzhlad('bronzove').opacity!;
		expect(cire).toBeLessThan(dymove);
		expect(cire).toBeLessThan(bronzove);
		expect(cire).toBeLessThan(matne);
		expect(matne).toBeGreaterThanOrEqual(Math.max(dymove, bronzove));
	});

	it('matné (opál) má výrazne vyššiu drsnosť než číre (mliečny, nie lesklý povrch)', () => {
		expect(pergolaSkloVzhlad('matne').roughness!).toBeGreaterThan(
			pergolaSkloVzhlad('cire').roughness! + 0.2
		);
	});

	it('každý typ má inú farbu tabule (žiadne dva identické)', () => {
		const farby = VSETKY.map((t) => pergolaSkloVzhlad(t).farbaHex);
		expect(new Set(farby).size).toBe(VSETKY.length);
	});
});

describe('PERGOLA_SKLA_NAZVY — popisky pre všetky typy', () => {
	it('má neprázdny slovenský názov pre každý typ', () => {
		for (const typ of VSETKY) {
			expect(PERGOLA_SKLA_NAZVY[typ]).toBeTruthy();
			expect(PERGOLA_SKLA_NAZVY[typ].length).toBeGreaterThan(2);
		}
	});
});
