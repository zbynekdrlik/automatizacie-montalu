// Štruktúrny config-guard test (#278). Číta reálny `deploy/docker-compose.yml` a tvrdí,
// že `services.app.environment:` forwarduje VŠETKY štyri `ODOO_LEAD_*` premenné, ktoré
// appka číta výhradne z runtime env (`src/lib/server/odoo-lead.ts:171-174`). Bez forwardu
// je Odoo lead integrácia na prode ticho vypnutá (`hooks.server.ts:42` je no-op keď chýba
// ktorákoľvek premenná) — presne incident #278.
//
// Bez behaviorálnej logiky, bez novej yaml závislosti — jednoduchý odsadenie/regex parser,
// vzor `tests/ci-docker-hardening.test.ts` (`yaml`/`js-yaml` v strome nie sú).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromRoot = (rel: string) => fileURLToPath(new URL('../' + rel, import.meta.url));
const compose = readFileSync(fromRoot('deploy/docker-compose.yml'), 'utf8');

// Vráti druhoúrovňové bloky mapovania pod `parentKey` (services → jednotlivé služby).
// Blok = všetky riadky od hlavičky child kľúča po ďalšiu rovnako-odsadenú hlavičku
// (alebo dedent na top-level). Kópia helpera z tests/ci-docker-hardening.test.ts.
function childBlocks(text: string, parentKey: string, childIndent: number): Record<string, string> {
	const lines = text.split('\n');
	const start = lines.findIndex((l) => new RegExp('^' + parentKey + ':\\s*$').test(l));
	const out: Record<string, string> = {};
	if (start === -1) return out;
	const headerRe = new RegExp('^ {' + childIndent + '}([A-Za-z0-9_-]+):\\s*$');
	let cur: string | null = null;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^\S/.test(line!) && line!.trim() !== '') break; // dedent na top-level kľúč → koniec sekcie
		const m = line!.match(headerRe);
		if (m) {
			cur = m[1]!;
			out[cur] = '';
			continue;
		}
		if (cur !== null) out[cur] += line + '\n';
	}
	return out;
}

const app = childBlocks(compose, 'services', 2).app ?? '';

const ODOO_LEAD_VARS = ['ODOO_LEAD_URL', 'ODOO_LEAD_DB', 'ODOO_LEAD_LOGIN', 'ODOO_LEAD_API_KEY'];

describe('#278 — compose forwarduje ODOO_LEAD_* env do containera', () => {
	it('parser vidí službu app', () => {
		expect(app.length).toBeGreaterThan(0);
	});

	it.each(ODOO_LEAD_VARS)('environment: forwarduje %s ako ${%s:-}', (v) => {
		// Presný tvar `  ODOO_LEAD_X: ${ODOO_LEAD_X:-}` (interpolácia z host .env, prázdny default).
		const re = new RegExp('^\\s*' + v + ':\\s*\\$\\{' + v + ':-\\}\\s*$', 'm');
		expect(app, `compose environment: neforwarduje ${v} (chýba \`${v}: \${${v}:-}\`)`).toMatch(re);
	});
});
