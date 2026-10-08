// #608 dorobenie — tok cez SKUTOČNÉ form akcie modulov (zasklenia, CLIP): druhé odoslanie tej istej
// ZAK+OP vráti blok `uz-odpisane` (OdpisBlok) s re-submit poľami vrátane tokenu `potvrdenie_token`; re-submit
// TÝCH ISTÝCH polí + `override=uz-odpisane` (= čo pošle tlačidlo „Odoslať ako dorobenie") zapíše dorobenie;
// opätovné odoslanie toho istého potvrdenia (refresh výsledku / dvojklik) je znova blok.
// TEST režim (MONEY_LIVE=0) — do ostrého Money NIKDY nič.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-dorobenie-akcie-608-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const zasklenia = await import('../src/routes/zasklenia/+page.server');
const clip = await import('../src/routes/clip/+page.server');
const { db } = await import('../src/lib/server/db');

const LOCALS = { user: { id: 1, username: 'patrik', role: 'internal' } };

function fd(body: Record<string, string> | [string, string][]): FormData {
	const f = new FormData();
	for (const [k, v] of Array.isArray(body) ? body : Object.entries(body)) f.append(k, v);
	return f;
}
async function volaj(
	actions: Record<string, unknown>,
	name: string,
	body: Record<string, string> | [string, string][],
	url = 'http://x/'
) {
	const a = actions[name] as (e: unknown) => Promise<Record<string, unknown>>;
	return a({ request: new Request(url, { method: 'POST', body: fd(body) }), locals: LOCALS });
}
/** Hodnota tokenu potvrdenia v re-submit poliach bloku (stav append-only ledgeru, > 0). */
const token = (entries: [string, string][]) => {
	const t = entries.filter(([k]) => k === 'potvrdenie_token');
	expect(t.length).toBe(1);
	return Number(t[0]![1]);
};
const poradia = (zak: string) =>
	(
		db.prepare('SELECT poradie FROM odpis_log WHERE zak = ? ORDER BY id').all(zak) as {
			poradie: number;
		}[]
	).map((r) => r.poradie);

describe('#608 zasklenia — Odoslať → Odoslať znova → Odoslať ako dorobenie', () => {
	const ZAK = 'ZAK-608-Z';
	const vstup: Record<string, string> = {
		zak: ZAK,
		op: 'OPDL608',
		zakaznik: 'Javorský',
		system: 'Robust',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		farbaKovania: 'R7016'
	};
	let blokEntries: [string, string][] = [];

	it('[RED] druhé odoslanie → step blocked, reason uz-odpisane, re-submit nesie token potvrdenia', async () => {
		const n = await volaj(zasklenia.actions, 'nahlad', vstup);
		const potvrdenie = { ...vstup, planHash: String(n.planHash) };
		expect((await volaj(zasklenia.actions, 'odoslat', potvrdenie)).step).toBe('hotovo');
		const r = await volaj(zasklenia.actions, 'odoslat', potvrdenie);
		expect(r.step).toBe('blocked');
		expect(r.blokReason).toBe('uz-odpisane');
		expect(String(r.error)).toContain('už bola odpísaná');
		blokEntries = r.rawEntries as [string, string][];
		expect(token(blokEntries)).toBeGreaterThan(0);
		expect(blokEntries).toContainEqual(['planHash', String(n.planHash)]);
		expect(poradia(ZAK)).toEqual([1]);
	});

	it('[RED] „Odoslať ako dorobenie" (tie isté polia + override) → hotovo, dorobenie č. 2', async () => {
		const r = await volaj(zasklenia.actions, 'odoslat', [
			...blokEntries,
			['override', 'uz-odpisane']
		]);
		expect(r.step).toBe('hotovo');
		expect(poradia(ZAK)).toEqual([1, 2]);
	});

	it('[RED] refresh výsledku (rovnaký POST s potvrdením) → znova blok, žiadne tretie dorobenie', async () => {
		const r = await volaj(zasklenia.actions, 'odoslat', [
			...blokEntries,
			['override', 'uz-odpisane']
		]);
		expect(r.step).toBe('blocked');
		expect(r.blokReason).toBe('uz-odpisane');
		// nový blok nesie NOVÝ (vyšší) token — ledger sa dorobením posunul
		expect(token(r.rawEntries as [string, string][])).toBeGreaterThan(token(blokEntries));
		expect(poradia(ZAK)).toEqual([1, 2]);
	});
});

describe('#608 CLIP — rovnaký tok v inom module (generický OdpisBlok)', () => {
	const IZO_B1 = { typ: 'izo', variant: '2', sirka: '3000', vyska: '1000', ral: 'RAL 7016' };
	const ZAK = 'CLIP-608';

	it('[RED] druhé odoslanie → blok uz-odpisane; potvrdenie zapíše dorobenie', async () => {
		const telo = { zak: ZAK, op: 'OP1', zakaznik: 'X', ...IZO_B1 };
		expect((await volaj(clip.actions, 'odoslat', telo)).step).toBe('hotovo');
		const b = await volaj(clip.actions, 'odoslat', telo);
		expect(b.step).toBe('blocked');
		expect(b.blokReason).toBe('uz-odpisane');
		const entries = b.rawEntries as [string, string][];
		expect(token(entries)).toBeGreaterThan(0);
		const d = await volaj(clip.actions, 'odoslat', [...entries, ['override', 'uz-odpisane']]);
		expect(d.step).toBe('hotovo');
		expect(poradia(ZAK)).toEqual([1, 2]);
	});
});
