// Pergola — VÝROBNÁ varianta hárku (#381, podmnožina 1+3+4). Čistá geometria pozičného
// číslovania dielov, POTVRDENÝCH osových pozícií priečok a montážne tolerancie. Časti 2
// (Detail C/D) a 5 (rezný náčrt krovu) NIE SÚ v scope — viazané na #161. Generická
// `retazoveKoty` je testovaná v tests/kota.test.ts (zdieľaný helper).
//
// Display-only — do Money NIČ nezapisuje.
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	KOD_PRIECKA_NORMAL,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';
import {
	pozicujDiely,
	pozicieVoVykrese,
	prieckyOsiPotvrdene,
	MONTAZNE_TOLERANCIE_HLBKA_MM
} from '../src/lib/pergola-vyroba';

// Golden vstup zákazky OP260282 (Massive SS, výstuha 140×140, zasklená) — ten istý ako
// tests/pergola-narez-op260282.test.ts. Poradie Plánu rezov: predná noha (1), zadná noha
// (2), priečka (3), žľab (4), kotviaci (5), zadná konštr. horná (6), žľabová výstuha (7),
// pod fixom (8), lišty (9+).
const OP260282: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 4990,
	hlbka: 3470,
	prednaSvetlost: 2200,
	vyskaZadna: 2790,
	pocetPrednychNoh: 4,
	uchytenie: 'samostatne',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 110,
	prieckaLight: false,
	zosilnenyNosnik: true,
	sklonStrechy: 6.1,
	pocetKrovov: 8
};

// Vstup na stenu (bez zadných nôh, BEZ počtu krovov) — zadná noha honest-null vo
// výkresových pozíciách, potvrdené osi priečok tiež honest-null (chýba počet krovov).
const NA_STENU: PergolaNarezVstup = {
	system: 'Robust',
	sirka: 4000,
	hlbka: 3000,
	prednaSvetlost: 2500,
	vyskaZadna: 2800,
	pocetPrednychNoh: 3,
	uchytenie: 'stena',
	pocetZadnychNoh: 0,
	hornyProfilZadnej: 110,
	prieckaLight: false,
	zosilnenyNosnik: false,
	sklonStrechy: null,
	pocetKrovov: null,
	jednoduchaBezZasklenia: false
};

describe('pozicujDiely — stabilné pozičné čísla (Plán rezov, #381 časť 1)', () => {
	const r = spocitajNarez(OP260282);
	const diely = pozicujDiely(r.vypocitane);

	it('každý riadok dostane číslo = index + 1, v poradí kusovníka', () => {
		expect(diely.length).toBe(r.vypocitane.length);
		diely.forEach((d, i) => expect(d.cislo).toBe(i + 1));
	});

	it('zachová všetky pôvodné polia riadku (kód, názov, dĺžka, počet)', () => {
		diely.forEach((d, i) => {
			expect(d.kod).toBe(r.vypocitane[i]!.kod);
			expect(d.nazov).toBe(r.vypocitane[i]!.nazov);
			expect(d.dlzkaRezuMm).toBe(r.vypocitane[i]!.dlzkaRezuMm);
			expect(d.pocetKs).toBe(r.vypocitane[i]!.pocetKs);
		});
	});

	it('prvý diel má pozíciu 1, čísla sú súvislé bez preskakovania', () => {
		expect(diely[0]!.cislo).toBe(1);
		const cisla = diely.map((d) => d.cislo);
		expect(cisla).toEqual(Array.from({ length: diely.length }, (_, i) => i + 1));
	});

	it('prázdny kusovník → prázdne pole (žiadny pád)', () => {
		expect(pozicujDiely([])).toEqual([]);
	});
});

describe('pozicieVoVykrese — roly → pozičné číslo pre balóniky (#381 časť 1)', () => {
	it('OP260282: predná noha=1, zadná noha=2, priečka=3, žľab=4', () => {
		const r = spocitajNarez(OP260282);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(p.prednaNoha).toBe(1);
		expect(p.zadnaNoha).toBe(2);
		expect(p.priecka).toBe(3);
		expect(p.zlab).toBe(4);
	});

	it('na stenu: zadná noha = null (honest-null, balónik sa nekreslí), predná noha ostáva', () => {
		const r = spocitajNarez(NA_STENU);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(p.zadnaNoha).toBeNull();
		expect(p.prednaNoha).toBe(1);
		expect(p.zlab).not.toBeNull();
		expect(p.priecka).not.toBeNull();
	});

	// Nie tautológia: rola sa overuje cez KÓD zacieleného riadku (nezávisle od predikátu,
	// ktorý `pozicieVoVykrese` používa) — chytí zámenu roly aj keby predikát matchol iný riadok.
	it('rola ukazuje na riadok so správnym Money kódom (Massive: 18017/18013/18018/18004)', () => {
		const r = spocitajNarez(OP260282);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(r.vypocitane[p.prednaNoha! - 1]!.kod).toBe('18017'); // Massive stĺp = predná noha
		expect(r.vypocitane[p.zadnaNoha! - 1]!.kod).toBe('18013'); // zadná konštr. 110×110
		expect(r.vypocitane[p.zlab! - 1]!.kod).toBe('18018'); // Massive žľab
		expect(r.vypocitane[p.priecka! - 1]!.kod).toBe(KOD_PRIECKA_NORMAL); // 18004
		// a naozaj ROZDIELNE riadky (žiadne dva na tú istú pozíciu)
		expect(new Set([p.prednaNoha, p.zadnaNoha, p.zlab, p.priecka]).size).toBe(4);
	});
});

describe('prieckyOsiPotvrdene — POTVRDENÉ osi priečok (krovov) v pôdoryse (#381 časť 3)', () => {
	it('OP260282: 8 osí, prvá 1 mm od kraja + polovica krovu (26 mm), rozstup = 50 + svetlosť (705,4)', () => {
		const osi = prieckyOsiPotvrdene(OP260282);
		expect(osi).not.toBeNull();
		expect(osi!.length).toBe(8); // = pocetKrovov, presne ako kusovník
		expect(osi![0]).toBeCloseTo(26, 1); // 1 (kraj) + 25 (polovica krovu 50)
		// rozstup medzi osami = 50 + svetlosť(4990,8)=655,43 = 705,43
		expect(osi![1]! - osi![0]!).toBeCloseTo(705.4, 1);
		// všetky osi v rámci šírky
		osi!.forEach((x) => {
			expect(x).toBeGreaterThan(0);
			expect(x).toBeLessThan(4990);
		});
	});

	it('bez zadaného počtu krovov → null (honest-null, reťazová kóta sa nekreslí)', () => {
		expect(prieckyOsiPotvrdene(NA_STENU)).toBeNull();
	});

	it('priveľa krovov na šírku (svetlosť ≤ 0) → null, nič sa nehádže', () => {
		expect(prieckyOsiPotvrdene({ ...OP260282, sirka: 1000, pocetKrovov: 20 })).toBeNull();
	});

	it('počet osí sa vždy rovná manuálnemu počtu krovov (nie schematickému pocetPriecok)', () => {
		for (const n of [4, 6, 8, 10]) {
			const osi = prieckyOsiPotvrdene({ ...OP260282, pocetKrovov: n });
			expect(osi!.length).toBe(n);
		}
	});
});

describe('MONTAZNE_TOLERANCIE_HLBKA_MM — CAD konštanty (#381 časť 4)', () => {
	it('presne overené hodnoty z groundingu #377 — nič sa nehádže', () => {
		expect([...MONTAZNE_TOLERANCIE_HLBKA_MM]).toEqual([2, 3, 12]);
	});
});
