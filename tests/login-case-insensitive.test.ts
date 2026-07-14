import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Regresný test bugu: b2b účet s e-mailovým menom sa nedal prihlásiť, keď
// používateľ napísal meno s inou veľkosťou písmen (mobil kapitalizuje prvé
// písmeno e-mailu → 'Obchod@…' ≠ uložené 'obchod@…', SQLite BINARY porovnanie).
// Prihlásenie MUSÍ byť case-insensitive na mene (e-maily sú case-insensitive).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-logincase-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'a.db');

const db = await import('../src/lib/server/db');
const auth = await import('../src/lib/server/auth');

describe('login je case-insensitive na mene (e-mailové účty)', () => {
	it('prihlási účet aj keď meno má inú veľkosť písmen', () => {
		expect(db.addUser('obchod@phsplus.cz', 'tajneheslo1', 'b2b').error).toBeNull();
		// mobil kapitalizuje prvé písmeno mena → iná veľkosť, správne heslo
		expect(auth.login('Obchod@phsplus.cz', 'tajneheslo1')).toBeTruthy();
		expect(auth.login('OBCHOD@PHSPLUS.CZ', 'tajneheslo1')).toBeTruthy();
		// case-insensitivita je LEN na mene — zlé heslo stále neprejde
		expect(auth.login('obchod@phsplus.cz', 'zleheslo')).toBeNull();
	});

	it('addUser odmietne duplicitu líšiacu sa len veľkosťou písmen', () => {
		expect(db.addUser('Dodavatel@x.sk', 'heslo123', 'b2b').error).toBeNull();
		const dup = db.addUser('dodavatel@x.sk', 'heslo123', 'b2b');
		expect(dup.error).toContain('existuje');
	});
});
