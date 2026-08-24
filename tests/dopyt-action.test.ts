// #277 — verejná SvelteKit akcia dopytu. Fake RequestEvent (FormData + getClientAddress +
// headers) na čerstvo izolovanej test DB. Overuje honeypot, rate-limit, validáciu, úspech
// (PDF base64 download-first), pád getClientAddress a data-URL render.
import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '../src/lib/server/db';
import { dopytAction } from '../src/lib/server/dopyt-action';
import { countDopyty, getDopyt } from '../src/lib/server/dopyt-store';
import { CENNIK_VERZIA } from '../src/lib/server/konfigurator-cena';
import { allowDopyt, _resetDopytThrottle, MAX_PER_WINDOW } from '../src/lib/server/dopyt-throttle';
import { HONEYPOT_FIELD } from '../src/lib/dopyt';

const PNG_1x1_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface EventOpts {
	ip?: string | null;
	throwIp?: boolean;
	cf?: string | null;
}

function makeEvent(fields: Record<string, string>, opts: EventOpts = {}): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	const headers = new Headers();
	if (opts.cf) headers.set('cf-connecting-ip', opts.cf);
	return {
		request: {
			formData: () => Promise.resolve(fd),
			headers
		},
		getClientAddress: () => {
			if (opts.throwIp) throw new Error('no XFF');
			return opts.ip ?? '203.0.113.10';
		}
	} as unknown as RequestEvent;
}

const OK_FIELDS = {
	konfiguracia: JSON.stringify({ system: 'Robust', sirka: 3000, hlbka: 4000 }),
	meno: 'Ján Novák',
	email: 'jan@example.com',
	telefon: '+421 900 111 222',
	miesto: 'Bratislava',
	poznamka: 'ozvite sa'
};

beforeEach(() => _resetDopytThrottle());

describe('dopytAction', () => {
	it('úspech: uloží dopyt a vráti PDF base64 (download-first)', async () => {
		const before = countDopyty();
		const res = (await dopytAction(makeEvent(OK_FIELDS))) as {
			success: boolean;
			pdfBase64: string;
			filename: string;
		};
		expect(res.success).toBe(true);
		expect(countDopyty()).toBe(before + 1);
		// pdfBase64 je reálne PDF
		expect(Buffer.from(res.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
		expect(res.filename).toMatch(/^Montalu-ponuka-\d{4}-\d{2}-\d{2}\.pdf$/);
	});

	it('#309: opečiatkuje orientačnú cenu + verziu cenníka do dopyt riadka pri podaní', async () => {
		const res = (await dopytAction(makeEvent(OK_FIELDS))) as { success: boolean };
		expect(res.success).toBe(true);
		const lastId = (db.prepare('SELECT MAX(id) m FROM dopyt').get() as { m: number }).m;
		const row = getDopyt(lastId)!;
		// cena je opečiatkovaná (3000×4000 je v katalógu) + verzia zodpovedá aktuálnemu cenníku
		expect(row.cena_druh).toBe('cena');
		expect(typeof row.cena_s_dph).toBe('number');
		expect(row.cena_s_dph).toBeGreaterThan(0);
		expect(row.cennik_verzia).toBe(CENNIK_VERZIA);
	});

	it('honeypot vyplnený → ticho úspech, NIČ sa neuloží', async () => {
		const before = countDopyty();
		const res = (await dopytAction(
			makeEvent({ ...OK_FIELDS, [HONEYPOT_FIELD]: 'http://spam' })
		)) as {
			success: boolean;
			pdfBase64?: string;
		};
		expect(res.success).toBe(true);
		expect(res.pdfBase64).toBeUndefined();
		expect(countDopyty()).toBe(before);
	});

	it('rate-limit prekročený → fail 429', async () => {
		// predvyčerpaj okno pre túto IP
		for (let i = 0; i < MAX_PER_WINDOW; i++) allowDopyt('198.51.100.5');
		const res = (await dopytAction(makeEvent(OK_FIELDS, { ip: '198.51.100.5' }))) as {
			status: number;
		};
		expect(res.status).toBe(429);
	});

	it('nevalidný vstup (chýba meno) → fail 400 s chybami', async () => {
		const res = (await dopytAction(makeEvent({ ...OK_FIELDS, meno: '' }))) as {
			status: number;
			data: { errors: Record<string, string> };
		};
		expect(res.status).toBe(400);
		expect(res.data.errors.meno).toBeDefined();
	});

	it('getClientAddress hodí (chýba XFF) → akcia aj tak prejde (bucket "-")', async () => {
		const res = (await dopytAction(makeEvent(OK_FIELDS, { throwIp: true }))) as {
			success: boolean;
		};
		expect(res.success).toBe(true);
	});

	it('render ako data-URL PNG sa embedne, úspech', async () => {
		const res = (await dopytAction(
			makeEvent({ ...OK_FIELDS, renderPng: `data:image/png;base64,${PNG_1x1_B64}` })
		)) as { success: boolean; pdfBase64: string };
		expect(res.success).toBe(true);
		expect(Buffer.from(res.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
	});

	it('CF-connecting-ip sa rešpektuje keď edge je CF IP', async () => {
		// edge 172.70.0.1 je v CF rozsahu 172.64.0.0/13 → throttle kľúč = cf ip
		for (let i = 0; i < MAX_PER_WINDOW; i++) allowDopyt('9.9.9.9');
		const res = (await dopytAction(makeEvent(OK_FIELDS, { ip: '172.70.0.1', cf: '9.9.9.9' }))) as {
			status: number;
		};
		expect(res.status).toBe(429);
	});
});
