// #613: interný admin nastaví EXISTUJÚCEMU účtu nové heslo (bez znalosti starého). Dovtedy
// appka heslo vedela nastaviť len pri vytvorení účtu → zabudnuté heslo = nepoužiteľný účet
// (PROD 19.10.: `predaj` 4× bad_password, klient sa nevedel prihlásiť). `setPassword`:
// rovnaké pravidlá + `hashPassword` ako `addUser`, meno case-insensitive ako `login()`,
// zruší VŠETKY relácie účtu, vynuluje login-throttle lockout toho mena, zaloguje `auth`
// udalosť (admin, účet) — NIKDY heslo ani hash.
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest';
import { login, getSessionUser, setPassword, MAX_PASSWORD_LEN } from '../src/lib/server/auth';
import { addUser, db } from '../src/lib/server/db';
import {
	recordFailure,
	lockoutRemainingMs,
	_resetThrottle,
	MAX_FAILURES
} from '../src/lib/server/login-throttle';

// LOG_LEVEL len počas capture (moduly sú už importované → migrácie ticho) — vzor
// tests/login-log.test.ts, ale bez úniku logov z ostatných testov tohto súboru na stdout
afterAll(() => delete process.env.LOG_LEVEL);
afterEach(() => vi.restoreAllMocks());

function capture<T>(fn: () => T): { vysledok: T; zaznamy: Record<string, unknown>[] } {
	const riadky: string[] = [];
	process.env.LOG_LEVEL = 'info';
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		riadky.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	let vysledok: T;
	try {
		vysledok = fn();
	} finally {
		spy.mockRestore();
		delete process.env.LOG_LEVEL;
	}
	const zaznamy = riadky
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
	return { vysledok, zaznamy };
}

function hashUctu(username: string): string {
	return (
		db.prepare('SELECT pass_hash FROM users WHERE username = ?').get(username) as {
			pass_hash: string;
		}
	).pass_hash;
}

describe('setPassword — admin nastaví nové heslo existujúcemu účtu (#613)', () => {
	beforeEach(() => _resetThrottle());

	it('staré heslo prestane platiť, nové prejde — aj keď admin napíše meno inou veľkosťou písmen', () => {
		addUser('predaj-t1', 'stare-heslo-1', 'internal');
		const r = setPassword('  Predaj-T1 ', 'nove-heslo-1', 'admin');
		expect(r).toEqual({ error: null, username: 'predaj-t1' });
		expect(login('predaj-t1', 'stare-heslo-1')).toBeNull();
		expect(login('predaj-t1', 'nove-heslo-1')).not.toBeNull();
		// hash je rovnaký formát ako z addUser (scrypt `salt:hash`), nie čistý text
		expect(hashUctu('predaj-t1')).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
	});

	it('funguje aj pre B2B účet', () => {
		addUser('vo-t1@firma.sk', 'stare-heslo-1', 'b2b');
		expect(setPassword('VO-T1@firma.sk', 'nove-heslo-2', 'admin').error).toBeNull();
		expect(login('vo-t1@firma.sk', 'nove-heslo-2')).not.toBeNull();
	});

	it('zruší VŠETKY relácie toho účtu, relácie iného účtu nechá', () => {
		addUser('relacie-t1', 'stare-heslo-1', 'internal');
		addUser('iny-ucet-t1', 'ine-heslo-1', 'internal');
		const t1 = login('relacie-t1', 'stare-heslo-1')!;
		const t2 = login('relacie-t1', 'stare-heslo-1')!;
		const cudzi = login('iny-ucet-t1', 'ine-heslo-1')!;
		expect(getSessionUser(t1)?.username).toBe('relacie-t1');
		expect(getSessionUser(t2)?.username).toBe('relacie-t1');

		expect(setPassword('relacie-t1', 'nove-heslo-3', 'admin').error).toBeNull();

		expect(getSessionUser(t1)).toBeNull();
		expect(getSessionUser(t2)).toBeNull();
		expect(getSessionUser(cudzi)?.username).toBe('iny-ucet-t1');
	});

	it('vynuluje login lockout toho mena naprieč IP (aj keď sa zamkol inou veľkosťou písmen); cudzí lock ostane', () => {
		addUser('zamknuty-t1', 'stare-heslo-1', 'internal');
		const now = Date.now();
		for (let i = 0; i < MAX_FAILURES; i++) {
			recordFailure('Zamknuty-T1', '87.244.229.96', now);
			recordFailure('zamknuty-t1', '10.0.0.7', now);
			recordFailure('niekto-iny', '87.244.229.96', now);
		}
		expect(lockoutRemainingMs('zamknuty-t1', '87.244.229.96')).toBeGreaterThan(0);
		expect(lockoutRemainingMs('zamknuty-t1', '10.0.0.7')).toBeGreaterThan(0);

		expect(setPassword('zamknuty-t1', 'nove-heslo-4', 'admin').error).toBeNull();

		expect(lockoutRemainingMs('zamknuty-t1', '87.244.229.96')).toBe(0);
		expect(lockoutRemainingMs('ZAMKNUTY-t1', '10.0.0.7')).toBe(0);
		expect(lockoutRemainingMs('niekto-iny', '87.244.229.96')).toBeGreaterThan(0);
	});

	it('neznámy účet = chyba, nič sa nezmení', () => {
		addUser('existuje-t1', 'stare-heslo-1', 'internal');
		const pred = hashUctu('existuje-t1');
		const r = setPassword('neexistuje-t1', 'nove-heslo-5', 'admin');
		expect(r.error).toMatch(/neexistuje/i);
		expect(hashUctu('existuje-t1')).toBe(pred);
	});

	it('prázdne meno = chyba', () => {
		expect(setPassword('   ', 'nove-heslo-5', 'admin').error).toBeTruthy();
	});

	it('slabé heslo (< 6 znakov) = chyba, staré heslo ďalej platí, relácie ostanú', () => {
		addUser('slabe-t1', 'stare-heslo-1', 'internal');
		const token = login('slabe-t1', 'stare-heslo-1')!;
		const r = setPassword('slabe-t1', '12345', 'admin');
		expect(r.error).toMatch(/6 znakov/);
		expect(login('slabe-t1', 'stare-heslo-1')).not.toBeNull();
		expect(getSessionUser(token)?.username).toBe('slabe-t1');
	});

	it('príliš dlhé heslo (> MAX_PASSWORD_LEN) = chyba — inak by ho login() odmietol ako too_long', () => {
		addUser('dlhe-t1', 'stare-heslo-1', 'internal');
		const r = setPassword('dlhe-t1', 'x'.repeat(MAX_PASSWORD_LEN + 1), 'admin');
		expect(r.error).toBeTruthy();
		expect(login('dlhe-t1', 'stare-heslo-1')).not.toBeNull();
		// hranica je inkluzívna — presne MAX_PASSWORD_LEN je platné aj pre login
		const presne = 'y'.repeat(MAX_PASSWORD_LEN);
		expect(setPassword('dlhe-t1', presne, 'admin').error).toBeNull();
		expect(login('dlhe-t1', presne)).not.toBeNull();
	});

	it('6 znakov presne je platné (rovnaká hranica ako addUser)', () => {
		addUser('hranica-t1', 'stare-heslo-1', 'internal');
		expect(setPassword('hranica-t1', '123456', 'admin').error).toBeNull();
		expect(login('hranica-t1', '123456')).not.toBeNull();
	});

	it('admin si môže nastaviť heslo aj sám sebe (rovnaká akcia)', () => {
		addUser('admin-sam-t1', 'stare-heslo-1', 'internal');
		expect(setPassword('admin-sam-t1', 'nove-heslo-6', 'admin-sam-t1').error).toBeNull();
		expect(login('admin-sam-t1', 'nove-heslo-6')).not.toBeNull();
	});

	it('audit log `auth` „heslo zmenené administrátorom" — admin, účet, čas; NIKDY heslo ani hash', () => {
		addUser('log-t1', 'stare-heslo-log', 'internal');
		login('log-t1', 'stare-heslo-log');
		const { vysledok, zaznamy } = capture(() =>
			setPassword('Log-T1', 'nove-heslo-log-7', 'spravca')
		);
		expect(vysledok.error).toBeNull();
		const rec = zaznamy.find((z) => z.msg === 'heslo zmenené administrátorom');
		expect(rec).toBeDefined();
		expect(rec!.level).toBe('info');
		expect(rec!.module).toBe('auth');
		expect(rec!.admin).toBe('spravca');
		expect(rec!.username).toBe('log-t1');
		expect(rec!.zruseneRelacie).toBe(1);
		expect(typeof rec!.time).toBe('string');
		const vsetko = JSON.stringify(zaznamy);
		expect(vsetko).not.toContain('nove-heslo-log-7');
		expect(vsetko).not.toContain('stare-heslo-log');
		const [salt, hash] = hashUctu('log-t1').split(':');
		expect(vsetko).not.toContain(salt);
		expect(vsetko).not.toContain(hash);
	});

	it('zamietnutý pokus sa zaloguje ako WARN s dôvodom — bez hesla', () => {
		const { zaznamy } = capture(() => setPassword('nikto-taky-t1', 'tajne-heslo-8', 'spravca'));
		const rec = zaznamy.find((z) => z.msg === 'nové heslo zamietnuté');
		expect(rec).toBeDefined();
		expect(rec!.level).toBe('warn');
		expect(rec!.admin).toBe('spravca');
		expect(rec!.reason).toBe('unknown_user');
		expect(JSON.stringify(zaznamy)).not.toContain('tajne-heslo-8');
	});
});

describe('addUser zdieľa pravidlá hesla so setPassword (#613)', () => {
	it('heslo dlhšie než MAX_PASSWORD_LEN odmietne — login() by ho aj tak nikdy neprijal', () => {
		const r = addUser('dlhe-addUser-t1', 'z'.repeat(MAX_PASSWORD_LEN + 1), 'b2b');
		expect(r.error).toBeTruthy();
		expect(db.prepare('SELECT 1 FROM users WHERE username = ?').get('dlhe-addUser-t1')).toBe(
			undefined
		);
	});
});
