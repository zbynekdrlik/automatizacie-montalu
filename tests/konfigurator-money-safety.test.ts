// Verejný konfigurátor pergoly (#275, #279 Fáza C) — Money / únik bezpečnostný guard.
// NAJDÔLEŽITEJŠÍ test PR-u: verejná (bez-auth) route SMIE zobraziť orientačnú maloobchodnú (MO)
// cenu (owner ROZHODNUTÉ), ale do žiadnej odpovede (load/akcia/DOM/bundle) NESMIE pustiť
// VEĽKOOBCHOD (VO) cenu, Money kód (TS*/moneyKod), ani nárezový plán. Trojvrstvová obrana:
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
// #279 Fáza C: interný cenový modul (MO + VO) — na overenie, že verejná odpoveď nesie MO,
// ale VO (veľkoobchod) je z nej ODSTRÁNENÉ.
import { vypocitajCenu } from '../src/lib/server/konfigurator-cena';

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
	// #385: bazénový Money katalóg — `bazen-komponenty` (BPK* kusové odpisové kódy) je `$lib/`
	// (klientsky rozlíšiteľný) a NESIE Money kódy ako obyčajné stringy (nie slovo `moneyKod`), takže
	// obsahový grep nižšie by sám import nezachytil — preto ho blokujeme priamo ako zakázaný špecifikátor.
	/(^|\/)bazen-komponenty$/,
	/\/server\//,
	/(^|\/)server$/,
	/server\/money$/,
	/server\/ceny$/
];

function jeKlientskyReachable(subor: string): boolean {
	// *.server.ts / +page.server.ts / +layout.server.ts sa NIKDY nebundlujú do klienta
	if (/\.server\.ts$/.test(subor)) return false;
	// +server.ts (route GET/POST endpoint) je TIEŽ server-only — SvelteKit ho nikdy
	// nebundluje do klienta (rovnako ako +page.server.ts), smie importovať $lib/server/*;
	// bez tejto výnimky by ho guard mylne bral ako klientsky vstup a spadol na jeho
	// legitímnom serverovom importe. Money-neutralitu +server.ts stráži guard (B) nižšie.
	if (/(^|\/)\+server\.ts$/.test(subor)) return false;
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
		// #385: aj HOLÝ Money kód (BPK*/BPP* z bazénového odpisu, TS* zo skla) je únik, nielen slovo
		// `moneyKod` — bazén kusové/metrážové kódy sa v katalógu nesú ako stringy `'BPK00108'`.
		// #387: interné zasklenie moduly nesú Money kódy rodiny ZAS-P/ZAS-K ako holé stringy
		// (`ZAS[PK]` + číslo, napr. v `sklo`/`komponenty-cfg`). Vzor je case-sensitive → NEmatchuje
		// slovenské slovo „zasklievacie"/„ZASKLIEVACIE" (za `ZASK` je písmeno, nie číslica).
		if (/moneyKod|skloStrechaMoneyKod|\bBP[KP]\d{5}\b|\bZAS[PK]\d{4,}\b/.test(src))
			porusenia.push({
				subor,
				detail: 'referencuje Money kód (moneyKod / BPK*/BPP* / ZASP*/ZASK*)'
			});
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
	it('graf REÁLNE prechádza klientsky-dosiahnuteľné súbory (DopytForm + #319 ObjednavkaForm + #325 Konf* komponenty + #385 bazén + #386 zimná záhrada + #387 zasklenie, ponuka, dopyt)', () => {
		const { videne } = prejdiKlientskyGraf(konfVstupy());
		const musiaByt = [
			path.join(SRC, 'lib', 'components', 'DopytForm.svelte'),
			// #319: objednávkový formulár je nový klientsky vstup — guard (A) MUSÍ prejsť aj jeho graf,
			// inak by jeho prípadný budúci Money/katalóg import nezachytil.
			path.join(SRC, 'lib', 'components', 'ObjednavkaForm.svelte'),
			// #325: split-screen subkomponenty (nové klientske vstupy z +page.svelte) — guard (A)
			// MUSÍ prejsť aj ich graf (KonfVizual vťahuje celý vizuál strom cez dynamic import).
			path.join(SRC, 'lib', 'components', 'konfigurator', 'KonfVizual.svelte'),
			path.join(SRC, 'lib', 'components', 'konfigurator', 'KonfCena.svelte'),
			path.join(SRC, 'lib', 'components', 'konfigurator', 'KonfSuhrn.svelte'),
			// #327: prémiový ovládací panel — nový klientsky vstup (importuje $lib/vykres/ral
			// pre hex swatchov); guard (A) MUSÍ prejsť aj jeho graf, aby budúci Money/katalóg
			// import nezostal nezachytený.
			path.join(SRC, 'lib', 'components', 'konfigurator', 'KonfOvladace.svelte'),
			// #384: nový klientsky vstup výberovej obrazovky (root `/konfigurator/+page.svelte`
			// importuje `KonfVyber`, ten číta client-safe katalóg `konfigurator-produkty`) — guard (A)
			// MUSÍ prejsť ich graf, inak by ich prípadný budúci Money/katalóg import nezachytil.
			path.join(SRC, 'lib', 'components', 'konfigurator', 'KonfVyber.svelte'),
			path.join(SRC, 'lib', 'konfigurator-produkty.ts'),
			// #385: bazénová podstránka (`konfigurator/bazen/+page.svelte`) je nový klientsky vstup a
			// importuje client-safe `konfigurator-bazen` — guard (A) MUSÍ prejsť jeho graf, aby jeho
			// prípadný budúci Money import zachytil: `bazen-komponenty`/`server/bazen` import je v
			// `KLIENT_ZAKAZANE_SPEC`, a holý BPK*/BPP* kód v obsahu chytá rozšírený obsahový grep vyššie.
			path.join(SRC, 'lib', 'konfigurator-bazen.ts'),
			// #387: zasklenie podstránka (`konfigurator/zasklenie/+page.svelte`) je nový klientsky vstup a
			// importuje client-safe `konfigurator-zasklenie` — guard (A) MUSÍ prejsť jeho graf, aby jeho
			// prípadný budúci Money import zachytil (holý ZASP*/ZASK* kód chytá rozšírený obsahový grep vyššie).
			path.join(SRC, 'lib', 'konfigurator-zasklenie.ts'),
			// #386: podstránka zimnej záhrady (`konfigurator/zimna-zahrada/+page.svelte`) je nový klientsky
			// vstup a importuje client-safe `konfigurator-zimna-zahrada` — guard (A) MUSÍ prejsť jeho graf,
			// aby jeho prípadný budúci Money/katalóg import zachytil (žiadny Money katalóg zimných záhrad
			// neexistuje, ale pokrytie budúcich importov musí byť garantované rovnako ako pri bazéne).
			path.join(SRC, 'lib', 'konfigurator-zimna-zahrada.ts'),
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
	// #384: pergolový konfigurátor sa presunul na podstránku `/konfigurator/pergola`; root
	// `/konfigurator` je výberová obrazovka (bez +page.server.ts).
	'src/routes/konfigurator/pergola/+page.server.ts',
	// #385: bazénová podstránka — serverová route (load + `dopyt` akcia). Importuje client-safe
	// `konfigurator-bazen` + zdieľanú `dopyt-action` + RAL — NIKDY money/cena/pergola/moneyKod.
	'src/routes/konfigurator/bazen/+page.server.ts',
	// #387: zasklenie podstránka — serverová route (load + `dopyt` akcia). Importuje client-safe
	// `konfigurator-zasklenie` + zdieľanú `dopyt-action` + RAL — NIKDY money/cena/pergola/ZASP*/ZASK*.
	'src/routes/konfigurator/zasklenie/+page.server.ts',
	// #386: podstránka zimnej záhrady — serverová route (load + `dopyt` akcia). Importuje client-safe
	// `konfigurator-zimna-zahrada` + zdieľanú `dopyt-action` + RAL — NIKDY money/cena/pergola/moneyKod.
	'src/routes/konfigurator/zimna-zahrada/+page.server.ts',
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
	// #385: bazénová odpisová cesta (BPK/BPP kusové/metrážové kódy) — verejná route ju NESMIE importovať.
	/from ['"].*server\/bazen['"]/,
	/from ['"].*bazen-komponenty['"]/,
	// #387: interné zasklenie Money kódy rodiny ZAS-P/ZAS-K (holý string) — verejná route ich NESMIE niesť.
	/moneyKod|skloStrechaMoneyKod|writeOdpis|MONEY_LIVE|\bBP[KP]\d{5}\b|\bZAS[PK]\d{4,}\b/
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

// #384: runtime load/akcia žijú na pergolovej podstránke (root `/konfigurator` = výberová obrazovka).
const { load, actions } = await import('../src/routes/konfigurator/pergola/+page.server');

// #279 Fáza C — leak-guard REDEFINÍCIA. Owner ROZHODNUTÉ (issuecomment-5396941067, 2026-08-24:
// „vychádzať z aktuálneho konfigurátora … ceny — montalu.sk/konfigurator") POVOLIL zobraziť
// orientačnú PREDAJNÚ cenu vo verejnom konfigurátore → doterajší blanket zákaz „žiadne €/cena"
// PADOL pre PRICES ONLY. NAĎALEJ zakázané VŠADE: Money kód (TS*/moneyKod), nárez, VEĽKOOBCHOD
// (VO) cena a raw cenová matica (seed).

/** Money kód / moneyKod / nárez sa NIKDY nesmú objaviť vo verejnom výstupe (nezmenené #275). */
function neobsahujeMoneyAniNarez(json: string) {
	for (const kod of MONEY_KODY) expect(json).not.toContain(kod);
	expect(json).not.toMatch(/moneyKod/);
	expect(json).not.toMatch(/panelSirka|panelDlzka|narez|nárez|krov/i);
}

/** VEĽKOOBCHOD (VO) ani raw matica sa NIKDY nesmú dostať do verejnej odpovede (#279 Fáza C).
 *  Pozn.: `ve[ľl]koobchod` chytá diakritickú aj ASCII formu (review 🔵 5b). */
function neobsahujeVOaniMaticu(json: string, voHodnoty: number[]) {
	expect(json).not.toMatch(/"vo"|priceB2B|ve[ľl]koobchod|bezDphVo/i);
	for (const v of voHodnoty) expect(json).not.toContain(String(v));
	// #318 review 🔵: ani NÁZOV diskriminátora hladiny (`hladina`/`hladinaLabel`) sa nesmie
	// dostať do MO odpovede — route regresia pripájajúca `hladina:'MO'` na verejný výstup by
	// inak prešla (leak-guard je „druhá strana" mapper unit testu `'hladina' in mo === false`).
	expect(json).not.toMatch(/hladina/);
	// seed / cenová matica sa NIKDY neserializuje do verejnej odpovede
	expect(json).not.toMatch(/cennik|update-pergolas|mriezka|verifikaciaDph/i);
}

/** VO hodnoty (net + s DPH) VŠETKÝCH 3 modelov pre daný rozmer — response nesie `cenyModely`
 *  pre všetky 3, takže guard musí overiť absenciu VO každého (review 🔵 5a). */
function voHodnotyVsetkychModelov(hlbkaMm: number, sirkaMm: number): number[] {
	const out: number[] = [];
	for (const model of ['LIGHT', 'ROBUST', 'MASSIVE'] as const) {
		const c = vypocitajCenu({ hlbkaMm, sirkaMm, model });
		if (c.druh === 'cena') out.push(c.vo.bezDph, c.vo.sDph);
	}
	return out;
}

describe('Money safety (C) — runtime výstup: cena SMIE, VO/Money/nárez/matica NIE (#275/#279 Fáza C)', () => {
	it('load() posiela názvy skla + RAL + modely (popisy) + rozmedzia — žiadna cena/moneyKod', async () => {
		const data = await load({} as Parameters<typeof load>[0]);
		const json = JSON.stringify(data);
		neobsahujeMoneyAniNarez(json);
		// load NEMÁ cenu (tá je až v akcii vypocet) → stále bez € aj bez slova „cena"
		expect(json).not.toMatch(/€|EUR\b/);
		expect(json).not.toMatch(/cena/i);
		// pozitívne: obsahuje názvy skla + modely (aby test dokazoval, že dáta NAOZAJ prešli)
		expect(json).toContain(SKLO_STRECHA_TYPY[0]!.nazov);
		expect(json).toContain('LIGHT');
	});

	it('akcia vráti orientačnú MO cenu (€), ale NIKDY VO / Money kód / nárez / maticu', async () => {
		const fd = new FormData();
		fd.append('sirka', '4000');
		fd.append('hlbka', '3500');
		fd.append('vyskaVpredu', '2500');
		fd.append('sklonDeg', '6');
		fd.append('model', 'LIGHT');
		fd.append('sklo', SKLO_STRECHA_TYPY[0]!.nazov);
		fd.append('farba', '7016');
		const event = {
			request: new Request('http://x/konfigurator', { method: 'POST', body: fd }),
			getClientAddress: () => '203.0.113.5'
		} as unknown as Parameters<typeof actions.vypocet>[0];

		const r = await actions.vypocet(event);
		const json = JSON.stringify(r);

		// interná cena (MO + VO) pre presne tento rozmer/model — nezávislá referencia
		const interne = vypocitajCenu({ hlbkaMm: 3500, sirkaMm: 4000, model: 'LIGHT' });
		expect(interne.druh).toBe('cena');
		if (interne.druh === 'cena') {
			// pozitívne: orientačná MO cena (net + s DPH) JE v odpovedi (cena sa smie zobraziť)
			expect(json).toContain(String(interne.mo.bezDph));
			expect(json).toContain(String(interne.mo.sDph));
			// negatívne: VO hodnoty VŠETKÝCH 3 modelov (response nesie cenyModely) NIE SÚ v odpovedi
			neobsahujeVOaniMaticu(json, voHodnotyVsetkychModelov(3500, 4000));
		}
		neobsahujeMoneyAniNarez(json);
		// pozitívne: súhrn naozaj prišiel (názov skla)
		expect(json).toContain(SKLO_STRECHA_TYPY[0]!.nazov);
	});

	// #318: prihlásený b2b (veľkoobchod) → akcia vráti VEĽKOOBCHOD (VO) cenu + hladina marker.
	// Toto je „druhá strana" leak-guardu: MO návštevník VO NIKDY nevidí (test vyššie), ale
	// oprávnený VO účet ju vidieť MÁ. Hladina sa odvodí SERVER-SIDE z `locals.user`.
	it('prihlásený b2b (VO) → akcia vráti VO cenu + hladinu VO; Money kód/nárez stále NIE (#318)', async () => {
		const fd = new FormData();
		fd.append('sirka', '4000');
		fd.append('hlbka', '3500');
		fd.append('vyskaVpredu', '2500');
		fd.append('sklonDeg', '6');
		fd.append('model', 'LIGHT');
		fd.append('sklo', SKLO_STRECHA_TYPY[0]!.nazov);
		fd.append('farba', '7016');
		const event = {
			request: new Request('http://x/konfigurator', { method: 'POST', body: fd }),
			getClientAddress: () => '203.0.113.9',
			locals: { user: { id: 1, username: 'obchod@phsplus.cz', role: 'b2b' } }
		} as unknown as Parameters<typeof actions.vypocet>[0];

		const r = await actions.vypocet(event);
		const json = JSON.stringify(r);

		const interne = vypocitajCenu({ hlbkaMm: 3500, sirkaMm: 4000, model: 'LIGHT' });
		expect(interne.druh).toBe('cena');
		if (interne.druh === 'cena') {
			// VO cena vybraného modelu JE v odpovedi pre b2b (net + s DPH) + hladina marker
			expect(json).toContain(String(interne.vo.bezDph));
			expect(json).toContain(String(interne.vo.sDph));
			expect(json).toMatch(/"hladina":"VO"/);
		}
		// Money kód / nárez sú zakázané aj pre VO výstup (VO je cena, nie Money kód)
		neobsahujeMoneyAniNarez(json);
	});
});

// --------------------------------------------------------------------------- //
// (C) RUNTIME guard — bazénová podstránka (#385): load() nesie LEN prezentačné dáta, žiadny Money
// kód (BPK*/BPP* z odpisu), žiadna cena (honest-null — bazén nemá cenový zdroj).
// --------------------------------------------------------------------------- //
const { load: bazenLoad } = await import('../src/routes/konfigurator/bazen/+page.server');

describe('Money safety (C) — bazénová route: žiadny Money kód, žiadna cena (#385)', () => {
	it('load() posiela modely/koľaj/výplne/farby/rozmedzia — žiadny BPK*/BPP*/moneyKod, žiadny € ani „cena"', async () => {
		const data = await bazenLoad({} as Parameters<typeof bazenLoad>[0]);
		const json = JSON.stringify(data);
		// žiadny Money kód (holý BPK/BPP ani slovo moneyKod), žiadny nárez
		neobsahujeMoneyAniNarez(json);
		expect(json).not.toMatch(/\bBP[KP]\d{5}\b/);
		// honest-null: žiadna cena / € vo verejnej bazénovej odpovedi
		expect(json).not.toMatch(/€|EUR\b/);
		expect(json).not.toMatch(/cena|priceB2B|cennik/i);
		// pozitívne: dáta naozaj prešli (modely + koľaj), aby test nebol vákuový
		expect(json).toContain('Premier');
		expect(json).toContain('Jednokoľajové');
	});
});

// --------------------------------------------------------------------------- //
// (C) RUNTIME guard — zasklenie podstránka (#387): load() nesie LEN prezentačné dáta, žiadny Money
// kód (holý ZASP*/ZASK* z odpisu), žiadna cena (honest-null — zasklenie nemá cenový zdroj).
// --------------------------------------------------------------------------- //
const { load: zaskleniLoad } = await import('../src/routes/konfigurator/zasklenie/+page.server');

describe('Money safety (C) — zasklenie route: žiadny Money kód, žiadna cena (#387)', () => {
	it('load() posiela umiestnenia/modely/výplne/farby/rozmedzia — žiadny ZASP*/ZASK*/moneyKod, žiadny € ani „cena"', async () => {
		const data = await zaskleniLoad({} as Parameters<typeof zaskleniLoad>[0]);
		const json = JSON.stringify(data);
		// žiadny Money kód (holý ZAS[PK]/BPK/BPP ani slovo moneyKod), žiadny nárez
		neobsahujeMoneyAniNarez(json);
		expect(json).not.toMatch(/\bZAS[PK]\d{4,}\b/);
		expect(json).not.toMatch(/\bBP[KP]\d{5}\b/);
		// honest-null: žiadna cena / € vo verejnej zasklenie odpovedi
		expect(json).not.toMatch(/€|EUR\b/);
		expect(json).not.toMatch(/cena|priceB2B|cennik/i);
		// pozitívne: dáta naozaj prešli (umiestnenie + model), aby test nebol vákuový
		expect(json).toContain('Terasa');
		expect(json).toContain('SLIDE');
	});
});

// --------------------------------------------------------------------------- //
// (C) RUNTIME guard — podstránka zimnej záhrady (#386): load() nesie LEN prezentačné dáta, žiadny
// Money kód, žiadna cena (honest-null — zimná záhrada nemá cenový zdroj).
// --------------------------------------------------------------------------- //
const { load: zzLoad } = await import('../src/routes/konfigurator/zimna-zahrada/+page.server');

describe('Money safety (C) — route zimnej záhrady: žiadny Money kód, žiadna cena (#386)', () => {
	it('load() posiela modely/zasklenia/farby/rozmedzia — žiadny BPK*/BPP*/moneyKod, žiadny € ani „cena"', async () => {
		const data = await zzLoad({} as Parameters<typeof zzLoad>[0]);
		const json = JSON.stringify(data);
		// žiadny Money kód (holý BPK/BPP ani slovo moneyKod), žiadny nárez
		neobsahujeMoneyAniNarez(json);
		expect(json).not.toMatch(/\bBP[KP]\d{5}\b/);
		// honest-null: žiadna cena / € vo verejnej odpovedi zimnej záhrady
		expect(json).not.toMatch(/€|EUR\b/);
		expect(json).not.toMatch(/cena|priceB2B|cennik/i);
		// pozitívne: dáta naozaj prešli (modely + zasklenie), aby test nebol vákuový
		expect(json).toContain('ROBUST');
		expect(json).toContain('Izolačné sklo');
	});
});
