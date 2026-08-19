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
	efektivnaSvetlost,
	SYSTEMY,
	PREDNA_SVETLOST_STD,
	PREDNA_NOHA_PRIDAVOK,
	VYSTUHA_ODPOCET,
	VYSTUHA_200x140_SVETLOST_ODPOCET,
	POD_KOTVIACI_110x43_ODPOCET,
	POCET_BOCNYCH_POD_KOTVIACIM,
	KOD_PROFIL_110x43,
	KOD_VYSTUHA_200x140,
	MAX_ROZOSTUP_PRIECOK,
	KOD_PRIECKA_NORMAL,
	KOD_PRIECKA_LIGHT,
	type PergolaNarezVstup,
	type VystuhaProfil
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
	it('#205: samostatne stojaca → zadná noha = PLNÁ zadná výška (výkres OP260282), 2900 → 2900', () => {
		const r = spocitajNarez({
			...VZOR,
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 140,
			pocetZadnychNoh: 4
		});
		const zadna = r.vypocitane.find((p) => /zadná/i.test(p.nazov));
		expect(zadna).toBeTruthy();
		expect(zadna!.dlzkaRezuMm).toBe(2900); // plná ZV (nie ZV−profil); výkres OP260282
		expect(zadna!.pocetKs).toBe(4);
		expect(r.informativne.zadnaNohaDlzka).toBe(2900);
	});
	it('#205: dĺžka zadnej nohy = plná ZV nezávisí od hornyProfilZadnej (110 aj 140 → 2900)', () => {
		// Po korekcii výkresom hornyProfilZadnej UŽ neurčuje dĺžku nohy (call citoval ZV−profil,
		// výkres uvádza plnú ZV) — 110/140 teraz slúži ako diskriminátor kaskády 110×43 pod fixom.
		const s110 = spocitajNarez({
			...VZOR,
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 110
		});
		const s140 = spocitajNarez({
			...VZOR,
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 140
		});
		expect(s110.informativne.zadnaNohaDlzka).toBe(2900);
		expect(s140.informativne.zadnaNohaDlzka).toBe(2900);
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
		// #233 — poznámka je plain slovenčina (HH krovu / #161 → „horná hrana krovu")
		expect(priecka!.poznamka).toMatch(/hrana krovu/i);
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
		const n = r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ');
		expect(n).toMatch(/krov/i);
		// #233 — interné referencie (#161, O1) nahradené plain slovenčinou
		expect(n).toMatch(/čaká na vzorec/i);
		expect(n).toMatch(/lišt|prítlačn|maskovac/i);
		expect(n).toMatch(/skl/i);
		expect(n).toMatch(/hrana krovu/i);
		// #205: žľab (18018/18021) + kotviaci (18019) sa presunuli z „nepodporované" do
		// „vypocitane" — kótovaný výkres OP260282 potvrdil dĺžku = šírka (O1 čiastočne).
		expect(
			r.vypocitane.some((p) => /žľab|žlab/i.test(p.nazov) && p.dlzkaRezuMm === VZOR.sirka)
		).toBe(true);
		expect(r.vypocitane.some((p) => p.kod === '18019' && p.dlzkaRezuMm === VZOR.sirka)).toBe(true);
	});
	it('zosilnený nosník checkbox → profil (250×110/230×110/200×140) je nepodporovaný (O2/O3)', () => {
		const bez = spocitajNarez({ ...VZOR, zosilnenyNosnik: false })
			.nepodporovane.map((x) => x.kratky + ' ' + x.detail)
			.join(' | ');
		const s = spocitajNarez({ ...VZOR, zosilnenyNosnik: true })
			.nepodporovane.map((x) => x.kratky + ' ' + x.detail)
			.join(' | ');
		expect(bez).not.toMatch(/zosilnen/i);
		expect(s).toMatch(/zosilnen/i);
		// #233 — O2/O3 nahradené plain vysvetlením
		expect(s).toMatch(/per-systém|čaká na vzorec/i);
	});
	it('spád/kliny sú vylúčené s poznámkou, že patria k zaskleniu (nie k nohám)', () => {
		expect(
			spocitajNarez(VZOR)
				.nepodporovane.map((x) => x.kratky + ' ' + x.detail)
				.join(' | ')
		).toMatch(/klin|spád/i);
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
	it('#206 na stenu + jednoduchá bez zasklenia: ZV sa NEvaliduje (nepoužíva sa) — 0 je OK', () => {
		expect(
			chybaPergolaNarezVstupu({
				...VZOR,
				uchytenie: 'stena',
				jednoduchaBezZasklenia: true,
				vyskaZadna: 0
			})
		).toBeNull();
	});
	it('#206 na stenu + zasklená: ZV je load-bearing (bočný 110×43 = ZV−190) → mimo rozsahu = chyba', () => {
		// stena + zasklená (default) používa ZV pre bočný 110×43 pod kotviacim → 0 je chyba
		expect(chybaPergolaNarezVstupu({ ...VZOR, uchytenie: 'stena', vyskaZadna: 0 })).toMatch(
			/zadná ZV|110×43/i
		);
		// platná ZV pri stena+zasklená = OK
		expect(chybaPergolaNarezVstupu({ ...VZOR, uchytenie: 'stena', vyskaZadna: 2790 })).toBeNull();
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

	it('#205: samostatne stojaca → zadné nohy = PLNÁ ZV (2900), nezávisí od hornyProfilZadnej', () => {
		const s = schemaVykresu({ ...VZOR, uchytenie: 'samostatne', pocetZadnychNoh: 4 });
		expect(s.zadnaKonstrukcia.typ).toBe('samostatne');
		if (s.zadnaKonstrukcia.typ === 'samostatne') {
			expect(s.zadnaKonstrukcia.nohaDlzka).toBe(2900); // plná ZV (výkres OP260282)
			expect(s.zadnaKonstrukcia.vyskaZadna).toBe(2900);
			expect(s.zadnaKonstrukcia.hornyProfil).toBe(140);
			expect(s.zadnaKonstrukcia.nohyX).toEqual([0, 1920, 3840, 5760]);
		}
		// horný profil 110 → stále plná ZV = 2900 (dĺžka nohy už nezávisí od profilu)
		const s110 = schemaVykresu({
			...VZOR,
			uchytenie: 'samostatne',
			hornyProfilZadnej: 110
		});
		if (s110.zadnaKonstrukcia.typ === 'samostatne')
			expect(s110.zadnaKonstrukcia.nohaDlzka).toBe(2900);
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

// --- #206 (a) — jednoduchá pergola bez zasklenia vypína bočné 110×43 ----------------
describe('#206 (a) jednoduchá pergola bez zasklenia — vypne bočné 110×43', () => {
	it('stena + zasklená → bočný 110×43 pod kotviacim JE vo vypocitane; bez zasklenia → NIE JE', () => {
		const zasklena = spocitajNarez({ ...VZOR, uchytenie: 'stena', vyskaZadna: 2900 });
		expect(zasklena.vypocitane.some((p) => p.kod === KOD_PROFIL_110x43)).toBe(true);

		const bez = spocitajNarez({
			...VZOR,
			uchytenie: 'stena',
			vyskaZadna: 2900,
			jednoduchaBezZasklenia: true
		});
		expect(bez.vypocitane.some((p) => p.kod === KOD_PROFIL_110x43)).toBe(false);
		expect(bez.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ')).toMatch(
			/bez zasklenia/i
		);
	});

	it('default (pole nezadané) = zasklená (bočný 110×43 sa počíta pri stene)', () => {
		// jednoduchaBezZasklenia je voliteľné → undefined sa správa ako false (zasklená)
		expect(
			spocitajNarez({ ...VZOR, uchytenie: 'stena', vyskaZadna: 2900 }).vypocitane.some(
				(p) => p.kod === KOD_PROFIL_110x43
			)
		).toBe(true);
	});
});

// --- #206 (b) — bočný 110×43 pod kotviacim = ZV − 190 pri NIE-SS --------------------
// (po #205 sú dva 110×43 riadky: „pod fixom" — VŠETKY konfigy, kaskáda z hĺbky; „pod kotviacim" —
// len NIE-SS, ZV−190. Preto sa tu disambiguuje NÁZVOM, nie len kódom 18016.)
const podKotviacim = (r: ReturnType<typeof spocitajNarez>) =>
	r.vypocitane.find((p) => p.kod === KOD_PROFIL_110x43 && /pod kotviacim/i.test(p.nazov));
describe('#206 (b) 110×43 pod kotviacim (u steny) = ZV − 190, len NIE-SS', () => {
	it('POTVRDENÝ vzorec: stena, ZV 2790 → bočný 110×43 = 2600, 2 ks, výdaj 1×(7,5 m)', () => {
		const r = spocitajNarez({ ...VZOR, uchytenie: 'stena', vyskaZadna: 2790 });
		const boc = podKotviacim(r);
		expect(boc, '110×43 pod kotviacim musí byť vo vypocitane pri stene').toBeTruthy();
		expect(boc!.dlzkaRezuMm).toBe(2790 - POD_KOTVIACI_110x43_ODPOCET); // 2600
		expect(boc!.pocetKs).toBe(POCET_BOCNYCH_POD_KOTVIACIM); // 2
		expect(boc!.vydajTyce).toEqual({ tycMm: 7500, pocet: 1 });
		expect(boc!.nazov).toMatch(/pod kotviacim/i);
	});

	it('konštanta = 190 (nie magické číslo)', () => {
		expect(POD_KOTVIACI_110x43_ODPOCET).toBe(190);
	});

	it('samostatne stojaca (SS) → žiadny bočný 110×43 POD KOTVIACIM (poznámka b je len NIE-SS)', () => {
		const r = spocitajNarez({ ...VZOR, uchytenie: 'samostatne', vyskaZadna: 2790 });
		expect(podKotviacim(r)).toBeUndefined(); // pod fixom pri SS existuje, pod kotviacim NIE
	});

	it('ZV mimo rozsahu (0 pri stene) → POD KOTVIACIM sa NEemituje, žiadna chyba (na stenu ZV nevaliduje)', () => {
		const r = spocitajNarez({ ...VZOR, uchytenie: 'stena', vyskaZadna: 0 });
		expect(podKotviacim(r)).toBeUndefined(); // pod fixom (z hĺbky) tým nie je dotknutý
	});
});

// --- #205 — bočný 110×43 „pod fixom" = HĹBKA − (predná noha profil + zadný prvok) --------
describe('#205 110×43 „pod fixom" (2 ks) = hĺbka − kaskáda (system × SS/stena × 110/140)', () => {
	const podFixom = (r: ReturnType<typeof spocitajNarez>) =>
		r.vypocitane.find((p) => p.kod === KOD_PROFIL_110x43 && /pod fixom/i.test(p.nazov));

	it('massive SS so 110 zadnou = hĺbka − 250 (140+110); OP260282: 3470 − 250 = 3220, 2 ks', () => {
		const r = spocitajNarez({
			...VZOR,
			system: 'Massive',
			hlbka: 3470,
			uchytenie: 'samostatne',
			hornyProfilZadnej: 110,
			vyskaZadna: 2790
		});
		const pf = podFixom(r)!;
		expect(pf, 'pod fixom musí byť vo vypocitane').toBeTruthy();
		expect(pf.dlzkaRezuMm).toBe(3220);
		expect(pf.pocetKs).toBe(2);
	});

	it('kaskáda reprodukuje všetkých 5 hodnôt z poznámky výkresu (odpočet = frontProfil + zadný prvok)', () => {
		const dl = (o: Partial<PergolaNarezVstup>) =>
			podFixom(spocitajNarez({ ...VZOR, hlbka: 3470, vyskaZadna: 2790, ...o }))!.dlzkaRezuMm;
		// robust stena: 110+43 = 153
		expect(dl({ system: 'Robust', uchytenie: 'stena' })).toBe(3470 - 153);
		// robust SS (110): 110+110 = 220
		expect(dl({ system: 'Robust', uchytenie: 'samostatne', hornyProfilZadnej: 110 })).toBe(
			3470 - 220
		);
		// massive stena: 140+43 = 183
		expect(dl({ system: 'Massive', uchytenie: 'stena' })).toBe(3470 - 183);
		// massive SS 110: 140+110 = 250
		expect(dl({ system: 'Massive', uchytenie: 'samostatne', hornyProfilZadnej: 110 })).toBe(
			3470 - 250
		);
		// massive SS 140: 140+140 = 280
		expect(dl({ system: 'Massive', uchytenie: 'samostatne', hornyProfilZadnej: 140 })).toBe(
			3470 - 280
		);
	});

	it('pod fixom sa vypína „jednoduchá pergola bez zasklenia" (#206 a)', () => {
		const bez = spocitajNarez({
			...VZOR,
			hlbka: 3470,
			uchytenie: 'samostatne',
			vyskaZadna: 2790,
			jednoduchaBezZasklenia: true
		});
		expect(podFixom(bez)).toBeUndefined();
	});
});

// --- #206 (c) — výstuha 200×140 → svetlosť −60; Robust varianty honest-null ----------
describe('#206 (c) výstuha 200×140 → svetlosť −60 (preteká do prednej nohy)', () => {
	it('konštanta = 60 (200 − 140); efektívna svetlosť = zadaná − 60 pri 200×140', () => {
		expect(VYSTUHA_200x140_SVETLOST_ODPOCET).toBe(60);
		expect(efektivnaSvetlost({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' })).toBe(
			2140
		);
		// bez 200×140 → efektívna = zadaná (žiadny −60)
		expect(efektivnaSvetlost({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '140x140' })).toBe(
			2200
		);
		expect(efektivnaSvetlost({ ...VZOR, prednaSvetlost: 2200 })).toBe(2200);
	});

	it('predná noha pri 200×140 = (svetlosť − 60) + 15 (2200 → 2155), inak nezmenená (2215)', () => {
		const r200 = spocitajNarez({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' });
		expect(r200.informativne.efektivnaSvetlost).toBe(2140);
		expect(r200.informativne.prednaNohaDlzka).toBe(2155); // (2200−60)+15
		const noha200 = r200.vypocitane.find((p) => !/zadná/i.test(p.nazov) && /noha/i.test(p.nazov));
		expect(noha200!.dlzkaRezuMm).toBe(2155);

		const rStd = spocitajNarez({ ...VZOR, prednaSvetlost: 2200 });
		expect(rStd.informativne.prednaNohaDlzka).toBe(2215); // POTVRDENÝ vektor sa NEMENÍ
	});

	it('výkres kreslí efektívnu svetlosť (200×140 → 2140), predná noha 2155', () => {
		const s = schemaVykresu({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' });
		expect(s.prednaSvetlost).toBe(2140);
		expect(s.prednaNohaDlzka).toBe(2155);
	});

	it('Robust varianty výstuhy (110×110 / 110×250) — honest-null (žiadny vymyslený riadok)', () => {
		const r = spocitajNarez({ ...VZOR, system: 'Robust', vystuhaProfil: '110x250' });
		// žiadny −60 (to je len 200×140), žiadny vymyslený riadok výstuhy Robust
		expect(r.informativne.efektivnaSvetlost).toBe(VZOR.prednaSvetlost);
		expect(r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ')).toMatch(
			/110×250|110x250/
		);
		expect(r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ')).toMatch(
			/skovan|žľabe/i
		);
		expect(r.informativne.vystuhaProfil).toBe('110x250');
	});

	it('Massive + zosilnený + 200×140: výstuha horná odzrkadľuje kód 18022/200x140 (nie 18017/140x140)', () => {
		const r = spocitajNarez({ ...VZOR, zosilnenyNosnik: true, vystuhaProfil: '200x140' });
		const vy = r.vypocitane.find((p) => /výstuha horná/i.test(p.nazov));
		expect(vy).toBeTruthy();
		expect(vy!.kod).toBe(KOD_VYSTUHA_200x140); // 18022
		expect(vy!.nazov).toMatch(/200x140/);
		expect(vy!.dlzkaRezuMm).toBe(VZOR.sirka - VYSTUHA_ODPOCET); // dĺžka (rozpätie) nezávisí na priereze
		// bez zvoleného 200×140 (default) ostáva 18017/140x140
		const rStd = spocitajNarez({ ...VZOR, zosilnenyNosnik: true });
		expect(rStd.vypocitane.find((p) => /výstuha horná/i.test(p.nazov))!.kod).toBe('18017');
	});

	it('−60 sa neaplikuje pri Robust + 200×140 (nekonzistentný ručný vstup) — gate na Massive', () => {
		expect(efektivnaSvetlost({ ...VZOR, system: 'Robust', vystuhaProfil: '200x140' })).toBe(
			VZOR.prednaSvetlost
		);
	});
});

// --- #206 (d)/(c) — validácia nových polí ------------------------------------------
describe('#206 validácia — zvod frézovanie + profil výstuhy', () => {
	it('zvod: frézovať zapnuté bez výšky = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, zvodFrezovat: true })).toMatch(/frézovani|SH/i);
	});
	it('zvod: frézovať zapnuté s platnou výškou = OK', () => {
		expect(
			chybaPergolaNarezVstupu({ ...VZOR, zvodFrezovat: true, zvodFrezovanieSHmm: 120 })
		).toBeNull();
	});
	it('zvod: nefrézovať (default) → výška sa nevaliduje, OK', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, zvodFrezovat: false })).toBeNull();
	});
	it('neplatný profil výstuhy = chyba', () => {
		expect(chybaPergolaNarezVstupu({ ...VZOR, vystuhaProfil: '999x999' as VystuhaProfil })).toMatch(
			/výstuh/i
		);
	});
	it('profil výstuhy nesedí so systémom = chyba (Robust+200x140, Massive+110x110)', () => {
		// VZOR je Massive; Robust profil pri Massive = nekonzistentné
		expect(chybaPergolaNarezVstupu({ ...VZOR, vystuhaProfil: '110x110' })).toMatch(/systém/i);
		expect(
			chybaPergolaNarezVstupu({ ...VZOR, system: 'Robust', vystuhaProfil: '200x140' })
		).toMatch(/systém/i);
		// konzistentné = OK
		expect(chybaPergolaNarezVstupu({ ...VZOR, vystuhaProfil: '200x140' })).toBeNull();
		expect(
			chybaPergolaNarezVstupu({ ...VZOR, system: 'Robust', vystuhaProfil: '110x250' })
		).toBeNull();
	});
});
