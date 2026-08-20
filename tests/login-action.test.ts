// #251: orchestrácia login akcie — limit dĺžky (400), lockout (6. pokus → lock
// správa; správne heslo počas lockoutu odmietnuté), reset po expirácii aj po
// úspechu. Akcia sa volá priamo s mock eventom; `redirect()` hádže (=úspech),
// `fail()` vracia ActionFailure. Čas ovládame cez Date.now spy (throttle aj
// login používajú Date.now).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { isRedirect, isActionFailure } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-login-action-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'action.db');

const { actions } = await import('../src/routes/login/+page.server');
const { addUser } = await import('../src/lib/server/db');
const { _resetThrottle, MAX_FAILURES, LOCKOUT_MS } =
	await import('../src/lib/server/login-throttle');

const GOOD = 'tajne-heslo-123';

function mkEvent(username: string, password: string, ip = '192.0.2.7') {
	const fd = new FormData();
	fd.set('username', username);
	fd.set('password', password);
	return {
		request: { formData: async () => fd },
		cookies: { set: () => {} },
		url: new URL('http://localhost/login'),
		getClientAddress: () => ip
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

type Res =
	| { kind: 'return'; value: { error?: string; username?: string } }
	| { kind: 'redirect'; location: string }
	| { kind: 'fail'; status: number };

async function run(ev: unknown): Promise<Res> {
	try {
		const value = await actions.default(ev as never);
		if (isActionFailure(value)) return { kind: 'fail', status: value.status };
		return { kind: 'return', value: value as { error?: string; username?: string } };
	} catch (e) {
		if (isRedirect(e)) return { kind: 'redirect', location: (e as { location: string }).location };
		throw e;
	}
}

let clock = 1_700_000_000_000;

describe('login akcia — dĺžka, lockout, reset', () => {
	beforeAll(() => {
		addUser('marek', GOOD, 'internal');
	});
	beforeEach(() => {
		_resetThrottle();
		clock = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => clock);
	});
	afterEach(() => vi.restoreAllMocks());

	it('príliš dlhé meno → fail(400) pred scrypt', async () => {
		const r = await run(mkEvent('a'.repeat(201), GOOD));
		expect(r.kind).toBe('fail');
		if (r.kind === 'fail') expect(r.status).toBe(400);
	});

	it('príliš dlhé heslo → fail(400) pred scrypt', async () => {
		const r = await run(mkEvent('marek', 'x'.repeat(201)));
		expect(r.kind).toBe('fail');
		if (r.kind === 'fail') expect(r.status).toBe(400);
	});

	it('správne prihlásenie → redirect (303) na /zasklenia', async () => {
		const r = await run(mkEvent('marek', GOOD));
		expect(r.kind).toBe('redirect');
		if (r.kind === 'redirect') expect(r.location).toBe('/zasklenia');
	});

	it('6. neúspešný pokus → lock správa; správne heslo počas lockoutu odmietnuté', async () => {
		// prvých MAX_FAILURES pokusov = normálna chyba "Nesprávne..."
		for (let i = 0; i < MAX_FAILURES; i++) {
			const r = await run(mkEvent('marek', 'zle-heslo'));
			expect(r.kind).toBe('return');
			if (r.kind === 'return') expect(r.value.error).toMatch(/Nesprávne/);
		}
		// 6. pokus (aj zlý) → lock správa
		const sixth = await run(mkEvent('marek', 'zle-heslo'));
		expect(sixth.kind).toBe('return');
		if (sixth.kind === 'return') expect(sixth.value.error).toMatch(/Príliš veľa/);
		// KRITICKÉ: aj SPRÁVNE heslo je počas lockoutu odmietnuté (do expirácie)
		const correctDuringLock = await run(mkEvent('marek', GOOD));
		expect(correctDuringLock.kind).toBe('return');
		if (correctDuringLock.kind === 'return')
			expect(correctDuringLock.value.error).toMatch(/Príliš veľa/);
	});

	it('po expirácii lockoutu správne heslo znova prejde', async () => {
		for (let i = 0; i < MAX_FAILURES; i++) await run(mkEvent('marek', 'zle-heslo'));
		expect((await run(mkEvent('marek', GOOD))).kind).toBe('return'); // ešte zamknuté
		clock += LOCKOUT_MS + 1; // posun za expiráciu
		const r = await run(mkEvent('marek', GOOD));
		expect(r.kind).toBe('redirect');
	});

	it('lockout je per (username, ip) — iná IP toho istého mena prejde', async () => {
		for (let i = 0; i < MAX_FAILURES; i++) await run(mkEvent('marek', 'zle-heslo', '198.51.100.1'));
		// útočníkova IP je zamknutá, ale reálny marek z inej IP so správnym heslom prejde
		const r = await run(mkEvent('marek', GOOD, '10.20.30.40'));
		expect(r.kind).toBe('redirect');
	});

	it('úspech vyčistí počítadlo — preklepy pred úspechom neuzamknú', async () => {
		for (let i = 0; i < MAX_FAILURES - 1; i++) await run(mkEvent('marek', 'zle-heslo'));
		expect((await run(mkEvent('marek', GOOD))).kind).toBe('redirect'); // 5. pokus správne
		// po úspechu je štít čistý; ďalšie 4 preklepy stále neuzamknú
		for (let i = 0; i < MAX_FAILURES - 1; i++) {
			const r = await run(mkEvent('marek', 'zle-heslo'));
			// #251 review 🔵 #7a: assert kind PRV, inak by nesprávny kind ticho prešiel
			expect(r.kind).toBe('return');
			if (r.kind === 'return') expect(r.value.error).toMatch(/Nesprávne/);
		}
	});

	it('SÚBEŽNÉ pokusy neobídu 5-limit — najviac MAX_FAILURES scryptov (review 🔴 #2)', async () => {
		// Bez re-checku PO backoffe prejde počiatočnú kontrolu N súbežných požiadaviek
		// (všetky vidia failures<5) a vyhodnotia N scryptov (concurrency bypass). Re-check
		// po awaite + synchrónny scrypt+record serializuje admission → max MAX_FAILURES.
		const N = 40;
		const results = await Promise.all(
			Array.from({ length: N }, () => run(mkEvent('marek', 'zle-heslo', '192.0.2.99')))
		);
		const evaluated = results.filter(
			(r) => r.kind === 'return' && /Nesprávne/.test(r.value.error ?? '')
		).length;
		const locked = results.filter(
			(r) => r.kind === 'return' && /Príliš veľa/.test(r.value.error ?? '')
		).length;
		expect(evaluated).toBeLessThanOrEqual(MAX_FAILURES); // ← RED bez fixu (bolo by 40)
		expect(evaluated + locked).toBe(N); // všetky skončili buď chybou alebo lockom
		expect(locked).toBe(N - evaluated);
	});
});
