// Verejný konfigurátor pergoly (#275) — Money / únik bezpečnostný guard. NAJDÔLEŽITEJŠÍ
// test PR-u: verejná (bez-auth) route NESMIE do žiadnej odpovede (load/akcia/DOM/bundle)
// pustiť CENU, Money kód (TS*/moneyKod), ani nárezový plán. Dvojvrstvová obrana:
//   (A) STATICKÝ import guard — súbory routy sa neviažu na Money/cenu/nárez cesty a
//       klientske súbory neimportujú ani katalóg skla (moneyKod na klientovi).
//   (B) RUNTIME guard — reálny výstup load() aj akcie neobsahuje žiadny reálny moneyKod.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { SKLO_STRECHA_TYPY } from '../src/lib/sklo-strecha';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// Reálne Money kódy z katalógu strešného skla — nesmú sa objaviť nikde vo verejnom výstupe.
const MONEY_KODY = SKLO_STRECHA_TYPY.map((t) => t.moneyKod).filter((k): k is string => k !== null);

// --------------------------------------------------------------------------- //
// (A) STATICKÝ import guard
// --------------------------------------------------------------------------- //

// Klientsky-viditeľné / čisté súbory: NESMÚ importovať server/, katalóg skla
// (sklo-strecha nesie moneyKod), cenu, nárez, Money — inak by sa moneyKod dostal do
// klientskeho bundlu / display výpočtu.
const CISTO_KLIENTSKE = ['src/lib/konfigurator.ts', 'src/routes/konfigurator/+page.svelte'];

const KLIENTSKE_ZAKAZANE = [
	/from ['"].*\/server\//,
	/from ['"].*sklo-strecha['"]/,
	/from ['"].*sklo-cena['"]/,
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/ceny['"]/,
	/from ['"].*pergola-narez['"]/,
	/moneyKod|skloStrechaMoneyKod/
];

// Serverové súbory routy: SMÚ importovať katalóg sklo-strecha (na názvy), ale NESMÚ sa
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

describe('Money safety (A) — statický import guard verejnej routy (#275)', () => {
	for (const subor of CISTO_KLIENTSKE) {
		it(`${subor} neimportuje server/katalóg/cenu/nárez a nedotýka sa moneyKod`, () => {
			const src = zdroj(subor);
			for (const vzor of KLIENTSKE_ZAKAZANE) expect(src).not.toMatch(vzor);
		});
	}
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
// (B) RUNTIME guard — reálny výstup load() aj akcie
// --------------------------------------------------------------------------- //

const { load, actions } = await import('../src/routes/konfigurator/+page.server');

function neobsahujeUnik(json: string) {
	for (const kod of MONEY_KODY) expect(json).not.toContain(kod);
	expect(json).not.toMatch(/moneyKod/);
	expect(json).not.toMatch(/€|EUR\b/);
	// nárezové / interné polia
	expect(json).not.toMatch(/panelSirka|panelDlzka|narez|nárez|krov/i);
}

describe('Money safety (B) — runtime výstup neobsahuje cenu ani Money kód (#275)', () => {
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
		} as unknown as Parameters<typeof actions.default>[0];

		const r = await actions.default(event);
		const json = JSON.stringify(r);
		neobsahujeUnik(json);
		// pozitívne: súhrn naozaj prišiel (obsahuje názov skla)
		expect(json).toContain(SKLO_STRECHA_TYPY[0]!.nazov);
	});
});
