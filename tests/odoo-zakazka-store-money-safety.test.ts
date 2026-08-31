// #349: durable store `odoo-zakazka-store.ts` je Money-NEUTRÁLNY — nezapisuje do `/data` (Money
// import), nevolá `writeOdpis`, nedotýka sa `MONEY_LIVE`/`isLive`, žiadny fs zápis. Rovnaký statický
// guard ako `odoo-zakazka.test.ts` / `dopyt-money-safety.test.ts`: číta ZDROJ a tvrdí NEprítomnosť
// nebezpečných vzorov. Store importuje LEN `db` (SQLite pripojenie) + čisté `normZak/normOp`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('odoo-zakazka-store Money-neutralita', () => {
	const src = fs.readFileSync(
		new URL('../src/lib/server/odoo-zakazka-store.ts', import.meta.url),
		'utf8'
	);
	it('zdroj NEZAPISUJE do /data ani na disk a nevolá writeOdpis', () => {
		expect(src).not.toMatch(/\/data\//);
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open)/);
	});
	it('zdroj sa nedotýka MONEY_LIVE / isLive', () => {
		expect(src).not.toMatch(/process\.env\.MONEY_LIVE|isLive\s*\(/);
	});
});
