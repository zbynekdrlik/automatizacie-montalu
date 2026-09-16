// #524: admin backfill endpoint (`/admin/backfill-narezaky`) + reálne deps (SELECT + Odoo transport).
// DB je seedovaná per-file izolátorom; Odoo transport je mocknutý (`setJson2Transport`) → žiadny PROD
// Odoo. Overuje: token/session gate, ODOO-enabled gate, DRY-RUN default (žiadny upload), skip logika.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { db } from '../src/lib/server/db';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import {
	listOdpisyForBackfill,
	backfillTokenValid
} from '../src/lib/server/backfill-narezaky-deps';
import { POST } from '../src/routes/admin/backfill-narezaky/+server';
import type { SessionUser } from '../src/lib/server/auth';

const CAD = '18013 Profil A\t3\t3000';

function insertOdpis(
	over: Partial<{ modul: string; op: string; live: number; detail: string }> = {}
) {
	const modul = over.modul ?? 'pergola';
	const op = over.op ?? 'OP260700';
	const live = over.live ?? 1;
	const detail = over.detail ?? JSON.stringify({ cad: CAD });
	return db
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
			 VALUES (?, 'ZAK1', ?, 'Test', 0, ?, 't', 'f', 'h', ?, 'test', 'ZAK1', ?)`
		)
		.run(modul, op, live, detail, op).lastInsertRowid as number;
}

/** Odoo transport mock: search_read podľa modelu, upload zachytí. */
function mockOdoo(opts: {
	orderExists?: boolean;
	hasLines?: boolean;
	onUpload?: (body: unknown) => void;
}) {
	const orderExists = opts.orderExists ?? true;
	const hasLines = opts.hasLines ?? false;
	setJson2Transport(async (input, init) => {
		const url = String(input);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		let data: unknown = {};
		if (url.includes('/sale.order/search_read')) data = orderExists ? [{ id: 1 }] : [];
		else if (url.includes('/montalu.rozpis.line/search_read')) data = hasLines ? [{ id: 9 }] : [];
		else if (url.includes('/montalu_narezak_upload')) {
			opts.onUpload?.(body);
			data = { lines_created: (body as { lines?: unknown[] }).lines?.length ?? 0 };
		}
		return new Response(JSON.stringify(data), { status: 200 });
	});
}

function evt(opts: { token?: string; user?: SessionUser | null; body?: unknown }) {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (opts.token) headers.set('x-backfill-token', opts.token);
	const request = new Request('http://localhost/admin/backfill-narezaky', {
		method: 'POST',
		headers,
		body: JSON.stringify(opts.body ?? {})
	});
	return { request, locals: { user: opts.user ?? null } } as unknown as Parameters<typeof POST>[0];
}

function enableOdooEnv() {
	vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

afterEach(() => {
	vi.unstubAllEnvs();
	setJson2Transport(null);
	db.prepare('DELETE FROM odpis_log').run();
});

const admin: SessionUser = { id: 1, username: 'admin', role: 'internal' };

describe('backfillTokenValid', () => {
	it('false keď BACKFILL_TOKEN chýba (bezpečný default = vypnuté)', () => {
		vi.stubEnv('BACKFILL_TOKEN', '');
		expect(backfillTokenValid('cokolvek')).toBe(false);
	});
	it('timing-safe zhoda', () => {
		vi.stubEnv('BACKFILL_TOKEN', 'tajny-token-123');
		expect(backfillTokenValid('tajny-token-123')).toBe(true);
		expect(backfillTokenValid('zle')).toBe(false);
		expect(backfillTokenValid(null)).toBe(false);
	});
});

describe('listOdpisyForBackfill', () => {
	it('vráti len live=1 v okne, s content_hash + detail', () => {
		insertOdpis({ op: 'OPA', live: 1 });
		insertOdpis({ op: 'OPB', live: 0 }); // test odpis — vylúčený
		const rows = listOdpisyForBackfill(30);
		expect(rows.map((r) => r.op)).toEqual(['OPA']);
		expect(rows[0]!.content_hash).toBe('h');
		expect(typeof rows[0]!.detail).toBe('string');
	});
});

describe('POST /admin/backfill-narezaky — gate', () => {
	it('bez tokenu aj bez internej session → 403', async () => {
		vi.stubEnv('BACKFILL_TOKEN', 'T');
		await expect(POST(evt({ body: { dryRun: true } }))).rejects.toMatchObject({ status: 403 });
	});

	it('platný token, ale ODOO upload vypnutý → 409', async () => {
		vi.stubEnv('BACKFILL_TOKEN', 'T');
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		await expect(POST(evt({ token: 'T', body: { dryRun: true } }))).rejects.toMatchObject({
			status: 409
		});
	});

	it('interná session (bez tokenu) prejde gate', async () => {
		enableOdooEnv();
		mockOdoo({ orderExists: true });
		insertOdpis({ op: 'OP1' });
		const res = await POST(evt({ user: admin, body: { dryRun: true } }));
		expect(res.status).toBe(200);
	});
});

describe('POST /admin/backfill-narezaky — beh', () => {
	it('DRY-RUN default: neposiela upload, vráti sumár', async () => {
		vi.stubEnv('BACKFILL_TOKEN', 'T');
		enableOdooEnv();
		let uploaded = false;
		mockOdoo({ orderExists: true, onUpload: () => (uploaded = true) });
		insertOdpis({ op: 'OP1', modul: 'pergola' });
		// telo bez dryRun → default true
		const res = await POST(evt({ token: 'T', body: {} }));
		const s = await res.json();
		expect(s.dryRun).toBe(true);
		expect(uploaded).toBe(false);
		expect(s.objednavok).toBe(1);
		expect(s.nahranych).toBe(1); // „poslal by"
	});

	it('--live (dryRun:false) reálne pošle upload s lines', async () => {
		vi.stubEnv('BACKFILL_TOKEN', 'T');
		enableOdooEnv();
		let sent: unknown = null;
		mockOdoo({ orderExists: true, onUpload: (b) => (sent = b) });
		insertOdpis({ op: 'OP2', modul: 'pergola' });
		const res = await POST(evt({ token: 'T', body: { dryRun: false } }));
		const s = await res.json();
		expect(s.dryRun).toBe(false);
		expect(s.nahranych).toBe(1);
		expect((sent as { order_number: string }).order_number).toBe('OP2');
		expect((sent as { doc_id: string }).doc_id).toBe('backfill-narezak-op2');
		expect((sent as { lines: unknown[] }).lines).toHaveLength(1);
	});

	it('objednávka ktorá už má riadky → skip (chráni #522 riadky)', async () => {
		vi.stubEnv('BACKFILL_TOKEN', 'T');
		enableOdooEnv();
		let uploaded = false;
		mockOdoo({ orderExists: true, hasLines: true, onUpload: () => (uploaded = true) });
		insertOdpis({ op: 'OP3', modul: 'pergola' });
		const res = await POST(evt({ token: 'T', body: { dryRun: false } }));
		const s = await res.json();
		expect(uploaded).toBe(false);
		expect(s.skipHasLines).toBe(1);
	});
});
