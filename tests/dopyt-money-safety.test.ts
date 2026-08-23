// #277 — Money-safety guard (vzor `pergola-narez-money-safety`). Verejná dopyt/ponuka
// funkcia NIKDY nesmie siahnuť na Money/odpis zápisovú cestu. Statický import-guard:
// žiadny import `money`/`pergola`, žiadny `writeOdpis`/`MONEY_LIVE`/`dlv-import`/`odpis_log`,
// žiadny zápis do `/data`. `dopyt-store` SMIE importovať `./db` (len pripojenie k SQLite);
// PURE moduly (`ponuka`/`dopyt`) nesmú importovať ani `server/db`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// Zakázané naprieč VŠETKÝMI dopyt/ponuka súbormi (Money zápisová cesta).
const ZAKAZANE_MONEY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/pergola['"]/,
	/import\(\s*['"`].*server\/money['"`]/,
	/import\(\s*['"`].*server\/pergola['"`]/,
	/writeOdpis|MONEY_LIVE|dlv-import|odpis_log/,
	/['"`]\/data\//
];

const VSETKY = [
	'src/lib/ponuka.ts',
	'src/lib/dopyt.ts',
	'src/lib/server/ponuka-pdf.ts',
	'src/lib/server/dopyt-throttle.ts',
	'src/lib/server/dopyt-store.ts',
	'src/lib/server/dopyt-action.ts',
	'src/lib/components/DopytForm.svelte'
];

// PURE moduly (bez servera) nesmú importovať ani server/db.
const PURE = ['src/lib/ponuka.ts', 'src/lib/dopyt.ts'];

describe('dopyt/ponuka Money-safety (#277)', () => {
	for (const f of VSETKY) {
		it(`${f} sa nedotýka Money/odpis zápisovej cesty`, () => {
			const src = zdroj(f);
			for (const re of ZAKAZANE_MONEY) {
				expect(re.test(src), `${f} obsahuje zakázaný vzor ${re}`).toBe(false);
			}
		});
	}

	for (const f of PURE) {
		it(`${f} (pure) neimportuje ani server/db`, () => {
			const src = zdroj(f);
			expect(/from ['"].*server\/db['"]/.test(src)).toBe(false);
			expect(/import\(\s*['"`].*server\/db['"`]/.test(src)).toBe(false);
		});
	}
});
