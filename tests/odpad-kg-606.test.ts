// #606 — odpad z nárezov aj v KILOGRAMOCH (Odoo úloha 1366, vzorec 1:1 s odoo-erp 9076).
// Čisté funkcie `odpadKgProfilu` / `sumaOdpadKg` v client-safe `$lib/odpad`:
//   odpad kg    = odpadMm / 1000 × kg/m
//   materiál kg = tyče × dĺžka tyče / 1000 × kg/m
//   % hmotnosti = Σ odpad kg / Σ materiál kg (vážené), vedľa ostáva dnešné % podľa dĺžky
// Chýbajúce kg/m (Odoo 403 / výpadok / karta bez kg/m / 0) = honest-null: profil „kg/m chýba",
// súčet NEÚPLNÝ — nikdy 0 kg. Žiadny profil s kg/m → `zobrazit=false` (UI ako pred #606).
// Literály: att 40349 (ZASP00002 2 × 7500, odpad 1204 mm; spolu 9820 mm naprieč 3 profilmi, 26,2 %).
// kg/m sú FIXTÚRA (1,288 = literál z návrhu odoo-erp 9076; ostatné vymyslené).
import { describe, it, expect } from 'vitest';
import { odpadKgProfilu, sumaOdpad, sumaOdpadKg } from '../src/lib/odpad';
import type { MaterialRow } from '../src/lib/server/compute';

function mk(o: Partial<MaterialRow>): MaterialRow {
	return {
		kod: '',
		nazov: '',
		rezy: [],
		tyce: 0,
		bary: [],
		odpadMm: 0,
		odpadPct: 0,
		barLen: 7500,
		sikmyRez: false,
		...o
	};
}

// att 40349: 3 profily, 5 tyčí × 7500 mm, odpad spolu 9820 mm
const ZASP00002 = mk({ kod: 'ZASP00002', tyce: 2, odpadMm: 1204, odpadPct: 8 });
const ZASP00010 = mk({ kod: 'ZASP00010', tyce: 1, odpadMm: 3632, odpadPct: 48.4 });
const ZASP00014 = mk({ kod: 'ZASP00014', tyce: 2, odpadMm: 4984, odpadPct: 33.2 });
const KG: Record<string, number> = { ZASP00002: 1.288, ZASP00010: 0.9, ZASP00014: 0.75 };
const sKg = (m: MaterialRow, kgNaM: number | null = KG[m.kod] ?? null): MaterialRow => ({
	...m,
	kgNaM
});

describe('odpadKgProfilu (#606)', () => {
	it('ZASP00002: odpad 1204 mm × 1,288 kg/m = 1,55 kg', () => {
		expect(odpadKgProfilu(sKg(ZASP00002))).toBe(1.55);
	});

	it('kg/m chýba (null / undefined / 0 / záporné / NaN) → null, nikdy 0 kg', () => {
		expect(odpadKgProfilu(sKg(ZASP00002, null))).toBeNull();
		expect(odpadKgProfilu(ZASP00002)).toBeNull(); // kgNaM nezisťované (undefined)
		expect(odpadKgProfilu(sKg(ZASP00002, 0))).toBeNull();
		expect(odpadKgProfilu(sKg(ZASP00002, -1))).toBeNull();
		expect(odpadKgProfilu(sKg(ZASP00002, NaN))).toBeNull();
	});
});

describe('sumaOdpadKg (#606)', () => {
	it('att 40349 (3 profily, 9820 mm): kg odpadu z kg materiálu + vážené % hmotnosti', () => {
		const material = [sKg(ZASP00002), sKg(ZASP00010), sKg(ZASP00014)];
		// dĺžkové % ostáva (26,2 %) — kg sú len doplnok
		expect(sumaOdpad(material).odpadMm).toBe(9820);
		expect(sumaOdpad(material).odpadPct).toBe(26.2);
		// odpad: 1,204×1,288 + 3,632×0,9 + 4,984×0,75 = 1,550752 + 3,2688 + 3,738 = 8,557552
		// materiál: 15×1,288 + 7,5×0,9 + 15×0,75 = 19,32 + 6,75 + 11,25 = 37,32
		expect(sumaOdpadKg(material)).toEqual({
			zobrazit: true,
			odpadKg: 8.56,
			materialKg: 37.32,
			hmotnostPct: 22.93,
			chybaKgNaM: []
		});
	});

	it('% podľa hmotnosti je VÁŽENÉ: 1 kg z 10 kg + 30 kg zo 100 kg = 28,18 % (nie priemer 20 %)', () => {
		const a = mk({ kod: 'A', tyce: 1, barLen: 5000, odpadMm: 500, kgNaM: 2 }); // 10 kg, odpad 1 kg
		const b = mk({ kod: 'B', tyce: 2, barLen: 5000, odpadMm: 3000, kgNaM: 10 }); // 100 kg, 30 kg
		const r = sumaOdpadKg([a, b]);
		expect(r.odpadKg).toBe(31);
		expect(r.materialKg).toBe(110);
		expect(r.hmotnostPct).toBe(28.18);
	});

	it('chýbajúce kg/m pri jednom profile → súčet NEÚPLNÝ, menovite kód; kg len zo známych', () => {
		const r = sumaOdpadKg([sKg(ZASP00002), sKg(ZASP00010, null), sKg(ZASP00014)]);
		expect(r.zobrazit).toBe(true);
		expect(r.chybaKgNaM).toEqual(['ZASP00010']);
		// 1,550752 + 3,738 = 5,288752 z 19,32 + 11,25 = 30,57
		expect(r.odpadKg).toBe(5.29);
		expect(r.materialKg).toBe(30.57);
		expect(r.hmotnostPct).toBe(17.3);
	});

	it('ŽIADNY profil nemá kg/m (dnešný PROD 403 / CI bez Odoo) → zobrazit=false, nič sa nepočíta', () => {
		const nezistovane = sumaOdpadKg([ZASP00002, ZASP00010, ZASP00014]);
		expect(nezistovane).toEqual({
			zobrazit: false,
			odpadKg: 0,
			materialKg: 0,
			hmotnostPct: 0,
			chybaKgNaM: []
		});
		// Odoo odpovedalo, ale karty kg/m nemajú → rovnako ako dnes (žiadny „kg/m chýba" text)
		expect(sumaOdpadKg([sKg(ZASP00002, null), sKg(ZASP00010, null)]).zobrazit).toBe(false);
	});

	it('profily bez tyče a NaN riadky sa nerátajú (rovnaká množina ako sumaOdpad)', () => {
		const r = sumaOdpadKg([
			sKg(ZASP00002),
			mk({ kod: 'ZASP99999', tyce: 0, odpadMm: 9999, kgNaM: null }), // nepoužitý profil
			{ ...sKg(ZASP00014), barLen: NaN }
		]);
		expect(r.chybaKgNaM).toEqual([]);
		expect(r.odpadKg).toBe(1.55);
		expect(r.materialKg).toBe(19.32);
	});

	it('profil bez kódu sa v zozname chýbajúcich menuje názvom', () => {
		const r = sumaOdpadKg([sKg(ZASP00002), mk({ nazov: 'Tyč 6000 mm', tyce: 1, kgNaM: null })]);
		expect(r.chybaKgNaM).toEqual(['Tyč 6000 mm']);
	});

	it('prázdny vstup → zobrazit=false, nuly', () => {
		expect(sumaOdpadKg([])).toEqual({
			zobrazit: false,
			odpadKg: 0,
			materialKg: 0,
			hmotnostPct: 0,
			chybaKgNaM: []
		});
	});
});
