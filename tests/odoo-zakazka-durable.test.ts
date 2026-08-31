// #349: durable retry + startup sweep pre Odoo zákazka-push. VŠETKY qty/kódy/ceny sú VYMYSLENÉ
// (repo je verejné). Jedna DB pre celý súbor (db.ts modulový singleton — vzor odoo-zakazka.test.ts);
// každý test vlastná ZAK/OP. Odoo transport je MOCK (žiadny reálny post na PROD zákazky z testu).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OdooTransport } from '../src/lib/server/odoo-rpc';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-zakazka-durable-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json');

const { db } = await import('../src/lib/server/db');
const { setOdooTransport } = await import('../src/lib/server/odoo-rpc');
const {
	pushZakazkaToOdoo,
	retryPendingZakazkaPushes,
	runStartupZakazkaSweep,
	queueZakazkaPush,
	MAX_ATTEMPTS
} = await import('../src/lib/server/odoo-zakazka');
const {
	recordZakazkaPushFailed,
	recordZakazkaPushNoOrder,
	recordZakazkaPushPosted,
	recordZakazkaPushMissing,
	getPendingZakazkaPushes,
	expireStaleZakazkaPushes,
	isPendingZakazkaPush
} = await import('../src/lib/server/odoo-zakazka-store');

let nextId = 90001;
function seedOdpis(opts: { zak: string; op: string; kod?: string }): number {
	const id = nextId++;
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, presunute_at, zak_norm, op_norm)
		 VALUES (?, 'zasklenia', ?, ?, 'Test Zákazník', 0, 1, '/t/f.xlsx', 'f.xlsx', ?, '{}', 'test', datetime('now'), NULL, ?, ?)`
	).run(id, opts.zak, opts.op, `hash-${id}`, opts.zak, opts.op);
	db.prepare(
		'INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)'
	).run(id, opts.kod ?? 'K1', 'Profil A', 2, 'm');
	return id;
}

function row(zak: string, op: string) {
	return db
		.prepare(
			'SELECT pending, attempts, last_error, posted_at FROM odoo_zakazka_push WHERE zak_norm = ? AND op_norm = ?'
		)
		.get(zak, op) as
		{ pending: number; attempts: number; last_error: string; posted_at: string | null } | undefined;
}

/** Mock transport: auth → uid, search → dané id-čka (default 1 nájdený), message_post zaznamenaný. */
function mockOdoo(opts?: { searchIds?: number[]; onPost?: (body: string) => void }): OdooTransport {
	const ids = opts?.searchIds ?? [501];
	return async (_url, body) => {
		if (body.includes('<methodName>authenticate</methodName>'))
			return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
		if (body.includes('<string>search</string>')) {
			const items = ids.map((n) => `<value><int>${n}</int></value>`).join('');
			return `<methodResponse><params><param><value><array><data>${items}</data></array></value></param></params></methodResponse>`;
		}
		if (body.includes('<string>message_post</string>')) {
			opts?.onPost?.(body);
			return '<methodResponse><params><param><value><int>9001</int></value></param></params></methodResponse>';
		}
		throw new Error('unexpected RPC: ' + body.slice(0, 120));
	};
}

const ENV = {
	ODOO_LEAD_URL: 'https://odoo.test',
	ODOO_LEAD_DB: 'odoo',
	ODOO_LEAD_LOGIN: 'web',
	ODOO_LEAD_API_KEY: 'k'
};
function enableOdoo() {
	for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
		await new Promise((r) => setTimeout(r, 5));
	}
}

beforeEach(() => db.prepare('DELETE FROM odoo_zakazka_push').run());
afterEach(() => {
	setOdooTransport(null);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

// ---- store state machine (deterministické, priame) ----------------------------------

describe('odoo-zakazka-store — stavový automat', () => {
	it('failed → pending=1, attempts inkrementuje, last_error uložený', () => {
		recordZakazkaPushFailed('ZAKF', 'OP1', 'siet down');
		expect(row('ZAKF', 'OP1')).toMatchObject({ pending: 1, attempts: 1, last_error: 'siet down' });
		recordZakazkaPushFailed('ZAKF', 'OP1', 'znova');
		expect(row('ZAKF', 'OP1')).toMatchObject({ pending: 1, attempts: 2, last_error: 'znova' });
	});
	it('no-order → pending=1, ale attempts sa NEZVYŠUJE (časový strop, nie poison-pill)', () => {
		recordZakazkaPushNoOrder('ZAKN', 'OP2');
		recordZakazkaPushNoOrder('ZAKN', 'OP2');
		recordZakazkaPushNoOrder('ZAKN', 'OP2');
		expect(row('ZAKN', 'OP2')).toMatchObject({ pending: 1, attempts: 0 });
	});
	it('posted → pending=0, attempts vynulované, posted_at vyplnené', () => {
		recordZakazkaPushFailed('ZAKP', 'OP3', 'x');
		recordZakazkaPushPosted('ZAKP', 'OP3');
		const r = row('ZAKP', 'OP3')!;
		expect(r.pending).toBe(0);
		expect(r.attempts).toBe(0);
		expect(r.posted_at).toBeTruthy();
	});
	it('missing → UPDATE-only (neexistujúci riadok sa nevytvorí); existujúci → terminálny pending=0', () => {
		recordZakazkaPushMissing('ZAKM', 'OP4'); // riadok neexistuje → no-op
		expect(row('ZAKM', 'OP4')).toBeUndefined();
		recordZakazkaPushFailed('ZAKM', 'OP4', 'x');
		recordZakazkaPushMissing('ZAKM', 'OP4');
		expect(row('ZAKM', 'OP4')).toMatchObject({ pending: 0 });
	});
	it('kľúč je normalizovaný: "260439" a "OP260439" sú ten istý riadok', () => {
		recordZakazkaPushFailed('zak 5 ', '260439', 'x');
		recordZakazkaPushFailed('ZAK5', 'OP260439', 'y');
		const n = (
			db.prepare("SELECT COUNT(*) c FROM odoo_zakazka_push WHERE op_norm='OP260439'").get() as {
				c: number;
			}
		).c;
		expect(n).toBe(1);
	});
	it('expireStaleZakazkaPushes: pending riadok starší než strop → pending=0, last_error=expired', () => {
		recordZakazkaPushNoOrder('ZAKEXP', 'OP5');
		// posuň created_at do minulosti (100 dní)
		db.prepare(
			"UPDATE odoo_zakazka_push SET created_at = datetime('now','-100 days') WHERE zak_norm='ZAKEXP'"
		).run();
		expireStaleZakazkaPushes(90);
		expect(row('ZAKEXP', 'OP5')).toMatchObject({ pending: 0, last_error: 'expired' });
	});
	it('created_at sa RESETUJE pri 0→1 (review #349 🟡): posted starý riadok → dnes failed → NIE expired, retryovateľný', () => {
		// riadok bol dávno úspešne postnutý (created_at 200 dní dozadu, pending=0)
		recordZakazkaPushPosted('ZAKOLD', 'OP99');
		db.prepare(
			"UPDATE odoo_zakazka_push SET created_at = datetime('now','-200 days') WHERE zak_norm='ZAKOLD'"
		).run();
		// DNES príde ČERSTVÉ genuine zlyhanie tej istej zákazky → epizóda začína teraz
		recordZakazkaPushFailed('ZAKOLD', 'OP99', 'siet down');
		// časový strop ho NESMIE hneď expirovať (created_at bol resetnutý na dnes)
		expireStaleZakazkaPushes(90);
		expect(row('ZAKOLD', 'OP99')).toMatchObject({ pending: 1, attempts: 1 });
		// a sweep ho MUSÍ vidieť ako retryovateľný (bez #349 🟡 fixu by bol expirovaný / mimo okna)
		const pend = getPendingZakazkaPushes(MAX_ATTEMPTS, 90, 20).map((r) => r.zak);
		expect(pend).toContain('ZAKOLD');
	});
	it('created_at sa NEresetuje počas prebiehajúcej epizódy (1→1): zombie strop drží', () => {
		recordZakazkaPushNoOrder('ZAKEP', 'OP98'); // epizóda štart (pending=1)
		db.prepare(
			"UPDATE odoo_zakazka_push SET created_at = datetime('now','-100 days') WHERE zak_norm='ZAKEP'"
		).run();
		recordZakazkaPushNoOrder('ZAKEP', 'OP98'); // ďalší no-order v tej istej epizóde → created_at DRŽÍ
		expireStaleZakazkaPushes(90);
		expect(row('ZAKEP', 'OP98')).toMatchObject({ pending: 0, last_error: 'expired' });
	});
	it('isPendingZakazkaPush: true pre pending riadok, false po vyriešení / pre neznámy kľúč', () => {
		expect(isPendingZakazkaPush('ZAKIP', 'OP9')).toBe(false); // neexistuje
		recordZakazkaPushFailed('ZAKIP', 'OP9', 'x');
		expect(isPendingZakazkaPush('ZAKIP', 'OP9')).toBe(true);
		recordZakazkaPushPosted('ZAKIP', 'OP9');
		expect(isPendingZakazkaPush('ZAKIP', 'OP9')).toBe(false);
	});
	it('getPendingZakazkaPushes: vylúči vyčerpané (attempts>=MAX) aj staré (mimo okna)', () => {
		recordZakazkaPushFailed('ZAKA', 'OP6', 'x'); // attempts 1 — pending
		for (let i = 0; i < MAX_ATTEMPTS; i++) recordZakazkaPushFailed('ZAKB', 'OP7', 'x'); // vyčerpaný
		recordZakazkaPushNoOrder('ZAKC', 'OP8');
		db.prepare(
			"UPDATE odoo_zakazka_push SET created_at = datetime('now','-100 days') WHERE zak_norm='ZAKC'"
		).run();
		const pend = getPendingZakazkaPushes(MAX_ATTEMPTS, 90, 20).map((r) => r.zak);
		expect(pend).toContain('ZAKA');
		expect(pend).not.toContain('ZAKB'); // poison-pill
		expect(pend).not.toContain('ZAKC'); // mimo časového okna
	});
});

// ---- push → durable záznam (end-to-end cez pushZakazkaToOdoo + arrival hook) ----------

describe('durable záznam pri pushi', () => {
	it('failed push (transport chyba) zaznamená pending', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKPF', op: 'OP10' });
		setOdooTransport(async () => {
			throw new Error('down');
		});
		queueZakazkaPush('ZAKPF', 'OP10');
		await waitFor(() => row('ZAKPF', 'OP10')?.pending === 1);
		expect(row('ZAKPF', 'OP10')).toMatchObject({ pending: 1 });
		expect(row('ZAKPF', 'OP10')!.attempts).toBe(1); // failed nespúšťa sweep → presne 1 pokus
	});
	it('no-order push (search []) zaznamená pending bez inkrementu attempts', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKPN', op: 'OP11' });
		setOdooTransport(mockOdoo({ searchIds: [] }));
		queueZakazkaPush('ZAKPN', 'OP11');
		await waitFor(() => row('ZAKPN', 'OP11')?.pending === 1);
		expect(row('ZAKPN', 'OP11')).toMatchObject({ pending: 1, attempts: 0 });
	});
	it('úspešný push zaznamená posted_at, pending=0', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKPS', op: 'OP12' });
		setOdooTransport(mockOdoo({ searchIds: [777] }));
		queueZakazkaPush('ZAKPS', 'OP12');
		await waitFor(() => row('ZAKPS', 'OP12')?.pending === 0 && !!row('ZAKPS', 'OP12')?.posted_at);
		expect(row('ZAKPS', 'OP12')!.posted_at).toBeTruthy();
	});
});

// ---- retry sweep --------------------------------------------------------------------

describe('retryPendingZakazkaPushes', () => {
	it('dopostne pending riadok keď Odoo znova hore → pending=0, posted_at', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKSW', op: 'OP20' });
		recordZakazkaPushFailed('ZAKSW', 'OP20', 'bola dole'); // pending z minulého výpadku
		let posted = 0;
		setOdooTransport(mockOdoo({ searchIds: [888], onPost: () => posted++ }));
		await retryPendingZakazkaPushes();
		expect(posted).toBe(1);
		expect(row('ZAKSW', 'OP20')).toMatchObject({ pending: 0 });
		expect(row('ZAKSW', 'OP20')!.posted_at).toBeTruthy();
	});
	it('poison-pill: attempts>=MAX sa NEskúša (transport sa nezavolá)', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKPP', op: 'OP21' });
		for (let i = 0; i < MAX_ATTEMPTS; i++) recordZakazkaPushFailed('ZAKPP', 'OP21', 'x');
		let called = false;
		setOdooTransport(async () => {
			called = true;
			throw new Error('nemalo sa volať');
		});
		await retryPendingZakazkaPushes();
		expect(called).toBe(false);
	});
	it('vypnuté (chýba env) → no-op, žiadny transport, žiadny throw', async () => {
		// bez enableOdoo()
		seedOdpis({ zak: 'ZAKDIS', op: 'OP22' });
		recordZakazkaPushFailed('ZAKDIS', 'OP22', 'x');
		let called = false;
		setOdooTransport(async () => {
			called = true;
			return '';
		});
		await expect(retryPendingZakazkaPushes()).resolves.toBeUndefined();
		expect(called).toBe(false);
	});
	it('retry re-derivuje missing (odpis medzitým uvoľnený) → terminálny pending=0', async () => {
		enableOdoo();
		// pending riadok EXISTUJE, ale zákazka NEMÁ odpis (uvoľnený) → pushZakazkaToOdoo = missing
		recordZakazkaPushFailed('ZAKGONE', 'OP23', 'bola dole');
		setOdooTransport(mockOdoo({ searchIds: [1] }));
		await retryPendingZakazkaPushes();
		expect(row('ZAKGONE', 'OP23')).toMatchObject({ pending: 0 });
		expect(row('ZAKGONE', 'OP23')!.last_error).toContain('missing');
	});
	it('RETRY cesta drží leak-kontrakt: repost je interná mt_note/comment/partner_ids=[]', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKLEAK', op: 'OP24' });
		recordZakazkaPushFailed('ZAKLEAK', 'OP24', 'bola dole');
		let body = '';
		setOdooTransport(mockOdoo({ searchIds: [9], onPost: (b) => (body = b) }));
		await retryPendingZakazkaPushes();
		expect(body).toContain('<string>mail.mt_note</string>');
		expect(body).toContain('<name>message_type</name><value><string>comment</string>');
		expect(body).toContain('<name>partner_ids</name><value><array><data></data></array></value>');
		expect(body).not.toContain('email_from');
	});
});

// ---- štartový sweep -----------------------------------------------------------------

describe('runStartupZakazkaSweep', () => {
	it('vypnuté (chýba env) → okamžitý no-op, žiadny throw', () => {
		expect(() => runStartupZakazkaSweep()).not.toThrow();
	});
	it('zapnuté → dopostne pending z minulého výpadku', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKSTART', op: 'OP30' });
		recordZakazkaPushFailed('ZAKSTART', 'OP30', 'bola dole');
		setOdooTransport(mockOdoo({ searchIds: [3] }));
		runStartupZakazkaSweep();
		await waitFor(() => row('ZAKSTART', 'OP30')?.pending === 0);
		expect(row('ZAKSTART', 'OP30')).toMatchObject({ pending: 0 });
	});
});

// ---- súbeh: per-kľúč serializácia (zadanie bod 4) ------------------------------------

describe('per-kľúč serializácia súbežných pushov', () => {
	it('dva súbežné pushe tej istej (zak,op) sa NEprekrývajú (postnú sekvenčne)', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKSER', op: 'OP40' });
		const events: string[] = [];
		let active = 0;
		let maxActive = 0;
		setOdooTransport(async (_u, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
			if (body.includes('<string>search</string>'))
				return '<methodResponse><params><param><value><array><data><value><int>4</int></value></data></array></value></param></params></methodResponse>';
			// message_post: sleduj súbežnosť pre ten istý kľúč
			active++;
			maxActive = Math.max(maxActive, active);
			events.push('start');
			await new Promise((r) => setTimeout(r, 15));
			events.push('end');
			active--;
			return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
		});
		// dva fire-and-forget pushe naraz — serializer ich musí zoradiť
		queueZakazkaPush('ZAKSER', 'OP40');
		queueZakazkaPush('ZAKSER', 'OP40');
		await waitFor(() => events.filter((e) => e === 'end').length >= 2, 3000);
		expect(maxActive).toBe(1); // nikdy 2 message_post naraz pre ten istý kľúč
		// prvý post sa CELÝ dokončí pred druhým (start,end,start,end — nie start,start,…)
		expect(events.slice(0, 4)).toEqual(['start', 'end', 'start', 'end']);
	});
});

// ---- pushZakazkaToOdoo tenký wrapper zachovaný (#340 API) ----------------------------

describe('pushZakazkaToOdoo wrapper (#340 API zachované)', () => {
	it('vráti holý ZakazkaPushResult (disabled bez env)', async () => {
		expect(await pushZakazkaToOdoo('ZAKW', 'OP1')).toBe('disabled');
	});
});
