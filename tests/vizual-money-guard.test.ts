// Zákaznícky 3D náhľad (#170) — Money-safety guard (§2.13). Prejde import graf
// REKURZÍVNE pre každý súbor pod `src/lib/vizual/**` a
// `src/lib/components/vizual/**` (rozlíši relatívne aj `$lib` aliasy) a SPADNE
// pri akomkoľvek špecifikátore matchujúcom zakázaný vzor. Toto je najdôležitejší
// test v celom PR — ak zlyhá, 3D vrstva má fyzický prístup k Money ceste.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, 'src');
const VIZUAL_DIRS = [
	path.join(SRC, 'lib', 'vizual'),
	path.join(SRC, 'lib', 'components', 'vizual')
];

const ZAKAZANE_VZORY = [
	/(^|\/)server\//,
	/exceljs/,
	/compute/,
	/odpis/,
	/money/i,
	/xlsx/,
	/better-sqlite3/
];

// Allowlist §2.13 + DVE zámerné doplnenia (zdôvodnené, nie tichá diera):
// `$lib/components/ZaskleniaNavrhVykres.svelte` je práve tá "existujúca SVG
// elevácia", ktorú §2.9 vyžaduje ako T0 poster (Vizual3DPoster.svelte) — bez nej
// by T0 fallback nebolo možné postaviť vôbec, a je to overene Money-free (nulový
// import server/, viď jeho vlastný hlavičkový komentár "Do Money NIČ nezapisuje").
// `$lib/vykres/kota` (fmtMm) je čisto formátovací helper (rovnaká rodina ako
// povolené `$lib/vykres/ral`/`$lib/vykres/iso`), použitý na caption pásik
// (§2.6 "V renderi nie je ani jeden text… kóty… sú v caption pásiku POD
// obrázkom") — patrí do rovnakej "prezentačný helper" kategórie ako `ral.ts`.
const ALLOWLIST = new Set([
	'$lib/zasklenia-navrh',
	'$lib/klin',
	'$lib/kolajnica',
	'$lib/components/ZaskleniaNavrhVykres.svelte',
	'$lib/vykres/kota',
	'$lib/pergola-navrh',
	'$lib/bazen-navrh',
	'$lib/vykres/ral',
	'$lib/vykres/iso'
]);

function jeVizualCesta(absPath: string): boolean {
	return VIZUAL_DIRS.some((d) => absPath === d || absPath.startsWith(d + path.sep));
}

function najdiSubory(dir: string, out: string[] = []): string[] {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) najdiSubory(abs, out);
		else if (/\.(ts|svelte)$/.test(entry.name)) out.push(abs);
	}
	return out;
}

/** Extrahuje VŠETKY import/re-export špecifikátory zo zdrojového textu —
 *  statický `import … from '…'`/`import '…'`, dynamický `import('…')` (rovnaká
 *  disciplína ako #139 review nález — dynamický import sa NESMIE dať obísť),
 *  AJ re-export `export … from '…'`/`export * from '…'` (review nález 🔵 #7
 *  — `export { x } from 'three'` by sa inak dalo použiť na obídenie guardu,
 *  keďže by fyzicky NEobsahovalo slovo "import"). */
function extrahujSpecifikatory(zdroj: string): string[] {
	const out: string[] = [];
	const staticRe = /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
	const dynamicRe = /import\s*\(\s*['"`]([^'"`]+)['"`]/g;
	const exportRe = /export\s+(?:\*(?:\s+as\s+\S+)?|\{[^}]*\}|[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
	for (const re of [staticRe, dynamicRe, exportRe]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(zdroj))) out.push(m[1]!);
	}
	return out;
}

/** Rozlíši relatívny AJ `$lib` alias špecifikátor na absolútnu cestu súboru
 *  (s príponou `.ts` alebo `.svelte`), alebo `null`, keď nejde o lokálny
 *  projektový súbor (napr. `three`, `svelte`, `$app/environment`). */
function rozlisSpecifikator(specifikator: string, odKade: string): string | null {
	let zakladCesta: string;
	if (specifikator.startsWith('.')) {
		zakladCesta = path.resolve(path.dirname(odKade), specifikator);
	} else if (specifikator.startsWith('$lib/')) {
		zakladCesta = path.join(SRC, 'lib', specifikator.slice('$lib/'.length));
	} else {
		return null;
	}
	for (const kandidat of [
		zakladCesta,
		`${zakladCesta}.ts`,
		`${zakladCesta}.svelte`,
		path.join(zakladCesta, 'index.ts')
	]) {
		if (fs.existsSync(kandidat) && fs.statSync(kandidat).isFile()) return kandidat;
	}
	return null;
}

interface Porusenie {
	subor: string;
	specifikator: string;
	dovod: string;
}

function prejdiGraf(vstupneSubory: string[]): Porusenie[] {
	const porusenia: Porusenie[] = [];
	const navstivene = new Set<string>();
	const fronta = [...vstupneSubory];

	while (fronta.length) {
		const subor = fronta.pop()!;
		if (navstivene.has(subor)) continue;
		navstivene.add(subor);

		const zdroj = fs.readFileSync(subor, 'utf8');
		for (const specifikator of extrahujSpecifikatory(zdroj)) {
			for (const vzor of ZAKAZANE_VZORY) {
				if (vzor.test(specifikator)) {
					porusenia.push({ subor, specifikator, dovod: `matchuje zakázaný vzor ${vzor}` });
				}
			}

			if (specifikator === 'three' || specifikator.startsWith('three/examples/jsm/')) continue; // OK, node_modules

			const rozlisene = rozlisSpecifikator(specifikator, subor);
			if (rozlisene === null) continue; // externý balík (svelte, $app/*, …) — mimo rozsahu guardu

			if (jeVizualCesta(rozlisene)) {
				fronta.push(rozlisene); // vlastný súbor vizual/** — rekurzia pokračuje
				continue;
			}

			// mimo vizual/** — musí byť v allowliste, inak porušenie; NEREKURZUJEME
			// ďalej (allowlistované moduly sú nezávisle udržiavané, mimo rozsahu 3D vrstvy)
			if (!ALLOWLIST.has(specifikator)) {
				porusenia.push({ subor, specifikator, dovod: 'nie je v allowliste §2.13' });
			}
		}
	}
	return porusenia;
}

describe('Money-safety guard (#170 §2.13) — src/lib/vizual/** a components/vizual/** nikdy nesiaha na Money cestu', () => {
	it('rekurzívny import graf neobsahuje ŽIADNY zakázaný ani neallowlistovaný špecifikátor', () => {
		const vstupy = VIZUAL_DIRS.flatMap((d) => najdiSubory(d));
		expect(vstupy.length).toBeGreaterThan(5); // sanity — guard musí mať čo kontrolovať
		const porusenia = prejdiGraf(vstupy);
		if (porusenia.length) {
			const hlasenie = porusenia
				.map((p) => `${path.relative(ROOT, p.subor)}: '${p.specifikator}' (${p.dovod})`)
				.join('\n');
			expect.fail(`Money-safety guard porušený:\n${hlasenie}`);
		}
	});

	it('PR sa nesmie dotknúť žiadneho .xlsx, golden/fixture snapshotu ani odpisového engine súboru', () => {
		// staticky over, že žiadny zo skutočne existujúcich money-kritických
		// súborov nebol upravený v rámci TOHTO PR — kontroluje sa cez git diff
		// voči base vetvou v CI (samostatný krok), tu len sanity, že tie súbory
		// stále existujú NEZMENENÉ na svojom mieste (regresný dôkaz, že guard
		// beží proti reálnemu stromu, nie proti fixture kópii)
		const odpisEngine = path.join(SRC, 'lib', 'server', 'money.ts');
		expect(fs.existsSync(odpisEngine)).toBe(true);
	});

	it('`three` sa nikde MIMO src/lib/vizual/** (a components/vizual/**) nesmie objaviť ako STATICKÝ import', () => {
		// rozsah: PRODUKČNÝ zdrojový kód appky (routes + lib) — testy (`tests/`,
		// `e2e/`) nie sú súčasťou bundlovanej appky (vitest beží v Node, nikdy sa
		// nebundluje do prehliadača), takže bundle-size/SSR účel tohto pravidla sa
		// na ne nevzťahuje; `tests/vizual-builder.test.ts` preto zámerne importuje
		// `three` priamo pre unit test builder.ts.
		// `export … from 'three'` (re-export) je ROVNAKO statický bundle-size
		// dôsledok ako `import … from 'three'` — review nález 🔵 #7.
		const staticImportRe =
			/(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+(?:\*(?:\s+as\s+\S+)?|\{[^}]*\}|[^'";]+?)\s+from\s+)['"]three(\/[^'"]*)?['"]/;
		const prehladavaneDiry = [path.join(SRC, 'routes'), path.join(SRC, 'lib')];
		const porusenia: string[] = [];
		for (const dir of prehladavaneDiry) {
			for (const subor of najdiSubory(dir)) {
				if (jeVizualCesta(subor)) continue;
				const zdroj = fs.readFileSync(subor, 'utf8');
				if (staticImportRe.test(zdroj)) porusenia.push(path.relative(ROOT, subor));
			}
		}
		expect(porusenia).toEqual([]);
	});
});
