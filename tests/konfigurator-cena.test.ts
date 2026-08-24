// Interim cenotvorba pergoly (#279, Fáza B) — parita cenového modulu voči vyťaženej
// matici montalu.sk (`cennik-pergola.json`, Fáza A). OFFLINE, deterministické, v CI.
// Online drift-check proti živému montalu.sk je samostatný `scripts/konfigurator-cennik-drift.mjs`
// (NIKDY v CI — externá sieť).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import cennik from '../src/lib/server/cennik-pergola.json';
import {
	vypocitajCenu,
	zaokruhliNahor,
	dostupneVyplne,
	DPH,
	PRIPLATKY,
	MRIEZKA,
	type ModelPergoly,
	type VyplnKluc
} from '../src/lib/server/konfigurator-cena';

const r2 = (x: number) => Math.round(x * 100) / 100;
/** DPH s-cena v celých centoch (half-up) — MUSÍ sa zhodovať s modulom `sDphEur` a s
 *  PHP `round()` na montalu.sk (overené na .xx5 hraniciach, LIGHT 3,5×7,5 / 3,0×5,75). */
const sDph = (net: number) => Math.round((Math.round(net * 100) * 123) / 100) / 100;
/** montalu.sk formát "2 611,88" (medzery vrátane nbsp/thin) → number */
const parseSk = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// ---------------------------------------------------------------------------
describe('seed integrita + Money-neutralita (#279)', () => {
	it('meta: DPH 23 %, pitched rodina, mriežka 0,5 / 0,25', () => {
		expect(DPH).toBe(0.23);
		expect(cennik.meta.rodina).toBe('pitched');
		expect(MRIEZKA.hlbkaM).toEqual({ min: 2, max: 6, krok: 0.5 });
		expect(MRIEZKA.sirkaM).toEqual({ min: 4, max: 7.5, krok: 0.25 });
	});

	it('fixné príplatky komín 250 € / záruka 600 €', () => {
		expect(PRIPLATKY.kominEur).toBe(250);
		expect(PRIPLATKY.zaruka5rEur).toBe(600);
	});

	// Interim cennik nesie PREDAJNÉ ceny prevzaté z montalu.sk — NIE Money ERP kódy.
	// Guard: seed ani modul neobsahujú moneyKod ani vzory Money kódov (TS*/ZASP*/BPP*/PRP*).
	it('seed + modul sú Money-neutrálne (žiadny moneyKod / TS*/ZASP*/BPP*/PRP* kód)', () => {
		const seedTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/cennik-pergola.json'),
			'utf8'
		);
		const modulTxt = fs.readFileSync(
			path.resolve(__dirname, '../src/lib/server/konfigurator-cena.ts'),
			'utf8'
		);
		const zakazane = /moneyKod|\bTS\d{3,}|\bZASP\d{3,}|\bBPP\d{3,}|\bPRP\d{3,}/;
		expect(seedTxt).not.toMatch(zakazane);
		expect(modulTxt).not.toMatch(/moneyKod|\bTS\d{3,}|\bZASP\d{3,}|\bBPP\d{3,}|\bPRP\d{3,}/);
		// modul neimportuje katalóg skla / cenu skla / Money / DB
		expect(modulTxt).not.toMatch(/from ['"][^'"]*sklo-strecha['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*sklo-cena['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/money['"]/);
		expect(modulTxt).not.toMatch(/from ['"][^'"]*server\/db['"]/);
	});

	it('modul NIE je importovaný verejnou route (Fáza C je mimo tohto lane)', () => {
		const route = fs.readFileSync(
			path.resolve(__dirname, '../src/routes/konfigurator/+page.server.ts'),
			'utf8'
		);
		expect(route).not.toMatch(/konfigurator-cena/);
	});
});

// ---------------------------------------------------------------------------
// (1) PARITY — modul == matica pre KAŽDÚ bunku (on-grid, bez príplatkov)
// ---------------------------------------------------------------------------
type Cennik = Record<string, Record<string, Record<string, Record<string, [number, number]>>>>;
const CENNIK = cennik.cennik as unknown as Cennik;

function vsetkyBunky(): Array<{
	vypln: VyplnKluc;
	model: ModelPergoly;
	dM: number;
	wM: number;
	mo: number;
	vo: number;
}> {
	const out: Array<{
		vypln: VyplnKluc;
		model: ModelPergoly;
		dM: number;
		wM: number;
		mo: number;
		vo: number;
	}> = [];
	for (const [vypln, modely] of Object.entries(CENNIK))
		for (const [model, hlbky] of Object.entries(modely))
			for (const [dK, sirky] of Object.entries(hlbky))
				for (const [wK, par] of Object.entries(sirky))
					out.push({
						vypln: vypln as VyplnKluc,
						model: model as ModelPergoly,
						dM: Number(dK),
						wM: Number(wK),
						mo: par[0],
						vo: par[1]
					});
	return out;
}

describe('parity — modul == matica montalu.sk (všetky bunky)', () => {
	const bunky = vsetkyBunky();

	it('matica má očakávaný rozsah buniek (sanity, > 1000)', () => {
		expect(bunky.length).toBeGreaterThan(1000);
	});

	it('KAŽDÁ bunka: modul (on-grid, bez príplatkov) vráti presne MO/VO net matice + DPH', () => {
		for (const b of bunky) {
			const r = vypocitajCenu({
				hlbkaMm: b.dM * 1000,
				sirkaMm: b.wM * 1000,
				model: b.model,
				vypln: b.vypln
			});
			expect(r.druh, `${b.vypln} ${b.model} ${b.dM}x${b.wM}`).toBe('cena');
			if (r.druh !== 'cena') continue;
			expect(r.hlbkaGridM).toBe(b.dM);
			expect(r.sirkaGridM).toBe(b.wM);
			expect(r.mo.bezDph).toBe(b.mo);
			expect(r.vo.bezDph).toBe(b.vo);
			expect(r.mo.sDph).toBe(sDph(b.mo));
			expect(r.vo.sDph).toBe(sDph(b.vo));
			expect(r.priplatky.spoluEur).toBe(0);
		}
	});

	it('všetky 4 rohy poly matice ROBUST (najširší dostupný model) sedia', () => {
		const rohy: Array<[number, number]> = [
			[2, 4],
			[2, 7.5],
			[6, 4],
			[6, 7.5]
		];
		for (const [d, w] of rohy) {
			const r = vypocitajCenu({ hlbkaMm: d * 1000, sirkaMm: w * 1000, model: 'ROBUST' });
			expect(r.druh, `roh ${d}x${w}`).toBe('cena');
			if (r.druh === 'cena')
				expect(r.mo.bezDph).toBe(
					CENNIK['polykarbonat-16']!.ROBUST![d.toFixed(1)]![w.toFixed(2)]![0]
				);
		}
	});
});

// ---------------------------------------------------------------------------
// (2) ZAOKRÚHĽOVANIE NAHOR
// ---------------------------------------------------------------------------
describe('zaokrúhľovanie NAHOR na katalógovú mriežku', () => {
	it('hĺbka: 2,6 → 3,0; 2,8 → 3,0; 3,0 → 3,0; 3,1 → 3,5', () => {
		expect(zaokruhliNahor(2.6, MRIEZKA.hlbkaM)).toBe(3);
		expect(zaokruhliNahor(2.8, MRIEZKA.hlbkaM)).toBe(3);
		expect(zaokruhliNahor(3.0, MRIEZKA.hlbkaM)).toBe(3);
		expect(zaokruhliNahor(3.1, MRIEZKA.hlbkaM)).toBe(3.5);
	});

	it('šírka: 4,2 → 4,25; 4,3 → 4,5; 5,0 → 5,0; 7,5 → 7,5', () => {
		expect(zaokruhliNahor(4.2, MRIEZKA.sirkaM)).toBe(4.25);
		expect(zaokruhliNahor(4.3, MRIEZKA.sirkaM)).toBe(4.5);
		expect(zaokruhliNahor(5.0, MRIEZKA.sirkaM)).toBe(5);
		expect(zaokruhliNahor(7.5, MRIEZKA.sirkaM)).toBe(7.5);
	});

	it('pod minimum sa prilepí na minimum (hĺbka 1,5 → 2,0; šírka 3,0 → 4,0)', () => {
		expect(zaokruhliNahor(1.5, MRIEZKA.hlbkaM)).toBe(2);
		expect(zaokruhliNahor(3.0, MRIEZKA.sirkaM)).toBe(4);
	});

	it('nad maximum ⇒ null (hĺbka 6,5; šírka 8,0)', () => {
		expect(zaokruhliNahor(6.5, MRIEZKA.hlbkaM)).toBeNull();
		expect(zaokruhliNahor(8.0, MRIEZKA.sirkaM)).toBeNull();
	});

	it('NaN / nekonečno ⇒ null', () => {
		expect(zaokruhliNahor(NaN, MRIEZKA.hlbkaM)).toBeNull();
		expect(zaokruhliNahor(Infinity, MRIEZKA.sirkaM)).toBeNull();
	});

	it('modul: off-grid vstup (2 630 × 4 190 mm) mapuje na bunku 3,0 × 4,25', () => {
		const r = vypocitajCenu({ hlbkaMm: 2630, sirkaMm: 4190, model: 'LIGHT' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect(r.hlbkaGridM).toBe(3);
			expect(r.sirkaGridM).toBe(4.25);
			expect(r.mo.bezDph).toBe(CENNIK['polykarbonat-16']!.LIGHT!['3.0']!['4.25']![0]);
		}
	});

	it('modul: šírka pod minimom (mm 2 000) sa prilepí na 4,0 m', () => {
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 2000, model: 'LIGHT' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') expect(r.sirkaGridM).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// (3) MIMO KATALÓGU / NEDOSTUPNÉ ⇒ individuálna ponuka (nikdy neextrapoluje)
// ---------------------------------------------------------------------------
describe('mimo katalógu / nedostupné ⇒ individuálna ponuka', () => {
	it('šírka > 7,5 m (mm 8 000) ⇒ individuálna', () => {
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 8000, model: 'ROBUST' });
		expect(r.druh).toBe('individualna-ponuka');
		if (r.druh === 'individualna-ponuka') expect(r.dovod).toMatch(/Šírka/);
	});

	it('hĺbka > 6,0 m (mm 6 500) ⇒ individuálna', () => {
		const r = vypocitajCenu({ hlbkaMm: 6500, sirkaMm: 5000, model: 'ROBUST' });
		expect(r.druh).toBe('individualna-ponuka');
		if (r.druh === 'individualna-ponuka') expect(r.dovod).toMatch(/Hĺbka/);
	});

	it('LIGHT nad 4,0 m hĺbky (5,0 m) ⇒ individuálna (mimo obálky modelu)', () => {
		const r = vypocitajCenu({ hlbkaMm: 5000, sirkaMm: 5000, model: 'LIGHT' });
		expect(r.druh).toBe('individualna-ponuka');
		if (r.druh === 'individualna-ponuka') expect(r.dovod).toMatch(/katalógu/);
	});

	it('izolačné sklo na LIGHT ⇒ individuálna (LIGHT nemá izolačné)', () => {
		const r = vypocitajCenu({
			hlbkaMm: 3000,
			sirkaMm: 5000,
			model: 'LIGHT',
			vypln: 'izolacne-sklo-24'
		});
		expect(r.druh).toBe('individualna-ponuka');
	});

	it('bezpečnostné sklo 4.4.2 (pre pitched neponúkané) ⇒ individuálna', () => {
		const r = vypocitajCenu({
			hlbkaMm: 3000,
			sirkaMm: 5000,
			model: 'ROBUST',
			vypln: 'bezpecnostne-sklo-442'
		});
		expect(r.druh).toBe('individualna-ponuka');
	});

	// Obranná hranica (review 🔵): nekladný/neplatný rozmer NESMIE ticho spadnúť na
	// katalógové minimum a vrátiť reálnu cenu — musí byť odmietnutý.
	it('nekladný rozmer (0 / záporný / NaN) ⇒ individuálna, nie cena min. bunky', () => {
		for (const v of [
			{ hlbkaMm: 0, sirkaMm: 5000 },
			{ hlbkaMm: 3000, sirkaMm: -500 },
			{ hlbkaMm: -1, sirkaMm: -1 },
			{ hlbkaMm: NaN, sirkaMm: 5000 }
		]) {
			const r = vypocitajCenu(v);
			expect(r.druh, JSON.stringify(v)).toBe('individualna-ponuka');
			if (r.druh === 'individualna-ponuka') expect(r.dovod).toMatch(/Neplatný rozmer/);
		}
	});
});

// ---------------------------------------------------------------------------
// (4) DPH 23 % proti REÁLNYM montalu.sk reťazcom (nezávislá kotva, nie tautológia)
// ---------------------------------------------------------------------------
describe('DPH 23 % reprodukuje reálne montalu.sk s-DPH reťazce (verifikaciaDph)', () => {
	it('má aspoň jednu verifikačnú vzorku', () => {
		expect(cennik.verifikaciaDph.length).toBeGreaterThan(0);
	});

	for (const v of cennik.verifikaciaDph) {
		it(`${v.roofing} ${v.model} ${v.hlbkaM}×${v.sirkaM}: modul s-DPH == montalu reťazec`, () => {
			const r = vypocitajCenu({
				hlbkaMm: v.hlbkaM * 1000,
				sirkaMm: v.sirkaM * 1000,
				model: v.model as ModelPergoly,
				vypln: v.roofing as VyplnKluc
			});
			expect(r.druh).toBe('cena');
			if (r.druh !== 'cena') return;
			expect(r.mo.bezDph).toBe(v.moNet);
			expect(r.vo.bezDph).toBe(v.voNet);
			expect(r.mo.sDph).toBe(parseSk(v.moDph));
			expect(r.vo.sDph).toBe(parseSk(v.voDph));
		});
	}
});

// DPH half-up na .xx5 hraniciach — overené proti reálnym montalu.sk reťazcom, aby
// interim cena sedela na cent aj na najťažších hodnotách (FP by inak driftlo o 1 cent).
describe('DPH half-up na .xx5 hraniciach (live montalu.sk)', () => {
	it('LIGHT 3,5×7,5: VO 3917,50 → s DPH 4818,53 (montalu zaokrúhľuje 4818,525 NAHOR)', () => {
		const r = vypocitajCenu({ hlbkaMm: 3500, sirkaMm: 7500, model: 'LIGHT' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect(r.vo.bezDph).toBe(3917.5);
			expect(r.vo.sDph).toBe(4818.53);
		}
	});

	it('LIGHT 3,0×5,75: MO 4095,50 → s DPH 5037,47 (montalu zaokrúhľuje 5037,465 NAHOR)', () => {
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 5750, model: 'LIGHT' });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect(r.mo.bezDph).toBe(4095.5);
			expect(r.mo.sDph).toBe(5037.47);
		}
	});
});

// ---------------------------------------------------------------------------
// (5) NEZÁVISLÉ KOTVY — hodnoty live-overené pri tomto lane / FINDING §9
// ---------------------------------------------------------------------------
describe('nezávislé kotvy (live-overené montalu.sk hodnoty)', () => {
	const kotvy: Array<{ model: ModelPergoly; d: number; w: number; mo: number; vo?: number }> = [
		{ model: 'LIGHT', d: 3, w: 5, mo: 3619.56, vo: 2352.41 },
		{ model: 'LIGHT', d: 2, w: 5, mo: 2413.04 },
		{ model: 'LIGHT', d: 3, w: 4, mo: 2895.65 },
		{ model: 'LIGHT', d: 2, w: 4, mo: 2123.48 }, // live (FINDING §9.3 „2014" je zastaraný)
		{ model: 'ROBUST', d: 2, w: 4, mo: 2475.31 },
		{ model: 'MASSIVE', d: 6, w: 7.5, mo: 13922.24 }
	];
	for (const k of kotvy) {
		it(`${k.model} ${k.d}×${k.w} poly MO = ${k.mo} €`, () => {
			const r = vypocitajCenu({ hlbkaMm: k.d * 1000, sirkaMm: k.w * 1000, model: k.model });
			expect(r.druh).toBe('cena');
			if (r.druh !== 'cena') return;
			expect(r.mo.bezDph).toBe(k.mo);
			if (k.vo !== undefined) expect(r.vo.bezDph).toBe(k.vo);
		});
	}
});

// ---------------------------------------------------------------------------
// (6) PRÍPLATKY (komín / záruka) — pripočítané k net, DPH zo súčtu
// ---------------------------------------------------------------------------
describe('príplatky (komín +250 € / záruka +600 €)', () => {
	const zaklad = () => vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 5000, model: 'LIGHT' });

	it('komín pripočíta 250 € k MO aj VO net, DPH zo súčtu', () => {
		const base = zaklad();
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 5000, model: 'LIGHT', komin: true });
		expect(base.druh).toBe('cena');
		expect(r.druh).toBe('cena');
		if (base.druh !== 'cena' || r.druh !== 'cena') return;
		expect(r.mo.bezDph).toBe(r2(base.mo.bezDph + 250));
		expect(r.vo.bezDph).toBe(r2(base.vo.bezDph + 250));
		expect(r.mo.sDph).toBe(sDph(base.mo.bezDph + 250));
		expect(r.priplatky).toEqual({ kominEur: 250, zaruka5rEur: 0, spoluEur: 250 });
	});

	it('záruka pripočíta 600 €', () => {
		const base = zaklad();
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 5000, model: 'LIGHT', zaruka5r: true });
		if (base.druh !== 'cena' || r.druh !== 'cena') throw new Error('nečakané');
		expect(r.mo.bezDph).toBe(r2(base.mo.bezDph + 600));
		expect(r.priplatky).toEqual({ kominEur: 0, zaruka5rEur: 600, spoluEur: 600 });
	});

	it('komín + záruka spolu 850 €', () => {
		const base = zaklad();
		const r = vypocitajCenu({
			hlbkaMm: 3000,
			sirkaMm: 5000,
			model: 'LIGHT',
			komin: true,
			zaruka5r: true
		});
		if (base.druh !== 'cena' || r.druh !== 'cena') throw new Error('nečakané');
		expect(r.mo.bezDph).toBe(r2(base.mo.bezDph + 850));
		expect(r.priplatky.spoluEur).toBe(850);
	});
});

// ---------------------------------------------------------------------------
// (7) DEFAULTY + helper
// ---------------------------------------------------------------------------
describe('defaulty a helpery', () => {
	it('bez model/vypln ⇒ LIGHT + polykarbonát', () => {
		const r = vypocitajCenu({ hlbkaMm: 3000, sirkaMm: 5000 });
		expect(r.druh).toBe('cena');
		if (r.druh === 'cena') {
			expect(r.model).toBe('LIGHT');
			expect(r.vypln).toBe('polykarbonat-16');
			expect(r.mo.bezDph).toBe(3619.56);
		}
	});

	it('dostupneVyplne: LIGHT = poly + bezpečnostné-441; ROBUST + izolačné/panel', () => {
		expect(dostupneVyplne('LIGHT').sort()).toEqual(
			['polykarbonat-16', 'bezpecnostne-sklo-441'].sort()
		);
		expect(dostupneVyplne('ROBUST')).toContain('izolacne-sklo-24');
		expect(dostupneVyplne('ROBUST')).toContain('panel-izo-24');
		expect(dostupneVyplne('MASSIVE')).toContain('panel-izo-24');
	});
});
