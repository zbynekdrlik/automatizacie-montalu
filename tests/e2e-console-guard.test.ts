// Guard #247: pravidlo browser-console-zero-errors sa v e2e presadzuje MECHANICKY,
// nie ručne. Číta e2e/*.spec.ts a stráži, PER TEST BLOK (nie len per-súbor agregát),
// že:
//  (1) každý test blok má PRÁVE JEDEN `collectConsole(page)` A jeho vlastný
//      `expect(<var>).toEqual([])` — per-block, aby budúci blok, ktorý zbiera konzolu
//      ale zabudne assert (alebo zbiera 2×/0×), NEPREŠIEL cez zdieľaný file-level assert,
//  (2) žiadny pevný `waitForTimeout(` (nahradený ohraničeným stability assertom),
//  (3) každý `test.skip` je len sankcionovaný process.env.BASE_URL deployment guard —
//      capability/env skip (napr. clipboard secure-context) je zakázaný (test má FAILnúť,
//      nie sa TICHO preskočiť). skipAkLive je volanie helpera, nie doslovný `test.skip`
//      v spec súbore. POZNÁMKA: skip skrytý v HELPERI (ako skipAkLive) túto kontrolu
//      obíde zámerne — helper skipy sú v réžii code-review, tu strážime len spec súbory.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const e2eDir = fileURLToPath(new URL('../e2e', import.meta.url));
const specFiles = readdirSync(e2eDir)
	.filter((f) => f.endsWith('.spec.ts'))
	.sort();

const read = (f: string) => readFileSync(join(e2eDir, f), 'utf8');

interface Block {
	line: number; // 1-based riadok, kde blok začína (pre čitateľné hlásenie)
	text: string;
}

// Rozparsuje spec na jednotlivé test bloky. Indent-aware: kotví na `^(\s*)test(`
// (vylučuje `test.describe(`/`test.skip` — tie majú `test.`) a hľadá uzatvárací
// `<indent>});` na ROVNAKOM odsadení. Zvláda col-0 testy aj test.describe-vnorené
// (1-tab) bloky vo vizual3d.
function testBlocks(src: string): Block[] {
	const lines = src.split('\n');
	const blocks: Block[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)test\(/.exec(lines[i]!);
		if (!m) continue;
		const close = m[1] + '});';
		let j = i;
		while (j < lines.length && lines[j] !== close) j++;
		blocks.push({ line: i + 1, text: lines.slice(i, j + 1).join('\n') });
		i = j; // preskoč za uzatváraciu zátvorku bloku
	}
	return blocks;
}

// #245/#247: záverečný console assert bloku je platný v DVOCH tvaroch:
//   (a) expect(<var>).toEqual([])  — zero-console default, ALEBO
//   (b) exact-allowlist expect(<var>).toEqual([ expect.stringMatching(...)[, …] ])
// Tvar (b) je pre INHERENTNÝ console riadok testovaného správania (napr. 500 chybová
// stránka VŽDY zaloguje resource error hlavného dokumentu — error-stranka #245): riadok
// sa asertuje PRESNE, guard ďalej VYNUCUJE úplný výpočet obsahu konzoly. NEoslabuje
// zero-console — `toEqual` je ÚPLNÁ rovnosť poľa, takže KAŽDÁ ďalšia console chyba pole
// predĺži a assert padne. Povolený je LEN `expect.stringMatching(...)` člen: po odstránení
// všetkých takých členov v poli nesmie ostať NIČ iné (žiadny `toContain`, voľný string,
// spread ani iný matcher). Extrakcia je regex-based a STRIKTNÁ — stringMatching, ktorého
// regex obsahuje literálne '(' / ')', by (bezpečne, na prísnej strane) NEPREŠIEL; dnešné
// sankcionované použitie také nemá.
function finalConsoleAssertOk(blockText: string, v: string): boolean {
	if (blockText.includes(`expect(${v}).toEqual([])`)) return true;
	const m = new RegExp(`expect\\(${v}\\)\\.toEqual\\(\\[([\\s\\S]*?)\\]\\)`).exec(blockText);
	if (!m) return false;
	const body = m[1];
	if (body.trim() === '') return true;
	const stripped = body.replace(/expect\.stringMatching\([\s\S]*?\)/g, '');
	return /expect\.stringMatching\(/.test(body) && /^[\s,]*$/.test(stripped);
}

describe('e2e zero-console guard (#247)', () => {
	it('nájde spec súbory (sanity)', () => {
		expect(specFiles.length).toBeGreaterThan(0);
	});

	describe.each(specFiles)('%s', (file) => {
		const src = read(file);
		const blocks = testBlocks(src);

		it('každý test blok má práve 1 collectConsole(page) + jeho sankcionovaný záverečný console assert', () => {
			for (const b of blocks) {
				const vars = [...b.text.matchAll(/const (\w+) = collectConsole\(/g)].map((mm) => mm[1]);
				expect(
					vars.length,
					`${file}:${b.line} — blok má ${vars.length}× collectConsole(page), očakávaný práve 1`
				).toBe(1);
				const v = vars[0];
				expect(
					finalConsoleAssertOk(b.text, v),
					`${file}:${b.line} — blok zbiera '${v}', ale chýba jeho sankcionovaný záverečný assert: ` +
						`buď expect(${v}).toEqual([]) alebo exact-allowlist ` +
						`expect(${v}).toEqual([expect.stringMatching(…)]) — každý člen LEN ` +
						`expect.stringMatching (žiadny toContain/voľný string/iný matcher)`
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
				const okno = src.slice(idx, idx + 160);
				expect(
					okno.includes('process.env.BASE_URL'),
					`${file}: test.skip ktorý nie je process.env.BASE_URL deployment guard — ` +
						`capability/env skip je zakázaný (test má FAILnúť, nie skipnúť). Riadok: ${okno.split('\n')[0]}`
				).toBe(true);
			}
		});
	});
});
