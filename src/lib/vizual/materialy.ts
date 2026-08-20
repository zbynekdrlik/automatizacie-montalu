// Zákaznícky 3D náhľad (#170) — materiály: hliník, sklo, RAL → farba (§2.6, §2.7).
import { farbaKonstrukcie } from '$lib/vykres/ral';
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

/** Sklo — buď skutočný transmission pass (jedna zliata geometria + jedna
 *  inštancia materiálu, §2.6), alebo lacnejšia priehľadnosť pre `low` tier
 *  (§2.9).
 *
 *  #174 vizuálna iterácia, 1. kolo — pôvodné hodnoty (opacity 0.34 / bledá
 *  0xeaf2ee / attenuationDistance 6) v OBOCH režimoch vyzerali ako mliečny
 *  plast, lebo tint skla bol tónovo takmer identický so stenou za ním.
 *
 *  #174, 2. kolo (DÔLEŽITÁ OPRAVA) — "skrátiť attenuationDistance" SAMO
 *  OSEBE nestačí. Three.js počíta útlm cez Beer–Lambert PO KANÁLI:
 *  `transmittance = attenuationColor ^ (dráhaVSkle / attenuationDistance)`
 *  (`transmission_pars_fragment.glsl.js`, `volumeAttenuation()`) — to je
 *  MOCNINA farby, nie exponenciála vzdialenosti samotnej. Pri takmer BIELOM
 *  `attenuationColor` je aj pri agresívne krátkej `attenuationDistance`
 *  výsledok stále blízko 1 (prakticky žiadny viditeľný útlm) — presne prečo
 *  1. kolo (kratšia distance, ale stále bledý `attenuationColor`) vizuálne
 *  takmer nič nezmenilo. Skutočný, viditeľný tint potrebuje SÝTY (nie bledý)
 *  `attenuationColor`.
 *
 *  POZOR pri prepočítavaní tejto formuly ručne: `THREE.Color`'s `.r/.g/.b`
 *  sú po `ColorManagement` sRGB→LINEÁRNOM prevode (three@0.185, zapnuté
 *  defaultne), NIE surové `hex/255` zlomky — `0x2f9478` je sRGB (0.18, 0.58,
 *  0.47), ale `new THREE.Color(0x2f9478).r/.g/.b` je (0.03, 0.30, 0.19).
 *  Prepočet zo surových sRGB zlomkov namiesto skutočných `.r/.g/.b` hodnôt
 *  dá viditeľne iné (nesprávne) číslo — presne táto chyba sa stala v
 *  predchádzajúcej verzii tohto komentára (adversariálny review #174).
 *  Skutočná transmitancia pri danej hrúbke/attenuationDistance je overená
 *  priamo v `tests/vizual-materialy.test.ts` cez `mat.attenuationColor[k]`
 *  (teda tie isté, už skonvertované lineárne hodnoty, ktoré shader použije)
 *  — ten test je zdroj pravdy, nie ilustračné čísla v komentári.
 *
 *  `clearcoat` pridáva DRUHÚ, nezávislú lesklú vrstvu zachytávajúcu priame
 *  kľúčové svetlo (§2.6, fixné) ako viditeľný "hot-spot" — vizuálna skratka
 *  "toto je lesklé sklo" nezávislá od (pri takmer čelnom pohľade fyzikálne
 *  slabého) fresnel odrazu environment mapy, rovnaká technika, akú
 *  `vytvorHlinikMaterial` už používa pre kov. */
export function vytvorSkloMaterial(
	THREE: ThreeNS,
	skloHrubkaMm: number,
	rezim: 'transmission' | 'falosne'
): Material {
	const clearcoatSpolocne = { clearcoat: 0.85, clearcoatRoughness: 0.04 };
	if (rezim === 'falosne') {
		return new THREE.MeshPhysicalMaterial({
			transparent: true,
			// #174 3. kolo: 2. kolo (opacity 0.32, farba 0x3fae8c) vizuálne
			// čítalo ako SÝTE zelené sklo, nie "jemný modrozelený nádych" zo
			// zadania — znížené opacity aj zosvetlená/menej sýta farba dávajú
			// stále jasne VIDITEĽNÝ, ale jemnejší tón (overené screenshotom)
			opacity: 0.26,
			roughness: 0.04,
			transmission: 0,
			color: new THREE.Color(0x8fcab3),
			metalness: 0,
			envMapIntensity: 1.6,
			specularIntensity: 1.3,
			specularColor: new THREE.Color(0xffffff),
			...clearcoatSpolocne
		});
	}
	return new THREE.MeshPhysicalMaterial({
		transmission: 1,
		ior: 1.5,
		roughness: 0.06,
		thickness: mm(skloHrubkaMm),
		metalness: 0,
		transparent: false,
		// takmer neutrálna — tint nesie hlavne attenuationColor (Beer–Lambert),
		// `color` by pri sýtej hodnote útlm len duplicitne prehĺbil
		color: new THREE.Color(0xf2faf7),
		// #174 3. kolo: 2. kolo (attenuationDistance 0.02) čítalo naživo ako
		// SÝTE zelené sklo, nie "jemný modrozelený nádych" zo zadania. Väčšia
		// attenuationDistance (0.035) pri rovnakej sýtej `attenuationColor`
		// dáva jemnejší, ale stále jasne VIDITEĽNÝ tón — overené screenshotom
		// AJ `tests/vizual-materialy.test.ts` (skutočná Beer–Lambert
		// transmitancia po kanáli, viď funkcie vlastný header komentár vyššie
		// pre presnú formulu a upozornenie na lineárny vs. sRGB priestor).
		attenuationColor: new THREE.Color(0x2f9478),
		attenuationDistance: 0.035,
		envMapIntensity: 1.6,
		specularIntensity: 1.3,
		specularColor: new THREE.Color(0xffffff),
		...clearcoatSpolocne
	});
}
