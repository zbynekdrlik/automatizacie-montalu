// #570 (doplnok): odpisy zapísané PRED migráciou v44 (issue 504, 10.9.) nesú v `detail.vstupRaw` názvy
// skiel, ktoré v44 z katalógu Štandard + zmazala („Izolačné sklo 4.8.4", „Float sklo 10 mm"). Rekomputa
// nárezáku (backfill + živý upload pri odpise) cez `skloPre` ich nenájde → „vyber typ skla" → OP dostane
// 0 riadkov na kiosk (PROD: OPDL260208 / ZAK2026528, posuvy 2 a 3). Rekomputačná cesta preto rozlíši
// legacy názov na jeho Money-identickú náhradu z v44. Uložený `detail` sa NIKDY neprepisuje.
import { describe, it, expect } from 'vitest';
import { loadCfg } from '../src/lib/server/db';
import { mapOdpisToLines, type OdpisBackfillRow } from '../src/lib/server/backfill-narezaky';
import { legacySkloNazov } from '../src/lib/server/zasklenia-sklo';

const cfg = loadCfg();

function posuv(system: string, styl: string, sklo: string) {
	return {
		system,
		styl,
		s: 2000,
		v: 1000,
		sklo,
		skloPresne: '',
		skloTrieda: null,
		otvaranie: '',
		kovanieL: '',
		kovanieP: '',
		kovanieStred: '',
		kovanieStredOkno: 'L',
		kliny: [],
		kolajnica: null,
		sietka: null
	};
}

function multiRow(posuvy: ReturnType<typeof posuv>[]): OdpisBackfillRow {
	const vstupRaw = {
		zak: 'ZAK2026528',
		op: 'OPDL260208',
		zakaznik: 'Test',
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		posuvy
	};
	return {
		id: 1,
		modul: 'zasklenia',
		zak: 'ZAK2026528',
		op: 'OPDL260208',
		zakaznik: 'Test',
		live: 1,
		content_hash: 'x',
		detail: JSON.stringify({ multiZasklenie: true, vstupRaw }),
		created_at: '2026-09-07 10:00:00'
	};
}

function singleRow(p: ReturnType<typeof posuv>): OdpisBackfillRow {
	const vstupRaw = {
		zak: 'ZAKL1',
		op: 'OP570901',
		zakaznik: 'Test',
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		...p
	};
	return {
		...multiRow([]),
		detail: JSON.stringify({ system: p.system, styl: p.styl, vstupRaw })
	};
}

describe('#570 legacy názvy skiel zmazané migráciou v44 — rekomputa nárezáku', () => {
	it('zimná záhrada s „Izolačné sklo 4.8.4" (Štandard +) → lines > 0, zhodné s náhradou 4/8/4 číre', () => {
		const stary = mapOdpisToLines(
			multiRow([
				posuv('Robust', '2K', 'Izolačné sklo 4/16/4 číre'),
				posuv('Štandard +', '2K', 'Izolačné sklo 4.8.4'),
				posuv('Štandard +', '2K', 'Izolačné sklo 4.8.4')
			]),
			[],
			cfg
		);
		expect(stary.status).toBe('lines');
		if (stary.status !== 'lines') return;
		expect(stary.lines.length).toBeGreaterThan(0);

		const novy = mapOdpisToLines(
			multiRow([
				posuv('Robust', '2K', 'Izolačné sklo 4/16/4 číre'),
				posuv('Štandard +', '2K', 'Izolačné sklo 4/8/4 číre'),
				posuv('Štandard +', '2K', 'Izolačné sklo 4/8/4 číre')
			]),
			[],
			cfg
		);
		expect(novy.status).toBe('lines');
		if (novy.status !== 'lines') return;
		expect(stary.lines).toEqual(novy.lines);
	});

	it('jednoposuv Štandard + s „Float sklo 10 mm" → lines zhodné s náhradou „ESG kalené 10 mm"', () => {
		const stary = mapOdpisToLines(
			singleRow(posuv('Štandard +', '2K', 'Float sklo 10 mm')),
			[],
			cfg
		);
		const novy = mapOdpisToLines(singleRow(posuv('Štandard +', '2K', 'ESG kalené 10 mm')), [], cfg);
		expect(stary.status).toBe('lines');
		expect(novy.status).toBe('lines');
		if (stary.status !== 'lines' || novy.status !== 'lines') return;
		expect(stary.lines.length).toBeGreaterThan(0);
		expect(stary.lines).toEqual(novy.lines);
	});

	it('alias platí aj pre starý „Štandard" (zdieľa katalóg Štandard + cez GLASS_SYSTEM_ALIAS)', () => {
		expect(legacySkloNazov('Štandard', 'Izolačné sklo 4.8.4')).toBe('Izolačné sklo 4/8/4 číre');
		expect(legacySkloNazov('Štandard Drevo', 'Float sklo 10 mm')).toBe('ESG kalené 10 mm');
	});

	it('mimo Štandard + katalógu sa názov NEMENÍ (Robust/Slide „Float sklo 10 mm" stále existuje)', () => {
		expect(legacySkloNazov('Robust', 'Float sklo 10 mm')).toBe('Float sklo 10 mm');
		expect(legacySkloNazov('Slide', 'Float sklo 10 mm')).toBe('Float sklo 10 mm');
		expect(legacySkloNazov('Štandard +', 'Izolačné sklo 4/8/4 číre')).toBe(
			'Izolačné sklo 4/8/4 číre'
		);
	});

	it('neznáme sklo ostáva honest-fail (skip recompute-failed), žiadny tichý fallback', () => {
		const res = mapOdpisToLines(
			multiRow([posuv('Štandard +', '2K', 'Neexistujúce sklo 9.9.9')]),
			[],
			cfg
		);
		expect(res).toEqual({ status: 'skip', reason: 'recompute-failed' });
	});

	it('uložený detail sa NEPREPISUJE — rekomputa pracuje na kópii', () => {
		const row = multiRow([posuv('Štandard +', '2K', 'Izolačné sklo 4.8.4')]);
		const pred = row.detail;
		mapOdpisToLines(row, [], cfg);
		expect(row.detail).toBe(pred);
		expect(row.detail).toContain('Izolačné sklo 4.8.4');
	});
});
