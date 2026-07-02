// Serverová validácia vstupu (rozsahy sa NEdajú obísť skriptovaným POSTom)
// + open-redirect ochrana safeNext.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseVstup } from '../src/lib/server/vstup';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-vstup-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const { safeNext } = await import('../src/lib/server/auth');

function fd(over: Record<string, string> = {}): FormData {
	const base: Record<string, string> = {
		zak: 'ZAK-1',
		op: '01',
		zakaznik: 'Zákazník',
		system: 'Robust',
		styl: '2K',
		s: '2509',
		v: '1930',
		sklo: 'Izolačné sklo 4/16/4 mliečne',
		otvaranie: 'P - L'
	};
	const form = new FormData();
	for (const [k, v] of Object.entries({ ...base, ...over })) form.set(k, v);
	return form;
}

describe('parseVstup — serverové rozsahy', () => {
	it('platný vstup prejde, čiarka ako desatinná bodka funguje', () => {
		const { vstup, error } = parseVstup(fd({ s: '2509,5' }));
		expect(error).toBeNull();
		expect(vstup.s).toBe(2509.5);
	});

	it.each([
		['s', '50', 'Šírka'],
		['s', '99999', 'Šírka'],
		['s', 'abc', 'Šírka'],
		['v', '10', 'Výška'],
		['v', '-2000', 'Výška']
	])('rozmer mimo 300–20000 sa odmietne (%s=%s)', (k, v, msg) => {
		const { error } = parseVstup(fd({ [k]: v }));
		expect(error).toContain(msg);
	});

	it('chýbajúce povinné polia sa odmietnu', () => {
		expect(parseVstup(fd({ zak: ' ' })).error).toContain('ZAK');
		expect(parseVstup(fd({ op: '' })).error).toContain('OP');
		expect(parseVstup(fd({ zakaznik: '' })).error).toContain('ákazník');
	});

	it('neznáme otváranie sa odmietne', () => {
		expect(parseVstup(fd({ otvaranie: 'hore' })).error).toContain('otváranie');
	});
});

describe('safeNext — open redirect', () => {
	it('platné relatívne cesty prejdú', () => {
		expect(safeNext('/zasklenia/nastavenia?sysStyl=Slide%7C2K')).toBe(
			'/zasklenia/nastavenia?sysStyl=Slide%7C2K'
		);
		expect(safeNext('/odpisy')).toBe('/odpisy');
	});

	it('externé a protokol-relatívne ciele padnú na default', () => {
		expect(safeNext('https://evil.example/login')).toBe('/zasklenia');
		expect(safeNext('//evil.example')).toBe('/zasklenia');
		expect(safeNext('/\\evil.example')).toBe('/zasklenia');
		expect(safeNext('javascript:alert(1)')).toBe('/zasklenia');
		expect(safeNext(null)).toBe('/zasklenia');
		expect(safeNext('')).toBe('/zasklenia');
	});
});
