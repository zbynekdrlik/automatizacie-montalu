// Strážny test (#616, Odoo úloha 1450): text, ktorý appka ukáže používateľovi (obrazovky,
// hlášky, varovania, PDF/tlač, poznámky zapisované do Odoo, audit editora), NESMIE menovať
// konkrétnych ľudí (Patrik, Dominik, Špetta, …) ani interné odkazy (Odoo msg id, číslo
// migrácie/tiketu, názov zdrojového súboru). Vznikalo to tak, že vývojárske zdôvodnenie z tiketu
// („Patrik povedal…") sa napísalo priamo do textu pre dielňu namiesto do komentára — klient to
// videl na /sietka (Odoo úloha 1450, príloha att 41003). Zdôvodnenia s menami patria do
// KOMENTÁROV v kóde a do testov — tie guard zámerne ignoruje.
//
// Čo sa skenuje (cez AST — komentáre nie sú uzly, takže sa nikdy nedostanú do kontroly):
//  - `src/**/*.ts`: reťazcové literály (TypeScript `createSourceFile`),
//  - `src/**/*.svelte`: textové uzly markupu, statické hodnoty atribútov (`title`,
//    `placeholder`, `aria-label`, …) a reťazcové literály v `<script>` aj vo výrazoch `{…}`
//    (`svelte/compiler` `parse`). HTML komentáre, JS komentáre a `<style>` sa nekontrolujú.
// Nekontrolujú sa: import špecifikátory a argumenty logovacích volaní (`log.*`, `logger(…).*`,
// `console.*`) — server log je pre vývoj, používateľ ho nevidí (handleError vracia generickú
// hlášku), číslo tiketu tam pomáha dohľadať pôvod.
// Stryker (mutation-diff) inštrumentuje `src/lib/**/*.ts`, ale len obalí EXISTUJÚCE literály a
// vloží číselné id mutantov / „Stryker was here!" — nič z toho nematchne vzory nižšie, takže
// tento čisto negatívny guard je Stryker-safe (`.claude/rules/testing.md`).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isIdentifier,
	isImportDeclaration,
	isImportTypeNode,
	isLiteralTypeNode,
	isPropertyAccessExpression,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	type Expression,
	type Node,
	type SourceFile
} from 'typescript';

const SRC = path.resolve(fileURLToPath(new URL('../src', import.meta.url)));
const ROOT = path.dirname(SRC);

/** Mená ľudí (zákazník, výroba, vývoj) ako ZAČIATKY slov — chytí aj skloňovanie
 *  (Patrika, Dominikove, Špettu, Zbyňkovi). Jediný zoznam; nové meno pridaj sem. */
const MENA = [
	'Patrik',
	'Dominik',
	'Špett',
	'Spett',
	'Marek',
	'Markovi',
	'Markom',
	'Zbyněk',
	'Zbynek',
	'Zbyňk',
	'Zbynk',
	'Pavol',
	'Pavlovi',
	'Pavlom',
	'Drlík',
	'Drlik',
	'Ondrišk',
	'Ondrisk',
	'Volek'
] as const;

const VZORY: ReadonlyArray<{ vzor: RegExp; popis: string }> = [
	{ vzor: new RegExp(`(?<!\\p{L})(?:${MENA.join('|')})`, 'gu'), popis: 'meno človeka' },
	{ vzor: /Odoo\s+msg/giu, popis: 'Odoo msg id' },
	{ vzor: /\bmsg\.?\s*\d{4,}/giu, popis: 'id správy' },
	{ vzor: /migráci\p{L}*\s+v\d+/giu, popis: 'číslo migrácie' },
	{ vzor: /\b(?:tiket|ticket|issue)\p{L}*\s*#?\d+/giu, popis: 'číslo tiketu' },
	// `#610`, `(#154)`, `#138+` — ale nie CSS farba (`color: #333`, `fill="#000"`).
	{ vzor: /(?<!:\s*)(?<=^|[\s(,;])#\d{2,4}(?!\w)/gu, popis: 'číslo tiketu (#N)' },
	{ vzor: /úloh\p{L}*\s+(?:č\.\s*)?\d{3,}/giu, popis: 'číslo Odoo úlohy' },
	{ vzor: /(?<![\w.$-])[\w-]{2,}\.(?:ts|svelte)\b/gu, popis: 'názov súboru' }
];

/** Historické záznamy, ktoré sa ZÁMERNE nemenia — každý s dôvodom. Guard overí, že výnimka
 *  ešte platí (mŕtva výnimka = chyba), takže zoznam nemôže potichu rásť. */
const HISTORICKE_VYNIMKY: ReadonlyArray<{ subor: string; text: string; dovod: string }> = [
	{
		subor: 'src/lib/server/migracie-opona-izo-sklo.ts',
		text: 'Odoo úloha 1416 (#610)',
		dovod:
			'audit text jednorazovej migrácie v57→v58, ktorá už na PROD zbehla a zápis je v cfg_audit; ' +
			'zbehnutá migrácia sa nemení (database-migrations) a audit histórie sa neprepisuje'
	}
];

interface Nalez {
	subor: string;
	riadok: number;
	text: string;
	dovod: string;
}

interface Usek {
	start: number;
	end: number;
}

const LOG_METODY = new Set(['debug', 'info', 'warn', 'error', 'trace', 'log']);

/** Je objekt volania logger? `log`, `authLog`, `console`, `logger('modul')`. */
function jeLoggerTs(obj: Expression): boolean {
	if (isIdentifier(obj)) return obj.text === 'console' || /log/i.test(obj.text);
	return isCallExpression(obj) && isIdentifier(obj.expression) && obj.expression.text === 'logger';
}

/** Leží uzol v argumentoch logovacieho volania? */
function vLoguTs(n: Node): boolean {
	for (let p = n.parent; p; p = p.parent) {
		if (
			isCallExpression(p) &&
			isPropertyAccessExpression(p.expression) &&
			LOG_METODY.has(p.expression.name.text) &&
			jeLoggerTs(p.expression.expression) &&
			p.arguments.some((a) => a.pos <= n.pos && n.end <= a.end)
		)
			return true;
	}
	return false;
}

/** Je uzol špecifikátor modulu (import/export/import type/import())? */
function jeSpecifikatorTs(n: Node): boolean {
	const p = n.parent;
	if (!p) return false;
	if ((isImportDeclaration(p) || isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
	if (isExternalModuleReference(p)) return true;
	if (isLiteralTypeNode(p) && p.parent && isImportTypeNode(p.parent)) return true;
	return isCallExpression(p) && p.expression.kind === SyntaxKind.ImportKeyword;
}

const LITERALY_TS = new Set<SyntaxKind>([
	SyntaxKind.StringLiteral,
	SyntaxKind.NoSubstitutionTemplateLiteral,
	SyntaxKind.TemplateHead,
	SyntaxKind.TemplateMiddle,
	SyntaxKind.TemplateTail
]);

/** Úseky reťazcových literálov `.ts` zdroja. Komentáre sú v AST len trivia → nikdy tu nie sú. */
function usekyTs(zdroj: string): Usek[] {
	const sf: SourceFile = createSourceFile('x.ts', zdroj, ScriptTarget.Latest, true, ScriptKind.TS);
	const out: Usek[] = [];
	const navstiv = (n: Node): void => {
		if (LITERALY_TS.has(n.kind) && !jeSpecifikatorTs(n) && !vLoguTs(n)) {
			out.push({ start: n.getStart(sf), end: n.end });
		}
		forEachChild(n, navstiv);
	};
	navstiv(sf);
	return out;
}

interface SvUzol {
	type?: string;
	start?: number;
	end?: number;
	value?: unknown;
	[k: string]: unknown;
}

const SV_PRESKOC = new Set([
	'css',
	'comments',
	'metadata',
	'parent',
	'leadingComments',
	'trailingComments'
]);
const SV_SPECIFIKATOR = new Set([
	'ImportDeclaration',
	'ExportNamedDeclaration',
	'ExportAllDeclaration',
	'ImportExpression'
]);

/** Je estree uzol volaním loggera (`log.info(…)`, `logger('x').warn(…)`, `console.error(…)`)? */
function jeLogVolanieSv(n: SvUzol): boolean {
	if (n.type !== 'CallExpression') return false;
	const callee = n.callee as SvUzol | undefined;
	if (callee?.type !== 'MemberExpression') return false;
	const prop = callee.property as SvUzol;
	const obj = callee.object as SvUzol;
	if (prop.type !== 'Identifier' || !LOG_METODY.has(String(prop.name))) return false;
	if (obj.type === 'Identifier') return obj.name === 'console' || /log/i.test(String(obj.name));
	const objCallee = obj.callee as SvUzol | undefined;
	return (
		obj.type === 'CallExpression' && objCallee?.type === 'Identifier' && objCallee.name === 'logger'
	);
}

/** Úseky `.svelte` súboru: textové uzly markupu + statické hodnoty atribútov + reťazcové
 *  literály (script aj výrazy `{…}`). HTML/JS komentáre a `<style>` nie sú v týchto uzloch. */
function usekySvelte(zdroj: string): Usek[] {
	const ast = parse(zdroj, { modern: true }) as unknown as SvUzol;
	const out: Usek[] = [];
	const videne = new WeakSet<object>();
	const navstiv = (n: unknown): void => {
		if (!n || typeof n !== 'object' || videne.has(n)) return;
		videne.add(n);
		if (Array.isArray(n)) {
			for (const c of n) navstiv(c);
			return;
		}
		const u = n as SvUzol;
		if (u.type === 'TSImportType') return; // `typeof import('…/X.svelte')` je typ, nie text
		const jeText =
			u.type === 'Text' ||
			u.type === 'TemplateElement' ||
			(u.type === 'Literal' && typeof u.value === 'string');
		if (jeText && typeof u.start === 'number' && typeof u.end === 'number') {
			out.push({ start: u.start, end: u.end });
		}
		for (const [k, v] of Object.entries(u)) {
			if (SV_PRESKOC.has(k)) continue;
			if (k === 'source' && SV_SPECIFIKATOR.has(String(u.type))) continue;
			if (k === 'arguments' && jeLogVolanieSv(u)) continue;
			navstiv(v);
		}
	};
	navstiv(ast);
	return out;
}

function riadokZ(text: string, index: number): number {
	let r = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) r++;
	return r;
}

function hladaj(zdroj: string, useky: Usek[], subor: string): Nalez[] {
	const riadky = zdroj.split('\n');
	const out: Nalez[] = [];
	for (const u of useky) {
		const kus = zdroj.slice(u.start, u.end);
		for (const { vzor, popis } of VZORY) {
			for (const m of kus.matchAll(new RegExp(vzor.source, vzor.flags))) {
				const riadok = riadokZ(zdroj, u.start + m.index);
				const text = (riadky[riadok - 1] ?? '').trim();
				out.push({ subor, riadok, text, dovod: `${popis} „${m[0]}"` });
			}
		}
	}
	return out;
}

/** Nálezy v jednom zdroji; `subor` určuje parser podľa prípony. */
function skenuj(zdroj: string, subor: string): Nalez[] {
	const useky = subor.endsWith('.svelte') ? usekySvelte(zdroj) : usekyTs(zdroj);
	return hladaj(zdroj, useky, subor);
}

function najdiSubory(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) najdiSubory(abs, out);
		else if (/\.(ts|svelte)$/.test(entry.name)) out.push(abs);
	}
	return out;
}

const jeVynimka = (n: Nalez) =>
	HISTORICKE_VYNIMKY.some((v) => v.subor === n.subor && n.text.includes(v.text));

const dovody = (zdroj: string, subor: string) => skenuj(zdroj, subor).map((n) => n.dovod);

describe('#616 skener — rozlišuje text pre používateľa od komentára', () => {
	it('.ts: literál s menom/odkazom nájde, komentár/import/log nie', () => {
		const zdroj = [
			'// Patrik povedal (Odoo msg 1789477)',
			"import x from './migracie.ts';",
			'/* Dominik: pozri migráciu v17 */',
			"const a = 'čaká na overenie výrobou (Patrik).';",
			"log.info('migrácia hotová (#608)');",
			"logger('m').warn(`súbežné volanie (#315)`);",
			'const b = `pozri migráciu v17 v migracie.ts`;',
			"const c = 'Drevostavby (#445)';"
		].join('\n');
		expect(skenuj(zdroj, 'x.ts').map((n) => `${n.riadok}:${n.dovod}`)).toEqual([
			'4:meno človeka „Patrik"',
			'7:číslo migrácie „migráciu v17"',
			'7:názov súboru „migracie.ts"',
			'8:číslo tiketu (#N) „#445"'
		]);
	});

	it('.ts: Odoo msg id, Špetta v skloňovaní, číslo úlohy', () => {
		expect(dovody("const p = '(Špettu, Odoo msg 1789036; úloha 1416)';", 'x.ts')).toEqual([
			'meno človeka „Špett"',
			'Odoo msg id „Odoo msg"',
			'id správy „msg 1789036"',
			'číslo Odoo úlohy „úloha 1416"'
		]);
	});

	it('.svelte: markup, atribút a výraz nájde; HTML/JS komentár, style a {výraz.ts} nie', () => {
		const zdroj = [
			'<script lang="ts">',
			'\t// Patrik',
			"\tconst a = 'od Dominika';",
			"\tconsole.warn('nie (#608)');",
			'</script>',
			'<!-- Marek: (#150) -->',
			'<p title="Zbyňkovi">Patrik: „90%" {r.ts}</p>',
			"<button onclick={() => {\n\t// #150 review\n}}>{x ? 'čaká na tabuľky od Dominika' : ''}</button>",
			'<style>/* Patrik */ p { color: #333; }</style>',
			'<p style="color: #333">ok</p>'
		].join('\n');
		expect(
			skenuj(zdroj, 'x.svelte')
				.map((n) => `${n.riadok}:${n.dovod}`)
				.sort()
		).toEqual([
			'10:meno človeka „Dominik"',
			'3:meno človeka „Dominik"',
			'7:meno človeka „Patrik"',
			'7:meno človeka „Zbyňk"'
		]);
	});

	it('farba nie je tiket, tiket v zátvorke a na začiatku textu áno', () => {
		expect(dovody("const f = 'fill: #000; stroke:#999'; const g = '#555';", 'x.ts')).toEqual([]);
		expect(dovody('<p>#138+ príde (#154)</p>', 'x.svelte')).toEqual([
			'číslo tiketu (#N) „#138"',
			'číslo tiketu (#N) „#154"'
		]);
	});
});

describe('#616 UI texty bez mien ľudí a interných odkazov', () => {
	const subory = najdiSubory(SRC);
	const nalezy = subory.flatMap((abs) =>
		skenuj(fs.readFileSync(abs, 'utf8'), path.relative(ROOT, abs))
	);

	it('skener prešiel .ts aj .svelte súbory (nie je no-op)', () => {
		expect(subory.filter((s) => s.endsWith('.svelte')).length).toBeGreaterThan(50);
		expect(subory.filter((s) => s.endsWith('.ts')).length).toBeGreaterThan(100);
	});

	it('žiadny text pre používateľa nemenuje ľudí ani interné odkazy', () => {
		const vypis = nalezy
			.filter((n) => !jeVynimka(n))
			.map((n) => `${n.subor}:${n.riadok} — ${n.dovod} — ${n.text}`);
		expect(vypis, vypis.join('\n')).toEqual([]);
	});

	it('každá historická výnimka ešte platí (žiadna mŕtva výnimka)', () => {
		for (const v of HISTORICKE_VYNIMKY) {
			expect(
				nalezy.some((n) => n.subor === v.subor && n.text.includes(v.text)),
				v.subor
			).toBe(true);
			expect(v.dovod.length).toBeGreaterThan(30);
		}
	});
});
