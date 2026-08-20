import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// scripts/mutation-shard.sh — deterministické rozdelenie diff-scoped mutate zoznamu
// do N shardov (mutation.yml matrix). Vlastnosti, na ktorých gate stojí:
// (1) partícia: každý súbor presne v JEDNOM sharde, zjednotenie == vstup;
// (2) determinizmus: rovnaký vstup → rovnaký výstup (stabilné incremental lineage per shard);
// (3) prázdny vstup → prázdny výstup (shard bez práce končí zelený bez npm ci).
const SCRIPT = resolve(__dirname, '../scripts/mutation-shard.sh');

function shard(files: string[], shardNo: number, shards: number): string[] {
	const out = execFileSync('bash', [SCRIPT], {
		input: files.join('\n') + (files.length ? '\n' : ''),
		env: { ...process.env, SHARD: String(shardNo), SHARDS: String(shards) },
		encoding: 'utf8'
	});
	return out === '' ? [] : out.split(',');
}

const FILES = Array.from({ length: 23 }, (_, i) => `src/lib/server/modul-${i}.ts`);

describe('scripts/mutation-shard.sh (mutation.yml matrix)', () => {
	it('partícia: každý súbor presne v jednom sharde, zjednotenie == vstup', () => {
		const SHARDS = 4;
		const parts = Array.from({ length: SHARDS }, (_, i) => shard(FILES, i + 1, SHARDS));
		const all = parts.flat();
		expect(all.length).toBe(FILES.length);
		expect(new Set(all)).toEqual(new Set(FILES));
		for (let a = 0; a < SHARDS; a++)
			for (let b = a + 1; b < SHARDS; b++)
				expect(parts[a]!.filter((f) => parts[b]!.includes(f))).toEqual([]);
	});

	it('determinizmus: rovnaký vstup → rovnaký výstup, nezávisle od poradia riadkov', () => {
		const a = shard(FILES, 2, 3);
		const b = shard([...FILES].reverse(), 2, 3);
		expect(a.length).toBeGreaterThan(0);
		expect(new Set(a)).toEqual(new Set(b));
	});

	it('SHARDS=1 vráti všetko; prázdny vstup vráti prázdny výstup', () => {
		expect(shard(FILES, 1, 1)).toEqual(FILES);
		expect(shard([], 1, 4)).toEqual([]);
	});

	it('chýbajúci SHARD/SHARDS = chyba (nie tichý prázdny shard)', () => {
		expect(() =>
			execFileSync('bash', [SCRIPT], {
				input: 'src/lib/x.ts\n',
				env: { ...process.env, SHARD: '', SHARDS: '' },
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe']
			})
		).toThrow();
	});
});
