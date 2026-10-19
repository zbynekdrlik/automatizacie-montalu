import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// /pouzivatelia (#142): voľba roly pri založení účtu + zmena roly z UI. Rola sa
// odteraz číta z formulára (`pridat`), čo je bezpečné LEN preto, že b2b aktér je
// odmietnutý PRED čítaním `role` — over to skriptovaným (sfalšovaným) POSTom, nie
// len že tlačidlo/select nie sú v UI vidno (skill access-control §2: "Test the
// boundary with a forged POST, not just button hidden").

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pouzivatelia-actions-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'r.db');
const dbMod = await import('../src/lib/server/db');
const authMod = await import('../src/lib/server/auth');
const { actions } = await import('../src/routes/pouzivatelia/+page.server');

function event(body: Record<string, string>, user: { id: number; username: string; role: string }) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/pouzivatelia', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof actions.pridat>[0];
}

const b2bActor = { id: 1, username: 'vo', role: 'b2b' };

describe('/pouzivatelia akcie — forged POST od b2b je odmietnutý PRED spracovaním', () => {
	it('pridat: b2b nemôže založiť účet ani s role=internal vo formulári', async () => {
		const r = await actions.pridat(
			event({ username: 'utocnik', password: 'tajneheslo', role: 'internal' }, b2bActor)
		);
		expect(r).toMatchObject({ status: 403 });
		expect(dbMod.listUsers().find((u) => u.username === 'utocnik')).toBeUndefined();
	});

	it('zmazat: b2b nemôže zmazať účet', async () => {
		const r = await actions.zmazat(event({ id: '1' }, b2bActor));
		expect(r).toMatchObject({ status: 403 });
	});

	it('zmenit_rolu: b2b nemôže zmeniť rolu žiadneho účtu', async () => {
		dbMod.addUser('cielovy-ucet', 'tajneheslo', 'b2b');
		const target = dbMod.listUsers().find((u) => u.username === 'cielovy-ucet')!;
		const r = await actions.zmenit_rolu(
			event({ id: String(target.id), role: 'internal' }, b2bActor)
		);
		expect(r).toMatchObject({ status: 403 });
		expect(dbMod.listUsers().find((u) => u.id === target.id)?.role).toBe('b2b');
	});
});

describe('/pouzivatelia akcie — interný aktér', () => {
	const internalActor = { id: 100, username: 'admin', role: 'internal' };

	it('pridat s role=internal vo formulári vytvorí interný účet (dôvera je v isB2B gate, nie v skrytie poľa)', async () => {
		const r = await actions.pridat(
			event({ username: 'novy-sef', password: 'tajneheslo1', role: 'internal' }, internalActor)
		);
		expect(r).toMatchObject({ ok: expect.stringContaining('Interný') });
		expect(dbMod.listUsers().find((u) => u.username === 'novy-sef')?.role).toBe('internal');
	});

	it('pridat bez role vo formulári defaultuje na b2b (späť-kompatibilné so starým formulárom)', async () => {
		const r = await actions.pridat(
			event({ username: 'bez-roly', password: 'tajneheslo1' }, internalActor)
		);
		expect(r).toMatchObject({ ok: expect.stringContaining('B2B') });
		expect(dbMod.listUsers().find((u) => u.username === 'bez-roly')?.role).toBe('b2b');
	});

	it('zmenit_rolu: vlastnú rolu si aktér nemôže zmeniť (server-side, aj keby UI ovládač obišiel)', async () => {
		// self-check porovnáva id → aktér musí byť SKUTOČNÝ riadok v DB (zmenit_rolu
		// najprv načíta cieľový účet podľa `id`, až potom porovná s aktérom).
		dbMod.addUser('sam-seba', 'tajneheslo1', 'internal');
		const self = dbMod.listUsers().find((u) => u.username === 'sam-seba')!;
		const selfActor = { id: self.id, username: self.username, role: 'internal' };
		const r = await actions.zmenit_rolu(event({ id: String(self.id), role: 'b2b' }, selfActor));
		expect(r).toMatchObject({ status: 400 });
		expect((r as { data?: { error?: string } }).data?.error).toMatch(/Vlastnú/);
		expect(dbMod.listUsers().find((u) => u.id === self.id)?.role).toBe('internal');
	});

	it('zmenit_rolu: neplatná hodnota role je odmietnutá', async () => {
		dbMod.addUser('neplatna-rola-ciel', 'tajneheslo1', 'b2b');
		const target = dbMod.listUsers().find((u) => u.username === 'neplatna-rola-ciel')!;
		const r = await actions.zmenit_rolu(
			event({ id: String(target.id), role: 'superadmin' }, internalActor)
		);
		expect(r).toMatchObject({ status: 400 });
	});
});

// #613: nové heslo existujúcemu účtu. Rovnaká brána ako ostatné akcie — b2b aj neprihlásený
// sú odmietnutí PRED čítaním formulára (forged POST, nie „tlačidlo nie je vidno").
describe('/pouzivatelia noveHeslo (#613)', () => {
	const internalActor = { id: 100, username: 'admin', role: 'internal' };
	// testovacie heslá sú zámerne len fixture do dočasnej DB tohto súboru
	const POVODNE = 'povodne-heslo';
	const CIZIE = 'utocnik-heslo';
	const NOVE = 'nove-heslo-613';

	/** telo formulára „Nastaviť nové heslo" (heslo + potvrdenie, default zhodné) */
	function hesloForm(username: string, heslo: string, potvrdenie = heslo) {
		return { username, password: heslo, password2: potvrdenie };
	}

	it('množina akcií routy je presne táto — nová akcia nesmie prekĺznuť bez gate testu', () => {
		expect(Object.keys(actions).sort()).toEqual(['noveHeslo', 'pridat', 'zmazat', 'zmenit_rolu']);
	});

	it('b2b nemôže nastaviť heslo žiadnemu účtu (ani internému) — 403, staré heslo platí ďalej', async () => {
		dbMod.addUser('obet-b2b-613', POVODNE, 'internal');
		const r = await actions.noveHeslo(event(hesloForm('obet-b2b-613', CIZIE), b2bActor));
		expect(r).toMatchObject({ status: 403 });
		expect(authMod.login('obet-b2b-613', POVODNE)).not.toBeNull();
		expect(authMod.login('obet-b2b-613', CIZIE)).toBeNull();
	});

	it('neprihlásený (locals.user = null) — 403', async () => {
		dbMod.addUser('obet-anon-613', POVODNE, 'internal');
		const e = event(hesloForm('obet-anon-613', CIZIE), b2bActor);
		(e as unknown as { locals: { user: null } }).locals = { user: null };
		const r = await actions.noveHeslo(e);
		expect(r).toMatchObject({ status: 403 });
		expect(authMod.login('obet-anon-613', POVODNE)).not.toBeNull();
	});

	it('interný: heslá sa nezhodujú → 400, nič sa nezmení', async () => {
		dbMod.addUser('nezhoda-613', POVODNE, 'b2b');
		const r = await actions.noveHeslo(
			event(hesloForm('nezhoda-613', NOVE, NOVE + '-preklep'), internalActor)
		);
		expect(r).toMatchObject({ status: 400 });
		expect((r as { data?: { error?: string } }).data?.error).toMatch(/nezhodujú/);
		expect(authMod.login('nezhoda-613', POVODNE)).not.toBeNull();
	});

	it('interný: slabé heslo → 400 s pravidlom, nič sa nezmení', async () => {
		dbMod.addUser('slabe-613', POVODNE, 'b2b');
		const r = await actions.noveHeslo(event(hesloForm('slabe-613', '123'), internalActor));
		expect(r).toMatchObject({ status: 400 });
		expect((r as { data?: { error?: string } }).data?.error).toMatch(/6 znakov/);
		expect(authMod.login('slabe-613', POVODNE)).not.toBeNull();
	});

	it('interný: nové heslo nastavené — staré neprejde, nové prejde, odpoveď nesie účet', async () => {
		dbMod.addUser('predaj-613', POVODNE, 'internal');
		const r = await actions.noveHeslo(event(hesloForm('Predaj-613', NOVE), internalActor));
		expect(r).toMatchObject({ ucet: 'predaj-613', ok: expect.stringContaining('predaj-613') });
		expect(JSON.stringify(r)).not.toContain(NOVE);
		expect(authMod.login('predaj-613', POVODNE)).toBeNull();
		expect(authMod.login('predaj-613', NOVE)).not.toBeNull();
	});

	it('interný: neexistujúci účet → 400', async () => {
		const r = await actions.noveHeslo(event(hesloForm('nikto-613', NOVE), internalActor));
		expect(r).toMatchObject({ status: 400 });
	});
});
