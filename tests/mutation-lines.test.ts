import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

// scripts/mutation-lines.sh — z `git diff -U0` (stdin) vyrobí Stryker `--mutate`
// zoznam obmedzený na ZMENENÉ RIADKY (`súbor:start-end`, jeden záznam na hunk).
// Dôvod (#569, run 36109311931): diff-scoped gate mutoval CELÉ zmenené súbory —
// pár zmenených riadkov v LEAF module `compute-model.ts` vygeneroval stovky
// mutantov a shard 6 presiahol tvrdý 20-min strop. Vlastnosti, na ktorých gate stojí:
// (1) hunk `+c,d` → `súbor:c-(c+d-1)`; `+c` (bez počtu) → `súbor:c-c`;
// (2) čisté zmazanie (`+c,0`) → žiadny záznam (nie je čo mutovať);
// (3) NOVÝ súbor (`--- /dev/null`) → celý súbor (holá cesta, bez rozsahu);
// (4) ZMAZANÝ súbor (`+++ /dev/null`) → nič;
// (5) viac hunkov → viac záznamov, v poradí diffu; viac súborov → zreťazené;
// (6) prázdny vstup → prázdny výstup (gate na tom stavia „nič na mutovanie").
const SCRIPT = resolve(__dirname, '../scripts/mutation-lines.sh');

function lines(diff: string, cwd?: string): string[] {
	const out = execFileSync('bash', [SCRIPT], {
		input: diff,
		encoding: 'utf8',
		...(cwd ? { cwd } : {})
	});
	return out === '' ? [] : out.split(',');
}

const MODIFIED = `diff --git a/src/lib/server/compute-model.ts b/src/lib/server/compute-model.ts
index f33f096..7a3017d 100644
--- a/src/lib/server/compute-model.ts
+++ b/src/lib/server/compute-model.ts
@@ -2 +2 @@
-// stary
+// novy
@@ -4,0 +5 @@
+import { X } from '$lib/x';
@@ -42 +43,12 @@ export interface CfgGroup {
-export type Cfg = Record<string, CfgGroup>;
+a
+b
+c
+d
+e
+f
+g
+h
+i
+j
+k
+l
@@ -60,3 +71,0 @@ export function foo() {
-zmazane1
-zmazane2
-zmazane3
`;

const NEW_FILE = `diff --git a/src/lib/sietka-standard.ts b/src/lib/sietka-standard.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/lib/sietka-standard.ts
@@ -0,0 +1,107 @@
+export const A = 1;
`;

const DELETED_FILE = `diff --git a/src/lib/stary.ts b/src/lib/stary.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/lib/stary.ts
+++ /dev/null
@@ -1,20 +0,0 @@
-export const B = 2;
`;

const DELETION_ONLY = `diff --git a/src/lib/sietka.ts b/src/lib/sietka.ts
index 1111111..2222222 100644
--- a/src/lib/sietka.ts
+++ b/src/lib/sietka.ts
@@ -74,18 +73,0 @@ export function x() {
-riadok
`;

describe('scripts/mutation-lines.sh (mutation.yml diff-scope na riadky)', () => {
	it('upravený súbor: jeden záznam na hunk, `+c` bez počtu = jeden riadok, čisté zmazanie vynechané', () => {
		expect(lines(MODIFIED)).toEqual([
			'src/lib/server/compute-model.ts:2-2',
			'src/lib/server/compute-model.ts:5-5',
			'src/lib/server/compute-model.ts:43-54'
		]);
	});

	it('nový súbor = celý súbor (holá cesta bez rozsahu)', () => {
		expect(lines(NEW_FILE)).toEqual(['src/lib/sietka-standard.ts']);
	});

	it('zmazaný súbor ani súbor len so zmazaniami nedajú žiadny záznam', () => {
		expect(lines(DELETED_FILE)).toEqual([]);
		expect(lines(DELETION_ONLY)).toEqual([]);
	});

	it('viac súborov: zreťazené v poradí diffu', () => {
		expect(lines(DELETION_ONLY + NEW_FILE + DELETED_FILE + MODIFIED)).toEqual([
			'src/lib/sietka-standard.ts',
			'src/lib/server/compute-model.ts:2-2',
			'src/lib/server/compute-model.ts:5-5',
			'src/lib/server/compute-model.ts:43-54'
		]);
	});

	it('prázdny vstup → prázdny výstup', () => {
		expect(lines('')).toEqual([]);
	});

	// Integračný test na skutočnom `git diff -U0` (nie ručne písaný fixture) —
	// chráni pred rozchodom medzi fixture a reálnym formátom gitu.
	const dirs: string[] = [];
	afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

	it('reálny `git diff -U0 base...HEAD`: rozsahy sedia na HEAD čísla riadkov', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mutation-lines-'));
		dirs.push(dir);
		const git = (...args: string[]) =>
			execFileSync('git', args, {
				cwd: dir,
				encoding: 'utf8',
				env: {
					...process.env,
					GIT_AUTHOR_NAME: 't',
					GIT_AUTHOR_EMAIL: 't@t',
					GIT_COMMITTER_NAME: 't',
					GIT_COMMITTER_EMAIL: 't@t'
				}
			});
		git('init', '-q', '-b', 'main');
		mkdirSync(join(dir, 'src/lib'), { recursive: true });
		const base = Array.from({ length: 30 }, (_, i) => `const r${i + 1} = ${i + 1};`);
		writeFileSync(join(dir, 'src/lib/a.ts'), base.join('\n') + '\n');
		writeFileSync(join(dir, 'src/lib/zmaz.ts'), 'export const z = 1;\n');
		git('add', '.');
		git('commit', '-q', '-m', 'base');
		git('checkout', '-q', '-b', 'dev');
		const next = [...base];
		next[4] = 'const r5 = 500;'; // riadok 5 zmenený
		next.splice(10, 3); // pôvodné riadky 11-13 zmazané (čisté zmazanie)
		next.splice(20, 0, 'const n1 = 1;', 'const n2 = 2;'); // 2 nové riadky na HEAD 21-22
		writeFileSync(join(dir, 'src/lib/a.ts'), next.join('\n') + '\n');
		writeFileSync(join(dir, 'src/lib/novy.ts'), 'export const n = 1;\nexport const m = 2;\n');
		rmSync(join(dir, 'src/lib/zmaz.ts'));
		git('add', '-A');
		git('commit', '-q', '-m', 'zmena');
		const diff = git('-c', 'core.quotePath=false', 'diff', '-U0', 'main...HEAD', '--', 'src/lib');
		expect(lines(diff)).toEqual(['src/lib/a.ts:5-5', 'src/lib/a.ts:21-22', 'src/lib/novy.ts']);
	});
});
