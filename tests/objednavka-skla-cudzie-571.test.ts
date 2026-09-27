// #571 (PROD 25.9.): podklad objednávky skla je kľúčovaný číslom zákazky (`zak_norm`), nie
// používateľom → opakovane používaný skúšobný názov („test", „te") zdieľa jeden podklad a
// `palo@montalu.sk` nevedomky pridal sklo do podkladu s riadkami iného používateľa.
// ROZHODNUTÉ (gk z poverenia ownera 27.9.): UPOZORNIŤ, nikdy neblokovať, nič nemazať.
// Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cudzie-571-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { cudzieRiadky, textCudzichRiadkov, pridajSklo, listSklaPreZakazku } =
	await import('../src/lib/server/objednavka-skla');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { load } = await import('../src/routes/objednavka-skla/[zak]/+page.server');
const { db } = await import('../src/lib/server/db');

/** Riadok podkladu od `autor` s PEVNÝM `created_at` (SQLite UTC tvar s medzerou). */
function seedRiadok(zak: string, autor: string, createdAt = '2026-01-05 10:00:00'): number {
	const id = pridajSklo({
		zak,
		modul: 'manual',
		popis: 'V.O.',
		sirkaMm: 500,
		vyskaMm: 400,
		pocet: 1,
		typSkla: 'Float 4',
		createdBy: autor
	});
	db.prepare('UPDATE objednavka_skla SET created_at = ? WHERE id = ?').run(createdAt, id);
	return id;
}

describe('#571 cudzieRiadky — riadky podkladu od INÉHO používateľa', () => {
	it('riadky od A, pýta sa B → počet + autor + najstarší dátum autora', () => {
		const zak = 'ZAK-571-A';
		seedRiadok(zak, 'alice', '2026-01-05 10:00:00');
		seedRiadok(zak, 'alice', '2026-01-03 08:00:00');
		const c = cudzieRiadky(zak, 'bob');
		expect(c.pocet).toBe(2);
		expect(c.autori).toEqual([{ user: 'alice', od: '2026-01-03 08:00:00' }]);
	});

	it('vlastný podklad → žiadne cudzie riadky', () => {
		const zak = 'ZAK-571-B';
		seedRiadok(zak, 'alice');
		expect(cudzieRiadky(zak, 'alice')).toEqual({ pocet: 0, autori: [] });
	});

	it('riadok s prázdnym created_by sa ignoruje (legacy/bez autora)', () => {
		const zak = 'ZAK-571-C';
		seedRiadok(zak, '');
		seedRiadok(zak, 'bob');
		expect(cudzieRiadky(zak, 'bob')).toEqual({ pocet: 0, autori: [] });
	});

	it('zmiešaný podklad: počíta LEN cudzie riadky, autori zoradení podľa dátumu', () => {
		const zak = 'ZAK-571-D';
		seedRiadok(zak, 'bob', '2026-01-01 09:00:00');
		seedRiadok(zak, 'vyroba', '2026-01-04 09:00:00');
		seedRiadok(zak, 'alice', '2026-01-02 09:00:00');
		const c = cudzieRiadky(zak, 'bob');
		expect(c.pocet).toBe(2);
		expect(c.autori.map((a) => a.user)).toEqual(['alice', 'vyroba']);
	});

	it('rovnaký WHERE ako podklad — legacy zak_norm s medzerou sa započíta', () => {
		const zak = 'ZAK571E';
		const id = seedRiadok(zak, 'alice');
		db.prepare('UPDATE objednavka_skla SET zak_norm = ? WHERE id = ?').run('ZAK 571E', id);
		expect(listSklaPreZakazku(zak)).toHaveLength(1);
		expect(cudzieRiadky(zak, 'bob').pocet).toBe(1);
	});

	it('bez prihláseného používateľa (prázdne meno) → nič (nevieme porovnať)', () => {
		const zak = 'ZAK-571-F';
		seedRiadok(zak, 'alice');
		expect(cudzieRiadky(zak, '')).toEqual({ pocet: 0, autori: [] });
	});
});

describe('#571 textCudzichRiadkov — hláška pre operátora', () => {
	it('žiadne cudzie → null', () => {
		expect(textCudzichRiadkov({ pocet: 0, autori: [] })).toBeNull();
	});

	it('dátum v Europe/Bratislava (NIE UTC) — 5.1. 23:30 UTC je v Bratislave už 6.1.', () => {
		const t = textCudzichRiadkov({
			pocet: 1,
			autori: [{ user: 'alice', od: '2026-01-05 23:30:00' }]
		});
		expect(t).toBe(
			'Táto zákazka už obsahuje 1 riadok od alice (6.1.2026) — pridávaš do existujúceho podkladu'
		);
	});

	it('skloňovanie (2–4 riadky, 5+ riadkov) a viac autorov', () => {
		const t3 = textCudzichRiadkov({
			pocet: 3,
			autori: [
				{ user: 'alice', od: '2026-01-02 09:00:00' },
				{ user: 'vyroba', od: '2026-01-04 09:00:00' }
			]
		});
		expect(t3).toBe(
			'Táto zákazka už obsahuje 3 riadky od alice (2.1.2026), vyroba (4.1.2026) — pridávaš do existujúceho podkladu'
		);
		const t5 = textCudzichRiadkov({
			pocet: 5,
			autori: [{ user: 'alice', od: '2026-01-02 09:00:00' }]
		});
		expect(t5).toContain('obsahuje 5 riadkov od alice');
	});
});

const SLIDE = {
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

async function pridatSklaAko(username: string, zak: string) {
	const f = new FormData();
	for (const [k, v] of Object.entries({ ...SLIDE, zak })) f.append(k, v);
	const event = {
		request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
		locals: { user: { id: 1, username, role: 'internal' as const } }
	};
	const fn = actions.pridatSkla as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
	return (await fn(event)).sklaPridane as {
		pridane: number;
		zak: string;
		upozornenieCudzie: string | null;
	};
}

describe('#571 zasklenia „Pridať sklá" — upozornenie v potvrdení, nikdy neblokuje', () => {
	it('pridanie ako B do podkladu A → sklá pridané + upozornenie s autorom A', async () => {
		const zak = 'ZAK-571-Z1';
		seedRiadok(zak, 'alice', '2026-01-05 10:00:00');
		const s = await pridatSklaAko('bob', zak);
		expect(s.pridane).toBe(1); // neblokuje
		expect(s.upozornenieCudzie).toBe(
			'Táto zákazka už obsahuje 1 riadok od alice (5.1.2026) — pridávaš do existujúceho podkladu'
		);
		expect(listSklaPreZakazku(zak)).toHaveLength(2); // nič sa nemaže
	});

	it('pridanie do vlastného podkladu → žiadne upozornenie', async () => {
		const zak = 'ZAK-571-Z2';
		seedRiadok(zak, 'bob');
		const s = await pridatSklaAko('bob', zak);
		expect(s.upozornenieCudzie).toBeNull();
	});
});

function callLoad(zak: string, username?: string) {
	return load({
		params: { zak },
		url: new URL(`http://x/objednavka-skla/${encodeURIComponent(zak)}`),
		locals: username ? { user: { id: 1, username, role: 'internal' } } : {}
	} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
}

describe('#571 podklad /objednavka-skla/[zak] — banner cudzích riadkov (FIX/pergola/ručný riadok)', () => {
	it('prihlásený B na podklade A → `cudzie` hláška', async () => {
		const zak = 'ZAK-571-L1';
		seedRiadok(zak, 'alice', '2026-01-05 10:00:00');
		const d = await callLoad(zak, 'bob');
		expect(d.cudzie).toBe(
			'Táto zákazka už obsahuje 1 riadok od alice (5.1.2026) — pridávaš do existujúceho podkladu'
		);
	});

	it('autor na vlastnom podklade → `cudzie` = null', async () => {
		const zak = 'ZAK-571-L2';
		seedRiadok(zak, 'alice');
		const d = await callLoad(zak, 'alice');
		expect(d.cudzie).toBeNull();
	});
});
