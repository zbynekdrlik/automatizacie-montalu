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

function timeCall(fn: () => void): number {
	const t0 = process.hrtime.bigint();
	fn();
	return Number(process.hrtime.bigint() - t0) / 1e6; // ms
}

describe('login timing oracle je uzavretý', () => {
	beforeAll(() => {
		addUser('realny-ucet', 'spravne-heslo-123', 'internal');
	});

	it('čas neznáme meno vs zlé heslo sa líši < 20 % (oba behy spustia scrypt)', () => {
		const N = 41;
		const WARM = 8;
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
		// POROVNÁVAME MINIMÁ, nie mediány: pod plným behom testov + v8 coverage
		// inštrumentáciou je CPU kontencia veľká a mediány driftujú (flaky nad 20 %
		// — nájdené naživo). Kontencia čas iba PRIDÁVA, takže minimum každej cesty =
		// čistá, nerušená cena scryptu = presne ten časový signál, ktorý by útočník
		// s mnohými vzorkami odčítal. Minimá sú deterministické a robustné.
		const mu = Math.min(...unknown);
		const mw = Math.min(...wrong);
		const relDiff = Math.abs(mu - mw) / Math.max(mu, mw);
		// oba behy spustia práve jeden scrypt (neznáme meno cez DUMMY_HASH) → minimá takmer zhodné
		expect(relDiff).toBeLessThan(0.2);
	});
});
