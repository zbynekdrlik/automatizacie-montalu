// #261: regresný test na izoláciu test DB. `db.ts` je modulový singleton, ktorý pri
// importe otvorí + migruje DB na `DATABASE_PATH || './data/app.db'`. 79 test súborov
// túto cestu nenastavuje → pri paralelnom vitest sa preteká viac workerov na prvotnej
// migrácii toho istého `./data/app.db` (`SqliteError: table ... already exists`). Setup
// `tests/setup/db-isolation.ts` priradí unikátnu per-file cestu PRED importom `db.ts`.
// Tento súbor ZÁMERNE nenastavuje `DATABASE_PATH` — overuje, že ho izoloval setup, nie default.
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { DB_PATH } from '../src/lib/server/db';

describe('test DB izolácia (#261)', () => {
	it('db-importujúci súbor bez explicitného DATABASE_PATH dostane izolovanú scratch cestu', () => {
		// bez setupu by DB_PATH bola zdieľaný default → race na prvotnej migrácii
		expect(DB_PATH).not.toBe('./data/app.db');
		// izolovaná cesta žije pod os.tmpdir() a nesie marker setup mechanizmu
		expect(DB_PATH.startsWith(os.tmpdir())).toBe(true);
		expect(DB_PATH).toContain('am-vitest-db');
	});
});
