// computeLakovanie (#369) — čistý display-only výpočet spotreby farby na rozvin
// profilov. Rozvin hodnoty sú VYMYSLENÉ (repo je verejné) — testuje sa vzorec,
// nie Money dáta. Vzorec: spotreba [kg] = rozvin [m²/bm] × dĺžka [bm] × 0,150.
import { describe, it, expect } from 'vitest';
import {
	computeLakovanie,
	LAKOVANIE_KOEF_KG_M2,
	LAKOVANIE_VYNIMKY,
	LAKOVANIE_PROFIL_PREFIXY
} from '../src/lib/lakovanie';

describe('computeLakovanie (#369)', () => {
	it('koeficient je 0,150 kg/m² (Dominik)', () => {
		expect(LAKOVANIE_KOEF_KG_M2).toBe(0.15);
	});

	it('výnimky = presne 5 Dominikových kódov', () => {
		expect([...LAKOVANIE_VYNIMKY].sort()).toEqual([
			'BPP00091',
			'BPP00092',
			'BPP00094',
			'BPP00097',
			'PRP00047'
		]);
	});

	it('profilové rodiny sú ZASP/PRP/BPP', () => {
		expect([...LAKOVANIE_PROFIL_PREFIXY].sort()).toEqual(['BPP', 'PRP', 'ZASP']);
	});

	it('spotreba = rozvin × dĺžka × 0,150; súčty + honest-null € správne', () => {
		const res = computeLakovanie([
			{ kod: 'PRP00001', nazov: 'Profil A', qty: 10, mj: 'm', rozvin: 0.5 },
			{ kod: 'ZASP00001', nazov: 'Profil B', qty: 4, mj: 'm', rozvin: 0.25 }
		]);
		expect(res.radky).toHaveLength(2);
		// PRP: plocha 0,5×10=5 m²; spotreba 5×0,15=0,75 kg
		expect(res.radky[0]).toMatchObject({ kod: 'PRP00001', plocha: 5, spotreba: 0.75 });
		// ZASP: plocha 0,25×4=1 m²; spotreba 1×0,15=0,15 kg
		expect(res.radky[1]).toMatchObject({ kod: 'ZASP00001', plocha: 1, spotreba: 0.15 });
		expect(res.plochaSpolu).toBe(6);
		expect(res.spotrebaSpolu).toBe(0.9);
		expect(res.kompletne).toBe(true);
		expect(res.eurSpolu).toBeNull();
	});

	it('BPP profil (bazén) sa lakuje', () => {
		const res = computeLakovanie([
			{ kod: 'BPP00001', nazov: 'Bazén profil', qty: 2, mj: 'm', rozvin: 0.3 }
		]);
		expect(res.radky).toHaveLength(1);
		expect(res.radky[0]).toMatchObject({ plocha: 0.6, spotreba: 0.09 });
	});

	it('výnimky (Dominik) sa nelakujú, aj keď majú rozvin', () => {
		for (const kod of LAKOVANIE_VYNIMKY) {
			const res = computeLakovanie([{ kod, nazov: 'x', qty: 5, mj: 'm', rozvin: 0.4 }]);
			expect(res.radky).toHaveLength(0);
			expect(res.spotrebaSpolu).toBe(0);
			expect(res.kompletne).toBe(true);
		}
	});

	it('kovanie/tesnenie (ZASK) a komponenty (BPK) sa do sekcie nedostanú — žiadny falošný neúplný flag', () => {
		const res = computeLakovanie([
			{ kod: 'ZASK20242', nazov: 'Tesnenie zasklievacie', qty: 8, mj: 'm', rozvin: null },
			{ kod: 'BPK00001', nazov: 'Bazén komponent', qty: 3, mj: 'ks', rozvin: null }
		]);
		expect(res.radky).toHaveLength(0);
		expect(res.kompletne).toBe(true);
		expect(res.spotrebaSpolu).toBe(0);
	});

	it('lakovaný profil bez rozvinu → honest-null riadok + kompletne=false', () => {
		const res = computeLakovanie([
			{ kod: 'PRP00001', nazov: 'A', qty: 10, mj: 'm', rozvin: 0.5 },
			{ kod: 'PRP00002', nazov: 'B (bez rozvinu)', qty: 6, mj: 'm', rozvin: null }
		]);
		expect(res.radky).toHaveLength(2);
		const b = res.radky.find((r) => r.kod === 'PRP00002')!;
		expect(b.rozvin).toBeNull();
		expect(b.plocha).toBeNull();
		expect(b.spotreba).toBeNull();
		expect(res.kompletne).toBe(false);
		expect(res.spotrebaSpolu).toBe(0.75); // len profil so známym rozvinom
	});

	it("profil v 'ks' (nie dĺžka v m) → honest-null riadok + kompletne=false (nie tiché zahodenie, napr. CLIP)", () => {
		const res = computeLakovanie([{ kod: 'BPP00001', nazov: 'x', qty: 2, mj: 'ks', rozvin: 0.4 }]);
		expect(res.radky).toHaveLength(1);
		expect(res.radky[0]).toMatchObject({ kod: 'BPP00001', mj: 'ks', plocha: null, spotreba: null });
		expect(res.radky[0]!.rozvin).toBe(0.4); // rozvin poznáme, len plochu z ks nevieme
		expect(res.kompletne).toBe(false);
		expect(res.spotrebaSpolu).toBe(0);
	});

	it('zaokrúhlenie na 3 desatinné + súčet = Σ zaokrúhlených riadkov', () => {
		// rozvin 0,431 × 7,2 = 3,1032 → round3 3,103 m²; × 0,15 = 0,46545 → 0,465 kg
		const res = computeLakovanie([
			{ kod: 'ZASP00001', nazov: 'A', qty: 7.2, mj: 'm', rozvin: 0.431 },
			{ kod: 'PRP00001', nazov: 'B', qty: 3.3, mj: 'm', rozvin: 0.702 } // 2,3166→2,317; ×0,15=0,34755→0,348
		]);
		expect(res.radky[0]).toMatchObject({ plocha: 3.103, spotreba: 0.465 });
		expect(res.radky[1]).toMatchObject({ plocha: 2.317, spotreba: 0.348 });
		expect(res.plochaSpolu).toBe(5.42); // 3,103 + 2,317
		expect(res.spotrebaSpolu).toBe(0.813); // 0,465 + 0,348 (Σ zaokrúhlených)
	});

	it('nulové/záporné množstvo sa preskočí (žiadny riadok, žiadny neúplný flag)', () => {
		const res = computeLakovanie([
			{ kod: 'PRP00001', nazov: 'x', qty: 0, mj: 'm', rozvin: 0.5 },
			{ kod: 'PRP00003', nazov: 'y', qty: -2, mj: 'm', rozvin: 0.5 }
		]);
		expect(res.radky).toHaveLength(0);
		expect(res.kompletne).toBe(true);
	});

	it('rozvin 0 alebo záporný = neznámy (honest-null)', () => {
		const res = computeLakovanie([{ kod: 'PRP00001', nazov: 'x', qty: 10, mj: 'm', rozvin: 0 }]);
		expect(res.radky[0]!.spotreba).toBeNull();
		expect(res.kompletne).toBe(false);
	});

	it('prázdny vstup → prázdny výsledok, kompletne=true, € null', () => {
		const res = computeLakovanie([]);
		expect(res.radky).toEqual([]);
		expect(res.plochaSpolu).toBe(0);
		expect(res.spotrebaSpolu).toBe(0);
		expect(res.kompletne).toBe(true);
		expect(res.eurSpolu).toBeNull();
	});
});
