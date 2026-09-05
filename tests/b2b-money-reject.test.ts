import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// b2b nesmie zapisovať do Money — UI tlačidlo je skryté, ale skriptovaný POST
// priamo na akciu (bypass UI) musí byť odmietnutý SERVER-SIDE, pred akýmkoľvek
// parsom/výpočtom/zápisom (nález reviewera: chýbalo automatizované pokrytie).

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-b2bmoney-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'r.db');
delete process.env.MONEY_LIVE; // istota — test nesmie nikdy zapisovať do ostrého Money
await import('../src/lib/server/db'); // triggers migrate + seed (all systems/styles)
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { actions: sietkaActions } = await import('../src/routes/sietka/+page.server');

function b2bEvent(body: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'vo', role: 'b2b' } }
	} as Parameters<typeof actions.odoslat>[0];
}

describe('b2b Money-write server reject (forged POST priamo na akciu, obchádza UI)', () => {
	it('odoslat odmietne b2b PRED parsom/výpočtom/zápisom — aj s neplatnými dátami', async () => {
		// zámerne nezmyselný/chýbajúci formulárový obsah — reject musí prísť skôr,
		// než sa vôbec siahne na request.formData()
		const r = await actions.odoslat(b2bEvent({ zak: '1', op: '1', zakaznik: 'x' }));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string })?.error).toMatch(/Veľkoobchodný/);
	});

	it('odoslatMulti odmietne b2b PRED parsom/výpočtom/zápisom', async () => {
		const r = await actions.odoslatMulti(b2bEvent({ zak: '1', op: '1', zakaznik: 'x' }));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string })?.error).toMatch(/Veľkoobchodný/);
	});

	it('interný účet (role != b2b) nie je zablokovaný týmto rejectom (odmietnutie je b2b-špecifické)', async () => {
		const internalEvent = {
			request: new Request('http://x/zasklenia', { method: 'POST', body: new FormData() }),
			locals: { user: { id: 2, username: 'admin', role: 'internal' } }
		} as Parameters<typeof actions.odoslat>[0];
		const r = await actions.odoslat(internalEvent);
		// interný účet prejde cez b2b-reject vetvu ďalej (do parseVstup) — chyba,
		// ak nejaká je, NEsmie byť hláška o veľkoobchode
		expect((r as { error?: string })?.error ?? '').not.toMatch(/Veľkoobchodný/);
	});
});

// /sietka (#89) dostala od korekcie 2026-08-02 vlastnú `odoslat` akciu (rovnaká
// vrstva ako /zasklenia) — rovnaký forged-POST dôkaz, per access-control skill
// §2: „Test the boundary with a forged POST, not just button hidden".
function b2bSietkaEvent(body: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/sietka', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'vo', role: 'b2b' } }
	} as Parameters<typeof sietkaActions.odoslat>[0];
}

describe('b2b Money-write server reject — /sietka odoslat (forged POST, obchádza UI)', () => {
	it('odoslat odmietne b2b PRED parsom/výpočtom/zápisom — aj s neplatnými dátami', async () => {
		const r = await sietkaActions.odoslat(b2bSietkaEvent({ zak: '1', op: '1', zakaznik: 'x' }));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string })?.error).toMatch(/Veľkoobchodný/);
	});

	it('interný účet nie je zablokovaný týmto rejectom (odmietnutie je b2b-špecifické)', async () => {
		const internalEvent = {
			request: new Request('http://x/sietka', { method: 'POST', body: new FormData() }),
			locals: { user: { id: 2, username: 'admin', role: 'internal' } }
		} as Parameters<typeof sietkaActions.odoslat>[0];
		const r = await sietkaActions.odoslat(internalEvent);
		expect((r as { error?: string })?.error ?? '').not.toMatch(/Veľkoobchodný/);
	});
});

// #473 — multi-kus /sietka dostala VLASTNÚ `odoslatMulti` akciu (rovnaká vrstva ako
// jednokusová `odoslat`) — rovnaký forged-POST dôkaz.
describe('b2b Money-write server reject — /sietka odoslatMulti (forged POST, obchádza UI)', () => {
	it('odoslatMulti odmietne b2b PRED parsom/výpočtom/zápisom — aj s neplatnými dátami', async () => {
		const r = await sietkaActions.odoslatMulti(
			b2bSietkaEvent({ zak: '1', op: '1', zakaznik: 'x' })
		);
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string })?.error).toMatch(/Veľkoobchodný/);
	});

	it('interný účet nie je zablokovaný týmto rejectom (odmietnutie je b2b-špecifické)', async () => {
		const internalEvent = {
			request: new Request('http://x/sietka', { method: 'POST', body: new FormData() }),
			locals: { user: { id: 2, username: 'admin', role: 'internal' } }
		} as Parameters<typeof sietkaActions.odoslatMulti>[0];
		const r = await sietkaActions.odoslatMulti(internalEvent);
		expect((r as { error?: string })?.error ?? '').not.toMatch(/Veľkoobchodný/);
	});
});
