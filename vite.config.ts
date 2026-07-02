/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// verzia zobrazená v pätičke — git describe pri builde (post-deploy verifikácia
// číta túto hodnotu z DOM a porovnáva s nasadeným commitom)
let version = process.env.APP_VERSION || '';
if (!version) {
	try {
		version = execSync('git describe --tags --always --dirty').toString().trim();
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
		include: ['tests/**/*.test.ts']
	}
});
