// #514: na výsledkovej obrazovke zasklení sa „Odoslať sklo" (pridatSkla → objednávka
// skla, Money-NEUTRÁLNE) a „uložiť nárezák" (odoslat → Money odpis) museli dať urobiť
// v ľubovoľnom poradí nad TÝM ISTÝM výsledkom. Predtým `pridatSkla` presmerovalo preč
// na /objednavka-skla/[zak] (redirect 303), takže odpisové tlačidlo zmizlo a obsluha
// musela znovu vyplniť a spočítať (Odoo úloha 885, Marek 11.9.).
//
// Oprava (Money-NEUTRÁLNA — writeOdpis/money.ts sa NEtýka): `pridatSkla`/`pridatSklaMulti`
// už NEpresmerúva — vráti späť náhľad (`step: 'nahlad'`) s potvrdením `sklaPridane`, takže
// „uložiť nárezák" (odpis) ostáva dostupné; opakované pridanie toho istého plánu neduplikuje.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isRedirect } from '@sveltejs/kit';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-akcie-poradie-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { actions } = await import('../src/routes/zasklenia/+page.server');
const { listSklaPreZakazku } = await import('../src/lib/server/objednavka-skla');

const LOCALS = { user: { id: 1, username: 'tester', role: 'internal' } };

/** Zavolaj `pridatSkla` s platným jedno-posuvovým vstupom (Slide 3K, ako v
 *  zasklenia-detail-sklo.test.ts). Vráti výsledok akcie, alebo — ak akcia hodí
 *  redirect (staré správanie) — objekt `{ redirect: location }`, aby test vedel
 *  rozlíšiť „vrátil náhľad" od „presmeroval preč". */
async function pridatSkla(extra: Record<string, string>) {
	const fd = new FormData();
	const base: Record<string, string> = {
		zak: 'ZAK-514',
		op: '01',
		zakaznik: 'X',
		system: 'Slide',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/8/4 číre',
		otvaranie: 'P - L',
		farbaKovania: 'R7016'
	};
	for (const [k, v] of Object.entries({ ...base, ...extra })) fd.append(k, v);
	try {
		return await actions.pridatSkla({
			request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
			locals: LOCALS
		} as Parameters<typeof actions.pridatSkla>[0]);
	} catch (e) {
		if (isRedirect(e)) return { redirect: (e as { location: string }).location };
		throw e;
	}
}

describe('#514 zasklenia — „odoslať sklo" + „uložiť nárezák" v ľubovoľnom poradí', () => {
	it('pridatSkla NEpresmerúva preč — vráti náhľad s potvrdením (odpis ostáva dostupný)', async () => {
		const r = (await pridatSkla({ zak: 'ZAK-514-A' })) as Record<string, unknown>;
		// staré (RED) správanie vrátilo { redirect: '/objednavka-skla/...' } → odpis zmizol
		expect('redirect' in r).toBe(false);
		expect(r).toMatchObject({ step: 'nahlad' });
		expect(r.sklaPridane).toBeTruthy();
		expect((r.sklaPridane as { zak: string }).zak).toBe('ZAK-514-A');
		expect((r.sklaPridane as { pridane: number }).pridane).toBe(1);
		// náhľad musí niesť plán + planHash, aby odpisové tlačidlo fungovalo bez prepočtu
		expect(r.plan).toBeTruthy();
		expect(typeof r.planHash).toBe('string');
		expect(listSklaPreZakazku('ZAK-514-A').length).toBe(1);
	});

	it('opakované pridatSkla nad tým istým výsledkom neduplikuje (idempotencia)', async () => {
		const r1 = (await pridatSkla({ zak: 'ZAK-514-B' })) as Record<string, unknown>;
		expect((r1.sklaPridane as { pridane: number }).pridane).toBe(1);
		const r2 = (await pridatSkla({ zak: 'ZAK-514-B' })) as Record<string, unknown>;
		// druhé kliknutie na ten istý plán nič nepridá
		expect((r2.sklaPridane as { pridane: number }).pridane).toBe(0);
		expect(listSklaPreZakazku('ZAK-514-B').length).toBe(1);
	});
});
