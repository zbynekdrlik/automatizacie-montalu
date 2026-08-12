// Zákaznícky 3D náhľad (#170) — kamera: auto-fit vzdialenosť, presety, azimut
// clamp. Pure logic (žiadny THREE import — konzument (`scena.ts`) len berie
// vrátené čísla a nastaví `camera.position`/`controls.min*`/`controls.max*`),
// takže je priamo unit-testovateľné.
import { mm } from './jednotky';

export interface Bbox {
	w: number;
	h: number;
	d: number;
}

export interface Preset {
	nazov: string;
	/** stupne */
	azimut: number;
	/** stupne */
	elevacia: number;
}

/** §2.8 — tri primárne presety. `troStvrte` je DEFAULT aj záber pre tlač. */
export const PRESETY = {
	troStvrte: { nazov: '3/4 exteriér', azimut: -32, elevacia: 16 },
	celny: { nazov: 'Čelný', azimut: 0, elevacia: 8 },
	zvnutra: { nazov: 'Zvnútra', azimut: 152, elevacia: 4 }
} as const satisfies Record<string, Preset>;

export type PresetKluc = keyof typeof PRESETY;
export const PRESET_DEFAULT: PresetKluc = 'troStvrte';

/** fov je ZAMKNUTÉ na 35° (§2.8) — žiadna wide-angle deformácia, nikde inde
 *  sa toto číslo nesmie prepisovať. */
export const FOV_DEG = 35;

/** "Zvnútra" NIE JE auto-fit záber — je to fixné oko 1,6 m (§2.8), presne to,
 *  čo robí pohľad "spoza skla von" emocionálne silným (kamera je BLÍZKO
 *  produktu, nie ďaleko od neho ako pri exteriérových presetoch). */
const ZVNUTRA_VZDIALENOST_M = 1.6;

/** Vzdialenosť kamery od stredu bboxu (m), aby sa produkt zmestil do zorného
 *  poľa s `rezerva` (default 15 %) pri danom aspect pomere. Analytický výpočet
 *  priamo z bboxu — NIKDY hardcoded, volajúci ho prepočítava pri každom
 *  resize (§2.8). */
export function autoFitVzdialenost(bbox: Bbox, aspect: number, rezerva = 1.15): number {
	const w = mm(bbox.w) * rezerva;
	const h = mm(bbox.h) * rezerva;
	const vFov = (FOV_DEG * Math.PI) / 180;
	const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.01));
	const distV = h / 2 / Math.tan(vFov / 2);
	const distH = w / 2 / Math.tan(hFov / 2);
	return Math.max(distV, distH, mm(bbox.d) * rezerva, 0.1);
}

/** Vzdialenosť kamery pre daný preset — `zvnutra` má vlastnú fixnú hodnotu,
 *  ostatné použijú auto-fit. */
export function vzdialenostPrePreset(preset: PresetKluc, fitVzdialenost: number): number {
	return preset === 'zvnutra' ? ZVNUTRA_VZDIALENOST_M : fitVzdialenost;
}

/** Cieľ (`OrbitControls.target`) — stred bboxu stiahnutý o 8 % k zemi (m). */
export function fitCiel(bbox: Bbox): { x: number; y: number; z: number } {
	const stredY = mm(bbox.h) / 2;
	return { x: 0, y: stredY * 0.92, z: 0 };
}

/** Sférické súradnice → pozícia kamery okolo `ciel` (m), `azimutDeg`/`elevaciaDeg`
 *  v stupňoch. Azimut 0° = pozdĺž +Z (smerom k pôvodnému pozorovateľovi),
 *  rastie proti smeru hodinových ručičiek okolo osi Y. */
export function poziciaKamery(
	ciel: { x: number; y: number; z: number },
	azimutDeg: number,
	elevaciaDeg: number,
	vzdialenost: number
): { x: number; y: number; z: number } {
	const az = (azimutDeg * Math.PI) / 180;
	const el = (elevaciaDeg * Math.PI) / 180;
	return {
		x: ciel.x + vzdialenost * Math.cos(el) * Math.sin(az),
		y: ciel.y + vzdialenost * Math.sin(el),
		z: ciel.z + vzdialenost * Math.cos(el) * Math.cos(az)
	};
}

export interface OrbitLimity {
	minAzimuthAngle: number;
	maxAzimuthAngle: number;
	minPolarAngle: number;
	maxPolarAngle: number;
	minDistance: number;
	maxDistance: number;
}

/** §2.8 — voľný orbit je ZAKÁZANÝ. Po prepnutí presetu sa azimut zamkne na
 *  `preset ± 50°` — drag je sekundárny doťah, nikdy navigácia. */
export function orbitLimity(preset: Preset, fitVzdialenost: number): OrbitLimity {
	const az = (preset.azimut * Math.PI) / 180;
	const rozsah = (50 * Math.PI) / 180;
	return {
		minAzimuthAngle: az - rozsah,
		maxAzimuthAngle: az + rozsah,
		minPolarAngle: 0.4,
		maxPolarAngle: 1.4,
		minDistance: 0.65 * fitVzdialenost,
		maxDistance: 2.0 * fitVzdialenost
	};
}
