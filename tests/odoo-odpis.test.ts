// #5825: router + durable push odpisu do Odoo modelu (`montalu.material.odpis` cez `/json/2`).
// HTTP hranica mocknutá (`setJson2Transport`). Overuje: mode routing, live-gate, payload tvar
// (=#5817 kontrakt), Odoo zlyhanie NEblokuje Money, no-drop retry, transient vs permanent, release,
// import→release per-hash stop-on-failure poradie. Sweep sa volá EXPLICITNE (deterministicky).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OdpisWrittenEvent, OdpisReleasedEvent } from '../src/lib/server/money';
import type { Json2Response } from '../src/lib/server/odoo-json2';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-odpis-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'odpis.db');
process.env.MONEY_LIVE = '0';

// note-mode routovanie ide na queueZakazkaPush — mockneme celý odoo-zakazka modul (odoo-odpis z neho
// importuje LEN queueZakazkaPush).
vi.mock('../src/lib/server/odoo-zakazka', () => ({ queueZakazkaPush: vi.fn() }));

const {
	dispatchOdpisImport,
	dispatchOdpisRelease,
	runOdpisSweep,
	runStartupOdpisSweep,
	startOdpisTimerSweep,
	stopOdpisTimerSweep,
	odpisPushMode
} = await import('../src/lib/server/odoo-odpis');
const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { queueZakazkaPush } = await import('../src/lib/server/odoo-zakazka');
const store = await import('../src/lib/server/odoo-odpis-store');
const { db } = await import('../src/lib/server/db');

function enableModel() {
	process.env.ODOO_ODPIS_MODE = 'model';
	process.env.ODOO_URL = 'http://odoo-test:8069';
	process.env.ODOO_API_KEY = 'key-abc';
	process.env.ODOO_ODPIS_ALLOW_NONLIVE = '1';
}
function resetEnv() {
	delete process.env.ODOO_ODPIS_MODE;
	delete process.env.ODOO_URL;
	delete process.env.ODOO_API_KEY;
	delete process.env.ODOO_ODPIS_ALLOW_NONLIVE;
}

function mockJson2(resp: Json2Response | (() => Promise<Json2Response>)) {
	const calls: { url: string; body: string }[] = [];
	setJson2Transport(async (url, bodyJson) => {
		calls.push({ url, body: bodyJson });
		return typeof resp === 'function' ? resp() : resp;
	});
	return calls;
}
const okCreated = (id = 42, saleOrderId: number | false = 55, created = true): Json2Response => ({
	status: 200,
	text: JSON.stringify({ id, sale_order_id: saleOrderId, created })
});

function makeEvent(over: Partial<OdpisWrittenEvent> = {}): OdpisWrittenEvent {
	return {
		job: {
			modul: 'zasklenia',
			zak: 'ZAK1',
			op: 'OP100',
			zakaznik: 'Test Zákazník',
			caka: false,
			createdBy: 'marek@montalu.sk',
			cakaSubdir: 'Robust',
			popis: 'OP100 : Test Zákazník',
			polozky: [{ kod: 'K1', nazov: 'Profil', qty: 2.5, mj: 'm' }],
			detail: { system: 'Robust' }
		},
		contentHash: 'HASH1',
		live: true,
		odpisLogId: 1,
		...over
	};
}
const makeRelease = (over: Partial<OdpisReleasedEvent> = {}): OdpisReleasedEvent => ({
	contentHash: 'HASH1',
	zak: 'ZAK1',
	op: 'OP100',
	modul: 'zasklenia',
	live: true,
	actor: 'marek@montalu.sk',
	...over
});

interface StoreRow {
	pending: number;
	action: string;
	attempts: number;
	odoo_id: number | null;
	posted_at: string | null;
	payload: string;
	content_hash: string;
}
const rows = (): StoreRow[] =>
	db
		.prepare(
			'SELECT pending, action, attempts, odoo_id, posted_at, payload, content_hash FROM odoo_odpis_push ORDER BY id'
		)
		.all() as StoreRow[];

beforeEach(() => {
	db.prepare('DELETE FROM odoo_odpis_push').run();
	vi.mocked(queueZakazkaPush).mockClear();
	enableModel();
});
afterEach(async () => {
	await new Promise((r) => setImmediate(r)); // flush prípadný naplánovaný sweep
	setJson2Transport(null);
	resetEnv();
});

describe('odpisPushMode', () => {
	it('default (unset) = note', () => {
		delete process.env.ODOO_ODPIS_MODE;
		expect(odpisPushMode()).toEqual({ note: true, model: false });
	});
	it('model / both / neznáma→note', () => {
		process.env.ODOO_ODPIS_MODE = 'model';
		expect(odpisPushMode()).toEqual({ note: false, model: true });
		process.env.ODOO_ODPIS_MODE = 'both';
		expect(odpisPushMode()).toEqual({ note: true, model: true });
		process.env.ODOO_ODPIS_MODE = 'HABADURA';
		expect(odpisPushMode()).toEqual({ note: true, model: false });
	});
});

describe('dispatchOdpisImport — router + push', () => {
	it('model mode: enqueue + sweep → posted; payload tvar = #5817 kontrakt', async () => {
		const calls = mockJson2(okCreated(42, 55, true));
		dispatchOdpisImport(makeEvent());
		expect(rows()).toHaveLength(1); // synchrónny enqueue
		await runOdpisSweep();
		const r = rows()[0]!;
		expect(r.pending).toBe(0);
		expect(r.odoo_id).toBe(42);
		expect(r.posted_at).toBeTruthy();
		expect(calls[0]!.url).toBe(
			'http://odoo-test:8069/json/2/montalu.material.odpis/create_from_app'
		);
		const payload = JSON.parse(calls[0]!.body);
		expect(payload).toMatchObject({
			modul: 'zasklenia',
			zak: 'ZAK1',
			op: 'OP100',
			zakaznik: 'Test Zákazník',
			content_hash: expect.stringMatching(/^[0-9a-f]{64}$/), // silný sha256 kľúč (nie appkin ledgerHash)
			app_user: 'marek@montalu.sk',
			source: 'app',
			action: 'import',
			caka: false,
			rezervacia: false
		});
		expect(payload.polozky).toEqual([{ kod: 'K1', nazov: 'Profil', qty: 2.5, mj: 'm' }]);
	});

	it('idempotencia: created=false → posted (žiadna chyba)', async () => {
		mockJson2(okCreated(42, 55, false));
		dispatchOdpisImport(makeEvent());
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(0);
	});

	it('Odoo transport HODÍ → dispatch NEHODÍ (Money nedotknuté), riadok ostáva pending (retry)', async () => {
		mockJson2(async () => {
			throw new Error('ECONNREFUSED');
		});
		expect(() => dispatchOdpisImport(makeEvent())).not.toThrow();
		await runOdpisSweep();
		const r = rows()[0]!;
		expect(r.pending).toBe(1); // NEzahodené — retry
		expect(r.attempts).toBe(1);
	});

	it('no-drop retry: po výpadku a obnovení Odoo sa odpis dopostne', async () => {
		mockJson2({ status: 500, text: 'down' });
		dispatchOdpisImport(makeEvent());
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(1); // stále čaká
		// Odoo hore + splatný (backoff je v budúcnosti → posuň next_attempt_at do minulosti)
		db.prepare("UPDATE odoo_odpis_push SET next_attempt_at = datetime('now','-1 hour')").run();
		mockJson2(okCreated());
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(0); // dopostnuté
	});

	it('transient (500) → pending; payload-permanent (ValidationError) → pending=0 (prestane skúšať)', async () => {
		mockJson2({ status: 500, text: 'boom' });
		dispatchOdpisImport(makeEvent());
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(1); // transient

		db.prepare('DELETE FROM odoo_odpis_push').run();
		mockJson2({
			status: 400,
			text: JSON.stringify({ name: 'odoo.exceptions.ValidationError', message: 'zlý payload' })
		});
		dispatchOdpisImport(makeEvent());
		await runOdpisSweep();
		const r = rows()[0]!;
		expect(r.pending).toBe(0); // permanent → prestane skúšať
		expect(r.posted_at).toBeNull(); // ale NIE posted (failed)
	});

	it('live-gate: !live bez ALLOW_NONLIVE → žiadny enqueue', () => {
		delete process.env.ODOO_ODPIS_ALLOW_NONLIVE;
		mockJson2(okCreated());
		dispatchOdpisImport(makeEvent({ live: false }));
		expect(rows()).toHaveLength(0);
	});
	it('live-gate: !live + ALLOW_NONLIVE=1 → enqueue (shadow akceptácia)', () => {
		process.env.ODOO_ODPIS_ALLOW_NONLIVE = '1';
		mockJson2(okCreated());
		dispatchOdpisImport(makeEvent({ live: false }));
		expect(rows()).toHaveLength(1);
	});

	it('note mode: žiadny model enqueue, queueZakazkaPush zavolaný s (zak, op)', () => {
		process.env.ODOO_ODPIS_MODE = 'note';
		dispatchOdpisImport(makeEvent());
		expect(rows()).toHaveLength(0);
		expect(queueZakazkaPush).toHaveBeenCalledWith('ZAK1', 'OP100');
	});

	it('both mode: model enqueue AJ queueZakazkaPush', () => {
		process.env.ODOO_ODPIS_MODE = 'both';
		mockJson2(okCreated());
		dispatchOdpisImport(makeEvent());
		expect(rows()).toHaveLength(1);
		expect(queueZakazkaPush).toHaveBeenCalledWith('ZAK1', 'OP100');
	});
});

describe('dispatchOdpisRelease', () => {
	it('model mode: enqueue release payload → sweep posted; action=release', async () => {
		const calls = mockJson2(okCreated(7, false, false));
		dispatchOdpisRelease(makeRelease());
		expect(rows()).toHaveLength(1);
		expect(rows()[0]!.action).toBe('release');
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(0);
		const payload = JSON.parse(calls[0]!.body);
		expect(payload).toMatchObject({
			content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
			action: 'release',
			app_user: 'marek@montalu.sk'
		});
		expect(payload.polozky).toBeUndefined(); // release nesie len identity
	});

	it('note mode: žiadny release push', () => {
		process.env.ODOO_ODPIS_MODE = 'note';
		dispatchOdpisRelease(makeRelease());
		expect(rows()).toHaveLength(0);
	});
});

describe('sweep — per-hash STOP-ON-FIRST-FAILURE (release nepredbehne pending import)', () => {
	it('import(H) zlyhá → release(H) sa v tom istom sweepe NESPRACUJE (poradie)', async () => {
		// import(H) najprv zlyhá (transient), potom release(H) enqueue
		mockJson2({ status: 500, text: 'down' });
		dispatchOdpisImport(makeEvent()); // id1 import, pending
		dispatchOdpisRelease(makeRelease()); // id2 release, pending
		expect(rows().map((r) => r.action)).toEqual(['import', 'release']);
		await runOdpisSweep(); // import zlyhá → release preskočený (rovnaký hash)
		const rr = rows();
		expect(rr[0]!.pending).toBe(1); // import stále pending (zlyhal)
		expect(rr[0]!.attempts).toBe(1);
		expect(rr[1]!.pending).toBe(1); // release NEspracovaný (poradie držané)
		expect(rr[1]!.attempts).toBe(0); // ani sa nepokúsil
	});

	it('cross-pass ordering: release sa NEpošle skôr než pending import ani v INOM sweepe (arrival počas backoffu)', async () => {
		mockJson2({ status: 500, text: 'down' });
		dispatchOdpisImport(makeEvent()); // id1 import
		dispatchOdpisRelease(makeRelease()); // id2 release (rovnaký hash)
		await runOdpisSweep(); // import zlyhá (backoff), release blokovaný
		expect(rows()[1]!.attempts).toBe(0);

		// arrival sweep POČAS import-backoffu: import NIE je due, release (NULL next_attempt_at) je →
		// bez cross-pass kontroly by release predbehol. hasEarlierPending ho drží.
		mockJson2(okCreated());
		await runOdpisSweep();
		expect(rows()[1]!.attempts).toBe(0); // release STÁLE nepošle (skorší import je pending)

		// import splatný → import prejde, POTOM release
		db.prepare(
			"UPDATE odoo_odpis_push SET next_attempt_at = datetime('now','-1 hour') WHERE action='import'"
		).run();
		await runOdpisSweep();
		const rr = rows();
		expect(rr[0]!.pending).toBe(0); // import posted
		expect(rr[1]!.pending).toBe(0); // release posted AŽ PO importe
	});
});

describe('startup + timer sweep', () => {
	it('runStartupOdpisSweep drainuje pending backlog AJ v note mode (leftover po mode flipe #5825 review 🔵)', async () => {
		mockJson2(okCreated());
		store.enqueueOdpisPush('HS', 'import', { content_hash: 'HS', action: 'import' });
		process.env.ODOO_ODPIS_MODE = 'note'; // aj v note móde sa leftover backlog dopostne (nestrandne)
		runStartupOdpisSweep();
		await new Promise((r) => setImmediate(r));
		expect(rows()[0]!.pending).toBe(0); // dopostnuté (drain regardless of mode)
	});

	it('startOdpisTimerSweep timer dopostne pending; start/stop sú idempotentné', async () => {
		vi.useFakeTimers();
		try {
			mockJson2(okCreated());
			store.enqueueOdpisPush('HT', 'import', { content_hash: 'HT', action: 'import' });
			startOdpisTimerSweep();
			startOdpisTimerSweep(); // idempotent — druhý štart nič nerobí
			await vi.advanceTimersByTimeAsync(61_000); // timer tick → sweep
			expect(rows()[0]!.pending).toBe(0); // timer dopostol
			stopOdpisTimerSweep();
			stopOdpisTimerSweep(); // idempotent
		} finally {
			stopOdpisTimerSweep(); // poistka aj pri zlyhaní assertu (timer nesmie leaknúť medzi testy)
			vi.useRealTimers();
		}
	});
});

describe('idempotency key — silný per-odpis kľúč [#5825 review 🔴]', () => {
	it('rovnaký ledgerHash, INÝ op → RÔZNY Odoo content_hash (žiadny collapse dvoch odpisov)', () => {
		const ev1 = makeEvent({ contentHash: 'SAME' }); // op OP100
		const ev2 = makeEvent({ contentHash: 'SAME' });
		ev2.job = { ...ev2.job, op: 'OP999' }; // ten istý obsah, iná objednávka
		dispatchOdpisImport(ev1);
		dispatchOdpisImport(ev2);
		const hs = rows().map((r) => r.content_hash);
		expect(hs[0]).toMatch(/^[0-9a-f]{64}$/);
		expect(hs[0]).not.toBe(hs[1]); // rôzny OP → rôzny kľúč (inak by v Odoo skolabovali)
	});

	it('rovnaký odpis (import + release) → ROVNAKÝ kľúč (release matchne import v Odoo)', () => {
		dispatchOdpisImport(makeEvent({ contentHash: 'X' }));
		dispatchOdpisRelease(makeRelease({ contentHash: 'X' }));
		const hs = rows().map((r) => r.content_hash);
		expect(hs[0]).toBe(hs[1]);
	});
});

describe('error klasifikácia [#5825 review 🟡]', () => {
	it('TypeError/ValueError (deploy/schema skew) → TRANSIENT (nie permanent — fixne sa nasadením modelu)', async () => {
		mockJson2({
			status: 500,
			text: JSON.stringify({ name: 'builtins.ValueError', message: 'Invalid field xyz on model' })
		});
		dispatchOdpisImport(makeEvent());
		await runOdpisSweep();
		expect(rows()[0]!.pending).toBe(1); // transient → retry
	});
});
