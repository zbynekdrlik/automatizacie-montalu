// Guard #247: pravidlo browser-console-zero-errors sa v e2e presadzuje MECHANICKY,
// nie ručne. Tento test číta e2e/*.spec.ts a stráži, že:
//  (1) každý test blok zbiera konzolu — počet test blokov == počet collectConsole( volaní,
//  (2) každá collectConsole premenná je aj asertovaná cez expect(<var>).toEqual([]),
//  (3) žiadny pevný waitForTimeout( (nahradený ohraničeným stability assertom),
//  (4) každý test.skip je len sankcionovaný process.env.BASE_URL deployment guard —
//      capability/env skip (napr. clipboard secure-context) je zakázaný (test má FAILnúť,
//      nie sa TICHO preskočiť). skipAkLive je volanie helpera, nie doslovný test.skip
//      v spec súbore, takže je prirodzene mimo tejto kontroly.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const e2eDir = fileURLToPath(new URL('../e2e', import.meta.url));
const specFiles = readdirSync(e2eDir)
	.filter((f) => f.endsWith('.spec.ts'))
	.sort();

const read = (f: string) => readFileSync(join(e2eDir, f), 'utf8');

// počet test blokov = riadky, ktoré po odsadení začínajú `test(` — vylučuje
// `test.describe(`/`test.skip` (majú `test.`) aj neblokové výskyty v komentároch.
const countTestBlocks = (src: string) => src.split('\n').filter((l) => /^\s*test\(/.test(l)).length;

const countMatches = (src: string, re: RegExp) => (src.match(re) || []).length;

describe('e2e zero-console guard (#247)', () => {
	it('nájde spec súbory (sanity)', () => {
		expect(specFiles.length).toBeGreaterThan(0);
	});

	describe.each(specFiles)('%s', (file) => {
		const src = read(file);

		it('každý test blok zbiera konzolu (počet test blokov === počet collectConsole)', () => {
			const tests = countTestBlocks(src);
			const collects = countMatches(src, /collectConsole\(/g);
			expect(
				collects,
				`${file}: ${tests} test blokov, ale ${collects}× collectConsole(page) — každý test musí zbierať konzolu`
			).toBe(tests);
		});

		it('každá collectConsole premenná má expect(<var>).toEqual([])', () => {
			const vars = [...src.matchAll(/const (\w+) = collectConsole\(/g)].map((m) => m[1]);
			for (const v of vars) {
				expect(
					src.includes(`expect(${v}).toEqual([])`),
					`${file}: premenná '${v}' z collectConsole nemá zodpovedajúci expect(${v}).toEqual([])`
				).toBe(true);
			}
		});

		it('žiadny pevný waitForTimeout(', () => {
			expect(
				src.includes('waitForTimeout('),
				`${file}: obsahuje waitForTimeout( — nahraď ohraničeným stability assertom (toHaveValue s timeoutom)`
			).toBe(false);
		});

		it('každý test.skip je sankcionovaný process.env.BASE_URL guard', () => {
			for (const m of src.matchAll(/test\.skip\(/g)) {
				const idx = m.index ?? 0;
				const okno = src.slice(idx, idx + 140);
				expect(
					okno.includes('process.env.BASE_URL'),
					`${file}: test.skip ktorý nie je process.env.BASE_URL deployment guard — ` +
						`capability/env skip je zakázaný (test má FAILnúť, nie skipnúť). Riadok: ${okno.split('\n')[0]}`
				).toBe(true);
			}
		});
	});
});
