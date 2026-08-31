// Audit #30 + #31: keď zápis odpisového súboru ZLYHÁ (nedostupný priečinok, plný disk),
// akcia to musí zachytiť, vrátiť použiteľnú chybu a NECHAŤ používateľovi jeho vstup —
// a hlavne UVOĽNIŤ dedup kľúč, aby sa odoslanie dalo bezpečne zopakovať (inak by
// zákazka zostala „už odoslaná", hoci v Money nič nie je).
//
// Zlyhanie vyrobíme tak, že cieľový priečinok je vnútri SÚBORU (mkdir → ENOTDIR).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-write-fail-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'w.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
// „priečinok", ktorý je v skutočnosti súbor → mkdirSync vyhodí ENOTDIR
const blocker = path.join(tmpRoot, 'blocker');
fs.writeFileSync(blocker, 'nie som priečinok');
process.env.MONEY_TEST_DIR = path.join(blocker, 'export');

const { db } = await import('../src/lib/server/db');
const zasklenia = await import('../src/routes/zasklenia/+page.server');
const pergola = await import('../src/routes/pergola/+page.server');

const logRows = () => (db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }).c;

function ev(mod: string, body: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/' + mod, { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

// posuvy prídu ako JSON pole (viď parseMultiVstup)
// #357: Slide kovanie je zapnuté a jediný jeho Money farebný kód je R7016 (R9005
// zámok má 0 ks skladu, vynechaný) — bez farby by odoslanie padlo skôr, než sa
// vôbec dostane k testovanému zápisovému zlyhaniu.
const MULTI = {
	zak: 'ZAK-F1',
	op: '01',
	zakaznik: 'X',
	farbaKovania: 'R7016',
	posuvy: JSON.stringify([
		{
			system: 'Slide',
			styl: '3K',
			s: 3000,
			v: 2000,
			sklo: 'Izolačné sklo 4/8/4 číre',
			otvaranie: 'P - L'
		}
	])
};

// minimálny platný CAD blok pre pergolu (kódy z katalógu, neutrálna zákazka)
const CAD = [
	'18005 ZAKLAPAVACIA LISTA CELNA\t10\t722',
	'18006 PRITLACNA LISTA\t13\t2651',
	'18013 PROFIL 110x110 V2\t4\t2215',
	'18021 ZLABOVY PROFIL 110 V2\t1\t5930'
].join('\n');

describe('zlyhanie zápisu odpisu — jednoposuv (audit #30)', () => {
	it('odoslat vráti chybu, ponechá vstup a NEZANECHÁ dedup záznam', async () => {
		expect(logRows()).toBe(0);
		const r = await zasklenia.actions.odoslat(
			ev('zasklenia', {
				zak: 'ZAK-F0',
				op: '01',
				zakaznik: 'X',
				system: 'Slide',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Izolačné sklo 4/8/4 číre',
				otvaranie: 'P - L',
				// #357: bez farby by Slide odpis padol skôr, než sa vôbec dostane
				// k testovanému zápisovému zlyhaniu.
				farbaKovania: 'R7016'
			})
		);
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string }).error).toMatch(/NEzapísal/);
		expect((r as { vstup?: { zak: string } }).vstup?.zak).toBe('ZAK-F0');
		// kompenzácia: dedup kľúč uvoľnený → opakovanie je možné
		expect(logRows()).toBe(0);
	});
});

describe('zlyhanie zápisu odpisu — viac posuvov (audit #30)', () => {
	it('odoslatMulti vráti chybu, ZACHOVÁ zadané posuvy a neurobí dedup záznam', async () => {
		const r = await zasklenia.actions.odoslatMulti(ev('zasklenia', MULTI));
		expect(r).toMatchObject({ step: 'form' });
		expect((r as { error?: string }).error).toMatch(/NEzapísal/);
		const mv = (r as { multiVstup?: { zak: string; posuvy: unknown[] } }).multiVstup;
		expect(mv?.zak).toBe('ZAK-F1');
		expect(mv?.posuvy?.length).toBe(1);
		expect(logRows()).toBe(0);
	});
});

describe('zlyhanie zápisu odpisu — pergola (audit #31)', () => {
	it('odoslat sa vráti na NÁHĽAD (nie na prázdny formulár) s chybou a bez dedup záznamu', async () => {
		const r = await pergola.actions.odoslat(
			ev('pergola', { zak: 'ZAK-F2', op: '01', zakaznik: 'X', cad: CAD })
		);
		expect(r).toMatchObject({ step: 'nahlad' });
		expect((r as { error?: string }).error).toMatch(/NEzapísal/);
		// náhľad musí ostať vyplnený, nech sa dá odoslať znova bez opätovného vkladania CAD
		expect((r as { v?: unknown }).v).toBeTruthy();
		expect(logRows()).toBe(0);
	});
});
