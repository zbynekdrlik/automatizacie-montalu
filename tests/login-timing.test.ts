// #251 SEC-2: timing oracle. Pred fixom `login()` pri neznámom mene vráti null
// PRED scrypt → neznáme meno je rádovo rýchlejšie než existujúci účet so zlým
// heslom → enumerácia mien. Po fixe sa scrypt vykoná aj pri neznámom mene, takže
// medián času oboch ciest je takmer zhodný (rozdiel < 20 %, per akceptácia).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-login-timing-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'timing.db');

const { login } = await import('../src/lib/server/auth');
const { addUser } = await import('../src/lib/server/db');

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function timeCall(fn: () => void): number {
	const t0 = process.hrtime.bigint();
	fn();
	return Number(process.hrtime.bigint() - t0) / 1e6; // ms
}

describe('login timing oracle je uzavretý', () => {
	beforeAll(() => {
		addUser('realny-ucet', 'spravne-heslo-123', 'internal');
	});

	it('medián času neznáme meno vs zlé heslo sa líši < 20 %', () => {
		const N = 31;
		const WARM = 5;
		// warm-up (JIT, scrypt buffery) — nezapočítava sa
		for (let i = 0; i < WARM; i++) {
			login('nikto', 'x');
			login('realny-ucet', 'zle-heslo');
		}
		const unknown: number[] = [];
		const wrong: number[] = [];
		for (let i = 0; i < N; i++) {
			// striedavo, aby systémový šum ovplyvnil obe rovnako
			unknown.push(timeCall(() => login('neznamy-' + i, 'x')));
			wrong.push(timeCall(() => login('realny-ucet', 'zle-heslo-' + i)));
		}
		const mu = median(unknown);
		const mw = median(wrong);
		const relDiff = Math.abs(mu - mw) / Math.max(mu, mw);
		// oba behy teraz spustia jeden scrypt → mediány takmer zhodné
		expect(relDiff).toBeLessThan(0.2);
	});
});
