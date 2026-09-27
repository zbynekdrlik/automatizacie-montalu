// #571 follow-up (PROD 27.9., 0.25.45): podklad objednávky skla hlásil `hydration_mismatch`.
// Príčina: PROD beží za Cloudflare, ktorého „Email Address Obfuscation" prepíše e-mail v TEXTE
// HTML (banner „…od palo@montalu.sk…", user menu s e-mailovým menom) na `<a class="__cf_email__">`
// → server HTML ≠ to, čo klient hydratuje. Appka preto na HTML odpovede posiela
// `Cache-Control: no-transform` (Cloudflare potom HTML nemení — developers.cloudflare.com
// /waf/tools/scrape-shield/email-address-obfuscation). Existujúce direktívy sa zachovajú.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-no-transform-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'no-transform.db');
process.env.MONEY_LIVE = '0';

const { handle } = await import('../src/hooks.server');

function fakeEvent(pathname: string) {
	return {
		url: new URL('http://localhost' + pathname),
		request: new Request('http://localhost' + pathname),
		cookies: { get: () => undefined },
		locals: {}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const callHandle = (pathname: string, headers: Record<string, string>) =>
	handle({
		event: fakeEvent(pathname),
		resolve: async () => new Response('<p>palo@montalu.sk</p>', { status: 200, headers })
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

const direktivy = (v: string | null) =>
	(v ?? '')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);

describe('Cache-Control: no-transform — proxy nesmie meniť HTML (#571 hydration_mismatch)', () => {
	it('HTML stránka bez Cache-Control → no-transform', async () => {
		const res = await callHandle('/login', { 'content-type': 'text/html' });
		expect(direktivy(res.headers.get('cache-control'))).toEqual(['no-transform']);
	});

	it('existujúce direktívy ostanú, no-transform sa pridá', async () => {
		const res = await callHandle('/login', {
			'content-type': 'text/html',
			'cache-control': 'private, max-age=0'
		});
		expect(direktivy(res.headers.get('cache-control'))).toEqual([
			'private',
			'max-age=0',
			'no-transform'
		]);
	});

	// review: no-transform vypne aj Cloudflare brotli/gzip (developers.cloudflare.com/speed/
	// optimization/content/compression) — Email Obfuscation mení LEN HTML, takže JSON/__data.json
	// odpovede hlavičku NEdostanú a ostanú komprimované.
	it('JSON odpoveď (napr. /health, __data.json) → no-transform sa NEpridá (kompresia ostane)', async () => {
		const res = await callHandle('/health', {
			'content-type': 'application/json'
		});
		expect(res.headers.get('cache-control')).toBeNull();
	});

	it('no-transform sa nezdvojí, keď ho odpoveď už má', async () => {
		const res = await callHandle('/login', {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store, No-Transform'
		});
		expect(direktivy(res.headers.get('cache-control'))).toEqual(['no-store', 'no-transform']);
	});
});
