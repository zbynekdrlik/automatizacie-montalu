// #245: handleError — neočakávaná serverová chyba dostane dohľadateľné errorId,
// používateľ dostane bezpečnú SK správu a do logu ide plný kontext + stack.
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-handle-error-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';

// import PRV (LOG_LEVEL neni nastavený ⇒ migrácie ticho, žiadny šum); level až potom,
// aby handleError (ERROR) prešiel captureom. ERROR (nie debug) = žiadny INFO šum.
const { handleError } = await import('../src/hooks.server');
process.env.LOG_LEVEL = 'error';
afterAll(() => delete process.env.LOG_LEVEL);

function capture(fn: () => void): Record<string, unknown>[] {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return lines
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

// minimálny RequestEvent pre handleError
function fakeEvent(pathname: string, method: string, username?: string) {
	return {
		url: new URL('http://localhost' + pathname),
		request: new Request('http://localhost' + pathname, { method }),
		locals: { user: username ? { id: 1, username, role: 'internal' } : null }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('handleError', () => {
	it('vráti bezpečnú SK správu + errorId a zaloguje error+stack+kontext', () => {
		let result: { message: string; errorId?: string } | undefined;
		const recs = capture(() => {
			result = handleError({
				error: new Error('boom v serveri'),
				event: fakeEvent('/pergola', 'POST', 'bob'),
				status: 500,
				message: 'Internal Error'
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any) as { message: string; errorId?: string };
		});
		expect(result!.message).toBe('Nastala neočakávaná chyba. Skús to prosím znova.');
		expect(result!.errorId).toMatch(/^[0-9a-f]{12}$/);

		const rec = recs.find((r) => r.msg === 'neošetrená serverová chyba');
		expect(rec).toBeDefined();
		expect(rec!.level).toBe('error');
		expect(rec!.module).toBe('error');
		expect(rec!.errorId).toBe(result!.errorId);
		expect(rec!.status).toBe(500);
		expect(rec!.pathname).toBe('/pergola');
		expect(rec!.method).toBe('POST');
		expect(rec!.username).toBe('bob');
		const err = rec!.error as { message: string; stack: string };
		expect(err.message).toBe('boom v serveri');
		expect(err.stack).toContain('boom v serveri');
	});

	it('funguje aj bez prihláseného používateľa (username undefined)', () => {
		let result: { errorId?: string } | undefined;
		const recs = capture(() => {
			result = handleError({
				error: new Error('x'),
				event: fakeEvent('/bazen', 'GET'),
				status: 500,
				message: 'Internal Error'
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any) as { errorId?: string };
		});
		expect(result!.errorId).toMatch(/^[0-9a-f]{12}$/);
		const rec = recs.find((r) => r.msg === 'neošetrená serverová chyba');
		expect(rec!.username).toBeUndefined();
	});
});
