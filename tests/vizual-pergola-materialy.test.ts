// Zákaznícky 3D vizuál pergoly (#276) — unit testy aditívnej vetvy `materialy.ts`
// (`vzhlad` override vo `vytvorSkloMaterial` + `nastavSkloVzhlad`). SKUTOČNÝ
// `three` v Node (materiály sú čisté JS objekty), rovnaký precedens ako
// `tests/vizual-materialy.test.ts`.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nastavSkloVzhlad, vytvorSkloMaterial } from '../src/lib/vizual/materialy';
import { pergolaSkloVzhlad } from '../src/lib/vizual/pergola-sklo';

type Mat = InstanceType<typeof THREE.MeshPhysicalMaterial>;

describe('materialy — vytvorSkloMaterial s `vzhlad` override (#276)', () => {
	it('bez `vzhlad` = nezmenené pôvodné zasklenia sklo (spätná kompatibilita)', () => {
		const bez = vytvorSkloMaterial(THREE, 8, 'falosne') as Mat;
		const undef = vytvorSkloMaterial(THREE, 8, 'falosne', undefined) as Mat;
		expect(undef.opacity).toBe(bez.opacity);
		expect(undef.color.getHex()).toBe(bez.color.getHex());
		expect(undef.roughness).toBe(bez.roughness);
	});

	it('`falosne`: matné sklo (vyššie opacity + drsnosť) sa prejaví na materiáli', () => {
		const vzhlad = pergolaSkloVzhlad('matne');
		const mat = vytvorSkloMaterial(THREE, 10, 'falosne', vzhlad) as Mat;
		expect(mat.transparent).toBe(true);
		expect(mat.transmission).toBe(0);
		expect(mat.opacity).toBe(vzhlad.opacity);
		expect(mat.roughness).toBe(vzhlad.roughness);
		expect(mat.color.getHex(THREE.SRGBColorSpace)).toBe(vzhlad.farbaHex);
		// nezmenené fixné vlastnosti (fresnel/specular ostávajú z pôvodného skla)
		expect(mat.envMapIntensity).toBeGreaterThanOrEqual(1.5);
	});

	it('`transmission`: dymové sklo prepíše farbu + attenuationColor + attenuationDistance', () => {
		const vzhlad = pergolaSkloVzhlad('dymove');
		const mat = vytvorSkloMaterial(THREE, 10, 'transmission', vzhlad) as Mat;
		expect(mat.transmission).toBe(1);
		expect(mat.color.getHex(THREE.SRGBColorSpace)).toBe(vzhlad.farbaHex);
		expect(mat.attenuationColor.getHex(THREE.SRGBColorSpace)).toBe(vzhlad.attenuationHex);
		expect(mat.attenuationDistance).toBe(vzhlad.attenuationDistanceM);
		expect(mat.roughness).toBe(vzhlad.roughness);
	});

	it('rôzne typy skla dajú rôzne materiály (číre vs matné)', () => {
		const cire = vytvorSkloMaterial(THREE, 10, 'falosne', pergolaSkloVzhlad('cire')) as Mat;
		const matne = vytvorSkloMaterial(THREE, 10, 'falosne', pergolaSkloVzhlad('matne')) as Mat;
		expect(matne.opacity).toBeGreaterThan(cire.opacity);
		expect(matne.roughness).toBeGreaterThan(cire.roughness);
	});
});

describe('materialy — nastavSkloVzhlad (živá zmena typu skla bez rebuildu)', () => {
	it('`falosne`: prepíše opacity/farbu/drsnosť na existujúcej inštancii + bumpne version', () => {
		const mat = vytvorSkloMaterial(THREE, 10, 'falosne', pergolaSkloVzhlad('cire')) as Mat;
		const verziaPred = mat.version;
		const cieľ = pergolaSkloVzhlad('matne');
		nastavSkloVzhlad(THREE, mat, 'falosne', cieľ);
		expect(mat.opacity).toBe(cieľ.opacity);
		expect(mat.roughness).toBe(cieľ.roughness);
		expect(mat.color.getHex(THREE.SRGBColorSpace)).toBe(cieľ.farbaHex);
		// `needsUpdate=true` je write-only setter → over cez .version (GPU re-upload)
		expect(mat.version).toBeGreaterThan(verziaPred);
	});

	it('`transmission`: prepíše farbu/attenuation/drsnosť na existujúcej inštancii', () => {
		const mat = vytvorSkloMaterial(THREE, 10, 'transmission', pergolaSkloVzhlad('cire')) as Mat;
		const cieľ = pergolaSkloVzhlad('bronzove');
		nastavSkloVzhlad(THREE, mat, 'transmission', cieľ);
		expect(mat.color.getHex(THREE.SRGBColorSpace)).toBe(cieľ.farbaHex);
		expect(mat.attenuationColor.getHex(THREE.SRGBColorSpace)).toBe(cieľ.attenuationHex);
		expect(mat.attenuationDistance).toBe(cieľ.attenuationDistanceM);
		expect(mat.roughness).toBe(cieľ.roughness);
	});

	it('prázdny `vzhlad` (samé undefined polia) padne na pôvodné zasklenia defaulty', () => {
		const mat = vytvorSkloMaterial(THREE, 10, 'falosne', pergolaSkloVzhlad('matne')) as Mat;
		nastavSkloVzhlad(THREE, mat, 'falosne', {});
		const default_ = vytvorSkloMaterial(THREE, 10, 'falosne') as Mat;
		expect(mat.opacity).toBe(default_.opacity);
		expect(mat.color.getHex()).toBe(default_.color.getHex());
		expect(mat.roughness).toBe(default_.roughness);
	});
});
