// #524: backfill je Money-NEUTRÁLNY — smie IBA čítať (`detail`/`odpis_polozky`) a nahrať `lines` na
// Odoo; NIKDY nesmie zapísať do Money importu ani do `odpis_log`. Source-guard (vzor
// `odoo-rozpis-lines-money-safety.test.ts` #522) + DATA-FLOW guard: mapper môže do `lines` dať len
// to, čo je v type `RozpisLine` (žiadna cena/kód).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mapOdpisToLines } from '../src/lib/server/backfill-narezaky';
import { loadCfg } from '../src/lib/server/db';

const src = fs.readFileSync(
	new URL('../src/lib/server/backfill-narezaky.ts', import.meta.url),
	'utf8'
);
const depsSrc = fs.readFileSync(
	new URL('../src/lib/server/backfill-narezaky-deps.ts', import.meta.url),
	'utf8'
);

describe('#524 backfill Money-neutralita', () => {
	it('nevolá writeOdpis ani žiadny odpis zápis', () => {
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/INSERT\s+INTO\s+odpis/i);
	});

	it('neimportuje Money-write / ceny moduly (len normOp/normZak/Polozka z money)', () => {
		// import z './money' je povolený (normOp/normZak/Polozka — čisté), ale žiadny cenový modul
		expect(src).not.toMatch(/from\s+['"]\.\/(ceny|odoo-zakazka|zakazka-ceny|kovanie)['"]/);
		expect(src).not.toMatch(/fmtEur|predajVo|cenaSpolu|cenaNakup|€/);
	});

	it('nezapisuje na disk (žiadny fs write, žiadna import cesta /data)', () => {
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open|createWrite)/);
		expect(src).not.toMatch(/\/data\/dlv-import/);
	});

	it('deps (SELECT + Odoo) je READ-ONLY nad odpis_log — žiadny INSERT/UPDATE/DELETE, žiadny writeOdpis', () => {
		// jediný odpis_log dotyk je SELECT; jediný zápis je Odoo montalu_narezak_upload (lines)
		expect(depsSrc).not.toMatch(/writeOdpis\s*\(/);
		expect(depsSrc).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+odpis_log/i);
		expect(depsSrc).toMatch(/SELECT[\s\S]*FROM\s+odpis_log/i); // musí ostať čítanie
	});

	it('DATA-FLOW guard: žiadny kľúč vygenerovaného `lines` riadku nenesie cenu', () => {
		const cfg = loadCfg();
		const cad = '18013 Profil A\t3\t3000';
		const res = mapOdpisToLines(
			{
				id: 1,
				modul: 'pergola',
				zak: 'ZAK',
				op: 'OP1',
				zakaznik: 'T',
				live: 1,
				content_hash: 'x',
				detail: JSON.stringify({ cad }),
				created_at: '2026-09-10 12:00:00'
			},
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines.length).toBeGreaterThan(0);
		for (const line of res.lines) {
			for (const k of Object.keys(line)) {
				expect(k).not.toMatch(/cena|nakup|predaj|eur|price/i);
			}
			expect(line.kod).toBe(''); // Money-neutrálne: žiadny článkový kód na kiosk
		}
	});
});
