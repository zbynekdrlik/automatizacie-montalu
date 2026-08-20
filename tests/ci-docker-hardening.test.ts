// Štruktúrny regresný test spevnenia CI/Docker (#244). Číta reálne konfiguračné
// súbory a tvrdí, že spevnenia nezmizli — bez behaviorálnej logiky, bez novej
// yaml závislosti (jednoduchý odsadenie/regex parser; `yaml`/`js-yaml` v strome nie sú).
//
// Chráni: timeout-minutes na KAŽDOM jobe, žiadny continue-on-error, každá akcia
// pinnutá na commit SHA, blokujúci npm audit krok, compose logging + healthcheck.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromRoot = (rel: string) => fileURLToPath(new URL('../' + rel, import.meta.url));
const ci = readFileSync(fromRoot('.github/workflows/ci.yml'), 'utf8');
const compose = readFileSync(fromRoot('deploy/docker-compose.yml'), 'utf8');

// Vráti druhoúrovňové bloky mapovania pod `parentKey` (napr. jobs → jednotlivé
// joby). childIndent = počet medzier pred názvom child kľúča. Blok = všetky riadky
// od hlavičky child kľúča po ďalšiu rovnako-odsadenú hlavičku (alebo dedent na top-level).
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

describe('#244 — CI hardening (.github/workflows/ci.yml)', () => {
	const jobs = childBlocks(ci, 'jobs', 2);

	it('parser vidí všetky tri joby', () => {
		expect(Object.keys(jobs).sort()).toEqual(['deploy', 'test', 'version-check']);
	});

	it('KAŽDÝ job má timeout-minutes (fail-fast, žiadny 6h zombie)', () => {
		for (const [name, body] of Object.entries(jobs)) {
			expect(body, `job ${name} nemá timeout-minutes`).toMatch(/^\s+timeout-minutes:\s*\d+\s*$/m);
		}
	});

	it('žiadny continue-on-error (skryté zelené padnutie je zakázané)', () => {
		expect(ci).not.toMatch(/continue-on-error/);
	});

	it('cancel-in-progress NIE je bezpodmienečné true (na main sa nesmie rušiť deploy)', () => {
		expect(ci).toMatch(
			/cancel-in-progress:\s*\$\{\{\s*github\.ref\s*!=\s*'refs\/heads\/main'\s*\}\}/
		);
		expect(ci).not.toMatch(/cancel-in-progress:\s*true\s*$/m);
	});

	it('každá `uses:` akcia je pinnutá na 40-znakový commit SHA', () => {
		const uses = ci.match(/^\s*(?:-\s*)?uses:\s*(\S+)/gm) ?? [];
		expect(uses.length).toBeGreaterThan(0);
		for (const line of uses) {
			const ref = line.replace(/^\s*(?:-\s*)?uses:\s*/, '');
			expect(ref, `akcia nie je SHA-pinnutá: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
		}
	});

	it('blokujúci audit krok prod závislostí (high+) je prítomný', () => {
		expect(ci).toMatch(/npm audit --omit=dev --audit-level=high/);
	});
});

describe('#244 — Docker hardening (deploy/docker-compose.yml)', () => {
	const app = childBlocks(compose, 'services', 2).app ?? '';

	it('parser vidí službu app', () => {
		expect(app.length).toBeGreaterThan(0);
	});

	it('app má rotáciu logov (json-file max-size + max-file)', () => {
		expect(app).toMatch(/logging:/);
		expect(app).toMatch(/driver:\s*json-file/);
		expect(app).toMatch(/max-size:\s*['"]?10m/);
		expect(app).toMatch(/max-file:\s*['"]?5/);
	});

	it('app má healthcheck na /health s ohraničeným intervalom/retries', () => {
		expect(app).toMatch(/healthcheck:/);
		expect(app).toMatch(/\/health/);
		expect(app).toMatch(/interval:\s*\d+s/);
		expect(app).toMatch(/retries:\s*\d+/);
		expect(app).toMatch(/start_period:\s*\d+s/);
	});
});
