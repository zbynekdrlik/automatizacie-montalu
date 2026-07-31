import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import svelteConfigPrettier from 'eslint-config-prettier';
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
	svelteConfigPrettier,
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
		// generovaný SvelteKit build output typing — nie je náš zdrojový kód
		files: ['.svelte-kit/**'],
		ignores: ['.svelte-kit/**']
	},
	{
		rules: {
			// `any` sa v tomto MVP repe cielene používa na okrajoch (exceljs bunky,
			// SQLite rows) — nechceme ho zakázať naprieč, len upozorniť.
			'@typescript-eslint/no-explicit-any': 'warn',
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
