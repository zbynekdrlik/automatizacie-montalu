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
			'.superpowers/',
			// worktree-fleet checkouts majú vlastné tsconfig.json → typescript-eslint
			// by videl viacero tsconfigRootDir kandidátov a lint by falošne padal
			'.claude/worktrees/',
			'reports/',
			'.stryker-tmp/'
		]
	},
	js.configs.recommended,
	// Netypované `recommended` je baseline pre VŠETKY .ts/.js (testy, e2e, config
	// súbory). Typovo-závislé pravidlá sa pridávajú nižšie len pre `src/**/*.ts`.
	...ts.configs.recommended,
	...svelte.configs.recommended,
	...svelte.configs.prettier,
	eslintConfigPrettier,
	{
		// TYPOVANÁ analýza (#257 / ARCH-4) — LEN produkčný `src/**/*.ts`. Cieľ:
		// `no-floating-promises` / `no-misused-promises` na async Money ceste
		// (dnes 0 nálezov = kód je správny, pravidlo stráži budúcnosť). Zámerne sa
		// NEaplikuje na:
		//   • `tests/**` + `e2e/**` — e2e nie je v žiadnom tsconfig `include`, takže
		//     `projectService` ich nevie načítať (parse error); testy sú overené
		//     samotným behom a sú synchrónne (better-sqlite3), žiadne promise riziko.
		//   • `.svelte` / `.svelte.ts` — svelte parser + TS program sa neznesú
		//     (ticket: „svelte súbory ponechať na recommended ak typed parsing
		//     nefunguje"). `.ts` glob `.svelte` nechytá; `.svelte.ts` explicitne
		//     vynímame nižšie.
		// `projectService` postaví TS program z tsconfig.json (extends
		// .svelte-kit/tsconfig.json); `tsconfigRootDir` kotví hľadanie na priečinok
		// tohto configu (funguje aj vo worktree-fleet checkoutoch s vlastným tsconfig).
		files: ['src/**/*.ts'],
		ignores: ['**/*.svelte.ts'],
		extends: [ts.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			// `no-base-to-string` VYPNUTÉ: každý nález je vstupno-parsovacia hranica,
			// kde appka ZÁMERNE koercuje `FormData.get()` (`string | File`) a JSON
			// `unknown` na string cez `String(x ?? '')`. Tieto formuláre nemajú file
			// inputy → koercia je vždy string→string, žiadny reálny `[object Object]`.
			// Korektné „zúženie" typov by muselo prepísať ~105 miest naprieč Money
			// vstupom (`*-vstup.ts`, route akcie) — presne tá zmena, ktorú #257
			// zakazuje (Money semantika nedotknutá, lint fixy behavior-preserving).
			'@typescript-eslint/no-base-to-string': 'off'
		}
	},
	{
		// `require-await` VYPNUTÉ len pre SvelteKit route handlery: `load` / `+server`
		// čítajú zo SYNCHRÓNNEHO better-sqlite3, takže dnes legitímne nemajú `await`;
		// `async` je framework-idiomatický podpis handlera. Pre `src/lib/**` (biznis
		// logika) pravidlo ZOSTÁVA zapnuté — tam je zbytočný `async` hoden nahlásenia.
		files: ['src/routes/**/*.ts'],
		rules: {
			'@typescript-eslint/require-await': 'off'
		}
	},
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
			]
			// Typovaná `resolve()` navigácia (SvelteKit 2.12+) — zavedená v #99.
		}
	}
);
