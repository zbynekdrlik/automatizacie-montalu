// Zákaznícky 3D náhľad (#170) — unit testy zostávajúcich netestovaných `scena.ts`
// exportov (#177): `vytvorSvetla` (kľúčové/fill svetlo, §2.6 "FIXNÉ NAVŽDY" hodnoty),
// `vytvorOblohu` (obloha mesh), `disposeVsetko` (dispose registry — #170 review raz
// našiel unikajúce listenery; tento test stráži REGRESIU: každá vec v zozname MUSÍ
// dostať zavolané `.dispose()`, aj keď iná vec v zozname pri dispose zhodí výnimku).
// `tests/vizual-scena.test.ts` (#174) pokrýva `vytvorZem`/`vytvorStenu`/
// `vytvorKontaktnyTien` — TENTO súbor dopĺňa zvyšné exporty, ktoré doteraz nemali
// žiadny test (viď STEP 0 komentár na #177).
//
// `vytvorRenderer`/`vytvorEnvironment` VYŽADUJÚ skutočný WebGL kontext
// (`renderer.setPixelRatio`/`PMREMGenerator` volajú GL) — CI nemá GPU, preto sa
// NETESTUJÚ tu (žiadny reálny WebGL kontext v unit testoch, viď
// .claude/rules/vizual3d.md). `vytvorOblohu` naopak nepotrebuje WebGL vôbec (len
// Mesh/Geometry/Material konštrukcia) — potrebuje len `document.createElement
// ('canvas')` polyfill kvôli vnútornému volaniu `vytvorOblohuTexturu` (rovnaký
// no-op stub ako `tests/vizual-scena.test.ts`, obsah pixelov je tu jedno).
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	disposeVsetko,
	vytvorOblohu,
	vytvorSvetla,
	type Disposable
} from '../src/lib/vizual/scena';

beforeAll(() => {
	class FakeGradient {
		addColorStop(): void {
			/* no-op — obsah pixelov appke pre tieto testy nezáleží */
		}
	}
	class FakeCtx {
		fillStyle: unknown = '#000';
		createLinearGradient(): FakeGradient {
			return new FakeGradient();
		}
		fillRect(): void {
			/* no-op */
		}
	}
	class FakeCanvas {
		width = 0;
		height = 0;
		getContext(kind: string): FakeCtx | null {
			return kind === '2d' ? new FakeCtx() : null;
		}
	}
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : null)
	};
});

describe('vytvorSvetla — kľúčové svetlo je FIXNÉ NAVŽDY (§2.6): azimut 135°, elevácia 42°, 12 m', () => {
	it('key: farba 0xfff4ea, intenzita 2.4, pozícia podľa dokumentovaného azimutu/elevácie/vzdialenosti', () => {
		const { key } = vytvorSvetla(THREE);
		expect(key.color.getHex(THREE.SRGBColorSpace)).toBe(0xfff4ea);
		expect(key.intensity).toBe(2.4);

		// Nezávislý prepočet z DOKUMENTOVANÝCH ("FIXNÉ NAVŽDY") hodnôt — ak niekto
		// zmení azimut/eleváciu/vzdialenosť v `vytvorSvetla` bez zmeny dokumentácie,
		// TENTO test to odhalí (nejde o tautológiu re-importujúcu implementáciu).
		const azimut = (135 * Math.PI) / 180;
		const elevacia = (42 * Math.PI) / 180;
		const vzdialenost = 12;
		expect(key.position.x).toBeCloseTo(vzdialenost * Math.cos(elevacia) * Math.sin(azimut), 10);
		expect(key.position.y).toBeCloseTo(vzdialenost * Math.sin(elevacia), 10);
		expect(key.position.z).toBeCloseTo(vzdialenost * Math.cos(elevacia) * Math.cos(azimut), 10);
	});

	it('fill: hemisphere svetlo — obloha 0xcfe3f2 / zem 0xb9ae9d, intenzita 0.3', () => {
		const { fill } = vytvorSvetla(THREE);
		expect(fill.color.getHex(THREE.SRGBColorSpace)).toBe(0xcfe3f2);
		expect(fill.groundColor.getHex(THREE.SRGBColorSpace)).toBe(0xb9ae9d);
		expect(fill.intensity).toBe(0.3);
	});
});

describe('vytvorOblohu — prevrátená sféra, BackSide, netonemapovaná', () => {
	it('geometria: guľa s polomerom 60', () => {
		const obloha = vytvorOblohu(THREE);
		const geo = obloha.geometry as InstanceType<typeof THREE.SphereGeometry>;
		expect(geo.parameters.radius).toBe(60);
	});

	it('materiál: BackSide (kreslí sa "zvnútra" sféry), toneMapped=false (aby gradient neplatil za HDR jas), má mapu', () => {
		const obloha = vytvorOblohu(THREE);
		const mat = obloha.material as InstanceType<typeof THREE.MeshBasicMaterial>;
		expect(mat.side).toBe(THREE.BackSide);
		expect(mat.toneMapped).toBe(false);
		expect(mat.map).not.toBeNull();
	});
});

describe('disposeVsetko — dispose registry completeness (#170 review: raz unikli listenery)', () => {
	it('zavolá .dispose() na KAŽDEJ položke zoznamu', () => {
		const calls: string[] = [];
		const zoznam: Disposable[] = [
			{ dispose: () => calls.push('a') },
			{ dispose: () => calls.push('b') },
			{ dispose: () => calls.push('c') }
		];
		disposeVsetko(zoznam);
		expect(calls).toEqual(['a', 'b', 'c']);
	});

	it('REGRESIA: jedna zhodená výnimka pri dispose NEZABRÁNI disposu zvyšku zoznamu', () => {
		const calls: string[] = [];
		const zoznam: Disposable[] = [
			{ dispose: () => calls.push('a') },
			{
				dispose: () => {
					throw new Error('simulovaná chyba disposu');
				}
			},
			{ dispose: () => calls.push('c') }
		];
		expect(() => disposeVsetko(zoznam)).not.toThrow();
		expect(calls).toEqual(['a', 'c']);
	});

	it('prázdny zoznam je no-op', () => {
		expect(() => disposeVsetko([])).not.toThrow();
	});
});
