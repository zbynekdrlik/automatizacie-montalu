// Interim cenotvorba hliníkového oplotenia a brán (#410) — parity + jednotkové testy cenového modulu.
// DPH parita je kotvená NEZÁVISLE na montalu.sk vlastných zaokrúhlených reťazcoch s DPH
// (`verifikaciaDph` v seede — montalu PHP `round()`, vrátane half-up hranice), nie na našej vlastnej
// aritmetike. Product-aware dispatch test je NETAUTOLOGICKÝ (vzor #404/#388): reálna oplotenie cfg
// (systemKod) dostane cenu, cfg bez systemKod pod „oplotenie" NEDOSTANE, a tá istá pergolotvarová cfg
// pod „pergola" cenu DOSTANE.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import cennik from '../src/lib/server/cennik-oplotenie.json';
import {
	vypocitajCenuOplotenie,
	cenaPreModelOplotenie,
	cenyModelovOplotenie,
	cenaOplotenieZCfg,
	zaokruhliNaMriezku,
	DPH_OPLOTENIE,
	CENNIK_VERZIA_OPLOTENIE,
	OPLOTENIE_CENOVE_MODELY
} from '../src/lib/server/konfigurator-oplotenie-cena';
import { cenaZCfgProdukt, opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { parseOplotenieCenaVstup } from '../src/lib/server/konfigurator-oplotenie-vstup';
import type { OplotenieTypKod, OplotenieModel } from '../src/lib/konfigurator-oplotenie';

/** malý FormData helper (typ/model/vyska/sirka/pocet). */
function fd(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.append(k, v);
	return f;
}

/** montalu reťazec „4 931,69" → 4931.69 (medzery = tisícky, čiarka = desatinná). */
const parseCena = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// --------------------------------------------------------------------------- //
// DPH half-up parita voči montalu.sk — nezávislá kotva (montalu vlastné reťazce s DPH, vrátane hranice)
// --------------------------------------------------------------------------- //
describe('DPH half-up parita voči montalu.sk (verifikaciaDph)', () => {
	it('verifikaciaDph obsahuje aspoň jednu half-up HRANICU (naivné net*1.23 by driftlo)', () => {
		const naive = (net: number) => Math.round(net * 1.23 * 100) / 100;
		const exact = (net: number) => Math.round((Math.round(net * 100) * 123) / 100) / 100;
		const maHranicu = cennik.verifikaciaDph.some(
			(v) => naive(v.moNet) !== exact(v.moNet) || naive(v.voNet) !== exact(v.voNet)
		);
		expect(
			maHranicu,
			'seed musí niesť aspoň jednu .xx5 DPH hranicu (inak test nerozlíši half-up)'
		).toBe(true);
	});

	for (const v of cennik.verifikaciaDph) {
		it(`${v.typ}/${v.model} ${v.vyskaM}×${v.sirkaM} m: MO net ${v.moNet} → ${v.moDph}; VO net ${v.voNet} → ${v.voDph}`, () => {
			const r = vypocitajCenuOplotenie({
				typ: v.typ as OplotenieTypKod,
				model: v.model as OplotenieModel,
				vyskaMm: v.vyskaM * 1000,
				sirkaMm: v.sirkaM * 1000,
				pocet: 1
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
// Grid lookup + honest-null (nevymýšľa cenu mimo katalógu / na mieru)
// --------------------------------------------------------------------------- //
describe('grid lookup + honest-null', () => {
	it('bunka v matici vráti seed hodnotu (MO/VO net za 1 kus) + grid rozmery', () => {
		const r = vypocitajCenuOplotenie({
			typ: 'posuvna',
			model: 'REA',
			vyskaMm: 1600,
			sirkaMm: 4000,
			pocet: 1
		});
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect([r.mo.bezDph, r.vo.bezDph]).toEqual(cennik.cennik.posuvna!.REA!['1.6']!['4.0']);
			expect(r.vyskaGridM).toBe(1.6);
			expect(r.sirkaGridM).toBe(4);
		}
	});

	it('počet ks je LINEÁRNY (cena za 3 ks = 3× cena za 1 ks)', () => {
		const jeden = vypocitajCenuOplotenie({
			typ: 'posuvna',
			model: 'REA',
			vyskaMm: 1600,
			sirkaMm: 4000,
			pocet: 1
		});
		const tri = vypocitajCenuOplotenie({
			typ: 'posuvna',
			model: 'REA',
			vyskaMm: 1600,
			sirkaMm: 4000,
			pocet: 3
		});
		expect(jeden.druh).toBe('cena');
		expect(tri.druh).toBe('cena');
		if (jeden.druh === 'cena' && tri.druh === 'cena') {
			expect(tri.mo.bezDph).toBe(Math.round(jeden.mo.bezDph * 3 * 100) / 100);
			expect(tri.pocet).toBe(3);
		}
	});

	// #410 review 🔵: DPH pri počte > 1 = VAT z CELKOVÉHO netto (nie sčítanie per-kus VAT). Netautologická
	// REAL montalu kotva: posuvna/REA 1,6×4,0 × 3 ks → montalu MO „11 222,32" (VAT z celku 9123,84×1,23),
	// pričom per-kus VAT (3740,77 × 3 = 11 222,31) by driftol o 1 cent — takže count>1 rozlíšenie MATTERuje.
	it('DPH pri počte > 1 = VAT z CELKU (real montalu kotva posuvna/REA 1,6×4,0 × 3 ks)', () => {
		const r = vypocitajCenuOplotenie({
			typ: 'posuvna',
			model: 'REA',
			vyskaMm: 1600,
			sirkaMm: 4000,
			pocet: 3
		});
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect(r.mo.bezDph).toBe(9123.84);
			expect(r.mo.sDph).toBe(11222.32); // montalu priceWithVat pri count=3
			expect(r.vo.bezDph).toBe(5016);
			expect(r.vo.sDph).toBe(6169.68); // montalu priceB2BWithVat pri count=3
			// per-kus VAT sčítaná (3740,77 × 3 = 11 222,31) by NEsedela → VAT ide z CELKU (netautologické)
			const perKusVat = Math.round((Math.round(3041.28 * 100) * 123) / 100) / 100;
			expect(perKusVat * 3).not.toBe(r.mo.sDph);
		}
	});

	it('model ATYP (na mieru) → individuálna ponuka (žiadna montalu cena)', () => {
		expect(
			vypocitajCenuOplotenie({ typ: 'diel', model: 'ATYP', vyskaMm: 1600, sirkaMm: 2000, pocet: 1 })
				.druh
		).toBe('individualna-ponuka');
	});

	it('mimo obálky typu (plotový diel, šírka 5,0 m — diel má šírky len do 3,5 m) → individuálna ponuka', () => {
		expect(
			vypocitajCenuOplotenie({ typ: 'diel', model: 'REA', vyskaMm: 1600, sirkaMm: 5000, pocet: 1 })
				.druh
		).toBe('individualna-ponuka');
	});

	it('mimo obálky typu (bránka, šírka 3,0 m — bránka má šírky len do 1,5 m) → individuálna ponuka', () => {
		expect(
			vypocitajCenuOplotenie({
				typ: 'branka',
				model: 'REA',
				vyskaMm: 1600,
				sirkaMm: 3000,
				pocet: 1
			}).druh
		).toBe('individualna-ponuka');
	});

	it('nad katalóg (výška > 2,2 m) → individuálna ponuka (NEEXTRAPOLUJE)', () => {
		expect(
			vypocitajCenuOplotenie({
				typ: 'posuvna',
				model: 'REA',
				vyskaMm: 2500,
				sirkaMm: 4000,
				pocet: 1
			}).druh
		).toBe('individualna-ponuka');
	});

	it('neplatný rozmer (0) → individuálna ponuka (neprilepí sa na katalógové minimum)', () => {
		expect(
			vypocitajCenuOplotenie({ typ: 'posuvna', model: 'REA', vyskaMm: 0, sirkaMm: 4000, pocet: 1 })
				.druh
		).toBe('individualna-ponuka');
	});

	// #410 review 🟡: počet mimo rozmedzia / neceločíselný → individuálna (NIKDY ticho na 1)
	it('počet mimo rozmedzia (0 / veľký / neceločíselný) → individuálna ponuka', () => {
		const base = { typ: 'diel' as const, model: 'ARIEL' as const, vyskaMm: 1500, sirkaMm: 2000 };
		expect(vypocitajCenuOplotenie({ ...base, pocet: 0 }).druh).toBe('individualna-ponuka');
		expect(vypocitajCenuOplotenie({ ...base, pocet: 100000000 }).druh).toBe('individualna-ponuka');
		expect(vypocitajCenuOplotenie({ ...base, pocet: 2.6 }).druh).toBe('individualna-ponuka');
	});
});

describe('zaokruhliNaMriezku', () => {
	const mV = { min: 0.6, max: 2.2, krok: 0.1 };
	const mS = { min: 1.0, max: 6.0, krok: 0.5 };
	it('pod minimum → minimum', () => expect(zaokruhliNaMriezku(0.4, mV)).toBe(0.6));
	it('najbližší 0,1 (1,64 → 1,6)', () => expect(zaokruhliNaMriezku(1.64, mV)).toBe(1.6));
	it('najbližší 0,5 (4,2 → 4,0)', () => expect(zaokruhliNaMriezku(4.2, mS)).toBe(4));
	it('najbližší 0,5 (4,3 → 4,5)', () => expect(zaokruhliNaMriezku(4.3, mS)).toBe(4.5));
	it('nad maximum → null', () => expect(zaokruhliNaMriezku(2.5, mV)).toBe(null));
});

// --------------------------------------------------------------------------- //
// Hladina (MO/VO) — VO sa NIKDY nedostane do MO odpovede (#318 parita)
// --------------------------------------------------------------------------- //
describe('hladina MO/VO', () => {
	it('MO odpoveď nenesie hladinu; VO nesie hladinu VO a je NIŽŠIA než MO', () => {
		const vst = {
			typ: 'posuvna' as const,
			model: 'REA' as const,
			vyskaMm: 1600,
			sirkaMm: 4000,
			pocet: 1
		};
		const mo = cenaPreModelOplotenie(vst, 'MO');
		const vo = cenaPreModelOplotenie(vst, 'VO');
		expect('hladina' in mo).toBe(false);
		expect(mo.druh).toBe('cena');
		expect(vo.druh).toBe('cena');
		if (mo.druh === 'cena' && vo.druh === 'cena') {
			expect(vo.hladina).toBe('VO');
			expect(vo.bezDph).toBeLessThan(mo.bezDph);
		}
	});

	it('cenyModelovOplotenie vráti presne 6 cenových modelov (ARIEL…REA, bez ATYP)', () => {
		const cm = cenyModelovOplotenie('posuvna', 1600, 4000, 1, 'MO');
		expect(cm.map((c) => c.model).sort()).toEqual([...OPLOTENIE_CENOVE_MODELY].sort());
		expect(cm.map((c) => c.model)).not.toContain('ATYP');
	});
});

// --------------------------------------------------------------------------- //
// Product-aware dispatch (#410) — NETAUTOLOGICKÝ gate test (vzor #404/#388)
// --------------------------------------------------------------------------- //
describe('produkt-aware dispatch (dopyt-cena-stamp)', () => {
	// reálna oplotenie cfg: systemKod = "typKod|model|vyskaMm|pocet" + sirka (šírka mm)
	const oplotenieCfg = { systemKod: 'posuvna|PANDORA|1800|1', sirka: 4000 };

	it('oplotenie cfg pod „oplotenie" → OPLOTENIE cena (zhoda s modulom)', () => {
		const c = cenaZCfgProdukt(oplotenieCfg, 'oplotenie');
		const ref = vypocitajCenuOplotenie({
			typ: 'posuvna',
			model: 'PANDORA',
			vyskaMm: 1800,
			sirkaMm: 4000,
			pocet: 1
		});
		expect(c?.druh).toBe('cena');
		if (c?.druh === 'cena' && ref.druh === 'cena') expect(c.bezDph).toBe(ref.mo.bezDph);
	});

	it('cenaOplotenieZCfg číta počet zo systemKod (2 ks = 2× cena za 1 ks)', () => {
		const jeden = cenaOplotenieZCfg({ systemKod: 'posuvna|REA|1600|1', sirka: 4000 });
		const dva = cenaOplotenieZCfg({ systemKod: 'posuvna|REA|1600|2', sirka: 4000 });
		expect(jeden?.druh).toBe('cena');
		expect(dva?.druh).toBe('cena');
		if (jeden?.druh === 'cena' && dva?.druh === 'cena')
			expect(dva.bezDph).toBe(Math.round(jeden.bezDph * 2 * 100) / 100);
	});

	it('opeciatkujCenuPreProdukt(oplotenie) → cena + OPLOTENIE verzia cenníka', () => {
		const stamp = opeciatkujCenuPreProdukt(oplotenieCfg, 'oplotenie');
		expect(stamp.cena?.druh).toBe('cena');
		expect(stamp.cennikVerzia).toBe(CENNIK_VERZIA_OPLOTENIE);
	});

	it('oplotenie bez systemKod (starý neopečiatkovaný riadok) → honest-null (žiadna default cena)', () => {
		expect(cenaZCfgProdukt({ sirka: 4000 }, 'oplotenie')).toBeNull();
	});

	// #410 review 🟡: FORGOVATEĽNÝ počet v `systemKod` (klient ovláda POST `konfiguracia`) sa NIKDY
	// nesmie ticho naklampovať na 1 — inak by absurdný počet opečiatkoval nezmyselnú cenu do DB/PDF.
	it('forged veľký/nula/záporný/neceločíselný počet v systemKod → null (nikdy absurdná cena)', () => {
		expect(
			cenaZCfgProdukt({ systemKod: 'diel|ARIEL|1500|100000000', sirka: 2000 }, 'oplotenie')
		).toBeNull();
		expect(
			cenaZCfgProdukt({ systemKod: 'diel|ARIEL|1500|0', sirka: 2000 }, 'oplotenie')
		).toBeNull();
		expect(
			cenaZCfgProdukt({ systemKod: 'diel|ARIEL|1500|-5', sirka: 2000 }, 'oplotenie')
		).toBeNull();
		expect(
			cenaZCfgProdukt({ systemKod: 'diel|ARIEL|1500|2.6', sirka: 2000 }, 'oplotenie')
		).toBeNull();
		// KONTROLA: platný počet (max 40) DOSTANE cenu → gate nie je no-op
		expect(
			cenaZCfgProdukt({ systemKod: 'diel|ARIEL|1500|40', sirka: 2000 }, 'oplotenie')?.druh
		).toBe('cena');
	});

	it('pergolotvarová cfg (hlbka+model, bez systemKod) pod „oplotenie" → null (nedostane pergolovú cenu)', () => {
		expect(cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'oplotenie')).toBeNull();
	});

	it('TÁ ISTÁ pergolotvarová cfg pod „pergola" DOSTANE cenu (gate nie je no-op)', () => {
		const c = cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'pergola');
		expect(c?.druh).toBe('cena');
	});
});

// --------------------------------------------------------------------------- //
// Plná parita: KAŽDÁ bunka seedu → modul vráti presne tú istú MO/VO net za 1 kus (bazénový vzor).
// Dokazuje, že modul číta CELÚ maticu bez posunu kľúčov/zaokrúhlenia na mriežkových bodoch.
// --------------------------------------------------------------------------- //
describe('plná parita matice (každá bunka seedu)', () => {
	it('vypocitajCenuOplotenie vráti seed MO/VO net pre KAŽDÚ bunku', () => {
		// JSON bunky sa inferujú ako `number[]` (nie tuple) → cez `unknown` na jednotný tvar.
		const matica = cennik.cennik as unknown as Record<
			string,
			Record<string, Record<string, Record<string, number[]>>>
		>;
		let buniek = 0;
		for (const [typ, modely] of Object.entries(matica)) {
			for (const [model, vysky] of Object.entries(modely)) {
				for (const [hK, riadok] of Object.entries(vysky)) {
					for (const [wK, par] of Object.entries(riadok)) {
						const r = vypocitajCenuOplotenie({
							typ: typ as OplotenieTypKod,
							model: model as OplotenieModel,
							vyskaMm: Number(hK) * 1000,
							sirkaMm: Number(wK) * 1000,
							pocet: 1
						});
						expect(r.druh, `${typ}/${model} ${hK}×${wK}`).toBe('cena');
						if (r.druh === 'cena') {
							expect([r.mo.bezDph, r.vo.bezDph], `${typ}/${model} ${hK}×${wK}`).toEqual(par);
							expect(r.vo.bezDph).toBeLessThan(r.mo.bezDph); // VO vždy < MO
						}
						buniek++;
					}
				}
			}
		}
		expect(buniek).toBeGreaterThan(3000); // sanity: matica nie je prázdna
	});
});

// --------------------------------------------------------------------------- //
// Money-neutralita seedu + modulu (bazénový vzor): žiadny Money ERP kód (moneyKod / BPK*/BPP* odpisové
// kódy — montalu CENOVÉ kľúče modelov nie sú Money kódy), žiadny import katalógu skla / Money zapisovača
// / DB / bazénového odpisu.
// --------------------------------------------------------------------------- //
describe('seed + modul sú Money-neutrálne (#410)', () => {
	it('seed + modul neobsahujú moneyKod ani BPK*/BPP* odpisové kódy, modul neimportuje Money/DB/katalóg', () => {
		const seedTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/cennik-oplotenie.json'),
			'utf8'
		);
		const modulTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/konfigurator-oplotenie-cena.ts'),
			'utf8'
		);
		const vstupTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/konfigurator-oplotenie-vstup.ts'),
			'utf8'
		);
		const zakazane = /moneyKod|\bBP[KP]\d{5}\b|\bTS\d{3,}|\bPRP\d{3,}/;
		expect(seedTxt).not.toMatch(zakazane);
		expect(modulTxt).not.toMatch(zakazane);
		expect(vstupTxt).not.toMatch(zakazane);
		// modul neimportuje Money zapisovač / DB / katalóg skla / bazénový odpis
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/money['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/db['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*sklo-strecha['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/bazen['"]/);
	});
});

describe('metadáta cenníka', () => {
	it('DPH je 0,23', () => expect(DPH_OPLOTENIE).toBe(0.23));
	it('CENNIK_VERZIA_OPLOTENIE má tvar <iso>#<12hex>', () =>
		expect(CENNIK_VERZIA_OPLOTENIE).toMatch(/^.+#[0-9a-f]{12}$/));
});

// --------------------------------------------------------------------------- //
// Parser `vypocet` akcie — validácia rozmedzí + whitelist typu/modelu (vzor bazén)
// --------------------------------------------------------------------------- //
describe('parseOplotenieCenaVstup', () => {
	it('platný vstup → typovaný vstup (čiarka aj medzery v čísle znáša)', () => {
		const r = parseOplotenieCenaVstup(
			fd({ typ: 'posuvna', model: 'PANDORA', vyska: '1 800', sirka: '4000', pocet: '2' })
		);
		expect('vstup' in r).toBe(true);
		if ('vstup' in r)
			expect(r.vstup).toEqual({
				typ: 'posuvna',
				model: 'PANDORA',
				vyskaMm: 1800,
				sirkaMm: 4000,
				pocet: 2
			});
	});

	it('neznámy typ/model → bezpečný default (diel/ARIEL), nie chyba', () => {
		const r = parseOplotenieCenaVstup(
			fd({ typ: 'HACK', model: '<script>', vyska: '1500', sirka: '2000', pocet: '1' })
		);
		expect('vstup' in r).toBe(true);
		if ('vstup' in r) {
			expect(r.vstup.typ).toBe('diel');
			expect(r.vstup.model).toBe('ARIEL');
		}
	});

	it('výška/šírka mimo rozmedzia → error (slovenčina)', () => {
		expect(
			'error' in parseOplotenieCenaVstup(fd({ vyska: '100', sirka: '2000', pocet: '1' }))
		).toBe(true);
		expect(
			'error' in parseOplotenieCenaVstup(fd({ vyska: '1500', sirka: '999999', pocet: '1' }))
		).toBe(true);
	});

	it('počet mimo rozmedzia / neceločíselný → error', () => {
		expect(
			'error' in parseOplotenieCenaVstup(fd({ vyska: '1500', sirka: '2000', pocet: '0' }))
		).toBe(true);
		expect(
			'error' in parseOplotenieCenaVstup(fd({ vyska: '1500', sirka: '2000', pocet: '4.5' }))
		).toBe(true);
		expect(
			'error' in parseOplotenieCenaVstup(fd({ vyska: '1500', sirka: '2000', pocet: '999' }))
		).toBe(true);
	});
});
