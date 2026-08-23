// Verejný konfigurátor pergoly (#275) — Money / únik bezpečnostný guard. NAJDÔLEŽITEJŠÍ
// test PR-u: verejná (bez-auth) route NESMIE do žiadnej odpovede (load/akcia/DOM/bundle)
// pustiť CENU, Money kód (TS*/moneyKod), ani nárezový plán. Trojvrstvová obrana:
//   (A) REKURZÍVNY import-graf guard klientskeho bundlu — vzor
//       tests/vizual-money-guard.test.ts (#170 §2.13): prejde import graf KLIENTSKY
//       dosiahnuteľných súborov (nie *.server.ts / $lib/server/**) a spadne pri
//       akomkoľvek dosiahnutí katalógu skla / cenovej / Money cesty. Toto pokrýva aj
//       BUDÚCE súbory (napr. nová `Foo.svelte` importujúca sklo-strecha) — na rozdiel
//       od pôvodného pevného 5-súborového zoznamu, ktorý by ich nevidel (review 🟡 #275).
//   (B) STATICKÝ guard serverových súborov — SMÚ importovať sklo-strecha (na názvy),
//       ale NESMÚ sa dotknúť moneyKod ani sa viazať na Money zapisovač / cenu / nárez / DB.
//   (C) RUNTIME guard — reálny výstup load() aj akcie neobsahuje žiadny reálny moneyKod.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SKLO_STRECHA_TYPY } from '../src/lib/sklo-strecha';

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, 'src');
const KONF_ROUTE_DIR = path.join(SRC, 'routes', 'konfigurator');

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// Reálne Money kódy z katalógu strešného skla — nesmú sa objaviť nikde vo verejnom výstupe.
const MONEY_KODY = SKLO_STRECHA_TYPY.map((t) => t.moneyKod).filter((k): k is string => k !== null);

// --------------------------------------------------------------------------- //
// (A) REKURZÍVNY import-graf guard klientskeho bundlu (#170 §2.13 vzor)
// --------------------------------------------------------------------------- //

// Zakázané špecifikátory pre KLIENTSKY dosiahnuteľný kód: katalóg skla (nesie moneyKod),
// cena skla, Money zapisovač/cenník, nárez, a AKÝKOĽVEK server modul (klient server
// importovať nesmie — SvelteKit to aj tak odmietne, tu je to explicitný guard).
const KLIENT_ZAKAZANE_SPEC = [
	/(^|\/)sklo-strecha$/,
	/(^|\/)sklo-cena$/,
	/(^|\/)pergola-narez$/,
	/\/server\//,
	/(^|\/)server$/,
	/server\/money$/,
	/server\/ceny$/
];

function jeKlientskyReachable(subor: string): boolean {
	// *.server.ts / +page.server.ts / +layout.server.ts sa NIKDY nebundlujú do klienta
	if (/\.server\.ts$/.test(subor)) return false;
	return /\.svelte$/.test(subor) || /\.ts$/.test(subor);
}

/** Extrahuje statické importy, dynamické `import()` aj re-exporty (vzor vizual-guard —
 *  re-export `export … from` by inak guard obišiel, keďže neobsahuje slovo "import"). */
function extrahujSpecifikatory(src: string): string[] {
	const out: string[] = [];
	const res = [
		/import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
		/import\s*\(\s*['"`]([^'"`]+)['"`]/g,
		/export\s+(?:\*(?:\s+as\s+\S+)?|\{[^}]*\}|[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g
	];
	for (const re of res) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(src))) out.push(m[1]!);
	}
	return out;
}

/** Rozlíši relatívny alebo `$lib` špecifikátor na absolútnu cestu súboru, alebo null
 *  (externý balík: svelte, $app/*, …). */
function rozlisSpecifikator(spec: string, odKade: string): string | null {
	let zaklad: string;
	if (spec.startsWith('.')) zaklad = path.resolve(path.dirname(odKade), spec);
	else if (spec.startsWith('$lib/')) zaklad = path.join(SRC, 'lib', spec.slice('$lib/'.length));
	else return null;
	for (const k of [zaklad, `${zaklad}.ts`, `${zaklad}.svelte`, path.join(zaklad, 'index.ts')])
		if (fs.existsSync(k) && fs.statSync(k).isFile()) return k;
	return null;
}

function najdiSubory(dir: string, out: string[] = []): string[] {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, e.name);
		if (e.isDirectory()) najdiSubory(abs, out);
		else if (/\.(ts|svelte)$/.test(e.name)) out.push(abs);
	}
	return out;
}

interface Porusenie {
	subor: string;
	detail: string;
}

/** BFS import grafom KLIENTSKY dosiahnuteľných súborov. Spadne pri zakázanom
 *  špecifikátore ALEBO ak dosiahnuteľný súbor referencuje `moneyKod`/`skloStrechaMoneyKod`. */
function prejdiKlientskyGraf(vstupy: string[]): { porusenia: Porusenie[]; videne: Set<string> } {
	const porusenia: Porusenie[] = [];
	const videne = new Set<string>();
	const fronta = [...vstupy];
	while (fronta.length) {
		const subor = fronta.pop()!;
		if (videne.has(subor)) continue;
		videne.add(subor);
		const src = fs.readFileSync(subor, 'utf8');
		if (/moneyKod|skloStrechaMoneyKod/.test(src))
			porusenia.push({ subor, detail: 'referencuje moneyKod' });
		for (const spec of extrahujSpecifikatory(src)) {
			for (const vzor of KLIENT_ZAKAZANE_SPEC)
				if (vzor.test(spec)) porusenia.push({ subor, detail: `zakázaný import '${spec}'` });
			const rozlisene = rozlisSpecifikator(spec, subor);
			if (rozlisene === null) continue; // externý balík — mimo grafu
			if (!jeKlientskyReachable(rozlisene)) {
				// klient dosiahol server modul — porušenie (a nerekurzujeme doň)
				porusenia.push({ subor, detail: `dosahuje serverový modul '${spec}'` });
				continue;
			}
			fronta.push(rozlisene);
		}
	}
	return { porusenia, videne };
}

// Vstupné body klientskeho grafu verejnej routy — súbory dosiahnuteľné z klienta
// (mimo *.server.ts) + čistý compute konfigurátora. #277 pridal DopytForm.svelte, ktorý
// route +page.svelte importuje → BFS ho (a jeho pure importy ponuka.ts/dopyt.ts) prejde
// AUTOMATICKY. Ak DopytForm alebo pure moduly niekedy naimportujú katalóg/Money/server,
// guard (A) nižšie spadne — pokrytie NOVÝCH importov je overené samostatným testom.
function konfVstupy(): string[] {
	return [
		...najdiSubory(KONF_ROUTE_DIR).filter(jeKlientskyReachable),
		path.join(SRC, 'lib', 'konfigurator.ts')
	];
}

describe('Money safety (A) — rekurzívny import-graf klientskeho bundlu verejnej routy (#275/#277)', () => {
	it('žiadny klientsky dosiahnuteľný súbor nesiaha na katalóg/cenu/Money/server ani na moneyKod', () => {
		const vstupy = konfVstupy();
		expect(vstupy.length).toBeGreaterThan(1); // sanity — guard musí mať čo kontrolovať
		const { porusenia } = prejdiKlientskyGraf(vstupy);
		if (porusenia.length) {
			const hlasenie = porusenia
				.map((p) => `${path.relative(ROOT, p.subor)}: ${p.detail}`)
				.join('\n');
			expect.fail(`Únik guard porušený:\n${hlasenie}`);
		}
	});

	// #277: nový klientsky vstup do grafu je DopytForm.svelte (verejný kontaktný formulár) +
	// jeho pure závislosti ponuka.ts / dopyt.ts. Tento test dokazuje, že guard (A) ich REÁLNE
	// prechádza (nie sú mimo grafu) — inak by ich prípadný budúci Money import nezachytil.
	it('graf REÁLNE prechádza nové #277 klientsky-dosiahnuteľné súbory (DopytForm, ponuka, dopyt)', () => {
		const { videne } = prejdiKlientskyGraf(konfVstupy());
		const musiaByt = [
			path.join(SRC, 'lib', 'components', 'DopytForm.svelte'),
			path.join(SRC, 'lib', 'ponuka.ts'),
			path.join(SRC, 'lib', 'dopyt.ts')
		];
		for (const f of musiaByt) {
			expect(fs.existsSync(f)).toBe(true); // súbor existuje (inak by test len ticho prešiel)
			expect(videne.has(f), `graf nedosiahol ${path.relative(ROOT, f)}`).toBe(true);
		}
	});
});

// --------------------------------------------------------------------------- //
// (B) STATICKÝ guard serverových súborov routy
// --------------------------------------------------------------------------- //

// Serverové súbory routy SMÚ importovať katalóg sklo-strecha (na názvy), ale NESMÚ sa
// dotknúť moneyKod, ani sa viazať na Money zapisovač / cenu / nárez / DB / odpisovú cestu.
const SERVEROVE_ROUTY = [
	'src/routes/konfigurator/+page.server.ts',
	'src/lib/server/konfigurator-vstup.ts',
	'src/lib/server/public-throttle.ts'
];

const SERVER_ZAKAZANE = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/ceny['"]/,
	/from ['"].*sklo-cena['"]/,
	/from ['"].*server\/db['"]/,
	/from ['"].*server\/pergola['"]/,
	/from ['"].*pergola-narez['"]/,
	/moneyKod|skloStrechaMoneyKod|writeOdpis|MONEY_LIVE/
];

describe('Money safety (B) — serverové súbory routy sa neviažu na Money/cenu/nárez (#275)', () => {
	for (const subor of SERVEROVE_ROUTY) {
		it(`${subor} sa neviaže na Money zapisovač / cenu / nárez a nedotýka sa moneyKod`, () => {
			const src = zdroj(subor);
			for (const vzor of SERVER_ZAKAZANE) expect(src).not.toMatch(vzor);
		});
	}

	it('katalóg má aspoň jeden reálny moneyKod (sanity — inak by runtime guard nič nestrážil)', () => {
		expect(MONEY_KODY.length).toBeGreaterThan(0);
	});
});

// --------------------------------------------------------------------------- //
// (C) RUNTIME guard — reálny výstup load() aj akcie
// --------------------------------------------------------------------------- //

const { load, actions } = await import('../src/routes/konfigurator/+page.server');

function neobsahujeUnik(json: string) {
	for (const kod of MONEY_KODY) expect(json).not.toContain(kod);
	expect(json).not.toMatch(/moneyKod/);
	expect(json).not.toMatch(/€|EUR\b/);
	// cena v akejkoľvek podobe (aj bez menového symbolu, napr. pole `cena`/`cenaZaM2`)
	expect(json).not.toMatch(/cena/i);
	// nárezové / interné polia
	expect(json).not.toMatch(/panelSirka|panelDlzka|narez|nárez|krov/i);
}

describe('Money safety (C) — runtime výstup neobsahuje cenu ani Money kód (#275)', () => {
	it('load() posiela LEN názvy skla + RAL možnosti + rozmedzia — žiadny moneyKod', async () => {
		const data = await load({} as Parameters<typeof load>[0]);
		const json = JSON.stringify(data);
		neobsahujeUnik(json);
		// pozitívne: obsahuje názvy skla (aby test dokazoval, že katalóg NAOZAJ prešiel)
		expect(json).toContain(SKLO_STRECHA_TYPY[0]!.nazov);
	});

	it('akcia (platný vstup) vráti súhrn BEZ ceny / moneyKod / nárezu', async () => {
		const fd = new FormData();
		fd.append('sirka', '4000');
		fd.append('hlbka', '3500');
		fd.append('vyskaVpredu', '2500');
		fd.append('sklonDeg', '6');
		fd.append('sklo', SKLO_STRECHA_TYPY[0]!.nazov);
		fd.append('farba', '7016');
		const event = {
			request: new Request('http://x/konfigurator', { method: 'POST', body: fd }),
			getClientAddress: () => '203.0.113.5'
		} as unknown as Parameters<typeof actions.vypocet>[0];

		const r = await actions.vypocet(event);
		const json = JSON.stringify(r);
		neobsahujeUnik(json);
		// pozitívne: súhrn naozaj prišiel (obsahuje názov skla)
		expect(json).toContain(SKLO_STRECHA_TYPY[0]!.nazov);
	});
});
