// Unit testy auth (scrypt, sessions) + editora vzorcov (bounds, transakcia,
// audit, glass prepínač) — druhá vrstva ochrany Money odpisu.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-auth-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.SEED_USERS = 'tester:tajne-heslo-42';

const { db, hashPassword, verifyPassword, loadCfg, listGlassTypes, glassTypesForSystem } =
	await import('../src/lib/server/db');
const { login, getSessionUser, logout } = await import('../src/lib/server/auth');
const { getEditableRows, saveCfgChanges, getAuditLog } = await import(
	'../src/lib/server/cfg-editor'
);
const { safeCompute } = await import('../src/lib/server/compute');

describe('heslá a sessions', () => {
	it('hash/verify roundtrip, zlé heslo neprejde', () => {
		const h = hashPassword('moje-heslo');
		expect(verifyPassword('moje-heslo', h)).toBe(true);
		expect(verifyPassword('ine-heslo', h)).toBe(false);
		expect(verifyPassword('moje-heslo', 'poskodeny-hash')).toBe(false);
	});

	it('login: neznámy užívateľ / zlé heslo → null; správne → platná session', () => {
		expect(login('neexistuje', 'x')).toBeNull();
		expect(login('tester', 'zle')).toBeNull();
		const token = login('tester', 'tajne-heslo-42');
		expect(token).toBeTruthy();
		expect(getSessionUser(token!)?.username).toBe('tester');
		logout(token!);
		expect(getSessionUser(token!)).toBeNull();
	});

	it('expirovaná session neplatí', () => {
		const token = login('tester', 'tajne-heslo-42')!;
		db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() - 1000, token);
		expect(getSessionUser(token)).toBeNull();
	});
});

describe('editor vzorcov', () => {
	it('načíta editovateľné riadky Robust|2K (5 profilov + skloOffset 135)', () => {
		const e = getEditableRows('Robust|2K')!;
		expect(e.rows.length).toBe(5);
		expect(e.skloOffset).toBe(135);
	});

	it('offset mimo ±500 sa odmietne a DB sa nezmení', () => {
		const e = getEditableRows('Robust|2K')!;
		const { error } = saveCfgChanges({
			sysStyl: 'Robust|2K',
			username: 'tester',
			offsets: new Map([[e.rows[0].id, 9999]]),
			skloOffset: e.skloOffset
		});
		expect(error).toContain('rozsah');
		expect(getEditableRows('Robust|2K')!.rows[0].offset).toBe(e.rows[0].offset);
	});

	it('neznámy štýl / cudzí row id sa odmietne', () => {
		expect(saveCfgChanges({ sysStyl: 'Slide|9K', username: 't', offsets: new Map(), skloOffset: 83 }).error).toBeTruthy();
		expect(
			saveCfgChanges({ sysStyl: 'Robust|2K', username: 't', offsets: new Map([[999999, 10]]), skloOffset: 135 }).error
		).toBeTruthy();
	});

	it('platná zmena: uloží sa, audituje sa, sklo rez sa drží rámu, výpočet ju použije', () => {
		const e = getEditableRows('Robust|2K')!;
		const ram = e.rows.find((r) => /rámový/i.test(r.nazov) && r.dim === 'S')!;
		const { zmeny, error } = saveCfgChanges({
			sysStyl: 'Robust|2K',
			username: 'tester',
			offsets: new Map([[ram.id, ram.offset + 3]]),
			skloOffset: 140
		});
		expect(error).toBeNull();
		expect(zmeny.length).toBe(2);

		// audit
		const audit = getAuditLog(5);
		expect(audit[0].username).toBe('tester');
		expect(audit[0].zmeny).toContain('140');

		// sklo rez v S dimenzii zdieľa offset s rámom
		const skloRez = db
			.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl='Robust|2K' AND typ='sklo' AND dim='S'`)
			.get() as { offset: number };
		expect(skloRez.offset).toBe(ram.offset + 3);

		// výpočet: skloOffset 135→140 posunie sklo o 5, offset rámu +3 o +1.5 na polovici
		const r = safeCompute(loadCfg(), 'Robust|2K', 5000, 2000, false).r!;
		expect(r.sklo.vyska).toBe(1790); // 1795 − 5
		expect(r.sklo.sirka).toBe(2370.5); // 2374 − 5 + 3/2

		// návrat na pôvodné hodnoty
		const back = saveCfgChanges({
			sysStyl: 'Robust|2K',
			username: 'tester',
			offsets: new Map([[ram.id, ram.offset]]),
			skloOffset: 135
		});
		expect(back.error).toBeNull();
		expect(safeCompute(loadCfg(), 'Robust|2K', 5000, 2000, false).r!.sklo.sirka).toBe(2374);
	});

	it('žiadna zmena → prázdny výsledok bez auditu', () => {
		const before = getAuditLog(50).length;
		const e = getEditableRows('Robust|2K')!;
		const { zmeny, error } = saveCfgChanges({
			sysStyl: 'Robust|2K',
			username: 'tester',
			offsets: new Map(e.rows.map((r) => [r.id, r.offset])),
			skloOffset: e.skloOffset
		});
		expect(error).toBeNull();
		expect(zmeny.length).toBe(0);
		expect(getAuditLog(50).length).toBe(before);
	});

	it('sklá podľa systému: Robust = 4/16/4, Slide = 4/8/4 (+ Kalené oba)', () => {
		const robust = glassTypesForSystem('Robust').map((g) => g.nazov);
		const slide = glassTypesForSystem('Slide').map((g) => g.nazov);
		expect(robust).toContain('Izolačné sklo 4/16/4 mliečne');
		expect(robust).toContain('Izolačné sklo 4/16/4 číre');
		expect(robust.some((n) => n.includes('4/8/4'))).toBe(false);
		expect(slide).toContain('Izolačné sklo 4/8/4 mliečne');
		expect(slide).toContain('Izolačné sklo 4/8/4 číre');
		expect(slide.some((n) => n.includes('4/16/4'))).toBe(false);
		// kalené sú v oboch
		expect(robust).toContain('Kalené 8mm');
		expect(slide).toContain('Kalené 8mm');
		// Slide 4/8/4 číre nuluje Redukciu 6mm
		expect(slide.length).toBeGreaterThan(0);
		const cire = glassTypesForSystem('Slide').find((g) => g.nazov === 'Izolačné sklo 4/8/4 číre')!;
		expect(cire.redukciaZero).toBe(true);
		// Slide 4/8/4 číre v compute vynuluje ZASP00091
		const r = safeCompute(loadCfg(), 'Slide|2K', 3500, 2200, cire.redukciaZero).r!;
		expect(r.odpis.find((o) => o.kod === 'ZASP00091')!.metre).toBe(0);
	});

	it('prepínač skla (redukcia_zero) sa uloží a audituje', () => {
		const glass = listGlassTypes();
		const cieľ = glass[0].nazov;
		const { zmeny, error } = saveCfgChanges({
			sysStyl: 'Slide|2K',
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows('Slide|2K')!.skloOffset,
			glassRedukcia: new Map([[cieľ, true]])
		});
		expect(error).toBeNull();
		expect(zmeny.some((z) => z.pole.includes(cieľ))).toBe(true);
		expect(listGlassTypes().find((g) => g.nazov === cieľ)!.redukciaZero).toBe(true);

		// s týmto sklom sa Redukcia 6mm nuluje
		const r = safeCompute(loadCfg(), 'Slide|2K', 3500, 2200, true).r!;
		expect(r.odpis.find((o) => o.kod === 'ZASP00091')!.metre).toBe(0);

		// návrat
		saveCfgChanges({
			sysStyl: 'Slide|2K',
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows('Slide|2K')!.skloOffset,
			glassRedukcia: new Map([[cieľ, false]])
		});
		expect(listGlassTypes().find((g) => g.nazov === cieľ)!.redukciaZero).toBe(false);
	});
});
