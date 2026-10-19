// #613 (druhá časť): `/pouzivatelia` ukáže históriu účtov z `user_audit` — vrátane zmeny hesla
// administrátorom („heslo zmenené"). Dovtedy sa `user_audit` len zapisoval (create / role_change /
// delete / seed) a nikde nebol vidieť. Čas sa zobrazuje v Europe/Bratislava (SQLite `ts` je UTC bez
// zóny — timestamps.md), najnovšie hore, obmedzený počet riadkov.
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import { db, addUser } from '../src/lib/server/db';
import { setPassword } from '../src/lib/server/auth';
import {
	historiaUctov,
	popisAkcieUctu,
	POPIS_AKCIE_UCTU,
	HISTORIA_UCTOV_LIMIT
} from '../src/lib/server/ucty-historia';
import HistoriaUctov from '../src/lib/components/HistoriaUctov.svelte';

const route = await import('../src/routes/pouzivatelia/+page.server');

const zapis = (id: number, ts: string, actor: string, action: string, ucet: string, detail = '') =>
	db
		.prepare(
			'INSERT INTO user_audit (id, ts, actor, action, target_username, detail) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(id, ts, actor, action, ucet, detail);

describe('popis akcií histórie účtov (#613)', () => {
	it('každá akcia má slovenský popis; zmena hesla = „heslo zmenené"', () => {
		expect(popisAkcieUctu('create')).toBe('účet vytvorený');
		expect(popisAkcieUctu('role_change')).toBe('zmena roly');
		expect(popisAkcieUctu('delete')).toBe('účet zmazaný');
		expect(popisAkcieUctu('seed')).toBe('účet založený pri štarte');
		expect(popisAkcieUctu('password_reset')).toBe('heslo zmenené');
	});

	it('neznáma akcia sa ukáže surovo (riadok z histórie nikdy nezmizne)', () => {
		expect(popisAkcieUctu('nieco_nove')).toBe('nieco_nove');
		expect(popisAkcieUctu('constructor')).toBe('constructor');
	});

	it('drift guard: KAŽDÁ akcia povolená CHECK-om user_audit má popis (a žiadny popis navyše)', () => {
		const sql = (
			db
				.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_audit'")
				.get() as {
				sql: string;
			}
		).sql;
		const zoznam = /CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)/.exec(sql)?.[1] ?? '';
		const akcie = [...zoznam.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
		expect(akcie).toContain('password_reset');
		expect(Object.keys(POPIS_AKCIE_UCTU).sort()).toEqual(akcie);
	});
});

describe('historiaUctov — riadky user_audit pre /pouzivatelia (#613)', () => {
	beforeEach(() => {
		db.prepare('DELETE FROM user_audit').run();
	});

	it('najnovšie hore (podľa id), čas v Europe/Bratislava, popis akcie, kto/účet/detail', () => {
		zapis(3, '2026-01-05 13:32:00', 'marek', 'create', 'predaj', 'role=internal');
		zapis(8, '2026-07-01 22:30:00', 'marek', 'password_reset', 'predaj');
		zapis(5, '2026-03-01 08:00:00', '', 'seed', 'kontakt');
		expect(historiaUctov()).toEqual([
			{
				id: 8,
				kedy: '2.7.2026 00:30', // leto = UTC+2, prechod cez polnoc
				kto: 'marek',
				akcia: 'heslo zmenené',
				ucet: 'predaj',
				detail: ''
			},
			{
				id: 5,
				kedy: '1.3.2026 09:00',
				kto: '',
				akcia: 'účet založený pri štarte',
				ucet: 'kontakt',
				detail: ''
			},
			{
				id: 3,
				kedy: '5.1.2026 14:32', // zima = UTC+1
				kto: 'marek',
				akcia: 'účet vytvorený',
				ucet: 'predaj',
				detail: 'role=internal'
			}
		]);
	});

	it(`obmedzí počet riadkov (default ${HISTORIA_UCTOV_LIMIT}, vlastný limit) — najnovšie ostanú`, () => {
		for (let i = 1; i <= HISTORIA_UCTOV_LIMIT + 5; i++)
			zapis(i, '2026-10-19 10:00:00', 'marek', 'create', `ucet-${i}`);
		const h = historiaUctov();
		expect(h).toHaveLength(HISTORIA_UCTOV_LIMIT);
		expect(h[0].ucet).toBe(`ucet-${HISTORIA_UCTOV_LIMIT + 5}`);
		expect(h.at(-1)!.ucet).toBe('ucet-6');
		expect(historiaUctov(2).map((r) => r.id)).toEqual([
			HISTORIA_UCTOV_LIMIT + 5,
			HISTORIA_UCTOV_LIMIT + 4
		]);
	});

	it('/pouzivatelia load vráti históriu — po zmene hesla je navrchu „heslo zmenené" od admina', async () => {
		addUser('hist-t1', 'stare-heslo-h1', 'internal', 'marek');
		expect(setPassword('Hist-T1', 'nove-heslo-h1', 'marek').error).toBeNull();
		const data = (await route.load({
			locals: { user: { id: 1, username: 'marek', role: 'internal' } }
		} as Parameters<typeof route.load>[0])) as { historia: ReturnType<typeof historiaUctov> };
		expect(data.historia.slice(0, 2)).toMatchObject([
			{ kto: 'marek', akcia: 'heslo zmenené', ucet: 'hist-t1', detail: '' },
			{ kto: 'marek', akcia: 'účet vytvorený', ucet: 'hist-t1', detail: 'role=internal' }
		]);
		// heslo sa do histórie nikdy nedostane
		expect(JSON.stringify(data.historia)).not.toContain('nove-heslo-h1');
	});
});

describe('HistoriaUctov komponent (SSR render) (#613)', () => {
	const historia = [
		{
			id: 8,
			kedy: '2.7.2026 00:30',
			kto: 'marek',
			akcia: 'heslo zmenené',
			ucet: 'predaj',
			detail: ''
		},
		{
			id: 4,
			kedy: '20.8.2026 12:00',
			kto: 'marek',
			akcia: 'zmena roly',
			ucet: 'vo@firma.sk',
			detail: 'b2b→internal'
		},
		{
			id: 1,
			kedy: '13.8.2026 10:00',
			kto: '',
			akcia: 'účet založený pri štarte',
			ucet: 'kontakt',
			detail: ''
		}
	];

	it('každý riadok = čas · kto · akcia · účet (+ detail len keď nie je prázdny), v poradí z dát', () => {
		const html = render(HistoriaUctov, { props: { historia } }).body;
		expect(html).toContain('História účtov');
		const riadky = [...html.matchAll(/data-testid="historia-riadok"[^>]*>([\s\S]*?)<\/li>/g)].map(
			(m) =>
				m[1]
					.replace(/<!--[\s\S]*?-->/g, '')
					.replace(/<[^>]+>/g, '')
					.replace(/\s+/g, ' ')
					.trim()
		);
		expect(riadky).toEqual([
			'2.7.2026 00:30 · marek · heslo zmenené · predaj',
			'20.8.2026 12:00 · marek · zmena roly · vo@firma.sk · b2b→internal',
			'13.8.2026 10:00 · — · účet založený pri štarte · kontakt'
		]);
	});

	it('prázdna história = karta s textom, že zatiaľ nič nie je (žiadne riadky)', () => {
		const html = render(HistoriaUctov, { props: { historia: [] } }).body;
		expect(html).toContain('História účtov');
		expect(html).toContain('Zatiaľ žiadne udalosti.');
		expect(html).not.toContain('historia-riadok');
	});
});
