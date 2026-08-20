// Strážny test 1000-riadkového stropu pre `src/lib/server/**` (`.claude/rules/
// large-file-split.md`). Kým to bola len prozaická konvencia, `compute.ts` ticho
// prerástol na 1430 r. (#249). Tento test to teraz vynúti mechanicky: keď sa nejaký
// server modul opäť priblíži k stropu, split je NUTNÝ — nie voliteľný. Po #249
// splite je najväčší `migracie.ts` (861 r., #183); `compute.ts` je tenká fasáda.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CAP = 1000;
const SERVER_DIR = path.resolve(fileURLToPath(new URL('../src/lib/server', import.meta.url)));

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
	}
	return out;
}

describe('src/lib/server file-size cap', () => {
	const files = walk(SERVER_DIR);

	it('nájde nejaké server .ts súbory (test nie je no-op)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files.map((f) => [path.relative(SERVER_DIR, f), f] as const))(
		'%s je pod 1000-riadkovým stropom',
		(_rel, full) => {
			const lines = fs.readFileSync(full, 'utf8').split('\n').length;
			expect(lines).toBeLessThanOrEqual(CAP);
		}
	);
});
