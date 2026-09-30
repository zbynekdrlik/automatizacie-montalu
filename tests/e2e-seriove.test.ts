// Post-deploy E2E beží paralelne (`E2E_WORKERS` v ci.yml) — specy, ktoré menia ZDIEĽANÚ
// konfiguráciu appky (editor vzorcov, povolené hrúbky skla), musia bežať v sériovom projekte
// (`e2e/seriove.ts` → `playwright.config.ts`). Tento guard padne, keď nový spec začne zapisovať do
// editora a do `SERIOVE_SPECY` sa nepridá (súbežný editor by menil čísla ostatným testom), alebo
// keď zoznam obsahuje neexistujúci súbor (preklep = spec by ticho bežal paralelne).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MUTUJE_CFG, SERIOVE_SPECY } from '../e2e/seriove';

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
