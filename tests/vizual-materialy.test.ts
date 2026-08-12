// Zákaznícky 3D náhľad (#170, vizuálna iterácia #174) — unit testy
// `materialy.ts`. `MeshPhysicalMaterial`/`Color` sú čisté JS objekty (žiadny
// canvas/WebGL kontext potrebný na ich VYTVORENIE, len na `renderer.render()`),
// takže sa dajú testovať priamo v Node so SKUTOČNÝM `three` balíkom — rovnaký
// precedens ako `tests/vizual-builder.test.ts`.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nastavRAL, vytvorHlinikMaterial, vytvorSkloMaterial } from '../src/lib/vizual/materialy';
import { mm } from '../src/lib/vizual/jednotky';

describe('materialy — vytvorSkloMaterial (#174 tier-based sklo)', () => {
	it('"falosne" (low tier): priehľadné (opacity < 0.34 pôvodnej hodnoty), NULOVÁ transmission, silný fresnel', () => {
		const mat = vytvorSkloMaterial(THREE, 8, 'falosne') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		expect(mat.transparent).toBe(true);
		expect(mat.transmission).toBe(0);
		expect(mat.opacity).toBeGreaterThan(0);
		expect(mat.opacity).toBeLessThan(0.5); // stále jasne priehľadné, nie takmer nepriehľadný panel
		// silnejší odraz prostredia — inak sklo nečíta ako sklo nezávisle od
		// toho, čo je za ním (issue #174 nález 1)
		expect(mat.envMapIntensity).toBeGreaterThan(1);
	});

	it('"transmission" (mid/high tier): skutočná fyzikálna priehľadnosť, SKUTOČNE VIDITEĽNÝ Beer–Lambert tint pri 8 mm skle', () => {
		const skloHrubkaMm = 8;
		const mat = vytvorSkloMaterial(THREE, skloHrubkaMm, 'transmission') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		expect(mat.transmission).toBe(1);
		expect(mat.ior).toBeCloseTo(1.5, 6);
		expect(mat.transparent).toBe(false);

		// #174 2. kolo — DÔLEŽITÁ OPRAVA: three.js Beer–Lambert útlm je PO
		// KANÁLI mocnina farby (`transmission_pars_fragment.glsl.js`,
		// `volumeAttenuation()`): transmittance = attenuationColor^(dráha /
		// attenuationDistance) — NIE `exp(-dráha/attenuationDistance)` bez
		// ohľadu na farbu (to bola chyba 1. kola testu — "krátka
		// attenuationDistance" pri BLEDOM attenuationColor stále dáva
		// transmitanciu blízko 1, teda žiadny viditeľný útlm). Tento test
		// počíta SKUTOČNÚ shaderovú formulu priamo z uložených hodnôt
		// materiálu, aby overil, že útlm je naozaj badateľný, nie len
		// teoreticky nenulový.
		const draha = mm(skloHrubkaMm); // rovnaká aproximácia ako getVolumeTransmissionRay pri kolmom pohľade
		const kanaly = ['r', 'g', 'b'] as const;
		const transmitanciaPoKanali = kanaly.map(
			(k) => mat.attenuationColor[k] ** (draha / mat.attenuationDistance)
		);
		// aspoň JEDEN kanál musí byť jasne stlmený (< 0.7) — to je "vidno, že
		// sklo má farbu", nie len "matematicky pod 100 %"
		expect(Math.min(...transmitanciaPoKanali)).toBeLessThan(0.7);
		// a útlm nesmie byť tak silný, že by sklo prestalo byť priehľadné
		// (žiadny kanál úplne nevymiznutý)
		expect(Math.min(...transmitanciaPoKanali)).toBeGreaterThan(0.05);
		expect(mat.envMapIntensity).toBeGreaterThan(1);
	});

	it('OBA režimy majú rovnako posilnený fresnel/špecular (envMapIntensity, specularIntensity) — #174 nález 1+4', () => {
		const falosne = vytvorSkloMaterial(THREE, 8, 'falosne') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		const transmission = vytvorSkloMaterial(THREE, 8, 'transmission') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		for (const mat of [falosne, transmission]) {
			expect(mat.envMapIntensity).toBeGreaterThanOrEqual(1.5);
			expect(mat.specularIntensity).toBeGreaterThanOrEqual(1);
			// clearcoat = druhá lesklá vrstva zachytávajúca kľúčové svetlo ako
			// hot-spot — nezávislé od (prípadne slabého) fresnel odrazu
			// environment mapy pri takmer čelnom pohľade (#174 druhé kolo)
			expect(mat.clearcoat).toBeGreaterThan(0.5);
			expect(mat.clearcoatRoughness).toBeLessThan(0.2);
		}
	});

	it('sklo tint je CHLADNÝ (modrozelený) v OBOCH režimoch — odlišný od teplej steny (textury.ts)', () => {
		const falosne = vytvorSkloMaterial(THREE, 8, 'falosne') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		const transmission = vytvorSkloMaterial(THREE, 8, 'transmission') as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		for (const mat of [falosne, transmission]) {
			// modrozelený tint: modrá zložka >= červená (chladný, nie teplý odtieň)
			expect(mat.color.b).toBeGreaterThanOrEqual(mat.color.r);
		}
	});
});

describe('materialy — vytvorHlinikMaterial (RAL 7016 = tmavá anodizácia)', () => {
	it('RAL 7016 (ANTRACIT, tmavyObrys=false) je TMAVÝ kov — nízka luminancia farby', () => {
		const mat = vytvorHlinikMaterial(THREE, '7016', true) as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		// #383E42 v sRGB je tmavá anodizovaná antracitová — luminancia (priemer
		// RGB) musí byť jasne pod polovicou (potvrdzuje "číta sa ako tmavý
		// antracit", nie vymytá do sivej strednej hodnoty)
		const luminancia = (mat.color.r + mat.color.g + mat.color.b) / 3;
		expect(luminancia).toBeLessThan(0.35);
		expect(mat.metalness).toBeGreaterThan(0.5);
	});

	it('nastavRAL prepne farbu na existujúcej inštancii bez rebuildu (§2.7) — svetlý RAL (9010) má vyššiu luminanciu než 7016', () => {
		const mat = vytvorHlinikMaterial(THREE, '7016', true) as InstanceType<
			typeof THREE.MeshPhysicalMaterial
		>;
		const luminanciaTmava = (mat.color.r + mat.color.g + mat.color.b) / 3;
		const verziaPredZmenou = mat.version;
		nastavRAL(THREE, mat, '9010', true);
		const luminanciaSvetla = (mat.color.r + mat.color.g + mat.color.b) / 3;
		expect(luminanciaSvetla).toBeGreaterThan(luminanciaTmava);
		// `needsUpdate = true` je vo three.js write-only setter (inkrementuje
		// interné `.version`, nie čitateľný boolean) — `.version` je overiteľný
		// dôkaz, že `nastavRAL` naozaj označila materiál na GPU re-upload.
		expect(mat.version).toBeGreaterThan(verziaPredZmenou);
	});
});
