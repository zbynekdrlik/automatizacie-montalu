import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// scripts/mutation-shard.sh — deterministická LPT (Longest Processing Time)
// váhová partícia diff-scoped mutate zoznamu do N shardov (mutation.yml
// matrix). Nahradila predch. hash-podľa-cesty partíciu po incidente kolo 8
// (GH Actions run 32387255712): hash je uniformný len v OČAKÁVANÍ, pri ~20
// položkách sa vie zhlukovať — shard 3 vtedy dostal 9/18 zmenených súborov
// vrátane všetkých najťažších compute modulov a presiahol 20-min strop.
// Vlastnosti, na ktorých gate stojí:
// (1) partícia: každý súbor presne v JEDNOM sharde, zjednotenie == vstup;
// (2) determinizmus: rovnaký vstup → rovnaký výstup, nezávisle od poradia riadkov;
// (3) prázdny vstup → prázdny výstup (shard bez práce končí zelený bez npm ci);
// (4) LPT váhové vyváženie: veľký súbor dostane vlastný shard, malé sa zbalia spolu.
const SCRIPT = resolve(__dirname, '../scripts/mutation-shard.sh');

function shard(files: string[], shardNo: number, shards: number, cwd?: string): string[] {
	const out = execFileSync('bash', [SCRIPT], {
		input: files.join('\n') + (files.length ? '\n' : ''),
		env: { ...process.env, SHARD: String(shardNo), SHARDS: String(shards) },
		encoding: 'utf8',
		...(cwd ? { cwd } : {})
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

	it('SHARDS=1 vráti všetky súbory (množinovo — poradie je teraz váha/cesta, nie vstup); prázdny vstup vráti prázdny výstup', () => {
		expect(new Set(shard(FILES, 1, 1))).toEqual(new Set(FILES));
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

	describe('LPT váhové vyváženie (reálne súbory na disku)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mutation-shard-lpt-'));
		const big = 'big.dat';
		const small = ['small1.dat', 'small2.dat', 'small3.dat'];
		writeFileSync(join(dir, big), 'x'.repeat(4000));
		for (const s of small) writeFileSync(join(dir, s), 'x'.repeat(10));

		afterAll(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it('veľký súbor dostane vlastný shard, malé sa zbalia do druhého', () => {
			const inputs = [big, ...small];
			const shard1 = shard(inputs, 1, 2, dir);
			const shard2 = shard(inputs, 2, 2, dir);
			expect(shard1).toEqual([big]);
			expect(new Set(shard2)).toEqual(new Set(small));
		});
	});
});
