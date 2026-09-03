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
const { getEditableRows, saveCfgChanges, getAuditLog } =
	await import('../src/lib/server/cfg-editor');
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
			offsets: new Map([[e.rows[0]!.id, 9999]]),
			skloOffset: e.skloOffset
		});
		expect(error).toContain('rozsah');
		expect(getEditableRows('Robust|2K')!.rows[0]!.offset).toBe(e.rows[0]!.offset);
	});

	it('neznámy štýl / cudzí row id sa odmietne', () => {
		expect(
			saveCfgChanges({ sysStyl: 'Slide|9K', username: 't', offsets: new Map(), skloOffset: 83 })
				.error
		).toBeTruthy();
		expect(
			saveCfgChanges({
				sysStyl: 'Robust|2K',
				username: 't',
				offsets: new Map([[999999, 10]]),
				skloOffset: 135
			}).error
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
		expect(audit[0]!.username).toBe('tester');
		expect(audit[0]!.zmeny).toContain('140');

		// sklo rez v S dimenzii zdieľa offset s rámom
		const skloRez = db
			.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl='Robust|2K' AND typ='sklo' AND dim='S'`)
			.get() as { offset: number };
		expect(skloRez.offset).toBe(ram.offset + 3);

		// výpočet: skloOffset 135→140 posunie sklo o 5, offset rámu +3 o +1.5 na polovici
		const r = safeCompute(loadCfg(), 'Robust|2K', 5000, 2000, false).r!;
		expect(r.sklo.vyska).toBe(1790); // 1795 − 5
		expect(r.sklo.sirka).toBe(2371); // 2374 − 5 + 3/2 = 2370,5 → zaokrúhlené na celé mm

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

	it('Deluxe: editor ukáže JEDEN kladka/klzný riadok a edit zrkadlí 6↔10 (Money množstvo rovnaké)', () => {
		const e = getEditableRows('Deluxe|2K')!;
		// 10mm dvojča je skryté; kanonický riadok je bez hrúbky v názve
		expect(e.rows.some((r) => /10 mm/i.test(r.nazov))).toBe(false);
		expect(e.rows.filter((r) => /kladkov/i.test(r.nazov)).length).toBe(1);
		expect(e.rows.filter((r) => /klzn/i.test(r.nazov)).length).toBe(1);
		const kladka = e.rows.find((r) => /kladkov/i.test(r.nazov))!;

		const { error } = saveCfgChanges({
			sysStyl: 'Deluxe|2K',
			username: 'tester',
			offsets: new Map([[kladka.id, kladka.offset + 2]]),
			skloOffset: e.skloOffset
		});
		expect(error).toBeNull();

		// OBE dvojčatá (6mm ZASP202416 + 10mm ZASP202417) dostali nový offset
		const off = db
			.prepare(
				`SELECT kod, offset FROM cfg_rez WHERE sys_styl='Deluxe|2K' AND kod IN ('ZASP202416','ZASP202417')`
			)
			.all() as { kod: string; offset: number }[];
		expect(off.length).toBe(2);
		expect(off.every((r) => r.offset === kladka.offset + 2)).toBe(true);

		// compute 6mm a 10mm dá IDENTICKÉ množstvo aj po edite (invariant drží)
		const r6 = safeCompute(loadCfg(), 'Deluxe|2K', 5000, 2000, false, 6).r!;
		const r10 = safeCompute(loadCfg(), 'Deluxe|2K', 5000, 2000, false, 10).r!;
		expect(r6.odpis.find((o) => o.kod === 'ZASP202416')!.metre).toBe(
			r10.odpis.find((o) => o.kod === 'ZASP202417')!.metre
		);

		// návrat na pôvodný offset (obe dvojčatá späť)
		saveCfgChanges({
			sysStyl: 'Deluxe|2K',
			username: 'tester',
			offsets: new Map([[kladka.id, kladka.offset]]),
			skloOffset: e.skloOffset
		});
		const back = db
			.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl='Deluxe|2K' AND kod='ZASP202417'`)
			.get() as { offset: number };
		expect(back.offset).toBe(kladka.offset);
	});

	it('Deluxe: sklá = LEN Float kalené 6/10 (bez spoločných ALL skiel)', () => {
		const deluxe = glassTypesForSystem('Deluxe').map((g) => g.nazov);
		expect(deluxe).toEqual(['Float kalené 6 mm', 'Float kalené 10 mm']);
		expect(deluxe.some((n) => /Kalené (8|10)mm/.test(n))).toBe(false);
		// hrúbky sklá
		const g6 = glassTypesForSystem('Deluxe').find((g) => g.nazov === 'Float kalené 6 mm')!;
		const g10 = glassTypesForSystem('Deluxe').find((g) => g.nazov === 'Float kalené 10 mm')!;
		expect(g6.hrubka).toBe(6);
		expect(g10.hrubka).toBe(10);
	});

	it('sklá podľa systému: Robust = len 4/16/4 (IZO-only), Slide = 4/8/4 + 6 mm sklá', () => {
		const robust = glassTypesForSystem('Robust').map((g) => g.nazov);
		const slide = glassTypesForSystem('Slide').map((g) => g.nazov);
		expect(robust).toContain('Izolačné sklo 4/16/4 mliečne');
		expect(robust).toContain('Izolačné sklo 4/16/4 číre');
		expect(robust.some((n) => n.includes('4/8/4'))).toBe(false);
		expect(slide).toContain('Izolačné sklo 4/8/4 mliečne');
		expect(slide).toContain('Izolačné sklo 4/8/4 číre');
		expect(slide.some((n) => n.includes('4/16/4'))).toBe(false);
		// kalené 8/10 patria Robustu — do žiadnej Slide skladby sa nezmestia (Patrik, v17)
		// Robust je IZO-only (Patrik 2026-07-31, migrácia v19) — kalené 8/10 mm
		// sa už neponúkajú nikde
		expect(robust).not.toContain('Kalené 8mm');
		expect(robust).not.toContain('Kalené 10mm');
		expect(slide).not.toContain('Kalené 8mm');
		expect(slide).not.toContain('Kalené 10mm');
		// Slide 6 mm skladba = S redukciou (v17)
		expect(slide).toContain('6mm číre');
		expect(slide).toContain('6mm mliečne');
		expect(slide).toContain('3.3.1');
		for (const n of ['6mm číre', '6mm mliečne', '3.3.1'])
			expect(glassTypesForSystem('Slide').find((g) => g.nazov === n)!.redukciaZero, n).toBe(false);
		// 4/8/4 (skladba 16 mm) redukciu nuluje — obe varianty
		expect(slide.length).toBeGreaterThan(0);
		const cire = glassTypesForSystem('Slide').find((g) => g.nazov === 'Izolačné sklo 4/8/4 číre')!;
		expect(cire.redukciaZero).toBe(true);
		expect(
			glassTypesForSystem('Slide').find((g) => g.nazov === 'Izolačné sklo 4/8/4 mliečne')!
				.redukciaZero
		).toBe(true);
		// Slide 4/8/4 číre v compute vynuluje ZASP00091
		const r = safeCompute(loadCfg(), 'Slide|2K', 3500, 2200, cire.redukciaZero).r!;
		expect(r.odpis.find((o) => o.kod === 'ZASP00091')!.metre).toBe(0);
	});

	it('prepínač skla (redukcia_zero) sa uloží a audituje', () => {
		// #438: prepínač je PER SYSTÉM — cieľ MUSÍ byť sklo TOHTO systému. Predtým test bral
		// listGlassTypes()[0] (Robust sklo „Izolačné 4/16/4 mliečne") a menil ho zo stránky
		// Slide|2K, čo prešlo len vďaka cross-systémovému leaku (WHERE nazov=?), ktorý #438
		// práve opravuje. Vezmi prvé Slide sklo s redukcia_zero=0 (napr. „6mm číre").
		const cieľGlass = glassTypesForSystem('Slide').find((g) => !g.redukciaZero)!;
		const cieľ = cieľGlass.nazov;
		const { zmeny, error } = saveCfgChanges({
			sysStyl: 'Slide|2K',
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows('Slide|2K')!.skloOffset,
			glassRedukcia: new Map([[cieľGlass.id, true]])
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
			glassRedukcia: new Map([[cieľGlass.id, false]])
		});
		expect(listGlassTypes().find((g) => g.nazov === cieľ)!.redukciaZero).toBe(false);
	});
});
