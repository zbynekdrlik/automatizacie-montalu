/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
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
			include: ['src/lib/server/**'],
			// prah = namerané − 2 % (91,6 / 87,8 / 75,4 / 84) — len hore, nikdy dole
			thresholds: {
				lines: 89,
				statements: 85,
				branches: 73,
				functions: 82
			}
		}
	}
});
