// #569 — konštanty modelu sieťky Štandard (K/R/H) sú EDITOVATEĽNÉ v `/zasklenia/nastavenia`
// (Patrik 1070: „neviem toto nikde upraviť"). Zmena ide cez `saveCfgChanges` v tej istej
// transakcii ako ostatné vzorce a MUSÍ byť v `cfg_audit` (Money-kritický kladkový rez).
import { describe, it, expect, afterAll } from 'vitest';
import { db, loadCfg, getSietkaStandardParams } from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows, getAuditLog } from '../src/lib/server/cfg-editor';
import { safeCompute } from '../src/lib/server/compute';
import { SIETKA_STANDARD_SEED } from '../src/lib/sietka-standard';

const SYS = 'Štandard +|3K';
const zaklad = () => {
	const cur = getEditableRows(SYS)!;
	return {
		sysStyl: SYS,
		username: 'vyroba',
		offsets: new Map<number, number>(cur.rows.map((r) => [r.id, r.offset])),
		skloOffset: cur.skloOffset
	};
};
const bunkaC = () =>
	safeCompute(loadCfg(), SYS, 3000, 1850, false, 0, false, undefined, {
		uchyt: 'ziadny',
		system: 'Štandard'
	}).r!;

afterAll(() => {
	saveCfgChanges({ ...zaklad(), sietkaStandard: { ...SIETKA_STANDARD_SEED } });
});

describe('#569 editor: sieťka Štandard K/R/H', () => {
	it('migrácia naseedovala dnešné hodnoty (K 16,5 / R 17 / H 3)', () => {
		expect(getSietkaStandardParams()).toEqual(SIETKA_STANDARD_SEED);
		expect(bunkaC().sietovina).toEqual({ sirka: 976, vyska: 1738 });
	});

	it('zmena K → zmení kladkový sieťky aj sieťovinu + audit záznam', () => {
		const { zmeny, error } = saveCfgChanges({ ...zaklad(), sietkaStandard: { k: 20 } });
		expect(error).toBeNull();
		expect(zmeny).toEqual([
			expect.objectContaining({
				pole: expect.stringMatching(/Sieťka Štandard.*K/),
				stara: 16.5,
				nova: 20
			})
		]);
		expect(getSietkaStandardParams()).toEqual({ ...SIETKA_STANDARD_SEED, k: 20 });
		const r = bunkaC();
		// 942,5 + 20 = 962,5 → 963 (rez); sieťovina 962,5 + 17 = 979,5 → 980
		expect(r.material.find((m) => m.kod === 'ZASP202415')!.rezy).toEqual([
			{ rozmer: 943, ks: 6 },
			{ rozmer: 963, ks: 2 }
		]);
		expect(r.sietovina).toEqual({ sirka: 980, vyska: 1738 });
		const audit = getAuditLog(1)[0]!;
		expect(audit.sys_styl).toBe(SYS);
		expect(JSON.parse(audit.zmeny)).toEqual(zmeny);
	});

	it('zmena R a H → sieťovina, kladkový (Money) nedotknutý', () => {
		const { error } = saveCfgChanges({ ...zaklad(), sietkaStandard: { k: 16.5, r: 18, h: 4 } });
		expect(error).toBeNull();
		const r = bunkaC();
		expect(r.sietovina).toEqual({ sirka: 977, vyska: 1739 });
		expect(r.material.find((m) => m.kod === 'ZASP202415')!.rezy).toEqual([
			{ rozmer: 943, ks: 6 },
			{ rozmer: 959, ks: 2 }
		]);
	});

	it('preklep mimo medzí sa odmietne a NIČ sa nezapíše (ani audit)', () => {
		const pred = getSietkaStandardParams();
		const auditPred = (db.prepare('SELECT COUNT(*) c FROM cfg_audit').get() as { c: number }).c;
		const { error, zmeny } = saveCfgChanges({ ...zaklad(), sietkaStandard: { k: 999 } });
		expect(error).toMatch(/Sieťka Štandard/);
		expect(zmeny).toEqual([]);
		expect(getSietkaStandardParams()).toEqual(pred);
		expect((db.prepare('SELECT COUNT(*) c FROM cfg_audit').get() as { c: number }).c).toBe(
			auditPred
		);
	});

	it('nezmenené hodnoty = žiadna zmena, žiadny audit', () => {
		const cur = getSietkaStandardParams();
		const { zmeny, error } = saveCfgChanges({ ...zaklad(), sietkaStandard: { ...cur } });
		expect(error).toBeNull();
		expect(zmeny).toEqual([]);
	});

	it('NaN (prázdne pole z formulára) sa odmietne', () => {
		const { error } = saveCfgChanges({ ...zaklad(), sietkaStandard: { h: Number.NaN } });
		expect(error).toMatch(/Sieťka Štandard — H/);
	});

	it('mimo Štandard-rodiny (Robust) sa K/R/H nedajú zapísať', () => {
		const cur = getEditableRows('Robust|3K')!;
		const { error } = saveCfgChanges({
			sysStyl: 'Robust|3K',
			username: 'vyroba',
			offsets: new Map(cur.rows.map((r) => [r.id, r.offset])),
			skloOffset: cur.skloOffset,
			sietkaStandard: { k: 20 }
		});
		expect(error).toMatch(/len pri systéme Štandard/);
		expect(getSietkaStandardParams().k).not.toBe(20);
	});

	it('chýbajúci riadok v DB → seed hodnota (nie pád výpočtu), ostatné z DB', () => {
		saveCfgChanges({ ...zaklad(), sietkaStandard: { r: 18 } });
		db.prepare("DELETE FROM cfg_sietka_standard WHERE kluc = 'h'").run();
		try {
			expect(getSietkaStandardParams()).toEqual({ ...SIETKA_STANDARD_SEED, r: 18 });
		} finally {
			db.prepare("INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('h', ?)").run(
				SIETKA_STANDARD_SEED.h
			);
		}
	});
});
