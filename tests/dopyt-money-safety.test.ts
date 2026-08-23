// #277 — Money-safety guard (vzor `pergola-narez-money-safety`). Verejná dopyt/ponuka
// funkcia NIKDY nesmie siahnuť na Money/odpis zápisovú cestu. Statický import-guard:
// žiadny import `money`/`pergola`, žiadny `writeOdpis`/`MONEY_LIVE`/`dlv-import`/`odpis_log`,
// žiadny zápis do `/data`. `dopyt-store` SMIE importovať `./db` (len pripojenie k SQLite);
// PURE moduly (`ponuka`/`dopyt`) nesmú importovať ani `server/db`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// Rekurzívne nájdi všetky dopyt/ponuka zdrojové súbory (auto-guard nových súborov — #277
// review 🔵: manuálny zoznam by nový súbor prehliadol). Dva korene: pod src/lib matchuje MENO
// (dopyt|ponuka); celý route adresár src/routes/dopyty-konfigurator/ je dopyt-only (#282 review
// 🔵), takže tam berieme KAŽDÝ .ts/.svelte — mená +page.server.ts / +server.ts by name-match
// nechytil, no aj tie musia byť Money-neutrálne.
function najdiDopytPonuka(): string[] {
	const out: string[] = [];
	const walk = (dirUrl: URL, rel: string, base: string, vsetkyVDir: boolean) => {
		for (const e of fs.readdirSync(dirUrl, { withFileTypes: true })) {
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				walk(new URL(`${e.name}/`, dirUrl), childRel, base, vsetkyVDir);
			} else if (
				/\.(ts|svelte)$/.test(e.name) &&
				!e.name.endsWith('.d.ts') &&
				(vsetkyVDir || /(dopyt|ponuka)/i.test(e.name))
			) {
				out.push(`${base}${childRel}`);
			}
		}
	};
	walk(new URL('../src/lib/', import.meta.url), '', 'src/lib/', false);
	walk(
		new URL('../src/routes/dopyty-konfigurator/', import.meta.url),
		'',
		'src/routes/dopyty-konfigurator/',
		true
	);
	return out.sort();
}

// Zakázané naprieč VŠETKÝMI dopyt/ponuka súbormi (Money zápisová cesta).
const ZAKAZANE_MONEY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/pergola['"]/,
	/import\(\s*['"`].*server\/money['"`]/,
	/import\(\s*['"`].*server\/pergola['"`]/,
	/writeOdpis|MONEY_LIVE|dlv-import|odpis_log/,
	/['"`]\/data\//
];

// Auto-objavené (nie hardkódovaný zoznam) — nový dopyt-*/ponuka-* súbor je krytý automaticky.
const VSETKY = najdiDopytPonuka();

// PURE moduly (bez servera) nesmú importovať ani server/db.
const PURE = ['src/lib/ponuka.ts', 'src/lib/dopyt.ts'];

describe('dopyt/ponuka Money-safety (#277)', () => {
	it('objaví aspoň očakávané dopyt/ponuka súbory (glob nie je prázdny)', () => {
		// poistka: keby walk zlyhal/nič nenašiel, guard by falošne „prešiel"
		expect(VSETKY).toEqual(
			expect.arrayContaining([
				'src/lib/ponuka.ts',
				'src/lib/dopyt.ts',
				'src/lib/server/ponuka-pdf.ts',
				'src/lib/server/dopyt-action.ts',
				'src/lib/server/dopyt-store.ts',
				'src/lib/server/dopyt-throttle.ts',
				'src/lib/server/dopyt-pdf.ts',
				'src/lib/components/DopytForm.svelte',
				'src/routes/dopyty-konfigurator/+page.server.ts',
				'src/routes/dopyty-konfigurator/pdf/+server.ts'
			])
		);
	});

	for (const f of VSETKY) {
		it(`${f} sa nedotýka Money/odpis zápisovej cesty`, () => {
			const src = zdroj(f);
			for (const re of ZAKAZANE_MONEY) {
				expect(re.test(src), `${f} obsahuje zakázaný vzor ${re}`).toBe(false);
			}
		});
	}

	for (const f of PURE) {
		it(`${f} (pure) neimportuje ani server/db`, () => {
			const src = zdroj(f);
			expect(/from ['"].*server\/db['"]/.test(src)).toBe(false);
			expect(/import\(\s*['"`].*server\/db['"`]/.test(src)).toBe(false);
		});
	}
});
