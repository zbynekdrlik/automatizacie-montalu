// #282 — GET /dopyty-konfigurator/pdf endpoint: AUTH (defense-in-depth vrstva NAVYŠE k
// globálnej bráne hooks.server.ts) + validácia id + úspešný PDF response. Volá `GET` handler
// priamo s fake RequestEvent (vzor tests/dopyt-action.test.ts). Izolovaná test DB (v25).
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '../src/routes/dopyty-konfigurator/pdf/+server';
import { db } from '../src/lib/server/db';
import { insertDopyt } from '../src/lib/server/dopyt-store';

// Presný tvar eventu, ktorý GET handler očakáva (RouteParams + route id) — cez Parameters<>,
// nie generický RequestEvent (ten by mal širší RouteId union a neprešiel by typom).
type GetEvent = Parameters<typeof GET>[0];

type Role = 'internal' | 'b2b';
function makeEvent(idParam: string | null, role: Role | null): GetEvent {
	const url = new URL('http://localhost/dopyty-konfigurator/pdf');
	if (idParam !== null) url.searchParams.set('id', idParam);
	const user = role ? { id: 1, username: 'u', role } : null;
	return { url, locals: { user } } as unknown as GetEvent;
}

describe('GET /dopyty-konfigurator/pdf — auth + validácia (#282)', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('neprihlásený (locals.user=null) → 401', async () => {
		await expect(GET(makeEvent('1', null))).rejects.toMatchObject({ status: 401 });
	});

	it('b2b používateľ → 403 (interné-only, defense-in-depth)', async () => {
		await expect(GET(makeEvent('1', 'b2b'))).rejects.toMatchObject({ status: 403 });
	});

	it('interný + neplatné id → 400', async () => {
		await expect(GET(makeEvent('abc', 'internal'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(makeEvent('0', 'internal'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(makeEvent(null, 'internal'))).rejects.toMatchObject({ status: 400 });
	});

	it('interný + neexistujúce id → 404', async () => {
		await expect(GET(makeEvent('999999', 'internal'))).rejects.toMatchObject({ status: 404 });
	});

	it('interný + platné id → 200 application/pdf s attachment', async () => {
		const id = insertDopyt({
			konfiguracia: JSON.stringify({ system: 'Robust', sirka: 3000 }),
			meno: 'Ján',
			email: 'jan@x.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const res = await GET(makeEvent(String(id), 'internal'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(res.headers.get('content-disposition')).toContain('attachment');
		expect(res.headers.get('content-disposition')).toContain(`dopyt-${id}-`);
		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
	});
});
