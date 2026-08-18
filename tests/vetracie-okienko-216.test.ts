// #216 — malé „vetracie okienko" na starom Štandarde a Štandard plus.
//
// Patrik (interný) hlásil, že formulár Zasklení ho pri malom vetracom okienku
// (~1 zo 100 zákaziek) blokuje rozmerovým limitom. Príčina: tvrdý spodný floor
// 300 mm vo `vstup.ts` (parseVstup/parseMultiVstup) — systémovo-agnostický, platí
// aj pre interných. Naviac engine pri PRÍLIŠ malom rozmere ticho zahodí profil so
// zápornou dĺžkou (`profilCuts`: `if (q > 0) kusy.push`) → do Money by šiel
// podhodnotený odpis (Štandard +|2K 130×130 → kladka ZASP202415 = 0 m, bez chyby).
//
// Fix: znížiť vstupný floor 300 → 100 mm + pridať spodný engine guard
// `undersizeCut` (zrkadlo `oversizeCut`), ktorý pri profile/skle ≤ 0 mm zlyhá
// nahlas namiesto tichého zlého odpisu. b2b limity (checkB2BWidth ≥ 800) ostávajú.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup } from '../src/lib/server/vstup';
import { buildCFG, safeCompute, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const base = { zak: 'ZAK1', op: 'OP1', zakaznik: 'X' };

// Systémy, kde Patrik robí vetracie okienka (starý Štandard + Štandard plus).
const SYSTEMY = ['Štandard', 'Štandard +'];

describe('#216 vetracie okienko — interní môžu zadať malé rozmery', () => {
	// (1) Vstupný formulár musí malé okienko PRIJAŤ (predtým blok 300 mm).
	for (const system of SYSTEMY) {
		it(`parseVstup prijme malé okienko 250×300 (${system})`, () => {
			const { error } = parseVstup(
				fd({ ...base, system, styl: '2K', s: '250', v: '300', otvaranie: 'P - L' })
			);
			expect(error).toBeNull();
		});
		it(`parseMultiVstup prijme malé okienko 250×300 (${system})`, () => {
			const posuv = {
				system,
				styl: '2K',
				s: '250',
				v: '300',
				sklo: 'Izolačné sklo 4/16/4 číre',
				otvaranie: 'P - L'
			};
			const { error } = parseMultiVstup(fd({ ...base, posuvy: JSON.stringify([posuv]) }));
			expect(error).toBeNull();
		});
	}

	// (2) Engine dá pri malom (ale platnom) okienku KOREKTNÝ odpis — kladka > 0.
	for (const system of SYSTEMY) {
		it(`safeCompute dá korektný odpis pri 200×250 (${system})`, () => {
			const { r, err } = safeCompute(cfg, `${system}|2K`, 200, 250, false);
			expect(err).toBeNull();
			const kladka = r!.odpis.find((o) => o.kod === 'ZASP202415');
			expect(kladka).toBeTruthy();
			expect(kladka!.metre).toBeGreaterThan(0);
		});
	}

	// (3) Engine pri PRÍLIŠ malom rozmere zlyhá NAHLAS (nie ticho metre=0).
	it('safeCompute odmietne priMALÝ rozmer (Štandard + 130×130) — nie tichý zlý odpis', () => {
		const { r, err } = safeCompute(cfg, 'Štandard +|2K', 130, 130, false);
		expect(err).toBeTruthy();
		expect(r).toBeNull();
	});
});
