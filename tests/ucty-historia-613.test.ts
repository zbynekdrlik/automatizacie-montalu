// #613 (druhá časť): `/pouzivatelia` ukáže históriu účtov z `user_audit` — vrátane zmeny hesla
// administrátorom („heslo zmenené"). Dovtedy sa `user_audit` len zapisoval (create / role_change /
// delete / seed) a nikde nebol vidieť. Čas sa zobrazuje v Europe/Bratislava (SQLite `ts` je UTC bez
// zóny — timestamps.md), najnovšie hore, obmedzený počet riadkov.
import { describe, it, expect, beforeEach } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { db, addUser } from '../src/lib/server/db';
import { setPassword, MAX_USERNAME_LEN } from '../src/lib/server/auth';
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
		expect(h[0]?.ucet).toBe(`ucet-${HISTORIA_UCTOV_LIMIT + 5}`);
		expect(h.at(-1)!.ucet).toBe('ucet-6');
		expect(historiaUctov(2).map((r) => r.id)).toEqual([
			HISTORIA_UCTOV_LIMIT + 5,
			HISTORIA_UCTOV_LIMIT + 4
		]);
	});

	it('filter na účet: len udalosti toho účtu (meno bez ohľadu na veľkosť písmen), aj zmazaného', () => {
		zapis(1, '2026-09-01 12:00:00', 'marek', 'create', 'vo@firma.sk', 'role=b2b');
		zapis(2, '2026-09-01 12:05:00', 'marek', 'create', 'predaj', 'role=internal');
		zapis(3, '2026-09-02 13:00:00', 'marek', 'delete', 'vo@firma.sk', 'role=b2b');
		zapis(4, '2026-10-19 16:00:00', 'marek', 'password_reset', 'predaj');
		expect(historiaUctov(HISTORIA_UCTOV_LIMIT, 'VO@Firma.sk').map((r) => [r.id, r.akcia])).toEqual([
			[3, 'účet zmazaný'],
			[1, 'účet vytvorený']
		]);
		expect(historiaUctov(HISTORIA_UCTOV_LIMIT, 'predaj').map((r) => r.id)).toEqual([4, 2]);
		expect(historiaUctov(HISTORIA_UCTOV_LIMIT, 'nikto')).toEqual([]);
		// bez filtra (null) všetky
		expect(historiaUctov(HISTORIA_UCTOV_LIMIT, null)).toHaveLength(4);
	});

	it('nečitateľný čas v DB nezhodí stránku — ukáže sa surovo', () => {
		zapis(1, 'nie-je-cas', 'marek', 'create', 'predaj');
		expect(historiaUctov()[0]).toMatchObject({ kedy: 'nie-je-cas', akcia: 'účet vytvorený' });
	});
});

describe('/pouzivatelia load — história účtov (#613)', () => {
	const admin = { id: 1, username: 'marek', role: 'internal' };
	type Data = {
		historia: ReturnType<typeof historiaUctov>;
		historiaUcet: string | null;
		historiaLimit: number;
		ucetMax: number;
		users: { username: string }[];
	};
	const nacitaj = async (query = '', user: object = admin) =>
		(await route.load({
			locals: { user },
			url: new URL(`http://x/pouzivatelia${query}`)
		} as unknown as Parameters<typeof route.load>[0])) as Data;

	it('po zmene hesla je navrchu „heslo zmenené" od admina (bez filtra)', async () => {
		addUser('hist-t1', 'stare-heslo-h1', 'internal', 'marek');
		expect(setPassword('Hist-T1', 'nove-heslo-h1', 'marek').error).toBeNull();
		const data = await nacitaj();
		expect(data.historiaUcet).toBeNull();
		// limit histórie a dĺžka mena pre formulár z jedného zdroja (server)
		expect(data.historiaLimit).toBe(HISTORIA_UCTOV_LIMIT);
		expect(data.ucetMax).toBe(MAX_USERNAME_LEN);
		expect(data.historia.slice(0, 2)).toMatchObject([
			{ kto: 'marek', akcia: 'heslo zmenené', ucet: 'hist-t1', detail: '' },
			{ kto: 'marek', akcia: 'účet vytvorený', ucet: 'hist-t1', detail: 'role=internal' }
		]);
		// heslo sa do histórie nikdy nedostane
		expect(JSON.stringify(data.historia)).not.toContain('nove-heslo-h1');
	});

	it('?historia=<účet> (orezané) — len udalosti toho účtu; prázdny parameter = všetky', async () => {
		addUser('hist-t2', 'stare-heslo-h2', 'b2b', 'marek');
		addUser('iny-t2', 'stare-heslo-i2', 'b2b', 'marek');
		expect(setPassword('hist-t2', 'nove-heslo-h2', 'marek').error).toBeNull();
		const data = await nacitaj('?historia=%20Hist-T2%20');
		expect(data.historiaUcet).toBe('Hist-T2');
		expect(data.historia.map((h) => [h.akcia, h.ucet])).toEqual([
			['heslo zmenené', 'hist-t2'],
			['účet vytvorený', 'hist-t2']
		]);
		expect((await nacitaj('?historia=%20%20')).historiaUcet).toBeNull();
	});

	it('príliš dlhý ?historia= sa oreže na dĺžku mena (sfalšovaný vstup nenafúkne dotaz)', async () => {
		const data = await nacitaj(`?historia=${'a'.repeat(5000)}`);
		expect(data.historiaUcet).toBe('a'.repeat(200));
		expect(data.historia).toEqual([]);
	});

	it('b2b sa k histórii nedostane — load presmeruje na /zasklenia (303)', async () => {
		let chyba: unknown;
		try {
			await nacitaj('', { id: 9, username: 'vo', role: 'b2b' });
		} catch (e) {
			chyba = e;
		}
		expect(isRedirect(chyba)).toBe(true);
		expect(chyba).toMatchObject({ status: 303, location: '/zasklenia' });
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
				(m[1] ?? '')
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

	it('filter na účet: GET formulár s návrhmi účtov, bez filtra žiadny odkaz „Všetky účty"', () => {
		const html = render(HistoriaUctov, {
			props: { historia, ucty: ['kontakt', 'predaj'] }
		}).body;
		expect(html).toMatch(/<form[^>]*method="GET"[^>]*data-testid="historia-filter"/);
		expect(html).toMatch(/<input[^>]*name="historia"[^>]*list="historia-ucty"/);
		expect(html).toContain('<option value="kontakt"></option>');
		expect(html).toContain('<option value="predaj"></option>');
		expect(html).not.toContain('historia-vsetky');
		expect(html).toContain('Najnovšie hore');
	});

	it('plný zoznam bez filtra povie, že starší je za limitom (filter); neplný a filtrovaný nie', () => {
		const plny = render(HistoriaUctov, { props: { historia, limit: 3 } }).body;
		expect(plny).toContain('zobrazuje sa najviac 3 — staršie nájdeš filtrom na účet');
		const neplny = render(HistoriaUctov, { props: { historia, limit: 50 } }).body;
		expect(neplny).not.toContain('zobrazuje sa najviac');
		const filtrovany = render(HistoriaUctov, {
			props: { historia, limit: 3, filter: 'predaj' }
		}).body;
		expect(filtrovany).not.toContain('zobrazuje sa najviac');
	});

	it('maxlength poľa účtu ide z dát (jeden zdroj s MAX_USERNAME_LEN), nie natvrdo', () => {
		const html = render(HistoriaUctov, { props: { historia: [], ucetMax: 123 } }).body;
		expect(html).toMatch(/<input[^>]*name="historia"[^>]*maxlength="123"/);
	});

	it('aktívny filter: hodnota v poli, odkaz „Všetky účty", prázdny výsledok povie pre ktorý účet', () => {
		const s = render(HistoriaUctov, {
			props: { historia: historia.slice(0, 1), filter: 'predaj', ucty: [] }
		}).body;
		expect(s).toMatch(/<input[^>]*name="historia"[^>]*value="predaj"/);
		expect(s).toMatch(/<a[^>]*href="\/pouzivatelia"[^>]*data-testid="historia-vsetky"/);
		expect(s).toContain('Účet „predaj"');
		const prazdna = render(HistoriaUctov, {
			props: { historia: [], filter: '<b>x</b>', ucty: [] }
		}).body;
		expect(prazdna).toContain('Pre účet „&lt;b>x&lt;/b>" zatiaľ žiadne udalosti.');
		expect(prazdna).not.toContain('<b>x</b>');
	});
});
