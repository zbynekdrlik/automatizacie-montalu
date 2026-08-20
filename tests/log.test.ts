// Formát a správanie štruktúrovaného loggera (#245): JSON riadok s time/level/
// module/msg + fields, child moduly, serializácia Error (stack), redakcia
// tajomstiev a filtrovanie podľa LOG_LEVEL.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, log } from '../src/lib/server/log';

// Zachytí JSON riadky, ktoré logger zapíše na stdout (a nič sa reálne nevypíše).
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

describe('logger', () => {
	const saved = { ...process.env };
	beforeEach(() => {
		// explicitný level ⇒ logger píše aj pod VITEST (default by bol silent)
		process.env.LOG_LEVEL = 'debug';
	});
	afterEach(() => {
		process.env.LOG_LEVEL = saved.LOG_LEVEL;
		delete process.env.VITEST;
		delete process.env.NODE_ENV;
		if (saved.VITEST !== undefined) process.env.VITEST = saved.VITEST;
		if (saved.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV;
	});

	it('emits one JSON line with time/level/module/msg + fields', () => {
		const recs = capture(() => logger('auth').info('login ok', { username: 'a', ip: '1.2.3.4' }));
		expect(recs).toHaveLength(1);
		const r = recs[0];
		expect(r.level).toBe('info');
		expect(r.module).toBe('auth');
		expect(r.msg).toBe('login ok');
		expect(r.username).toBe('a');
		expect(r.ip).toBe('1.2.3.4');
		// time je platný ISO 8601 timestamp
		expect(typeof r.time).toBe('string');
		expect(new Date(r.time as string).toISOString()).toBe(r.time);
	});

	it('all four levels carry the right level tag', () => {
		const recs = capture(() => {
			const l = logger('x');
			l.debug('d');
			l.info('i');
			l.warn('w');
			l.error('e');
		});
		expect(recs.map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
	});

	it('child() nests the module name', () => {
		const recs = capture(() => logger('db').child('migrate').warn('hm'));
		expect(recs[0].module).toBe('db:migrate');
	});

	it('serializes Error values with name/message/stack', () => {
		const recs = capture(() => logger('err').error('zlyhalo', { error: new TypeError('bum') }));
		const e = recs[0].error as { name: string; message: string; stack: string };
		expect(e.name).toBe('TypeError');
		expect(e.message).toBe('bum');
		expect(typeof e.stack).toBe('string');
		expect(e.stack).toContain('bum');
	});

	it('redacts secret-named fields', () => {
		const recs = capture(() =>
			logger('auth').info('x', { password: 'tajne', token: 'abc', username: 'ok' })
		);
		expect(recs[0].password).toBe('[redacted]');
		expect(recs[0].token).toBe('[redacted]');
		expect(recs[0].username).toBe('ok');
	});

	it('LOG_LEVEL=warn suppresses debug/info but keeps warn/error', () => {
		process.env.LOG_LEVEL = 'warn';
		const recs = capture(() => {
			const l = logger('x');
			l.debug('no');
			l.info('no');
			l.warn('yes');
			l.error('yes');
		});
		expect(recs.map((r) => r.msg)).toEqual(['yes', 'yes']);
	});

	it('LOG_LEVEL=silent suppresses everything', () => {
		process.env.LOG_LEVEL = 'silent';
		const recs = capture(() => logger('x').error('nope'));
		expect(recs).toHaveLength(0);
	});

	it('under VITEST/test with no LOG_LEVEL it stays silent', () => {
		delete process.env.LOG_LEVEL;
		process.env.VITEST = 'true';
		const recs = capture(() => logger('x').error('nope'));
		expect(recs).toHaveLength(0);
	});

	it('outside test env with no LOG_LEVEL it defaults to debug', () => {
		delete process.env.LOG_LEVEL;
		delete process.env.VITEST;
		delete process.env.NODE_ENV;
		const recs = capture(() => logger('x').debug('yes'));
		expect(recs).toHaveLength(1);
	});

	it('never throws even if stdout.write fails', () => {
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => {
			throw new Error('EPIPE');
		});
		try {
			expect(() => log.info('x')).not.toThrow();
		} finally {
			spy.mockRestore();
		}
	});
});
