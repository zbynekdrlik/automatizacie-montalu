import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import eslintConfigPrettier from 'eslint-config-prettier';
import ts from 'typescript-eslint';
import globals from 'globals';

// Žiadny `svelte.config.js` v repe (SvelteKit sa konfiguruje inline vo `vite.config.ts`
// cez `sveltekit()`), takže eslint-plugin-svelte nedostáva `svelteConfig` — nie je
// povinný, ovplyvňuje len detekciu vlastných route/kit ciest, ktoré tu nepoužívame.
export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'coverage/',
			'playwright-report/',
			'test-results/',
			'data/',
			'.superpowers/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	...svelte.configs.prettier,
	eslintConfigPrettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		rules: {
			// Zámerne `error`, nie voľnejšie `warn` — bez `--max-warnings 0` v `npm run
			// lint` by `warn` bolo v CI netrestané (nikdy by nezhodilo build). Repo
			// aktuálne nemá ANI JEDNO `any` — ak niekedy vznikne genuinny okrajový prípad
			// (exceljs bunky, SQLite rows), rieš cieleným
			// `// eslint-disable-next-line @typescript-eslint/no-explicit-any` s
			// odôvodnením, nie plošným výnimkovaním.
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// Novšia typovaná `resolve()` navigácia (SvelteKit 2.12+) sem nebola nikdy
			// zavedená — celý app používa plain `href="/…"` string literály naprieč
			// desiatkami stránok. Prijať toto pravidlo by znamenalo prerobiť navigáciu
			// v celej appke (cross-cutting), čo je mimo rozsahu tohto lint-foundation
			// ticketu (#1) — sledované samostatne v #99.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
