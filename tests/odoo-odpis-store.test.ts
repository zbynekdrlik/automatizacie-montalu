// #5825: durable APPEND-ONLY push-log store (`odoo_odpis_push`). Overuje append-only (nie upsert),
// posted/failed/permanent prechody, backoff cez next_attempt_at (pendingDue filtruje budúce),
// backlog počty. MONEY-NEUTRÁLNE (len SQLite).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpis-store-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'store.db');
process.env.MONEY_LIVE = '0';

const store = await import('../src/lib/server/odoo-odpis-store');
const { db } = await import('../src/lib/server/db');

beforeAll(() => {
	db.prepare('DELETE FROM odoo_odpis_push').run();
});

describe('odoo-odpis-store — APPEND-ONLY log', () => {
	it('enqueue APENDUJE (dva rovnaké hash+action → dva riadky, distinctné id)', () => {
		const id1 = store.enqueueOdpisPush('HASH-A', 'import', {
			content_hash: 'HASH-A',
			action: 'import'
		});
		const id2 = store.enqueueOdpisPush('HASH-A', 'import', {
			content_hash: 'HASH-A',
			action: 'import'
		});
		expect(id2).toBeGreaterThan(id1);
		const n = (
			db.prepare("SELECT COUNT(*) c FROM odoo_odpis_push WHERE content_hash='HASH-A'").get() as {
				c: number;
			}
		).c;
		expect(n).toBe(2);
	});

	it('markPosted: pending=0, odoo_id/sale_order_id/posted_at nastavené', () => {
		const id = store.enqueueOdpisPush('HASH-P', 'import', {});
		store.markOdpisPushPosted(id, 4242, 5555);
		const row = db
			.prepare(
				'SELECT pending, odoo_id, sale_order_id, posted_at FROM odoo_odpis_push WHERE id = ?'
			)
			.get(id) as Record<string, unknown>;
		expect(row.pending).toBe(0);
		expect(row.odoo_id).toBe(4242);
		expect(row.sale_order_id).toBe(5555);
		expect(row.posted_at).toBeTruthy();
		expect(store.isOdpisPushPending(id)).toBe(false);
	});

	it('markFailed: ostáva pending=1, attempts++, next_attempt_at v BUDÚCNOSTI → pendingDue ho NEvráti', () => {
		const id = store.enqueueOdpisPush('HASH-F', 'import', {});
		store.markOdpisPushFailed(id, 'siet down', '+3600 seconds');
		const row = db
			.prepare(
				'SELECT pending, attempts, last_error, next_attempt_at FROM odoo_odpis_push WHERE id = ?'
			)
			.get(id) as Record<string, unknown>;
		expect(row.pending).toBe(1);
		expect(row.attempts).toBe(1);
		expect(row.last_error).toBe('siet down');
		expect(row.next_attempt_at).toBeTruthy();
		expect(store.isOdpisPushPending(id)).toBe(true);
		// next_attempt_at je +1h → NIE je splatný teraz
		const due = store.pendingDueOdpisPushes(100).map((r) => r.id);
		expect(due).not.toContain(id);
	});

	it('markFailed s minulým offsetom → pendingDue ho VRÁTI (splatný)', () => {
		const id = store.enqueueOdpisPush('HASH-DUE', 'import', {});
		store.markOdpisPushFailed(id, 'siet', '-5 seconds'); // splatný v minulosti
		const due = store.pendingDueOdpisPushes(100).map((r) => r.id);
		expect(due).toContain(id);
	});

	it('markPermanent: pending=0, posted_at NULL → počíta sa ako failed v backlogu', () => {
		const id = store.enqueueOdpisPush('HASH-PERM', 'import', {});
		store.markOdpisPushPermanent(id, 'ValidationError: zle');
		const row = db
			.prepare('SELECT pending, posted_at, last_error, attempts FROM odoo_odpis_push WHERE id = ?')
			.get(id) as Record<string, unknown>;
		expect(row.pending).toBe(0);
		expect(row.posted_at).toBeNull();
		expect(row.attempts).toBe(1);
		expect(store.isOdpisPushPending(id)).toBe(false);
	});

	it('pendingDue vracia v poradí id ASC (per-hash poradie zachované)', () => {
		db.prepare('DELETE FROM odoo_odpis_push').run();
		const a = store.enqueueOdpisPush('H', 'import', {});
		const b = store.enqueueOdpisPush('H', 'release', {});
		const due = store.pendingDueOdpisPushes(100).map((r) => r.id);
		expect(due).toEqual([a, b]); // import pred release (id poradie)
	});

	it('backlogCounts: pending vs failed (permanent)', () => {
		db.prepare('DELETE FROM odoo_odpis_push').run();
		store.enqueueOdpisPush('B1', 'import', {}); // pending
		store.enqueueOdpisPush('B2', 'import', {}); // pending
		const p = store.enqueueOdpisPush('B3', 'import', {});
		store.markOdpisPushPermanent(p, 'ValidationError'); // failed
		const okId = store.enqueueOdpisPush('B4', 'import', {});
		store.markOdpisPushPosted(okId, 1, 1); // posted (nie failed, nie pending)
		expect(store.odpisBacklogCounts()).toEqual({ pending: 2, failed: 1 });
		expect(store.anyOdpisPushPending()).toBe(true);
	});
});
