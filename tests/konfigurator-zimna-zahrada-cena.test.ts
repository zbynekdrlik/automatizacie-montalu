// Interim cenotvorba zimných záhrad (#408) — parity + jednotkové testy cenového modulu.
// DPH parita je kotvená NEZÁVISLE na montalu.sk vlastných zaokrúhlených reťazcoch s DPH
// (`verifikaciaDph` v seede — montalu PHP `round()`), nie na našej vlastnej aritmetike (vrátane .xx5
// hraníc, aby test odlíšil celocentový half-up od naivného FP driftu). Product-aware dispatch test je
// NETAUTOLOGICKÝ (vzor #388/#389): dokazuje, že cfg zimnej záhrady dostane cenu zimnej záhrady,
// pergolotvarová cfg bez systemKod pod „zimna-zahrada" NEDOSTANE cenu (honest-degrade), a tá istá cfg
// pod „pergola" cenu DOSTANE (gate nie je no-op).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import cennik from '../src/lib/server/cennik-zimna-zahrada.json';
import {
	vypocitajCenuZz,
	cenaPreZz,
	zaokruhliNahor,
	roofingPreZasklenie,
	DPH_ZZ,
	CENNIK_VERZIA_ZZ
} from '../src/lib/server/konfigurator-zimna-zahrada-cena';
import { cenaZCfgProdukt, opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import { maCenovyZdroj } from '../src/lib/konfigurator-produkty';
import { ZZ_ZASKLENIA } from '../src/lib/konfigurator-zimna-zahrada';

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
		it(`${v.roofing} ${v.hlbkaM}×${v.sirkaM} m: MO net ${v.moNet} → ${v.moDph}; VO net ${v.voNet} → ${v.voDph}`, () => {
			// nájdi zasklenie nazov, ktorý mapuje na tento roofing (na vstup do modulu)
			const zasklenie = ZZ_ZASKLENIA.find((z) => roofingPreZasklenie(z.nazov) === v.roofing)?.nazov;
			expect(zasklenie).toBeTruthy();
			const r = vypocitajCenuZz({
				hlbkaMm: v.hlbkaM * 1000,
				sirkaMm: v.sirkaM * 1000,
				zasklenie
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
	it('bunka v matici vráti seed hodnotu (MO/VO net) + grid rozmery', () => {
		const r = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			// literálny kľúč (nie premenná) — strict index JSON typu (noUncheckedIndexedAccess)
			expect([r.mo.bezDph, r.vo.bezDph]).toEqual(
				cennik.cennik['izolacne-sklo-24-mm']!['4.0']!['3.0']
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
	it('KAŽDÝ ZZ_ZASKLENIA nazov mapuje na roofing prítomný v seede', () => {
		for (const z of ZZ_ZASKLENIA) {
			const roofing = roofingPreZasklenie(z.nazov);
			expect(Object.keys(cennik.cennik), z.nazov).toContain(roofing);
			// a reálne vráti cenu pre bežný rozmer (nie individuálna)
			expect(vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: z.nazov }).druh).toBe(
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
});

// --------------------------------------------------------------------------- //
// Product-aware dispatch (#408) — NETAUTOLOGICKÝ gate test (vzor #388/#389)
// --------------------------------------------------------------------------- //
describe('produkt-aware dispatch (dopyt-cena-stamp)', () => {
	const zzCfg = { systemKod: 'ROBUST', hlbka: 4000, sirka: 3000, sklo: 'Izolačné sklo' };

	it('cfg zimnej záhrady pod „zimna-zahrada" → cena zimnej záhrady (zhoda s modulom)', () => {
		const c = cenaZCfgProdukt(zzCfg, 'zimna-zahrada');
		const ref = vypocitajCenuZz({ hlbkaMm: 4000, sirkaMm: 3000, zasklenie: 'Izolačné sklo' });
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
});

// --------------------------------------------------------------------------- //
// Plná parita: KAŽDÁ bunka seedu → modul vráti presne tú istú MO/VO net. Dokazuje, že modul číta CELÚ
// maticu bez posunu kľúčov/zaokrúhlenia na mriežkových bodoch.
// --------------------------------------------------------------------------- //
describe('plná parita matice (každá bunka seedu)', () => {
	it('vypocitajCenuZz vráti seed MO/VO net pre KAŽDÚ bunku', () => {
		const matica = cennik.cennik as unknown as Record<
			string,
			Record<string, Record<string, number[]>>
		>;
		// roofing slug → zasklenie nazov (na vstup do modulu)
		const nazovPreRoofing = new Map<string, string>();
		for (const z of ZZ_ZASKLENIA) nazovPreRoofing.set(roofingPreZasklenie(z.nazov), z.nazov);
		let buniek = 0;
		for (const [roofing, hlbky] of Object.entries(matica)) {
			const zasklenie = nazovPreRoofing.get(roofing);
			expect(zasklenie, roofing).toBeTruthy();
			for (const [dK, riadok] of Object.entries(hlbky)) {
				for (const [wK, par] of Object.entries(riadok)) {
					const r = vypocitajCenuZz({
						hlbkaMm: Number(dK) * 1000,
						sirkaMm: Number(wK) * 1000,
						zasklenie
					});
					expect(r.druh, `${roofing} ${dK}×${wK}`).toBe('cena');
					if (r.druh === 'cena') {
						expect([r.mo.bezDph, r.vo.bezDph], `${roofing} ${dK}×${wK}`).toEqual(par);
						expect(r.vo.bezDph).toBeLessThan(r.mo.bezDph); // VO vždy < MO
					}
					buniek++;
				}
			}
		}
		expect(buniek).toBeGreaterThan(400); // sanity: matica nie je prázdna (4×9×12 = 432)
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
