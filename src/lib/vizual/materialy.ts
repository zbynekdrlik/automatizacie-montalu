// Zákaznícky 3D náhľad (#170) — materiály: hliník, sklo, RAL → farba (§2.6, §2.7).
import { RAL_PALETA, farbaKonstrukcie } from '$lib/vykres/ral';
import { mm } from './jednotky';

type ThreeNS = typeof import('three');
type Material = InstanceType<ThreeNS['MeshPhysicalMaterial']>;

/** Hliníková konštrukcia — `MeshPhysicalMaterial` podľa §2.6. Tmavá anodizácia
 *  (RAL so `tmavyObrys`) je opticky lesklejšia — §2.7 (`roughness`/`clearcoat`/
 *  `envMapIntensity` sa jemne posunú, farba samotná ostáva presná). */
export function vytvorHlinikMaterial(
	THREE: ThreeNS,
	ralKod: string,
	clearcoatPovoleny: boolean
): Material {
	const farba = farbaKonstrukcie(ralKod);
	const mat = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color(farba.hex),
		metalness: 0.82,
		roughness: 0.32,
		clearcoat: clearcoatPovoleny ? 0.1 : 0,
		clearcoatRoughness: 0.25,
		envMapIntensity: 1.0
	});
	if (farba.tmavyObrys) {
		mat.roughness = 0.28;
		mat.clearcoat = clearcoatPovoleny ? 0.16 : 0;
		mat.envMapIntensity = 1.15;
	}
	return mat;
}

/** Nastaví RAL farbu na UŽ EXISTUJÚCEJ inštancii materiálu (RAL čip mení iba
 *  `material.color`, žiadny rebuild geometrie — §2.7). `ColorManagement` rieši
 *  sRGB→linear prevod sám (`new THREE.Color(hex)`). */
export function nastavRAL(
	THREE: ThreeNS,
	mat: Material,
	ralKod: string,
	clearcoatPovoleny: boolean
): void {
	const farba = farbaKonstrukcie(ralKod);
	mat.color = new THREE.Color(farba.hex);
	mat.roughness = farba.tmavyObrys ? 0.28 : 0.32;
	mat.clearcoat = clearcoatPovoleny ? (farba.tmavyObrys ? 0.16 : 0.1) : 0;
	mat.envMapIntensity = farba.tmavyObrys ? 1.15 : 1.0;
	mat.needsUpdate = true;
}

/** Overí, či appka pozná SKUTOČNÝ odtieň zadaného RAL kódu (5 vzoriek v
 *  palete) — použité na rozhodnutie, či pridať povinnú "ilustračná farba"
 *  poznámku (§2.7, logika samotná žije v `geo/zasklenia.ts`, toto je len malý
 *  pomocník pre komponenty, ktoré potrebujú vedieť to isté bez re-importu RAL
 *  paletového poľa). */
export function jePoznanyRal(ralKod: string): boolean {
	return RAL_PALETA.some((r) => r.kod === ralKod);
}

/** Sklo — buď skutočný transmission pass (jedna zliata geometria + jedna
 *  inštancia materiálu, §2.6), alebo lacnejšia priehľadnosť pre `low` tier
 *  (§2.9: `{ transparent:true, opacity:0.34, roughness:0.05, transmission:0 }`). */
export function vytvorSkloMaterial(
	THREE: ThreeNS,
	skloHrubkaMm: number,
	rezim: 'transmission' | 'falosne'
): Material {
	if (rezim === 'falosne') {
		return new THREE.MeshPhysicalMaterial({
			transparent: true,
			opacity: 0.34,
			roughness: 0.05,
			transmission: 0,
			color: new THREE.Color(0xeaf2ee),
			metalness: 0
		});
	}
	return new THREE.MeshPhysicalMaterial({
		transmission: 1,
		ior: 1.5,
		roughness: 0.08,
		thickness: mm(skloHrubkaMm),
		metalness: 0,
		transparent: false,
		attenuationColor: new THREE.Color(0xeaf2ee),
		attenuationDistance: 6
	});
}
