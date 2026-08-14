// Pergola — MATERIÁL / NÁREZ z rozmerov (#155), engine testy. Implementuje LEN
// potvrdené vzorce z analýzy callu (13.8.2026, komentár na #155); všetko O-blokované
// je „zatiaľ nepodporované", nikdy sa nehádže. Display-only — do Money NIČ nezapisuje
// (statický guard: tests/pergola-narez-money-safety.test.ts).
//
// KĽÚČOVÝ VERIFIKAČNÝ VEKTOR: predná noha = predná svetlosť (2200) + 15 = 2215 mm
// sedí 1:1 na reálnu historickú zákazku ZAK2026302 (4× stĺp 2215 mm — doložené v
// mining komentári na #155). To je jediný pár rozmer↔reálny nárez, ktorý sa dá z
// potvrdených vzorcov overiť bez kótovaného výkresu (O1).
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	schemaVykresu,
	chybaPergolaNarezVstupu,
	SYSTEMY,
	PREDNA_SVETLOST_STD,
	PREDNA_NOHA_PRIDAVOK,
	VYSTUHA_ODPOCET,
	MAX_ROZOSTUP_PRIECOK,
	KOD_PRIECKA_NORMAL,
	KOD_PRIECKA_LIGHT,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';

// Massive, na stenu (9/10 pergol) — vzorové kóty z výkresu „PERGOLA MASSIVE 140x140"
// (scr_014/015/031): predná svetlosť 2200, zadná výška 2900, šírka 5760.
const VZOR: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 5760,
	hlbka: 3690,
	prednaSvetlost: 2200,
	vyskaZadna: 2900,
	pocetPrednychNoh: 4,
	uchytenie: 'stena',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: false
};

describe('konštanty — potvrdené hodnoty z callu (nie magické čísla)', () => {
	it('predná svetlosť štandard = 2200, prídavok prednej nohy = 15, výstuha = šírka − 280, rozostup priečok max 700', () => {
		expect(PREDNA_SVETLOST_STD).toBe(2200);
		expect(PREDNA_NOHA_PRIDAVOK).toBe(15);
		expect(VYSTUHA_ODPOCET).toBe(280);
		expect(MAX_ROZOSTUP_PRIECOK).toBe(700);
	});
	it('systém → stĺp + žľab: Robust 18013/18021, Massive 18017/18018', () => {
		expect(SYSTEMY.Robust.stlp.kod).toBe('18013');
		expect(SYSTEMY.Robust.stlp.rozmer).toBe(110);
		expect(SYSTEMY.Robust.zlab.kod).toBe('18021');
		expect(SYSTEMY.Massive.stlp.kod).toBe('18017');
		expect(SYSTEMY.Massive.stlp.rozmer).toBe(140);
		expect(SYSTEMY.Massive.zlab.kod).toBe('18018');
	});
	it('kódy priečky: normal 18004, light 18102', () => {
		expect(KOD_PRIECKA_NORMAL).toBe('18004');
		expect(KOD_PRIECKA_LIGHT).toBe('18102');
	});
});

describe('spocitajNarez — predné nohy (potvrdený vzorec svetlosť + 15)', () => {
	it('VERIFIKÁCIA ZAK2026302: 4 predné nohy pri svetlosti 2200 → 4× 2215 mm', () => {
		const r = spocitajNarez({ ...VZOR, pocetPrednychNoh: 4, prednaSvetlost: 2200 });
		const noha = r.vypocitane.find((p) => p.kod === '18017' && !/zadná/i.test(p.nazov));
		expect(noha).toBeTruthy();
		expect(noha!.dlzkaRezuMm).toBe(2215);
		expect(noha!.pocetKs).toBe(4);
	});
	it('Robust systém → predná noha kód 18013 (110×110)', () => {
		const r = spocitajNarez({ ...VZOR, system: 'Robust' });
		const noha = r.vypocitane.find(
			(p) => !/zadná/i.test(p.nazov) && /noh|stĺp|110|140/i.test(p.nazov)
		);
		expect(noha!.kod).toBe('18013');
	});
	it('predná noha dĺžka = svetlosť + 15 aj pri neštandardnej svetlosti (napr. 2500 → 2515)', () => {
		const r = spocitajNarez({ ...VZOR, prednaSvetlost: 2500 });
		expect(r.informativne.prednaNohaDlzka).toBe(2515);
	});
});

describe('spocitajNarez — zadné nohy LEN pri samostatne stojacej', () => {
	it('na stenu (9/10) → žiadne zadné nohy vôbec', () => {
		const r = spocitajNarez({ ...VZOR, uchytenie: 'stena' });
		expect(r.vypocitane.some((p) => /zadná/i.test(p.nazov))).toBe(false);
		expect(r.informativne.zadnaNohaDlzka).toBeNull();
	});
	it('samostatne stojaca, horný profil 140 → zadná noha = výška zadná − 140 (2900 − 140 = 2760)', () => {
		const r = spocitajNarez({
			...VZOR,
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 140,
			pocetZadnychNoh: 4
		});
		const zadna = r.vypocitane.find((p) => /zadná/i.test(p.nazov));
		expect(zadna).toBeTruthy();
		expect(zadna!.dlzkaRezuMm).toBe(2760);
		expect(zadna!.pocetKs).toBe(4);
		expect(r.informativne.zadnaNohaDlzka).toBe(2760);
	});
	it('OPRAVA z callu: horný profil zadnej NIE je viazaný na systém — Massive s horným 110 → výška − 110', () => {
		const r = spocitajNarez({
			...VZOR,
			system: 'Massive',
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 110
		});
		expect(r.informativne.zadnaNohaDlzka).toBe(2790);
	});
});

describe('spocitajNarez — priečky (počet z max rozostupu 700, dĺžka O1-blokovaná)', () => {
	it('počet priečok = ceil(šírka/700) + 1 (šírka 5000 → ceil(7.14)+1 = 9)', () => {
		const r = spocitajNarez({ ...VZOR, sirka: 5000 });
		expect(r.informativne.pocetPriecok).toBe(9);
		const priecka = r.vypocitane.find((p) => p.kod === KOD_PRIECKA_NORMAL);
		expect(priecka!.pocetKs).toBe(9);
	});
	it('presné delenie (šírka 4200 → ceil(6)+1 = 7)', () => {
		expect(spocitajNarez({ ...VZOR, sirka: 4200 }).informativne.pocetPriecok).toBe(7);
	});
	it('dĺžka rezu priečky je NULL (= HH krovu, #161 neodvoditeľné), nie vymyslená', () => {
		const priecka = spocitajNarez(VZOR).vypocitane.find((p) => /priečk/i.test(p.nazov));
		expect(priecka!.dlzkaRezuMm).toBeNull();
		// #205: kótovaný výkres OP260282 dorazil, ale priečka = HH krovu, čo nie je vzorec
		// zo vstupov (CAD výsledok geometrie krovu) → poznámka odkazuje na HH krovu / #161
		expect(priecka!.poznamka).toMatch(/HH krovu|#161/i);
	});
	it('light checkbox → kód priečky 18102, inak 18004', () => {
		expect(
			spocitajNarez({ ...VZOR, prieckaLight: true }).vypocitane.some(
				(p) => p.kod === KOD_PRIECKA_LIGHT
			)
		).toBe(true);
		expect(
			spocitajNarez({ ...VZOR, prieckaLight: false }).vypocitane.some(
				(p) => p.kod === KOD_PRIECKA_NORMAL
			)
		).toBe(true);
	});
});

describe('spocitajNarez — informatívne výpočty', () => {
	it('výstuha rez = šírka − 280 (5760 → 5480) — informatívne, profil O2/O3 neurčený', () => {
		expect(spocitajNarez({ ...VZOR, sirka: 5760 }).informativne.vystuhaRezMm).toBe(5480);
	});
	it('rozostup predných nôh = šírka / (počet − 1), dopočítané (5760, 4 nohy → 1920)', () => {
		expect(
			spocitajNarez({ ...VZOR, sirka: 5760, pocetPrednychNoh: 4 }).informativne.rozostupPrednychNoh
		).toBe(1920);
	});
	it('rozostup pri 1 nohe je null (žiadne rozpätie) — obranný fallback, nie NaN', () => {
		// validácia to inak nepustí, ale engine musí byť robustný
		expect(
			spocitajNarez({ ...VZOR, pocetPrednychNoh: 1 }).informativne.rozostupPrednychNoh
		).toBeNull();
	});
});

describe('spocitajNarez — zatiaľ nepodporované (O-otázky), nič sa nehádže', () => {
	it('krov, lišty (HH krovu), sklá v nepodporované; žľab + kotviaci sú TERAZ vo vypocitane (#205)', () => {
		const r = spocitajNarez(VZOR);
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/krov/i);
		expect(n).toMatch(/#161/);
		expect(n).toMatch(/lišt|prítlačn|maskovac/i);
		expect(n).toMatch(/skl/i);
		expect(n).toMatch(/O1/);
		// #205: žľab (18018/18021) + kotviaci (18019) sa presunuli z „nepodporované" do
		// „vypocitane" — kótovaný výkres OP260282 potvrdil dĺžku = šírka (O1 čiastočne).
		expect(
			r.vypocitane.some((p) => /žľab|žlab/i.test(p.nazov) && p.dlzkaRezuMm === VZOR.sirka)
		).toBe(true);
		expect(r.vypocitane.some((p) => p.kod === '18019' && p.dlzkaRezuMm === VZOR.sirka)).toBe(true);
	});
	it('zosilnený nosník checkbox → profil (250×110/230×110/200×140) je nepodporovaný (O2/O3)', () => {
		const bez = spocitajNarez({ ...VZOR, zosilnenyNosnik: false }).nepodporovane.join(' | ');
		const s = spocitajNarez({ ...VZOR, zosilnenyNosnik: true }).nepodporovane.join(' | ');
		expect(bez).not.toMatch(/zosilnen/i);
		expect(s).toMatch(/zosilnen/i);
		expect(s).toMatch(/O2|O3/);
	});
	it('spád/kliny sú vylúčené s poznámkou, že patria k zaskleniu (nie k nohám)', () => {
		expect(spocitajNarez(VZOR).nepodporovane.join(' | ')).toMatch(/klin|spád/i);
	});
});

describe('chybaPergolaNarezVstupu — validácia rozsahov', () => {
	it('vzorové hodnoty sú platné', () => {
		expect(chybaPergolaNarezVstupu(VZOR)).toBeNull();
	});
	it('šírka mimo rozsahu = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, sirka: 100 })).toMatch(/šírka/i);
	});
	it('predná svetlosť mimo rozsahu = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, prednaSvetlost: 100 })).toMatch(/svetlosť/i);
	});
	it('počet predných nôh mimo rozsahu = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, pocetPrednychNoh: 1 })).toMatch(/predných nôh/i);
	});
	it('horný profil zadnej musí byť 110 alebo 140', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, hornyProfilZadnej: 120 as 110 })).toMatch(/horn/i);
	});
	it('samostatne stojaca: výška zadná mimo rozsahu = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, uchytenie: 'samostatne', vyskaZadna: 100 })).toMatch(
			/zadná|výšk/i
		);
	});
	it('na stenu: výška zadná sa NEvaliduje (nepoužíva sa) — 0 je OK', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, uchytenie: 'stena', vyskaZadna: 0 })).toBeNull();
	});
	it('samostatne stojaca: počet zadných nôh mimo rozsahu = chyba', () => {
		expect(
			chybaPergolaNarezVstupu({ ...VZOR, uchytenie: 'samostatne', pocetZadnychNoh: 1 })
		).toMatch(/zadných nôh/i);
	});
});

// --- Geometria technického výkresu (#194) --------------------------------------
describe('schemaVykresu (#194) — geometria z POTVRDENÝCH vzorcov, krov je #161', () => {
	it('profil systému + výšky: Massive 140, predná svetlosť 2200, predná noha 2215', () => {
		const s = schemaVykresu(VZOR);
		expect(s.profilRozmer).toBe(140);
		expect(s.zlabHrubka).toBe(140);
		expect(s.prednaSvetlost).toBe(2200);
		expect(s.prednaNohaDlzka).toBe(2215); // 2200 + 15 (ZAK2026302)
		expect(schemaVykresu({ ...VZOR, system: 'Robust' }).profilRozmer).toBe(110);
	});

	it('predné nohy: 4 nohy na šírke 5760 → rovnomerne [0,1920,3840,5760], rozostup 1920', () => {
		const s = schemaVykresu(VZOR);
		expect(s.prednaNohyX).toEqual([0, 1920, 3840, 5760]);
		expect(s.rozostupPrednychNoh).toBe(1920);
	});

	it('2 predné nohy → krajné [0, sirka], rozostup = celá šírka', () => {
		const s = schemaVykresu({ ...VZOR, sirka: 5000, pocetPrednychNoh: 2 });
		expect(s.prednaNohyX).toEqual([0, 5000]);
		expect(s.rozostupPrednychNoh).toBe(5000);
	});

	it('na stenu (default 9/10): zadná konštrukcia = stena, žiadne zadné nohy', () => {
		const s = schemaVykresu(VZOR);
		expect(s.zadnaKonstrukcia.typ).toBe('stena');
	});

	it('samostatne stojaca: zadné nohy s dĺžkou = výška zadná − horný profil (2900 − 140 = 2760)', () => {
		const s = schemaVykresu({ ...VZOR, uchytenie: 'samostatne', pocetZadnychNoh: 4 });
		expect(s.zadnaKonstrukcia.typ).toBe('samostatne');
		if (s.zadnaKonstrukcia.typ === 'samostatne') {
			expect(s.zadnaKonstrukcia.nohaDlzka).toBe(2760);
			expect(s.zadnaKonstrukcia.vyskaZadna).toBe(2900);
			expect(s.zadnaKonstrukcia.hornyProfil).toBe(140);
			expect(s.zadnaKonstrukcia.nohyX).toEqual([0, 1920, 3840, 5760]);
		}
		// horný profil 110 → 2900 − 110 = 2790
		const s110 = schemaVykresu({
			...VZOR,
			uchytenie: 'samostatne',
			hornyProfilZadnej: 110
		});
		if (s110.zadnaKonstrukcia.typ === 'samostatne')
			expect(s110.zadnaKonstrukcia.nohaDlzka).toBe(2790);
	});

	it('priečky: počet = ceil(5760/700)+1 = 10, vnútorných deliacich = 8, každý rozostup ≤ 700', () => {
		const s = schemaVykresu(VZOR);
		expect(s.priecky.pocet).toBe(10);
		expect(s.priecky.pozicieX).toHaveLength(8); // bez 2 krajných
		// rozostup medzi susednými (vrátane krajných 0 a sirka) ≤ 700
		const vsetky = [0, ...s.priecky.pozicieX, VZOR.sirka];
		for (let i = 1; i < vsetky.length; i++)
			expect(vsetky[i] - vsetky[i - 1]).toBeLessThanOrEqual(MAX_ROZOSTUP_PRIECOK + 1e-6);
		// vnútorné pozície sú striktne medzi 0 a sirka
		for (const x of s.priecky.pozicieX) {
			expect(x).toBeGreaterThan(0);
			expect(x).toBeLessThan(VZOR.sirka);
		}
	});

	it('priečky rozostup ≤ 700 aj pri extrémnej šírke (20000) — invariant, nie len demo', () => {
		const s = schemaVykresu({ ...VZOR, sirka: 20000 });
		const vsetky = [0, ...s.priecky.pozicieX, 20000];
		for (let i = 1; i < vsetky.length; i++)
			expect(vsetky[i] - vsetky[i - 1]).toBeLessThanOrEqual(MAX_ROZOSTUP_PRIECOK + 1e-6);
	});

	it('schemaVykresu je čistá — nič nezapisuje, hodnoty sedia so spocitajNarez informatívnymi', () => {
		const s = schemaVykresu(VZOR);
		const info = spocitajNarez(VZOR).informativne;
		expect(s.prednaNohaDlzka).toBe(info.prednaNohaDlzka);
		expect(s.priecky.pocet).toBe(info.pocetPriecok);
		expect(s.rozostupPrednychNoh).toBe(info.rozostupPrednychNoh);
	});
});
