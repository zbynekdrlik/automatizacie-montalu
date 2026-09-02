// Interim cenotvorba bazénových zastrešení (#404) — parity + jednotkové testy cenového modulu.
// DPH parita je kotvená NEZÁVISLE na montalu.sk vlastných zaokrúhlených reťazcoch s DPH
// (`verifikaciaDph` v seede — montalu PHP `round()`), nie na našej vlastnej aritmetike. Product-
// aware dispatch test je NETAUTOLOGICKÝ (vzor #388/#389): dokazuje, že bazénová cfg dostane bazénovú
// cenu, pergolotvarová cfg pod „bazen" NEDOSTANE cenu, a tá istá cfg pod „pergola" cenu DOSTANE.
import { describe, it, expect } from 'vitest';
import cennik from '../src/lib/server/cennik-bazen.json';
import {
	vypocitajCenuBazen,
	cenaPreModelBazen,
	cenyModelovBazen,
	zaokruhliNaMriezku,
	DPH_BAZEN,
	CENNIK_VERZIA_BAZEN
} from '../src/lib/server/konfigurator-bazen-cena';
import { cenaZCfgProdukt, opeciatkujCenuPreProdukt } from '../src/lib/server/dopyt-cena-stamp';
import type { BazenModel } from '../src/lib/konfigurator-bazen';

/** montalu reťazec „5 234,98" → 5234.98 (medzery = tisícky, čiarka = desatinná). */
const parseCena = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// --------------------------------------------------------------------------- //
// DPH half-up parita voči montalu.sk — nezávislá kotva (montalu vlastné reťazce s DPH)
// --------------------------------------------------------------------------- //
describe('DPH half-up parita voči montalu.sk (verifikaciaDph)', () => {
	for (const v of cennik.verifikaciaDph) {
		it(`${v.model} ${v.dlzkaM}×${v.sirkaM} m: MO net ${v.moNet} → ${v.moDph}; VO net ${v.voNet} → ${v.voDph}`, () => {
			const r = vypocitajCenuBazen({
				dlzkaMm: v.dlzkaM * 1000,
				sirkaMm: v.sirkaM * 1000,
				model: v.model as BazenModel
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
		const r = vypocitajCenuBazen({ dlzkaMm: 6000, sirkaMm: 4000, model: 'Premier' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect([r.mo.bezDph, r.vo.bezDph]).toEqual(cennik.cennik.Premier['6.0']!['4.0']);
			expect(r.dlzkaGridM).toBe(6);
			expect(r.sirkaGridM).toBe(4);
		}
	});

	it('mimo obálky modelu (Star, šírka 6,5 m — Star má šírky len do 4,5 m) → individuálna ponuka', () => {
		expect(vypocitajCenuBazen({ dlzkaMm: 6000, sirkaMm: 6500, model: 'Star' }).druh).toBe(
			'individualna-ponuka'
		);
	});

	it('nad katalóg (dĺžka > 15 m) → individuálna ponuka (NEEXTRAPOLUJE)', () => {
		expect(vypocitajCenuBazen({ dlzkaMm: 16000, sirkaMm: 4000, model: 'Premier' }).druh).toBe(
			'individualna-ponuka'
		);
	});

	it('nepokrytá bunka v rámci mriežky (dĺžka 13 m > pokrytie 12,5 m) → individuálna ponuka', () => {
		expect(vypocitajCenuBazen({ dlzkaMm: 13000, sirkaMm: 4000, model: 'Premier' }).druh).toBe(
			'individualna-ponuka'
		);
	});

	it('neplatný rozmer (0) → individuálna ponuka (neprilepí sa na katalógové minimum)', () => {
		expect(vypocitajCenuBazen({ dlzkaMm: 0, sirkaMm: 4000, model: 'Premier' }).druh).toBe(
			'individualna-ponuka'
		);
	});

	it('rozmer sa zaokrúhli na najbližší bod mriežky (6100 mm → 6,0 m — rovnaká cena ako 6000)', () => {
		const a = vypocitajCenuBazen({ dlzkaMm: 6000, sirkaMm: 4000, model: 'Premier' });
		const b = vypocitajCenuBazen({ dlzkaMm: 6100, sirkaMm: 4000, model: 'Premier' });
		expect(b).toEqual(a);
	});
});

describe('zaokruhliNaMriezku', () => {
	const m = { min: 2, max: 7, krok: 0.5 };
	it('pod minimum → minimum', () => expect(zaokruhliNaMriezku(1.5, m)).toBe(2));
	it('najbližší 0,5 (4,2 → 4,0)', () => expect(zaokruhliNaMriezku(4.2, m)).toBe(4));
	it('najbližší 0,5 (4,3 → 4,5)', () => expect(zaokruhliNaMriezku(4.3, m)).toBe(4.5));
	it('nad maximum → null', () => expect(zaokruhliNaMriezku(7.5, m)).toBe(null));
});

// --------------------------------------------------------------------------- //
// Hladina (MO/VO) — VO sa NIKDY nedostane do MO odpovede (#318 parita)
// --------------------------------------------------------------------------- //
describe('hladina MO/VO', () => {
	it('MO odpoveď nenesie hladinu; VO nesie hladinu VO a je NIŽŠIA než MO', () => {
		const mo = cenaPreModelBazen({ dlzkaMm: 6000, sirkaMm: 4000, model: 'Premier' }, 'MO');
		const vo = cenaPreModelBazen({ dlzkaMm: 6000, sirkaMm: 4000, model: 'Premier' }, 'VO');
		expect('hladina' in mo).toBe(false);
		expect(mo.druh).toBe('cena');
		expect(vo.druh).toBe('cena');
		if (mo.druh === 'cena' && vo.druh === 'cena') {
			expect(vo.hladina).toBe('VO');
			expect(vo.bezDph).toBeLessThan(mo.bezDph);
		}
	});

	it('cenyModelovBazen vráti presne 3 modely (Premier/Star/Exclusive)', () => {
		const cm = cenyModelovBazen(6000, 4000, 'MO');
		expect(cm.map((c) => c.model).sort()).toEqual(['Exclusive', 'Premier', 'Star']);
	});
});

// --------------------------------------------------------------------------- //
// Product-aware dispatch (#404) — NETAUTOLOGICKÝ gate test (vzor #388/#389)
// --------------------------------------------------------------------------- //
describe('produkt-aware dispatch (dopyt-cena-stamp)', () => {
	const bazenCfg = { systemKod: 'Premier', dlzka: 6000, sirka: 4000 };

	it('bazénová cfg pod „bazen" → BAZÉNOVÁ cena (zhoda s modulom)', () => {
		const c = cenaZCfgProdukt(bazenCfg, 'bazen');
		const ref = vypocitajCenuBazen({ dlzkaMm: 6000, sirkaMm: 4000, model: 'Premier' });
		expect(c?.druh).toBe('cena');
		if (c?.druh === 'cena' && ref.druh === 'cena') expect(c.bezDph).toBe(ref.mo.bezDph);
	});

	it('opeciatkujCenuPreProdukt(bazen) → cena + BAZÉNOVÁ verzia cenníka', () => {
		const stamp = opeciatkujCenuPreProdukt(bazenCfg, 'bazen');
		expect(stamp.cena?.druh).toBe('cena');
		expect(stamp.cennikVerzia).toBe(CENNIK_VERZIA_BAZEN);
	});

	it('bazén bez systemKod (starý neopečiatkovaný riadok) → honest-null (žiadna default cena)', () => {
		expect(cenaZCfgProdukt({ dlzka: 6000, sirka: 4000 }, 'bazen')).toBeNull();
	});

	it('pergolotvarová cfg (hlbka+model, bez systemKod/dlzka) pod „bazen" → null (nedostane pergolovú cenu)', () => {
		expect(cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'bazen')).toBeNull();
	});

	it('TÁ ISTÁ pergolotvarová cfg pod „pergola" DOSTANE cenu (gate nie je no-op)', () => {
		const c = cenaZCfgProdukt({ model: 'LIGHT', hlbka: 3500, sirka: 4000 }, 'pergola');
		expect(c?.druh).toBe('cena');
	});
});

describe('metadáta cenníka', () => {
	it('DPH je 0,23', () => expect(DPH_BAZEN).toBe(0.23));
	it('CENNIK_VERZIA_BAZEN má tvar <iso>#<12hex>', () =>
		expect(CENNIK_VERZIA_BAZEN).toMatch(/^.+#[0-9a-f]{12}$/));
});
