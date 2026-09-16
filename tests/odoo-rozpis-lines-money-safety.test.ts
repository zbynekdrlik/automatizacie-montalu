// #522: `buildRozpisLines` je Money-NEUTRÁLNY — `lines` posielané na kiosk nesmú niesť žiadnu
// cenu (leak cutterovi). Source-guard + DATA-FLOW guard (vzor `plan-rezov-pdf.test.ts` #511):
// zdrojový guard chytí IMPORT/identifikátor leak vektory, data-flow guard chytí cenu v dátach aj
// po budúcej zmene mapovača (silnejší — mapper môže do `lines` dať len to, čo je v type).
//
// POZOR (plan-rezov-kiosk.md): NEHĽADAJ `/cena/i` v CELOM zdroji — matchol by vlastný komentár
// „žiadna cena". Cieľ len na LEAK VEKTORY (import z ceny/money, `fmtEur`/`€`), inak na kľúče typu.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { spocitajPlanRezov } from '../src/lib/server/plan-rezov';
import { parsePlanRezov } from '../src/lib/server/plan-rezov-vstup';
import { buildRozpisLines } from '../src/lib/server/odoo-rozpis-lines';

const src = fs.readFileSync(
	new URL('../src/lib/server/odoo-rozpis-lines.ts', import.meta.url),
	'utf8'
);

describe('#522 odoo-rozpis-lines Money-neutralita', () => {
	it('neimportuje cenové/Money moduly (leak import nemožný)', () => {
		expect(src).not.toMatch(/from\s+['"]\.\/(ceny|money|odoo-zakazka|zakazka-ceny)['"]/);
	});

	it('nepoužíva cenové identifikátory ani € v kóde', () => {
		expect(src).not.toMatch(/fmtEur|predajVo|cenaSpolu|cenaNakup|nakupCennik|€/);
	});

	it('nezapisuje nikam (žiadny fs zápis, žiadny Money write)', () => {
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open)/);
		expect(src).not.toMatch(/\/data\//);
	});

	it('DATA-FLOW guard: žiadny kľúč RozpisLine nenesie cenu (najsilnejšie)', () => {
		const { riadky, preskocene } = parsePlanRezov('STABILIZAČNÝ PROFIL 100X50\t3\t2000');
		const vysledok = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky }, preskocene);
		const lines = buildRozpisLines(vysledok);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			for (const k of Object.keys(line)) {
				expect(k).not.toMatch(/cena|nakup|predaj|eur|price/i);
			}
		}
	});
});
