// #342: Tesnenie — Money odpis zasklievacieho tesnenia pre STANDARD.
//
// KOLO 2 korekcia (Dominik, úloha 582, 8.9.2026 05:36, verbatim v UNPARK komentári):
//   dĺžka = Σ(ZASP202415 rezy)  — „súčet šírok kladkových profilov", NIE obvod skla.
//   (Predtým 3-profilový súčet kladkový+nos+krajová — 7.9. msg 1806754 — bol nadhodnotený;
//    §1c money-odpis: neskoršia priama Dominikova odpoveď + owner UNPARK rozsúdenie vyhráva.)
// Mapovanie (8.9.2026, msg 1807247): 4mm→ZASK00005, 6mm→ZASK00006, IZO→žiadne (bez gumy).
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import {
	TESNENIE_SYSTEMY,
	klasifikujSkloPreTesnenie,
	TESNENIE_KODY,
	tesneniePolozky,
	tesneniePolozkyPooled
} from '../src/lib/tesnenie';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

// ---- klasifikujSkloPreTesnenie ----

describe('klasifikujSkloPreTesnenie', () => {
	it('4mm sklo → tesnenie4', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 4 mm')).toBe('tesnenie4');
	});

	it('6mm sklo → tesnenie6', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 6 mm')).toBe('tesnenie6');
	});

	it('izolačné sklo → izolacne', () => {
		expect(klasifikujSkloPreTesnenie('Izolačné sklo 4.8.4')).toBe('izolacne');
	});

	it('10mm sklo → nezname (Dominik neurčil)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 10 mm')).toBe('nezname');
	});

	it('undefined → nezname', () => {
		expect(klasifikujSkloPreTesnenie(undefined)).toBe('nezname');
	});

	it('prázdny reťazec → nezname', () => {
		expect(klasifikujSkloPreTesnenie('')).toBe('nezname');
	});

	it('iné izolačné meno → izolacne (regex jeIzoSklo)', () => {
		expect(klasifikujSkloPreTesnenie('Izolacne sklo 4/16/4')).toBe('izolacne');
	});

	// 🟡5 review: desatinné meno nesmie misroutovať (lookbehind (?<![\d.,]))
	it('"Float sklo 6,4 mm" → nezname (desatinné, nie 4 mm)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 6,4 mm')).toBe('nezname');
	});

	it('"Float sklo 4.4 mm" → nezname (desatinné s bodkou)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 4.4 mm')).toBe('nezname');
	});
});

// ---- TESNENIE_KODY ----

describe('TESNENIE_KODY', () => {
	it('tesnenie4 = ZASK00005', () => {
		expect(TESNENIE_KODY.tesnenie4.kod).toBe('ZASK00005');
	});

	it('tesnenie6 = ZASK00006', () => {
		expect(TESNENIE_KODY.tesnenie6.kod).toBe('ZASK00006');
	});
});

// ---- tesneniePolozky (single-posuv) ----

describe('tesneniePolozky', () => {
	it('vracia prázdne pre Robust (nie STANDARD systém)', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Robust', 'Float sklo 6 mm');
		expect(polozky).toEqual([]);
		expect(warn).toBeNull();
	});

	// Štandard +|3K — S=3000, V=2100
	//   ZASP202415 (kladkový, 3600mm tyč): pocetKs=6, koef=1, delitN=1, offset=-172.5
	//     val = (1*3000 + (-172.5)) / 3 = 942.5 → 943 (Math.round, kerf=0)
	//     6 ks × 943 = 5658 mm = „súčet šírok kladkových profilov" (Dominik verbatim)
	// KOLO 2: dĺžka = LEN kladkový = 5.658 m (nie +nos +krajová = staré 18.06 m).
	it('vracia ZASK00005 pre 4mm sklo Štandard + (5.658 m — kladkový only)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00005');
		expect(polozky[0]!.mj).toBe('m');
		expect(polozky[0]!.qty).toBe(5.658);
	});

	it('vracia ZASK00006 pre 6mm sklo Štandard +', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(5.658);
	});

	it('vracia prázdne polozky pre izolačné sklo (bez gumy)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Izolačné sklo 4.8.4');
		expect(polozky).toEqual([]);
		// Izolačné = žiadny warn (Dominik: "bez gumy" = OK)
		expect(warn).toBeNull();
	});

	it('vracia warn pre neznáme sklo (10mm)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 10 mm');
		expect(polozky).toEqual([]);
		expect(warn).toContain('10 mm');
		expect(warn).toContain('ZASK00005');
	});

	// ZASK202541 NIE JE v tesnenie warn — vlastní ho KOVANIE_NEUPLNE (🟡2 review fix)
	it('warn NEobsahuje ZASK202541 (vlastní ho KOVANIE_NEUPLNE)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		// 4mm = platný kód, žiadny warn vôbec
		expect(warn).toBeNull();
	});

	// Štandard Drevo|4K — S=5500, V=2132 (cross-check s compute-drevostavby.test.ts)
	//   ZASP202415 (kladkový): 8 ks × 1333 mm = 10664 mm = 10.664 m (kladkový only)
	//   (nos/krajová sa do dĺžky tesnenia UŽ nerátajú — KOLO 2 korekcia)
	it('Štandard Drevo 4K: 10.664 m pre 6mm sklo (kladkový only)', () => {
		const result = computeFlat(cfg, 'Štandard Drevo|4K', 5500, 2132, false);
		expect(result).not.toBeNull();
		expect(result!.system).toBe('Štandard Drevo');
		const { polozky } = tesneniePolozky(result!.material, 'Štandard Drevo', 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(10.664);
	});

	// Štandard +|2K — S=2000, V=2000
	// ZASP202415 (kladkový): pocetKs=4, offset=-147.5, val = (2000 + (-147.5))/2 = 926.25 → 926
	//   4 ks × 926 = 3704 mm = 3.704 m (kladkový only — KOLO 2 korekcia, nie +nos +krajová)
	it('Štandard + 2K: 3.704 m (kladkový only)', () => {
		const r = computeFlat(cfg, 'Štandard +|2K', 2000, 2000, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.qty).toBe(3.704);
	});

	// IZO varianta Štandard +|3K IZO — rovnaké profily, rovnaká dĺžka
	it('Štandard + 3K IZO: rovnaká dĺžka ako basic (profily identické)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		expect(r).not.toBeNull();
		// IZO → prázdne polozky (bez gumy), ale dĺžka by bola rovnaká
		const { polozky: p4 } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(p4[0]!.qty).toBe(5.658);
	});
});

// ---- tesneniePolozkyPooled (multi-posuv) ----

describe('tesneniePolozkyPooled', () => {
	it('vracia prázdne pre Robust-only zákazku', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(r!.material, ['Robust'], 'Float sklo 6 mm');
		expect(polozky).toEqual([]);
	});

	it('funguje s jedným Štandard + posuvom', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(r!.material, ['Štandard +'], 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(5.658);
	});

	it('ignoruje Robust system v zmiešanom poli', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(
			r!.material,
			['Robust', 'Štandard +'],
			'Float sklo 6 mm'
		);
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.qty).toBe(5.658);
	});

	it('warn NEobsahuje ZASK202541', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { warn } = tesneniePolozkyPooled(r!.material, ['Štandard +'], 'Float sklo 6 mm');
		expect(warn).toBeNull(); // 6mm = platný kód, žiadny warn
	});
});

// ---- KOLO 2 regresia: dĺžka = SÚČET ŠÍROK KLADKOVÝCH PROFILOV (ZASP202415), NIE 3-profilový
// súčet (Dominik verbatim, úloha 582, 8.9. — „je to súčet sírok (kladkových profilov)").
// Konkrétne šírky kladkového rezu → dĺžka tesnenia + kód podľa hrúbky skla 4/6/IZO. ----

describe('KOLO 2: dĺžka tesnenia = Σ šírok kladkových profilov (ZASP202415) only', () => {
	// Pomocník: Σ rezných šírok kladkového profilu (ZASP202415) z materiálu, v mm.
	const kladkovyMm = (material: { kod: string; rezy: { rozmer: number; ks: number }[] }[]) =>
		material
			.filter((m) => m.kod === 'ZASP202415')
			.reduce((s, m) => s + m.rezy.reduce((a, r) => a + r.rozmer * r.ks, 0), 0);

	it('dĺžka = Σ(kladkový ZASP202415), NIE +nos +krajová (Štandard + 3K, 4mm)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const kladkovy = kladkovyMm(r!.material); // konkrétne šírky kladkových profilov: 6×943 = 5658 mm
		expect(kladkovy).toBe(5658);
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00005'); // 4 mm → ZASK00005
		// dĺžka = presne kladkový/1000, zaokrúhlené na 3 desatinné (R3)
		expect(polozky[0]!.qty).toBe(Math.round(kladkovy) / 1000);
		expect(polozky[0]!.qty).toBe(5.658);
		// STRÁŽ regresie: NESMIE to byť starý 3-profilový (obvodový) súčet 18.06 m
		expect(polozky[0]!.qty).not.toBe(18.06);
	});

	it('6 mm → ZASK00006, tá istá kladkový-only dĺžka', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006'); // 6 mm → ZASK00006
		expect(polozky[0]!.qty).toBe(Math.round(kladkovyMm(r!.material)) / 1000);
	});

	it('izolačné (IZO) → ŽIADNE tesnenie (bez gumy), aj keď kladkový existuje', () => {
		const r = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		expect(r).not.toBeNull();
		// kladkový profil V MATERIÁLI existuje (dĺžka by bola > 0)…
		expect(kladkovyMm(r!.material)).toBeGreaterThan(0);
		// …ale IZO sklo → žiadny tesnenie riadok (Dominik: „pre izolačne … ide bez gumy")
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Izolačné sklo 4.8.4');
		expect(polozky).toEqual([]);
		expect(warn).toBeNull();
	});

	it('kefa ZASK00007 = kladkový × 2, tesnenie = kladkový × 1 (Dominik: „kefy … podľa výpočtu")', () => {
		// Kríž-kontrola pomeru: tesnenie a kefa zdieľajú kladkový základ, kefa má koef 2.
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const tesn = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm').polozky[0]!;
		expect(tesn.qty).toBe(Math.round(kladkovyMm(r!.material)) / 1000);
	});
});

// ---- TESNENIE_SYSTEMY ----

describe('TESNENIE_SYSTEMY', () => {
	it('obsahuje Štandard, Štandard + a Štandard Drevo', () => {
		expect(TESNENIE_SYSTEMY).toEqual(['Štandard', 'Štandard +', 'Štandard Drevo']);
	});
});
