// Meshe PRODUKTU pergoly/zasklenia (ram/kolajnica/klucka/klin/sklo/sietka) — extrahované z
// `Vizual3D.svelte` (#329, large-file-split.md: cap 1000 r. platí pre CELÉ `src/**` vrátane
// komponentov; Vizual3D prekročil strop). ČISTÉ funkcie (všetky vstupy ako argumenty, žiadny
// modulový stav ani DOM) — presunuté doslovne (façade-split variant #249): `Vizual3D` ich len
// importuje. Volajú ich `postavScenu()` (prvá stavba) aj `prestavGeometriuProduktu()` (in-place
// zmena geometrie), oddelené od rendereru/kamery/svetiel/scény.
import type { Rola, VizVysledok } from '$lib/vizual/spec';
import { SKLO_HRUBKA_DEFAULT_MM } from '$lib/vizual/konstanty';
import { postavGeometrie, type MergeGeometriesFn } from '$lib/vizual/builder';
import {
	vytvorHlinikMaterial,
	vytvorSkloMaterial,
	type HlinikMapy,
	type SkloVzhlad
} from '$lib/vizual/materialy';
import {
	vytvorHlinikNormalMapu,
	vytvorHlinikRoughMapu,
	vytvorSkloOdrazMapu
} from '$lib/vizual/textury';
import type { nastaveniaPreTier } from '$lib/vizual/kvalita';
import type { Disposable } from '$lib/vizual/scena';

type ThreeNS = typeof import('three');

// #356: hustota mikro-reliéf máp v DLAŽDICIACH NA METER (builder.ts robí UV v metroch,
// viď metreUvBox) → svetovo-rovnomerné tilovanie na VŠETKÝCH plochách bez natiahnutia
// (review 🟡). Hliník: 8/m ≈ 12,5 cm dlaždica (jemné práškované zrno); sklo: nízka
// hustota (nízkofrekvenčná vlna, len rozbitie odrazu).
const HLINIK_MAP_DLAZDICE_NA_M = 8;
const SKLO_MAP_DLAZDICE_NA_M = 1.5;

/** Materiály konštrukcie (ram/kolajnica/klucka/klin zdieľajú JEDNU `hlinik` inštanciu) — pre RAL
 *  update (`prekresliRAL`). Sklo/sieťka materiály tento map nedrží (dispose ide cez produktMeshe). */
export type ProduktMateriale = Partial<Record<Rola, InstanceType<ThreeNS['MeshPhysicalMaterial']>>>;

export interface PostavProduktVysledok {
	materialy: ProduktMateriale;
	produktMeshe: InstanceType<ThreeNS['Mesh']>[];
	skloMaterial: InstanceType<ThreeNS['MeshPhysicalMaterial']> | null;
}

export function zlikvidujProduktMeshe(meshe: InstanceType<ThreeNS['Mesh']>[]) {
	for (const mesh of meshe) {
		mesh.geometry.dispose();
		const mat = mesh.material as unknown as Disposable | Disposable[];
		for (const m of Array.isArray(mat) ? mat : [mat]) {
			// #356: Material.dispose() sám NEuvoľní svoje textúry (three ich zdieľa) —
			// mikro-reliéf mapy by inak unikli pri každom prestavGeometriuProduktu/remount.
			// Dispose je idempotentný → zdieľaný hliník (1 inštancia na 4 meshe) znesie
			// viacnásobné volanie bez ujmy.
			const mapy = m as unknown as {
				normalMap?: Disposable | null;
				roughnessMap?: Disposable | null;
				clearcoatNormalMap?: Disposable | null;
			};
			mapy.normalMap?.dispose();
			mapy.roughnessMap?.dispose();
			mapy.clearcoatNormalMap?.dispose();
			m.dispose();
		}
	}
}

/** Postaví MESHE PRODUKTU (ram/kolajnica/klucka/klin/sklo/sietka) a pridá ich do `scene` —
 *  ODDELENÉ od `postavScenu()`, aby to isté vedela zavolať aj `prestavGeometriuProduktu()`
 *  (napr. "Otvoriť") BEZ toho, aby sa dotkla rendereru/kamery/svetiel/zeme/steny/oblohy.
 *  `materialy` je len pre RAL update (`prekresliRAL()`); dispose ide cez `produktMeshe`
 *  (`zlikvidujProduktMeshe`), nie cez tento map (ten sklo/sietka materiály vôbec nedrží). */
export function postavProduktMeshe(
	THREE: ThreeNS,
	mergeGeometries: MergeGeometriesFn,
	scene: InstanceType<ThreeNS['Scene']>,
	vysledok: VizVysledok,
	ralKod: string,
	nastavenia: ReturnType<typeof nastaveniaPreTier>,
	skloVzhlad: SkloVzhlad | undefined
): PostavProduktVysledok {
	const geometrie = postavGeometrie(vysledok.diely, THREE, mergeGeometries);
	const materialy: ProduktMateriale = {};
	const produktMeshe: InstanceType<ThreeNS['Mesh']>[] = [];
	let skloMaterial: InstanceType<ThreeNS['MeshPhysicalMaterial']> | null = null;

	// #356: mikro-reliéf mapy LEN na mid/high (`plochyGradientMiestoMap` je low-tier
	// flag) — low tier ostáva PLOCHÝ (perf + spätne kompatibilné s #285/#170 testami).
	const bohateMaterialy = !nastavenia.plochyGradientMiestoMap;
	let hlinikMapy: HlinikMapy | undefined;
	if (bohateMaterialy) {
		const normalMap = vytvorHlinikNormalMapu(THREE);
		const roughnessMap = vytvorHlinikRoughMapu(THREE);
		for (const t of [normalMap, roughnessMap]) {
			t.wrapS = t.wrapT = THREE.RepeatWrapping;
			t.repeat.set(HLINIK_MAP_DLAZDICE_NA_M, HLINIK_MAP_DLAZDICE_NA_M);
		}
		hlinikMapy = { normalMap, roughnessMap };
	}

	const hlinik = vytvorHlinikMaterial(THREE, ralKod, nastavenia.clearcoat, hlinikMapy);
	for (const rola of ['ram', 'kolajnica', 'klucka', 'klin'] as const) {
		const geo = geometrie[rola];
		if (!geo) continue;
		materialy[rola] = hlinik;
		const mesh = new THREE.Mesh(geo, hlinik);
		// #285: hliníková konštrukcia vrhá aj prijíma reálny tieň (mid/high)
		mesh.castShadow = nastavenia.tiene;
		mesh.receiveShadow = nastavenia.tiene;
		scene.add(mesh);
		produktMeshe.push(mesh);
	}
	if (geometrie.sklo) {
		// review nález 🟡 #4: predtým natvrdo `8` — duplicitné magické číslo oproti
		// `SKLO_HRUBKA_DEFAULT_MM` (ktoré `geo/zasklenia.ts` už používa pre samotnú geometriu skla,
		// `tvar.d`). Appka dnes nezbiera per-objednávku hrúbku skla vo formulári zasklenia-navrh,
		// takže presná hodnota z `ZaskleniaVizVstup.skloPresne` sa sem (mimo `vysledok.diely`)
		// nedostane — zdieľaný default aspoň nevie "rozísť" s geometriou, ak sa zmení.
		// #356: jemná clearcoat normal mapa (mid/high) — rozbije zrkadlový odraz bez
		// dotyku číreho priehľadu skla. Vytvorená AŽ TU (len keď sklo existuje), aby
		// neunikla pri produktoch bez skla; dispose ide cez `zlikvidujProduktMeshe`.
		// UV skla je teraz v metroch (metreUvBox) → nutný RepeatWrapping + hustota/m,
		// inak by ClampToEdge default mapu roztiahol/prilepil cez celú tabuľu.
		const skloOdraz = bohateMaterialy ? vytvorSkloOdrazMapu(THREE) : undefined;
		if (skloOdraz) {
			skloOdraz.wrapS = skloOdraz.wrapT = THREE.RepeatWrapping;
			skloOdraz.repeat.set(SKLO_MAP_DLAZDICE_NA_M, SKLO_MAP_DLAZDICE_NA_M);
		}
		const skloMat = vytvorSkloMaterial(
			THREE,
			SKLO_HRUBKA_DEFAULT_MM,
			nastavenia.sklo,
			skloVzhlad,
			skloOdraz
		);
		skloMaterial = skloMat;
		const mesh = new THREE.Mesh(geometrie.sklo, skloMat);
		// #285: sklo prijíma tieň, ale NEvrhá (transmisné sklo by vrhalo nefyzikálny nepriehľadný tieň)
		mesh.receiveShadow = nastavenia.tiene;
		scene.add(mesh);
		produktMeshe.push(mesh);
	}
	if (geometrie.sietka) {
		// sieťkový panel — vizuál, nie katalóg (appka dnes nezbiera samostatné rozmery sieťky,
		// len boolean prítomnosť — §2.5)
		const sietkaMat = new THREE.MeshStandardMaterial({
			color: 0x1e293b,
			transparent: true,
			opacity: 0.28,
			side: THREE.DoubleSide,
			roughness: 0.7,
			metalness: 0
		});
		const mesh = new THREE.Mesh(geometrie.sietka, sietkaMat);
		scene.add(mesh);
		produktMeshe.push(mesh);
	}

	return { materialy, produktMeshe, skloMaterial };
}
