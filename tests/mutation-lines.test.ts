import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
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
// (6) prázdny vstup → prázdny výstup (gate na tom stavia „nič na mutovanie");
// (7) argumenty = allowlist súborov shardu: záznamy LEN pre tie cesty (diff sa robí
//     raz nad celým `src/lib` s `-M`, aby premenovaný súbor nebol „nový = celý").
const SCRIPT = resolve(__dirname, '../scripts/mutation-lines.sh');
const WORKFLOW = resolve(__dirname, '../.github/workflows/mutation.yml');
// Rovnaké príznaky ako mutation.yml scope krok — diff nezávislý od lokálneho git configu.
const DIFF_FLAGS = [
	'-U0',
	'-M',
	'--no-ext-diff',
	'--no-color',
	'--src-prefix=a/',
	'--dst-prefix=b/'
];

function lines(diff: string, files: string[] = []): string[] {
	const out = execFileSync('bash', [SCRIPT, ...files], {
		input: diff,
		encoding: 'utf8'
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

	it('riadok tela hunku `++ x` / `-- x` (vyzerá ako ---/+++) nezmätie hlavičku súboru', () => {
		const diff = `diff --git a/src/lib/c.ts b/src/lib/c.ts
index 1111111..2222222 100644
--- a/src/lib/c.ts
+++ b/src/lib/c.ts
@@ -3 +3 @@
--- /dev/null
+++ /dev/null
@@ -9,0 +10,2 @@
+++ b/iny.ts
+x
`;
		expect(lines(diff)).toEqual(['src/lib/c.ts:3-3', 'src/lib/c.ts:10-11']);
	});

	it('nečitateľná hlavička hunku = chyba (nie tichý prázdny scope)', () => {
		const diff = `diff --git a/src/lib/c.ts b/src/lib/c.ts
--- a/src/lib/c.ts
+++ b/src/lib/c.ts
@@ pokazene @@
`;
		expect(() => lines(diff)).toThrow();
	});

	it('allowlist (argumenty): záznamy len pre súbory shardu, poradie diffu', () => {
		const vsetko = NEW_FILE + MODIFIED;
		expect(lines(vsetko, ['src/lib/server/compute-model.ts'])).toEqual([
			'src/lib/server/compute-model.ts:2-2',
			'src/lib/server/compute-model.ts:5-5',
			'src/lib/server/compute-model.ts:43-54'
		]);
		expect(lines(vsetko, ['src/lib/sietka-standard.ts'])).toEqual(['src/lib/sietka-standard.ts']);
		expect(lines(vsetko, ['src/lib/iny.ts'])).toEqual([]);
	});

	// Integračné testy na skutočnom `git diff` (nie ručne písaný fixture) — chránia pred
	// rozchodom medzi fixture a reálnym formátom gitu. Izolovaný od globálneho/systémového
	// git configu (gpgsign, diff.noprefix, … by inak zmenili správanie na inom stroji).
	const dirs: string[] = [];
	afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

	function repo() {
		const dir = mkdtempSync(join(tmpdir(), 'mutation-lines-'));
		dirs.push(dir);
		const git = (...args: string[]) =>
			execFileSync('git', args, {
				cwd: dir,
				encoding: 'utf8',
				env: {
					...process.env,
					GIT_CONFIG_GLOBAL: '/dev/null',
					GIT_CONFIG_NOSYSTEM: '1',
					GIT_AUTHOR_NAME: 't',
					GIT_AUTHOR_EMAIL: 't@t',
					GIT_COMMITTER_NAME: 't',
					GIT_COMMITTER_EMAIL: 't@t'
				}
			});
		git('init', '-q', '-b', 'main');
		mkdirSync(join(dir, 'src/lib'), { recursive: true });
		const zapis = (f: string, obsah: string) => writeFileSync(join(dir, f), obsah);
		const commit = (msg: string) => {
			git('add', '-A');
			git('commit', '-q', '-m', msg);
		};
		const diff = () =>
			git('-c', 'core.quotePath=false', 'diff', ...DIFF_FLAGS, 'main...HEAD', '--', 'src/lib');
		return { dir, git, zapis, commit, diff };
	}

	const BASE = Array.from({ length: 30 }, (_, i) => `const r${i + 1} = ${i + 1};`);

	it('reálny `git diff -U0 base...HEAD`: rozsahy sedia na HEAD čísla riadkov', () => {
		const r = repo();
		r.zapis('src/lib/a.ts', BASE.join('\n') + '\n');
		r.zapis('src/lib/zmaz.ts', 'export const z = 1;\n');
		r.commit('base');
		r.git('checkout', '-q', '-b', 'dev');
		const next = [...BASE];
		next[4] = 'const r5 = 500;'; // riadok 5 zmenený
		next.splice(10, 3); // pôvodné riadky 11-13 zmazané (čisté zmazanie)
		next.splice(20, 0, 'const n1 = 1;', 'const n2 = 2;'); // 2 nové riadky na HEAD 21-22
		r.zapis('src/lib/a.ts', next.join('\n') + '\n');
		r.zapis('src/lib/novy.ts', 'export const n = 1;\nexport const m = 2;\n');
		rmSync(join(r.dir, 'src/lib/zmaz.ts'));
		r.commit('zmena');
		expect(lines(r.diff())).toEqual(['src/lib/a.ts:5-5', 'src/lib/a.ts:21-22', 'src/lib/novy.ts']);
	});

	it('premenovaný súbor s malou zmenou = len zmenené riadky, NIE celý súbor', () => {
		const r = repo();
		r.zapis('src/lib/stary.ts', BASE.join('\n') + '\n');
		r.commit('base');
		r.git('checkout', '-q', '-b', 'dev');
		r.git('mv', 'src/lib/stary.ts', 'src/lib/novy-nazov.ts');
		const next = [...BASE];
		next[7] = 'const r8 = 800;'; // riadok 8 zmenený
		r.zapis('src/lib/novy-nazov.ts', next.join('\n') + '\n');
		r.commit('premenovanie');
		// shard dostane NOVÚ cestu (tak ju vráti `--name-only`)
		expect(lines(r.diff(), ['src/lib/novy-nazov.ts'])).toEqual(['src/lib/novy-nazov.ts:8-8']);
	});
});

// Zapojenie v mutation.yml — tichý návrat k mutácii celých súborov (alebo zmena
// príznakov diffu, ktoré testy vyššie predpokladajú) má padnúť tu, nie až na 20-min strope.
describe('mutation.yml scope krok (zapojenie #569)', () => {
	const yml = readFileSync(WORKFLOW, 'utf8');

	it('rozsahy riadkov idú cez mutation-lines.sh s allowlistom shardu, diff s rovnakými príznakmi', () => {
		expect(yml).toContain('| bash scripts/mutation-lines.sh "${FILES[@]}"');
		expect(yml).toContain(`diff ${DIFF_FLAGS.join(' ')} origin/main...HEAD -- src/lib`);
		expect(yml).toContain('--mutate "$CHANGED"');
		expect(yml).toContain('changed=$RANGES');
	});

	it('DDL vylúčenie pokrýva migracie.ts aj každý migracie-*.ts, nie iné súbory', () => {
		const m = yml.match(/grep -vE '(\^src\/lib\/server\/migracie[^']*)'/);
		expect(m).not.toBeNull();
		const re = new RegExp(m![1]!);
		for (const f of [
			'src/lib/server/migracie.ts',
			'src/lib/server/migracie-seed.ts',
			'src/lib/server/migracie-sietka.ts',
			'src/lib/server/fonts/roboto.ts'
		])
			expect(re.test(f), f).toBe(true);
		for (const f of [
			'src/lib/server/compute-model.ts',
			'src/lib/server/migracie/iny.ts',
			'src/lib/migracie-x.ts'
		])
			expect(re.test(f), f).toBe(false);
	});
});
