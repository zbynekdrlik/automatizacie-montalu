#!/usr/bin/env node
// #529: generuj server-only base64 PNG modul obrázkov profilov pre nárezák PDF.
//
// pdf-lib (embedPng/embedJpg) NEvie embednúť webp; `static/profil/*.webp` sú VP8.
// Preto tento build-time skript prekonvertuje každý webp → zmenšený PNG cez `dwebp`
// (libwebp) a zapíše ich base64 do `src/lib/server/profil-png.ts`. Rovnaká disciplína
// ako vendorovaný DejaVu font (`fonts/dejavu.ts`) — base64 v `.ts` = vždy zbundlované
// pod Vite SSR + adapter-node, žiadna runtime fs/asset/native-image závislosť.
//
// Beží LEN ručne pri zmene katalógu obrázkov (ako sync-profil-obrazky.sh); VÝSTUP
// (`profil-png.ts`) je commitnutý a CI ho NEgeneruje (dwebp na CI nemusí byť). Po behu
// commitni oba súbory.
//
// Spustenie:  node scripts/gen-profil-png.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC_DIR = 'static/profil';
const OUT = 'src/lib/server/profil-png.ts';
// šírka zmenšeného PNG v px — dosť na ~48pt náhľad v PDF, malý base64 blob.
const WIDTH = 120;

function fail(msg) {
	console.error(`gen-profil-png: ${msg}`);
	process.exit(1);
}

let files;
try {
	files = readdirSync(SRC_DIR)
		.filter((f) => f.toLowerCase().endsWith('.webp'))
		.sort();
} catch (e) {
	fail(`nemôžem čítať ${SRC_DIR}: ${e.message}`);
}
if (files.length === 0) fail(`žiadne .webp v ${SRC_DIR}`);

const tmp = mkdtempSync(join(tmpdir(), 'profil-png-'));
const entries = [];
const skipped = [];
try {
	for (const f of files) {
		const kod = f.replace(/\.webp$/i, '');
		const inPath = join(SRC_DIR, f);
		const outPath = join(tmp, `${kod}.png`);
		try {
			execFileSync('dwebp', ['-quiet', '-resize', String(WIDTH), '0', inPath, '-o', outPath], {
				stdio: ['ignore', 'ignore', 'pipe']
			});
		} catch {
			// Nedekódovateľný/poškodený zdroj (napr. 31 B placeholder ZASP00113.webp) — PRESKOČ,
			// nezhoď beh. Ten profil jednoducho nemá PDF náhľad (runtime profilPngB64 → undefined,
			// rovnaká graceful degradácia ako maObrazok v UI). Loguj do súhrnu (auditovateľné).
			skipped.push(f);
			continue;
		}
		const b64 = readFileSync(outPath).toString('base64');
		entries.push([kod, b64]);
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
if (entries.length === 0)
	fail(`žiadny webp sa nepodarilo dekódovať (všetkých ${files.length} zlyhalo)`);

const body = entries.map(([kod, b64]) => `\t'${kod}': '${b64}'`).join(',\n');
const header = `// #529: GENEROVANÝ SÚBOR — needituj ručne. Beh: node scripts/gen-profil-png.mjs
// Base64 PNG (zmenšené na ${WIDTH} px) obrázky rezov profilov pre server-side nárezák PDF
// (\`narezak-pdf.ts\`). Zdroj: static/profil/<KOD>.webp → dwebp → PNG. Server-only (žiadny
// klientsky import — modul je pod src/lib/server/). Vzor: fonts/dejavu.ts.
`;
const out = `${header}export const PROFIL_PNG_B64: Record<string, string> = {
${body}
};

/** Base64 PNG rezu profilu podľa Money kódu, alebo undefined keď obrázok nemáme. */
export function profilPngB64(kod: string): string | undefined {
	return PROFIL_PNG_B64[kod];
}
`;

writeFileSync(OUT, out);
console.log(
	`gen-profil-png: ${entries.length} obrázkov → ${OUT} (${(out.length / 1024).toFixed(0)} KB)` +
		(skipped.length ? ` · preskočené (nedekódovateľné): ${skipped.join(', ')}` : '')
);
