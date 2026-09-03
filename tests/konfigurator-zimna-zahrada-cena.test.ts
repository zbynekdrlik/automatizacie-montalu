// Interim cenotvorba zimných záhrad (#408 + #429 systém stien) — parity + jednotkové testy cenového
// modulu. DPH parita je kotvená NEZÁVISLE na montalu.sk vlastných zaokrúhlených reťazcoch s DPH
// (`verifikaciaDph` v seede — montalu PHP `round()`), nie na našej vlastnej aritmetike (vrátane .xx5
// hraníc, aby test odlíšil celocentový half-up od naivného FP driftu). Product-aware dispatch test je
// NETAUTOLOGICKÝ (vzor #388/#389): dokazuje, že cfg zimnej záhrady dostane cenu zimnej záhrady,
// pergolotvarová cfg bez systemKod pod „zimna-zahrada" NEDOSTANE cenu (honest-degrade), a tá istá cfg
// pod „pergola" cenu DOSTANE (gate nie je no-op). #429: systém stien je TERAZ 4. cenotvorná os
// (`cennik[glazing][roofing][hĺbka][šírka]`) — default (chýbajúci `systemStien`) je non-breaking
// (byte-identický s #408 pôvodnou bázou Slide 16mm).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import cennik from '../src/lib/server/cennik-zimna-zahrada.json';
import {
	vypocitajCenuZz,
	cenaPreZz,
	zaokruhliNahor,
	roofingPreZasklenie,
	glazingPreSystemStien,
	DPH_ZZ,
	CENNIK_VERZIA_ZZ
} from '../src/lib/server/konfigurator-zimna-zahrada-cena';
import { cenaZCfgProdukt, opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { parseZzCenaVstup } from '../src/lib/server/konfigurator-zimna-zahrada-vstup';
import { maCenovyZdroj } from '../src/lib/konfigurator-produkty';
import {
	ZZ_ZASKLENIA,
	ZZ_SYSTEMY_STIEN,
	ZZ_SYSTEM_STIEN_DEFAULT,
	zzSystemKod
} from '../src/lib/konfigurator-zimna-zahrada';

/** montalu reťazec „5 234,98" → 5234.98 (medzery = tisícky, čiarka = desatinná). */
const parseCena = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// --------------------------------------------------------------------------- //
// DPH half-up parita voči montalu.sk — nezávislá kotva (montalu vlastné reťazce s DPH; .xx5 hranice)
// --------------------------------------------------------------------------- //
describe('DPH half-up parita voči montalu.sk (verifikaciaDph)', () => {
	it('seed má aspoň jednu .xx5 hraničnú kotvu (inak test nerozlíši half-up od naivného FP)', () => {
		const hranicna = cennik.verifikaciaDph.some(
			(v) => (Math.round(v.moNet * 100) * 23) % 100 === 50
		);
		expect(hranicna).toBe(true);
	});
	for (const v of cennik.verifikaciaDph) {
		it(`${v.glazing} / ${v.roofing} ${v.hlbkaM}×${v.sirkaM} m: MO net ${v.moNet} → ${v.moDph}; VO net ${v.voNet} → ${v.voDph}`, () => {
			// nájdi zasklenie/systém stien nazov, ktorý mapuje na tento roofing/glazing (na vstup do modulu)
			const zasklenie = ZZ_ZASKLENIA.find((z) => roofingPreZasklenie(z.nazov) === v.roofing)?.nazov;
			const systemStien = ZZ_SYSTEMY_STIEN.find(
				(s) => glazingPreSystemStien(s.nazov) === v.glazing
			)?.nazov;
			expect(zasklenie).toBeTruthy();
			expect(systemStien).toBeTruthy();
			const r = vypocitajCenuZz({
				hlbkaMm: v.hlbkaM * 1000,
				sirkaMm: v.sirkaM * 1000,
				zasklenie,
				systemStien
			});
			expect(r.druh).toBe('cena');
			if (r.druh === 'cena') {
				expect(r.mo.bezDph).toBe(v.moNet);
				expect(r.mo.sDph).toBe(parseCena(v.moDph));
				expect(r.vo.bezDph).toBe(v.voNet);
				expect(r.vo.sDph).toBe(parseCena(v.voDph));
			}
		});
	}
});

// --------------------------------------------------------------------------- //
// Grid lookup + honest-null (nevymýšľa cenu mimo katalógu)
// --------------------------------------------------------------------------- //
describe('grid lookup + honest-null', () => {
	it('bunka v matici vráti seed hodnotu (MO/VO net) + grid rozmery — default systemStien = báza', () => {
		const r = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			// literálny kľúč (nie premenná) — strict index JSON typu (noUncheckedIndexedAccess)
			expect([r.mo.bezDph, r.vo.bezDph]).toEqual(
				cennik.cennik['slide|izolacne-sklo-16-mm']!['izolacne-sklo-24-mm']!['4.0']!['3.0']
			);
			expect(r.hlbkaGridM).toBe(4);
			expect(r.sirkaGridM).toBe(3);
		}
	});

	it('nad katalóg (hĺbka > 6 m) → individuálna ponuka (NEEXTRAPOLUJE)', () => {
		expect(vypocitajCenuZz({ hlbkaMm: 6500, sirkaMm: 3000 }).druh).toBe('individualna-ponuka');
	});

	it('nad katalóg (šírka > 7,5 m) → individuálna ponuka (NEEXTRAPOLUJE)', () => {
		expect(vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 8000 }).druh).toBe('individualna-ponuka');
	});

	it('neplatný rozmer (0) → individuálna ponuka (neprilepí sa na katalógové minimum)', () => {
		expect(vypocitajCenuZz({ hlbkaMm: 0, sirkaMm: 3000 }).druh).toBe('individualna-ponuka');
	});

	it('rozmer sa zaokrúhli NAHOR na mriežku (hĺbka 4100 mm → 4,5 m, montalu „najbližší väčší")', () => {
		const r = vypocitajCenuZz({ hlbkaMm: 4100, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		const ref = vypocitajCenuZz({ hlbkaMm: 4500, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		expect(r).toEqual(ref);
	});

	it('neznáme zasklenie → bázový roofing (Izolačné sklo) — honest-degrade', () => {
		const r = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'čosi neznáme' });
		const ref = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		expect(r).toEqual(ref);
	});
});

// --------------------------------------------------------------------------- //
// #429 systém stien — TERAZ cenotvorná os. Chýbajúci/default vstup = byte-identický s #408 pôvodnou
// bázou (non-breaking); rôzny systém stien = rôzna (nie rovnaká) cena; neznámy → honest-degrade.
// --------------------------------------------------------------------------- //
describe('#429 systém stien — cenotvorná os', () => {
	it('vynechaný systemStien = byte-identický s explicitnou bázou „Slide - 16mm sklo" (non-breaking default)', () => {
		const bezVstupu = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		const sBazou = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
		expect(bezVstupu).toEqual(sBazou);
	});

	it('iný systém stien pri rovnakých rozmeroch+zasklení dá INÚ cenu (os REÁLNE cenotvorná, ±desiatky-tisíce €)', () => {
		const bazova = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: 'Slide - 16mm sklo'
		});
		const robust = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: 'Robust - 24mm IZO sklo'
		});
		expect(bazova.druh).toBe('cena');
		expect(robust.druh).toBe('cena');
		if (bazova.druh === 'cena' && robust.druh === 'cena') {
			expect(robust.mo.bezDph).not.toBe(bazova.mo.bezDph);
		}
	});

	it('neznámy systém stien → bázový glazing (Slide 16mm) — honest-degrade', () => {
		const r = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: 'čosi neznáme'
		});
		const ref = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
		expect(r).toEqual(ref);
	});
});

describe('zaokruhliNahor (montalu „najbližší väčší rozmer")', () => {
	const m = { min: 2, max: 6, krok: 0.5 };
	it('pod minimum → minimum', () => expect(zaokruhliNahor(1.5, m)).toBe(2));
	it('na mriežke ostáva (4,0 → 4,0)', () => expect(zaokruhliNahor(4.0, m)).toBe(4));
	it('nahor (4,2 → 4,5)', () => expect(zaokruhliNahor(4.2, m)).toBe(4.5));
	it('nahor (4,6 → 5,0)', () => expect(zaokruhliNahor(4.6, m)).toBe(5));
	it('nad maximum → null', () => expect(zaokruhliNahor(6.5, m)).toBe(null));
});

// --------------------------------------------------------------------------- //
// roofing mapping drift guard — KAŽDÝ ZZ_ZASKLENIA nazov musí mať záznam v matici (inak lookup padne)
// --------------------------------------------------------------------------- //
describe('roofing mapping (zasklenie → matica)', () => {
	it('KAŽDÝ ZZ_ZASKLENIA nazov mapuje na roofing prítomný v seede (pri báze systému stien)', () => {
		for (const z of ZZ_ZASKLENIA) {
			const roofing = roofingPreZasklenie(z.nazov);
			// #429: roofing je TERAZ pod glazing blokom — over v BÁZOVOM (default) glazing bloku
			const bazaGlazing = glazingPreSystemStien(ZZ_SYSTEM_STIEN_DEFAULT);
			const cennikMap = cennik.cennik as unknown as Record<string, Record<string, unknown>>;
			expect(Object.keys(cennikMap[bazaGlazing]!), z.nazov).toContain(roofing);
			// a reálne vráti cenu pre bežný rozmer (nie individuálna)
			expect(vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: z.nazov }).druh).toBe(
				'cena'
			);
		}
	});
});

// --------------------------------------------------------------------------- //
// #429 systém stien mapping drift guard — KAŽDÝ ZZ_SYSTEMY_STIEN nazov musí mať záznam v matici
// --------------------------------------------------------------------------- //
describe('#429 systém stien mapping (systém stien → matica)', () => {
	it('KAŽDÝ ZZ_SYSTEMY_STIEN nazov mapuje na glazing prítomný v seede', () => {
		for (const s of ZZ_SYSTEMY_STIEN) {
			const glazing = glazingPreSystemStien(s.nazov);
			expect(Object.keys(cennik.cennik), s.nazov).toContain(glazing);
			// a reálne vráti cenu pre bežný rozmer (nie individuálna)
			expect(vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, systemStien: s.nazov }).druh).toBe(
				'cena'
			);
		}
	});
});

// --------------------------------------------------------------------------- //
// Hladina (MO/VO) — VO sa NIKDY nedostane do MO odpovede (#318 parita)
// --------------------------------------------------------------------------- //
describe('hladina MO/VO', () => {
	it('MO odpoveď nenesie hladinu; VO nesie hladinu VO a je NIŽŠIA než MO', () => {
		const mo = cenaPreZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' }, 'MO');
		const vo = cenaPreZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' }, 'VO');
		expect('hladina' in mo).toBe(false);
		expect(mo.druh).toBe('cena');
		expect(vo.druh).toBe('cena');
		if (mo.druh === 'cena' && vo.druh === 'cena') {
			expect(vo.hladina).toBe('VO');
			expect(vo.bezDph).toBeLessThan(mo.bezDph);
		}
	});

	it('mimo katalógu + VO → individuálna ponuka nesie model + hladinu VO + label (naCenuZz VO vetva)', () => {
		const c = cenaPreZz({ hlbkaMm: 4000, sirkaMm: 8000, model: 'MASSIVE' }, 'VO');
		expect(c.druh).toBe('individualna-ponuka');
		expect(c.model).toBe('MASSIVE');
		if (c.druh === 'individualna-ponuka') {
			expect(c.hladina).toBe('VO');
			expect(c.hladinaLabel).toBeTruthy();
			expect(c.dovod).toMatch(/individuálna/i);
		}
	});
});

// --------------------------------------------------------------------------- //
// Parser vstupu (`vypocet` akcia) — rozmery mimo rozmedzia → error; whitelist zasklenia/modelu
// --------------------------------------------------------------------------- //
describe('parseZzCenaVstup', () => {
	function fd(o: Record<string, string>): FormData {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.append(k, v);
		return f;
	}

	it('platný vstup (mm, medzery v čísle sa ignorujú) → typovaný ZzCenaVstup', () => {
		// parser berie MM (skryté inputy stránky POSTujú mm); „4 000" = 4000 mm (medzery = oddeľovač tisícok)
		const r = parseZzCenaVstup(
			fd({
				hlbka: '4 000',
				sirka: '3000',
				zasklenie: 'Polykarbonát',
				systemStien: 'Robust - 24mm IZO sklo',
				model: 'MASSIVE'
			})
		);
		expect('vstup' in r).toBe(true);
		if ('vstup' in r) {
			expect(r.vstup.hlbkaMm).toBe(4000);
			expect(r.vstup.sirkaMm).toBe(3000);
			expect(r.vstup.zasklenie).toBe('Polykarbonát');
			expect(r.vstup.systemStien).toBe('Robust - 24mm IZO sklo');
			expect(r.vstup.model).toBe('MASSIVE');
		}
	});

	it('hĺbka mimo rozmedzia → error', () => {
		expect('error' in parseZzCenaVstup(fd({ hlbka: '1000', sirka: '3000' }))).toBe(true);
		expect('error' in parseZzCenaVstup(fd({ hlbka: '9000', sirka: '3000' }))).toBe(true);
	});

	it('šírka mimo rozmedzia → error', () => {
		expect('error' in parseZzCenaVstup(fd({ hlbka: '4000', sirka: '1000' }))).toBe(true);
		expect('error' in parseZzCenaVstup(fd({ hlbka: '4000', sirka: '9000' }))).toBe(true);
	});

	it('nečíselný rozmer → error', () => {
		expect('error' in parseZzCenaVstup(fd({ hlbka: 'abc', sirka: '3000' }))).toBe(true);
	});

	it('neznáme zasklenie/systém stien/model → whitelist default (Izolačné sklo / Slide 16mm / ROBUST)', () => {
		const r = parseZzCenaVstup(
			fd({ hlbka: '4000', sirka: '3000', zasklenie: 'xxx', systemStien: 'xxx', model: 'yyy' })
		);
		expect('vstup' in r).toBe(true);
		if ('vstup' in r) {
			expect(r.vstup.zasklenie).toBe('Izolačné sklo');
			expect(r.vstup.systemStien).toBe(ZZ_SYSTEM_STIEN_DEFAULT);
			expect(r.vstup.model).toBe('ROBUST');
		}
	});
});

// --------------------------------------------------------------------------- //
// Product-aware dispatch (#408) — NETAUTOLOGICKÝ gate test (vzor #388/#389)
// --------------------------------------------------------------------------- //
describe('produkt-aware dispatch (dopyt-cena-stamp)', () => {
	// #429: systemKod je TERAZ kompozitný "model|systémStien" (`zzSystemKod`, vzor #410 oplotenie).
	const zzCfg = {
		systemKod: zzSystemKod('ROBUST', 'Robust - 24mm IZO sklo'),
		hlbka: 4000,
		sirka: 3000,
		sklo: 'Izolačné sklo'
	};

	it('cfg zimnej záhrady pod „zimna-zahrada" → cena zimnej záhrady (zhoda s modulom, systém stien z kompozitného systemKod)', () => {
		const c = cenaZCfgProdukt(zzCfg, 'zimna-zahrada');
		const ref = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: 'Robust - 24mm IZO sklo'
		});
		expect(c?.druh).toBe('cena');
		if (c?.druh === 'cena' && ref.druh === 'cena') expect(c.bezDph).toBe(ref.mo.bezDph);
	});

	it('maCenovyZdroj(„zimna-zahrada") === true (#408 odblokoval cenu)', () => {
		expect(maCenovyZdroj('zimna-zahrada')).toBe(true);
	});

	it('opeciatkujCenuPreProdukt(zimna-zahrada) → cena + verzia cenníka zimnej záhrady', () => {
		const stamp = opeciatkujCenuPreProdukt(zzCfg, 'zimna-zahrada');
		expect(stamp.cena?.druh).toBe('cena');
		expect(stamp.cennikVerzia).toBe(CENNIK_VERZIA_ZZ);
	});

	it('zimná záhrada bez systemKod (starý neopečiatkovaný riadok) → honest-null (žiadna default cena)', () => {
		expect(
			cenaZCfgProdukt({ hlbka: 4000, sirka: 3000, sklo: 'Izolačné sklo' }, 'zimna-zahrada')
		).toBeNull();
	});

	it('pergolotvarová cfg (hlbka+model, bez systemKod) pod „zimna-zahrada" → null (nedostane cenu)', () => {
		expect(
			cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'zimna-zahrada')
		).toBeNull();
	});

	it('TÁ ISTÁ pergolotvarová cfg pod „pergola" DOSTANE cenu (gate nie je no-op)', () => {
		const c = cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'pergola');
		expect(c?.druh).toBe('cena');
	});

	// #429: spätná kompatibilita — STARÝ riadok (spred #429, systemKod = LEN model, žiadny „|")
	// dostane cenu pri BÁZOVOM systéme stien (presne to, čo bolo v čase podania jediné cenené).
	it('STARÝ (pred-#429) riadok systemKod="ROBUST" (bez „|") → cena pri báze Slide 16mm, nie honest-null', () => {
		const staryCfg = { systemKod: 'ROBUST', hlbka: 4000, sirka: 3000, sklo: 'Izolačné sklo' };
		const c = cenaZCfgProdukt(staryCfg, 'zimna-zahrada');
		const ref = vypocitajCenuZz({
			hlbkaMm: 4000,
			sirkaMm: 3000,
			zasklenie: 'Izolačné sklo',
			systemStien: ZZ_SYSTEM_STIEN_DEFAULT
		});
		expect(c?.druh).toBe('cena');
		if (c?.druh === 'cena' && ref.druh === 'cena') expect(c.bezDph).toBe(ref.mo.bezDph);
	});
});

// --------------------------------------------------------------------------- //
// Plná parita: KAŽDÁ bunka seedu → modul vráti presne tú istú MO/VO net. Dokazuje, že modul číta CELÚ
// maticu bez posunu kľúčov/zaokrúhlenia na mriežkových bodoch.
// --------------------------------------------------------------------------- //
describe('plná parita matice (každá bunka seedu)', () => {
	it('vypocitajCenuZz vráti seed MO/VO net pre KAŽDÚ bunku (glazing × roofing × hĺbka × šírka)', () => {
		const matica = cennik.cennik as unknown as Record<
			string,
			Record<string, Record<string, Record<string, number[]>>>
		>;
		// roofing slug → zasklenie nazov, glazing slug → systém stien nazov (na vstup do modulu)
		const nazovPreRoofing = new Map<string, string>();
		for (const z of ZZ_ZASKLENIA) nazovPreRoofing.set(roofingPreZasklenie(z.nazov), z.nazov);
		const nazovPreGlazing = new Map<string, string>();
		for (const s of ZZ_SYSTEMY_STIEN) nazovPreGlazing.set(glazingPreSystemStien(s.nazov), s.nazov);
		let buniek = 0;
		for (const [glazing, roofingBlok] of Object.entries(matica)) {
			const systemStien = nazovPreGlazing.get(glazing);
			expect(systemStien, glazing).toBeTruthy();
			for (const [roofing, hlbky] of Object.entries(roofingBlok)) {
				const zasklenie = nazovPreRoofing.get(roofing);
				expect(zasklenie, roofing).toBeTruthy();
				for (const [dK, riadok] of Object.entries(hlbky)) {
					for (const [wK, par] of Object.entries(riadok)) {
						const r = vypocitajCenuZz({
							hlbkaMm: Number(dK) * 1000,
							sirkaMm: Number(wK) * 1000,
							zasklenie,
							systemStien
						});
						expect(r.druh, `${glazing} / ${roofing} ${dK}×${wK}`).toBe('cena');
						if (r.druh === 'cena') {
							expect([r.mo.bezDph, r.vo.bezDph], `${glazing} / ${roofing} ${dK}×${wK}`).toEqual(
								par
							);
							expect(r.vo.bezDph).toBeLessThan(r.mo.bezDph); // VO vždy < MO
						}
						buniek++;
					}
				}
			}
		}
		// sanity: matica nie je prázdna (6 glazing × 4 roofing × 9 hĺbka × 12 šírka = 2592)
		expect(buniek).toBeGreaterThan(2500);
	});
});

// --------------------------------------------------------------------------- //
// Money-neutralita seedu + modulu: žiadny Money ERP kód (Money kód / BPK*/BPP* odpisové kódy — montalu
// roofing slugy nie sú Money kódy), žiadny import katalógu skla / Money zapisovača / DB.
// --------------------------------------------------------------------------- //
describe('seed + modul sú Money-neutrálne (#408)', () => {
	it('seed + modul neobsahujú Money kód ani BPK*/BPP* odpisové kódy, modul neimportuje Money/DB/katalóg', () => {
		const seedTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/cennik-zimna-zahrada.json'),
			'utf8'
		);
		const modulTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/konfigurator-zimna-zahrada-cena.ts'),
			'utf8'
		);
		const vstupTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/konfigurator-zimna-zahrada-vstup.ts'),
			'utf8'
		);
		const zakazane = /moneyKod|\bBP[KP]\d{5}\b|\bTS\d{3,}|\bPRP\d{3,}|\bZAS[PK]\d{4,}\b/;
		expect(seedTxt).not.toMatch(zakazane);
		expect(modulTxt).not.toMatch(zakazane);
		expect(vstupTxt).not.toMatch(zakazane);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/money['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/db['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*sklo-strecha['"]/);
	});
});

describe('metadáta cenníka', () => {
	it('DPH je 0,23', () => expect(DPH_ZZ).toBe(0.23));
	it('CENNIK_VERZIA_ZZ má tvar <iso>#<12hex>', () =>
		expect(CENNIK_VERZIA_ZZ).toMatch(/^.+#[0-9a-f]{12}$/));
});
