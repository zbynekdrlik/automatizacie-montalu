// #251 SEC-missed: obranný limit dĺžky priamo v login() (choke-point pre KAŽDÉHO
// volajúceho, nielen HTTP akciu, ktorá capuje skôr). Príliš dlhé meno/heslo vráti
// null PRED DB/scrypt — bez tohto by veľký vstup nútil scrypt hashovať megabajty.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-login-length-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'length.db');

const { login } = await import('../src/lib/server/auth');
const { addUser } = await import('../src/lib/server/db');
const { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } = await import('../src/lib/server/auth');

describe('login() obranný limit dĺžky (pred scrypt)', () => {
	it('príliš dlhé meno → null, aj keď účet inak existuje', () => {
		addUser('realny', 'spravne-heslo-123', 'internal');
		// presne na strope prejde normálne (zlé heslo → null cez scrypt, nie cez guard)
		expect(login('realny', 'zle')).toBeNull();
		// nad stropom → guard vráti null PRED DB/scrypt
		expect(login('a'.repeat(MAX_USERNAME_LEN + 1), 'x')).toBeNull();
	});

	it('príliš dlhé heslo → null (aj pre existujúce meno)', () => {
		expect(login('realny', 'x'.repeat(MAX_PASSWORD_LEN + 1))).toBeNull();
	});
});
