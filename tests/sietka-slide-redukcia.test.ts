// Sieťka na Slide — vlastný redukčný profil (#90) — Patrik, Odoo kanál 207,
// 2026-08-03 (msg #1614895 „Redukcia pre sieťku Surový 7500 mm - ZASP20252",
// nadväzuje na #1614827 bod 2: „sa vkladá ten sieťkový profil miesto zúžovacieho").
//
// Kód potvrdený priamo Patrikom + overený v Money SQL (Sklady_Zasoba, read-only,
// 2026-08-03: karta existuje, Deleted=0). Počet kusov/dĺžka sú ODVODENÉ (nie
// doslovne dané) z existujúceho „Redukcia 6mm" (ZASP00091) riadku — jedno okno
// navyše = rovnaký vzorec (2 ks S-smer + 2 ks V-smer), nový kód, nezávisle od
// `redukciaZero` (sieťovina nie je sklo — pozri #90 komentár, kde je toto
// odvodenie explicitne označené ako neisté a treba ho dať Patrikovi potvrdiť pred
// prvou reálnou objednávkou).
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	computeFlat,
	computeMulti,
	sietkaSlideExtra,
	type SysRow,
	type RezRow
} from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

describe('#90 — Slide sieťka pridáva vlastnú redukciu (ZASP20252)', () => {
	it('bez sieťky: ZASP20252 sa v odpise vôbec nenachádza (Money-neutrálne)', () => {
		const bez = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, null)!;
		expect(bez.odpis.some((o) => o.kod === 'ZASP20252')).toBe(false);
	});

	it('so sieťkou: 2 ks S-smer + 2 ks V-smer, odvodené z existujúceho vzorca „Redukcia 6mm" pre 3K', () => {
		const so = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = so.material.find((m) => m.kod === 'ZASP20252')?.rezy;
		expect(rezy).toEqual([
			{ rozmer: 1180, ks: 2 }, // S-smer: round((3500+39)/3) = 1180
			{ rozmer: 1936, ks: 2 } // V-smer: 2001-65 = 1936
		]);
		expect(so.material.find((m) => m.kod === 'ZASP20252')?.nazov).toBe(
			'Redukcia pre sieťku Surový 7500 mm'
		);
	});

	it('NEZÁVISLÉ od redukciaZero — sieťková redukcia ide aj keď je zvolené sklo, ktoré NULUJE Redukciu 6mm', () => {
		// redukciaZero=true by pri BEŽNEJ Redukcii 6mm dalo 0 ks (iné sklo než 6mm) —
		// sieťková redukcia to VÔBEC nesleduje, lebo sieťovina nie je sklo
		const soRedukciaZero = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const soRedukciaNieZero = computeFlat(cfg, 'Slide|3K', 3500, 2001, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = (r: typeof soRedukciaZero) => r.material.find((m) => m.kod === 'ZASP20252')?.rezy;
		expect(rezy(soRedukciaZero)).toEqual(rezy(soRedukciaNieZero));
		expect(rezy(soRedukciaZero)).toEqual([
			{ rozmer: 1180, ks: 2 },
			{ rozmer: 1936, ks: 2 }
		]);
	});

	it('existujúca Redukcia 6mm (ZASP00091) ostáva úplne nedotknutá pri sieťke', () => {
		const bez = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, null)!;
		const so = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = (r: typeof bez) => r.material.find((m) => m.kod === 'ZASP00091')?.rezy;
		expect(rezy(so)).toEqual(rezy(bez));
	});

	it('computeFlat vs computeMulti (rovnaký posuv) dávajú bit-identický odpis so sieťkou', () => {
		const flat = computeFlat(cfg, 'Slide|3K', 3500, 2001, true, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const multi = computeMulti(cfg, [
			{ sysStyl: 'Slide|3K', S: 3500, V: 2001, redukciaZero: true, sietka: { uchyt: 'ziadny' } }
		])!;
		expect(multi.odpis).toEqual(flat.odpis);
	});

	it('sabotáž: keby delta chýbala, tento test by ju odhalil (kontrolný dôkaz)', () => {
		const bez = computeFlat(cfg, 'Slide|2K', 2551, 1601, true, 0, false, undefined, null)!;
		const so = computeFlat(cfg, 'Slide|2K', 2551, 1601, true, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		expect(so.odpis.length).toBe(bez.odpis.length + 1);
		expect(so.odpis.some((o) => o.kod === 'ZASP20252')).toBe(true);
	});

	it('sietkaSlideExtra: neznámy štýl vráti chybu, nie tichý pád', () => {
		const { rezy, err } = sietkaSlideExtra(cfg, 'neexistuje', 3500, 2001, 3);
		expect(rezy).toEqual([]);
		expect(err).toMatch(/Konfigurácia Slide chýba/);
	});
});
