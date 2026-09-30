// Post-deploy E2E beží paralelne (`E2E_WORKERS` v ci.yml) — DVE kategórie specov musia bežať
// v sériovom projekte (`e2e/seriove.ts` → `playwright.config.ts`), každá z INÉHO dôvodu:
//   1. `SERIOVE_SPECY` — menia ZDIEĽANÚ konfiguráciu appky (editor vzorcov, povolené hrúbky skla);
//      súbežný editor by menil čísla ostatným testom.
//   2. `SERIOVE_3D` — čakajú na reálnu three.js/WebGL scénu (softvérový swiftshader na 4-vCPU
//      runneri); pri 3 súbežných workeroch CPU vyhladovie a čakanie na scénu padne na timeoute
//      (#599, post-deploy 0.25.60: zasklenia-zakaznicky `waitForFunction` 60 s).
// Guard padne, keď nový spec spadá do kategórie a nie je v zozname, keď zoznam obsahuje
// neexistujúci / nekvalifikovaný súbor (preklep = spec by ticho bežal paralelne, resp. zbytočný
// serial), alebo keď sériový projekt v configu neberie zjednotenie oboch zoznamov.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	MUTUJE_CFG,
	RENDERUJE_3D,
	SERIOVE_3D,
	SERIOVE_SPECY,
	SERIOVE_VSETKY
} from '../e2e/seriove';

const E2E = path.resolve(__dirname, '../e2e');
const specy = fs.readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));
const text = (f: string) => fs.readFileSync(path.join(E2E, f), 'utf8');

describe('paralelný post-deploy E2E — sériové specy (zdieľaná konfigurácia)', () => {
	it('každý spec so zápisom do editora konfigurácie je v SERIOVE_SPECY', () => {
		const mutujuce = specy.filter((f) => MUTUJE_CFG.test(text(f))).sort();
		expect(mutujuce.length).toBeGreaterThan(0);
		expect(mutujuce.filter((f) => !SERIOVE_SPECY.includes(f))).toEqual([]);
	});

	it('SERIOVE_SPECY obsahuje len existujúce specy, ktoré naozaj zapisujú (žiadny zbytočný serial)', () => {
		for (const f of SERIOVE_SPECY) {
			expect(specy, f).toContain(f);
			expect(MUTUJE_CFG.test(text(f)), f).toBe(true);
		}
	});

	it('MUTUJE_CFG rozpozná zápisové ovládače, nie podobné názvy', () => {
		expect(MUTUJE_CFG.test("getByTestId('ulozit-vzorce')")).toBe(true);
		expect(MUTUJE_CFG.test("getByTestId('pridat-hrubku')")).toBe(true);
		expect(MUTUJE_CFG.test("getByTestId('odobrat-hrubku-24')")).toBe(true);
		expect(MUTUJE_CFG.test("getByTestId('nastavenia-ulozene')")).toBe(false);
		expect(MUTUJE_CFG.test("goto(page, '/zasklenia/nastavenia')")).toBe(false);
	});
});

describe('paralelný post-deploy E2E — sériové specy (CPU-ťažká 3D/WebGL scéna, #599)', () => {
	it('každý spec, ktorý čaká na 3D scénu, je v SERIOVE_3D', () => {
		const renderujuce = specy.filter((f) => RENDERUJE_3D.test(text(f))).sort();
		expect(renderujuce.length).toBeGreaterThan(0);
		expect(renderujuce.filter((f) => !SERIOVE_3D.includes(f))).toEqual([]);
	});

	it('SERIOVE_3D obsahuje len existujúce specy, ktoré naozaj čakajú na 3D scénu', () => {
		expect(SERIOVE_3D.length).toBeGreaterThan(0);
		for (const f of SERIOVE_3D) {
			expect(specy, f).toContain(f);
			expect(RENDERUJE_3D.test(text(f)), f).toBe(true);
		}
	});

	it('RENDERUJE_3D rozpozná čakanie na 3D scénu, nie podobné názvy', () => {
		expect(RENDERUJE_3D.test(`page.locator('[data-viz-ready="true"]')`)).toBe(true);
		expect(RENDERUJE_3D.test("page.getByTestId('vizual3d-canvas')")).toBe(true);
		expect(RENDERUJE_3D.test(`document.querySelector('[data-testid="zakaznicky-obrazok"]')`)).toBe(
			true
		);
		// každý scénový atribút `data-viz-*` (rozmer/RAL/postproc) sa nastaví až z hotovej scény
		expect(RENDERUJE_3D.test(`toHaveAttribute('data-viz-rozmer', '6000×4000')`)).toBe(true);
		expect(RENDERUJE_3D.test(`locator('[data-viz-postproc]')`)).toBe(true);
		// súrodenecké testid-y (placeholder bez obrázka) nie sú čakanie na scénu
		expect(RENDERUJE_3D.test('querySelector(\'[data-testid="zakaznicky-obrazok-chyba"]\')')).toBe(
			false
		);
		expect(RENDERUJE_3D.test("getByTestId('zakaznicky-obrazok-nedostupne')")).toBe(false);
		// overlay / kontajner / poster / cudzí <canvas> nie sú čakanie na vyrenderovanú scénu
		expect(RENDERUJE_3D.test("getByTestId('vizual3d-dotyk-overlay')")).toBe(false);
		expect(RENDERUJE_3D.test("getByTestId('vizual3d-poster')")).toBe(false);
		expect(RENDERUJE_3D.test("querySelectorAll('image, canvas, foreignObject')")).toBe(false);
	});

	it('SERIOVE_VSETKY = zjednotenie oboch kategórií bez duplicít a config ho používa', () => {
		expect([...SERIOVE_VSETKY].sort()).toEqual(
			[...new Set([...SERIOVE_SPECY, ...SERIOVE_3D])].sort()
		);
		expect(new Set(SERIOVE_VSETKY).size).toBe(SERIOVE_VSETKY.length);
		const config = fs.readFileSync(path.resolve(__dirname, '../playwright.config.ts'), 'utf8');
		expect(config).toMatch(/\bSERIOVE_VSETKY\b/);
		expect(config).not.toMatch(/\bSERIOVE_SPECY\b/);
	});
});
