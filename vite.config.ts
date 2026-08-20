import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
// `defineConfig` z `vitest/config` (nie `vite`) — natívne typuje `test` blok, takže
// netreba triple-slash `/// <reference types="vitest/config" />` (ktoré by teraz
// koliduje s importom `coverageConfigDefaults` — triple-slash-reference/prefer-import).
import { defineConfig, coverageConfigDefaults } from 'vitest/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// verzia zobrazená v pätičke — deploy job posiela APP_VERSION="<package.json verzia>
// (<sha7>)" (viď .github/workflows/ci.yml). Lokálny beh a CI `test` job (npm run build
// bez APP_VERSION) ho nemá — repo nikdy nemalo git tag, takže `git describe --tags`
// by padol na holý SHA a porušil by mandatórny v<semver> formát (version-on-dashboard).
// Fallback preto berie verziu z package.json (jediný zdroj pravdy, viď
// version-bumping) + krátky SHA v ROVNAKOM tvare ako deploy job.
let version = process.env.APP_VERSION || '';
if (!version) {
	try {
		const pkgVersion = (JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string })
			.version;
		const sha = execSync('git rev-parse --short=7 HEAD').toString().trim();
		version = `${pkgVersion} (${sha})`;
	} catch {
		version = 'dev';
	}
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(version)
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			// #257: meria sa CELÁ biznis logika v `src/lib` (nielen `server/`) — ~2953 LoC
			// v `src/lib/*.ts` malo testy, ale nebolo merané ani gatované. `.svelte` (UI)
			// glob `**/*.ts` nechytá. Vylúčené len 3 nemerateľné/prázdne súbory (nižšie).
			include: ['src/lib/**/*.ts'],
			exclude: [
				...coverageConfigDefaults.exclude,
				'src/lib/index.ts', // prázdny `$lib` barrel (0 kódu)
				'src/lib/vizual/spec.ts', // len typy
				// WebGL capture: `gl.readPixels` + canvas 2D → v headless vitest nemerateľné;
				// jediná čistá fn `supersampleFaktor` má vlastný unit test.
				'src/lib/vizual/snimka.ts'
			],
			// Prahy = namerané − 2 %, LEN hore (nikdy pod predošlé server-only gaty
			// 89/85/73/82). Namerané pri rozšírení 2026-08-20: lines 97,41 / stmts 96,23
			// / funcs 97,5 / branch 90,54 → nové prahy zdvíhajú KAŽDÝ gate.
			thresholds: {
				lines: 95,
				statements: 94,
				branches: 88,
				functions: 95
			}
		}
	}
});
