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
	POD_KOTVIACI_110x43_ODPOCET,
	POCET_BOCNYCH_POD_KOTVIACIM,
	KOD_PROFIL_110x43,
	KOD_VYSTUHA_200x140,
	MAX_ROZOSTUP_PRIECOK,
	KOD_PRIECKA_NORMAL,
	KOD_PRIECKA_LIGHT,
	svetlostMedziKrovmi,
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

// --- #155 A9 (Dominik, Odoo 1724498) — predná noha pri VÝSTUHE = svetlosť + rozmer výstuhy ------
// Keď je zosilnený nosník (výstuha), noha = svetlosť + zvislý rozmer výstuhy (110/140/250), NIE +15.
// Kľúč = `zosilnenyNosnik` (nie „je zadaný vystuhaProfil"): profil sa berie z `vystuhaProfil` ak je
// zadaný, inak systémový default (Massive 140×140, Robust 110×110) — OP260282 má prázdny profil.
// Bez zosilnenia ostáva +15 (overený vektor ZAK2026302 sa NEMENÍ).
describe('#155 A9 — predná noha pri výstuhe = svetlosť + rozmer výstuhy (nie +15)', () => {
	const noha = (v: Parameters<typeof spocitajNarez>[0]) =>
		spocitajNarez(v).vypocitane.find(
			(p) => !/zadná/i.test(p.nazov) && /predná noha/i.test(p.nazov)
		);

	it('Massive + zosilnený, default profil (140×140) → 2200 + 140 = 2340 (OP260282 vzor)', () => {
		const v = { ...VZOR, zosilnenyNosnik: true, prednaSvetlost: 2200 };
		expect(spocitajNarez(v).informativne.prednaNohaDlzka).toBe(2340);
		expect(noha(v)!.dlzkaRezuMm).toBe(2340);
	});
	it('Massive + zosilnený + explicitne 140×140 → 2340 (rovnaké ako default)', () => {
		expect(
			spocitajNarez({ ...VZOR, zosilnenyNosnik: true, vystuhaProfil: '140x140' }).informativne
				.prednaNohaDlzka
		).toBe(2340);
	});
	it('Robust + zosilnený, default profil (110×110) → 2200 + 110 = 2310', () => {
		expect(
			spocitajNarez({ ...VZOR, system: 'Robust', zosilnenyNosnik: true }).informativne
				.prednaNohaDlzka
		).toBe(2310);
	});
	it('Robust + zosilnený + 110×250 → 2200 + 250 = 2450 (A9 „pri 250 +250")', () => {
		expect(
			spocitajNarez({
				...VZOR,
				system: 'Robust',
				zosilnenyNosnik: true,
				vystuhaProfil: '110x250'
			}).informativne.prednaNohaDlzka
		).toBe(2450);
	});
	it('200×140 + zosilnený → svetlosť + 200 = 2400 (všeobecné pravidlo; −60 Dominik odvolal)', () => {
		// Dominik ch207 msg 1731729: „tých 60 to je asi zle … výstuha je tiež 15 mm usadená
		// v žľabe … noha je svetlosť +15 [bez výstuhy], pri výstuhe o (výška − 15) dlhšia"
		// → noha = svetlosť + zvislý rozmer výstuhy, VŠEOBECNE (aj 200×140 → +200). Bývalá
		// odvodenina −60+200 = svetlosť+140 (2340) padla spolu s odvolaným −60.
		expect(
			spocitajNarez({ ...VZOR, zosilnenyNosnik: true, vystuhaProfil: '200x140' }).informativne
				.prednaNohaDlzka
		).toBe(2400);
	});
	it('BEZ zosilnenia → +15 VŽDY (aj so zadaným 200×140 profilom): 2215', () => {
		expect(spocitajNarez({ ...VZOR, prednaSvetlost: 2200 }).informativne.prednaNohaDlzka).toBe(
			2215
		);
		// vystuhaProfil zadaný ale zosilnenyNosnik=false → NIE je výstuha → +15. Bývalých 2155
		// bol presak odvolaného −60 do bez-výstuhového prípadu (msg 1731729: „to je asi zle").
		expect(
			spocitajNarez({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' }).informativne
				.prednaNohaDlzka
		).toBe(2215);
	});
	it('neštandardná svetlosť + zosilnený 140 → svetlosť + 140 (2500 → 2640)', () => {
		expect(
			spocitajNarez({ ...VZOR, prednaSvetlost: 2500, zosilnenyNosnik: true }).informativne
				.prednaNohaDlzka
		).toBe(2640);
	});
});

describe('spocitajNarez — zadné nohy LEN pri samostatne stojacej', () => {
	it('na stenu (9/10) → žiadne zadné nohy vôbec', () => {
		const r = spocitajNarez({ ...VZOR, uchytenie: 'stena' });
		expect(r.vypocitane.some((p) => /zadná/i.test(p.nazov))).toBe(false);
		expect(r.informativne.zadnaNohaDlzka).toBeNull();
	});
	it('#316: samostatne stojaca → zadná noha = ZV − horný profil (2900, profil 140 → 2760)', () => {
		const r = spocitajNarez({
			...VZOR,
			uchytenie: 'samostatne',
			vyskaZadna: 2900,
			hornyProfilZadnej: 140,
			pocetZadnychNoh: 4
		});
		const zadna = r.vypocitane.find((p) => /zadná noha/i.test(p.nazov));
		expect(zadna).toBeTruthy();
		expect(zadna!.dlzkaRezuMm).toBe(2760); // ZV − horný profil 140 (Dominik 24.8. kanál 207)
		expect(zadna!.pocetKs).toBe(4);
		expect(r.informativne.zadnaNohaDlzka).toBe(2760);
	});
	it('#316: dĺžka zadnej nohy = ZV − horný profil → ZÁVISÍ od hornyProfilZadnej (110 → 2790, 140 → 2760)', () => {
		// Dominik 24.8. (kanál 207 msg 1731730): horizontálny profil sedí na nohách → dĺžka nohy =
		// ZV − horný profil. hornyProfilZadnej po novom URČUJE dĺžku AJ kód zadnej konštrukcie
		// (predtým chybne: dĺžka = plná ZV nezávislá od profilu).
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
		expect(s110.informativne.zadnaNohaDlzka).toBe(2790); // 2900 − 110
		expect(s140.informativne.zadnaNohaDlzka).toBe(2760); // 2900 − 140
	});
});

// --- #316 — zadná konštrukcia sleduje hornyProfilZadnej (kód + jednotnosť) --------------------
// Dominik 24.8. (kanál 207 msg 1731730): pri výstuhe 110×110 sú aj zadné nohy 110; dĺžka nohy =
// ZV − horný profil; horizontálny profil sedí na nohách. Zadná noha AJ „zadná konštrukcia horná"
// majú sledovať hornyProfilZadnej (110 → 18013/110×110, 140 → 18017/140×140), nie systém/hardcode
// → zadná konštrukcia jednotná by-construction (výkres OP260282 = jednotne 110×110).
describe('#316 — zadná konštrukcia sleduje hornyProfilZadnej (kód + jednotnosť)', () => {
	const SS = (
		hp: 110 | 140,
		system: PergolaNarezVstup['system'] = 'Massive'
	): PergolaNarezVstup => ({
		...VZOR,
		system,
		uchytenie: 'samostatne',
		vyskaZadna: 2900,
		hornyProfilZadnej: hp
	});
	const noha = (r: ReturnType<typeof spocitajNarez>) =>
		r.vypocitane.find((p) => /zadná noha/i.test(p.nazov))!;
	const horna = (r: ReturnType<typeof spocitajNarez>) =>
		r.vypocitane.find((p) => /zadná konštr/i.test(p.nazov))!;

	it('hornyProfilZadnej=110 → zadná noha AJ horná = kód 18013 (110×110), aj pri Massive systéme', () => {
		const r = spocitajNarez(SS(110, 'Massive'));
		expect(noha(r).kod).toBe('18013'); // predtým systémový 18017 → RED
		expect(noha(r).nazov).toMatch(/110x110/);
		expect(horna(r).kod).toBe('18013');
		expect(horna(r).nazov).toMatch(/110x110/);
	});

	it('hornyProfilZadnej=140 → zadná noha AJ horná = kód 18017 (140×140), aj pri Robust systéme', () => {
		const r = spocitajNarez(SS(140, 'Robust'));
		expect(noha(r).kod).toBe('18017');
		expect(noha(r).nazov).toMatch(/140x140/);
		expect(horna(r).kod).toBe('18017'); // predtým hardcoded 18013 → RED
		expect(horna(r).nazov).toMatch(/140x140/);
	});

	it('zadná konštrukcia je JEDNOTNÁ (noha aj horná ten istý kód) pre oba profily', () => {
		for (const hp of [110, 140] as const) {
			const r = spocitajNarez(SS(hp));
			expect(noha(r).kod).toBe(horna(r).kod);
		}
	});

	it('dĺžka zadnej nohy = ZV − horný profil (110 → 2790, 140 → 2760)', () => {
		expect(noha(spocitajNarez(SS(110))).dlzkaRezuMm).toBe(2790);
		expect(noha(spocitajNarez(SS(140))).dlzkaRezuMm).toBe(2760);
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
		// #233 — poznámka je plain slovenčina; jednotné pomenovanie = „nominálna dĺžka krovu"
		// (spodná hrana — review 25.8. zjednotil framing, „horná hrana" bol protirečivý text)
		expect(priecka!.poznamka).toMatch(/nominálna dĺžka krovu/i);
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
		expect(n).toMatch(/nominálna dĺžka krovu/i);
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

	it('#316: samostatne → zadná noha CUT = ZV − horný profil (140 → 2760, 110 → 2790); vizuál ostáva ZV', () => {
		const s = schemaVykresu({ ...VZOR, uchytenie: 'samostatne', pocetZadnychNoh: 4 });
		expect(s.zadnaKonstrukcia.typ).toBe('samostatne');
		if (s.zadnaKonstrukcia.typ === 'samostatne') {
			expect(s.zadnaKonstrukcia.nohaDlzka).toBe(2760); // CUT = 2900 − 140 (VZOR hornyProfilZadnej 140)
			expect(s.zadnaKonstrukcia.vyskaZadna).toBe(2900); // vizuálna výška ostáva plná ZV
			expect(s.zadnaKonstrukcia.hornyProfil).toBe(140);
			expect(s.zadnaKonstrukcia.nohyX).toEqual([0, 1920, 3840, 5760]);
		}
		// horný profil 110 → CUT = 2900 − 110 = 2790 (dĺžka nohy ZÁVISÍ od profilu)
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
			expect(vsetky[i]! - vsetky[i - 1]!).toBeLessThanOrEqual(MAX_ROZOSTUP_PRIECOK + 1e-6);
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
			expect(vsetky[i]! - vsetky[i - 1]!).toBeLessThanOrEqual(MAX_ROZOSTUP_PRIECOK + 1e-6);
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

// --- #155 trčanie výstuhy (1731729) — svetlosť bez výstuhy; Robust varianty honest-null ---
describe('#155 trčanie výstuhy (ch207 1731729) — svetlosť bez výstuhy, −60 ZRUŠENÉ', () => {
	it('výstuha je skovaná 15 mm v žľabe → trčí (zvislý rozmer − 15): 95/125/185/235', () => {
		// Dominik VERBATIM (1731729): „výstuha je tiež 15mm usadená v žlabe tak ako aj noha čiže
		// ked je 110x110 tak výstuha realne trčí von 95mm … ak je vystuha 140x140 tak noha je o
		// dalších 125mm dlhšia". Kontrola konzistencie: 15 + 95 = 110, 15 + 125 = 140 = presne
		// A9 prídavky nohy (noha = svetlosť + 15 + trčanie = svetlosť + zvislý rozmer).
		const t = (v: Partial<PergolaNarezVstup>) =>
			spocitajNarez({ ...VZOR, zosilnenyNosnik: true, ...v }).informativne.vystuhaTrcanieMm;
		expect(t({ vystuhaProfil: '140x140' })).toBe(125);
		expect(t({ system: 'Robust', vystuhaProfil: '110x110' })).toBe(95);
		expect(t({ vystuhaProfil: '200x140' })).toBe(185);
		expect(t({ system: 'Robust', vystuhaProfil: '110x250' })).toBe(235);
		// bez zosilneného nosníka výstuha nie je → trčanie null
		expect(spocitajNarez({ ...VZOR }).informativne.vystuhaTrcanieMm).toBeNull();
	});

	it('svetlosť bez výstuhy = zadaná svetlosť + trčanie (golden OP260282: 2200 + 125 = 2325)', () => {
		// Výkres OP260282 rozlišuje „svetlosť s výstuhou 2200" (zadávaná) vs „bez výstuhy 2325"
		// — rozdiel presne 125 (140×140). Model 1731729 to reprodukuje: 2200 + (140−15) = 2325.
		const r = spocitajNarez({ ...VZOR, prednaSvetlost: 2200, zosilnenyNosnik: true });
		expect(r.informativne.svetlostBezVystuhy).toBe(2325);
		// bez výstuhy sa nezobrazuje (null)
		expect(spocitajNarez({ ...VZOR }).informativne.svetlostBezVystuhy).toBeNull();
	});

	it('žiadny −60: predná noha 200×140 bez zosilnenia = 2215, výkres kreslí zadanú svetlosť', () => {
		const r200 = spocitajNarez({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' });
		expect(r200.informativne.prednaNohaDlzka).toBe(2215); // +15 (výstuha nie je)
		const s = schemaVykresu({ ...VZOR, prednaSvetlost: 2200, vystuhaProfil: '200x140' });
		expect(s.prednaSvetlost).toBe(2200); // kóta = zadaná svetlosť, žiadne tiché −60
		expect(s.prednaNohaDlzka).toBe(2215);

		const rStd = spocitajNarez({ ...VZOR, prednaSvetlost: 2200 });
		expect(rStd.informativne.prednaNohaDlzka).toBe(2215); // POTVRDENÝ vektor sa NEMENÍ
	});

	it('Robust varianty výstuhy (110×110 / 110×250) — honest-null (žiadny vymyslený riadok)', () => {
		const r = spocitajNarez({ ...VZOR, system: 'Robust', vystuhaProfil: '110x250' });
		// bez zosilnenia žiadna výstuha → svetlosť bez výstuhy sa neukazuje
		expect(r.informativne.svetlostBezVystuhy).toBeNull();
		expect(r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ')).toMatch(
			/110×250|110x250/
		);
		expect(r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ')).toMatch(
			/skovan|žľabe/i
		);
		expect(r.informativne.vystuhaProfil).toBe('110x250');
	});

	it('Massive + zosilnený + 200×140: žľabová výstuha odzrkadľuje kód 18022/200x140 (nie 18017/140x140)', () => {
		const r = spocitajNarez({ ...VZOR, zosilnenyNosnik: true, vystuhaProfil: '200x140' });
		const vy = r.vypocitane.find((p) => /žľabová výstuha/i.test(p.nazov));
		expect(vy).toBeTruthy();
		expect(vy!.kod).toBe(KOD_VYSTUHA_200x140); // 18022
		expect(vy!.nazov).toMatch(/200x140/);
		expect(vy!.dlzkaRezuMm).toBe(VZOR.sirka - VYSTUHA_ODPOCET); // dĺžka (rozpätie) nezávisí na priereze
		// bez zvoleného 200×140 (default) ostáva 18017/140x140
		const rStd = spocitajNarez({ ...VZOR, zosilnenyNosnik: true });
		expect(rStd.vypocitane.find((p) => /žľabová výstuha/i.test(p.nazov))!.kod).toBe('18017');
	});

	it('nekonzistentný ručný vstup Robust + 200×140 bez zosilnenia → noha +15 (žiadne tiché odpočty)', () => {
		expect(
			spocitajNarez({ ...VZOR, system: 'Robust', vystuhaProfil: '200x140' }).informativne
				.prednaNohaDlzka
		).toBe(VZOR.prednaSvetlost + 15);
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

describe('#161 — počet krovov (manuál) + svetlosť medzi krovmi', () => {
	// VZOR = Massive, šírka 5760, bez sklonu / počtu krovov
	it('svetlostMedziKrovmi: (šírka − 50n − 2)/(n−1); golden 4990/n=8 → 655,43', () => {
		expect(svetlostMedziKrovmi(4990, 8)).toBe(655.43);
		// null keď n < 2 alebo neplatné (nikdy NaN/delenie nulou)
		expect(svetlostMedziKrovmi(4990, 1)).toBeNull();
		expect(svetlostMedziKrovmi(4990, null)).toBeNull();
		expect(svetlostMedziKrovmi(0, 8)).toBeNull();
	});

	it('manuálny počet krovov RUŠÍ auto pocetPriecok: priečka počet = zadané n (nie ceil(š/700)+1)', () => {
		const auto = spocitajNarez(VZOR); // bez n → fallback auto
		const prieckaAuto = auto.vypocitane.find((p) => /priečk/i.test(p.nazov))!;
		expect(prieckaAuto.pocetKs).toBe(auto.informativne.pocetPriecok); // fallback

		const manual = spocitajNarez({ ...VZOR, pocetKrovov: 6 });
		const prieckaMan = manual.vypocitane.find((p) => /priečk/i.test(p.nazov))!;
		expect(prieckaMan.pocetKs).toBe(6); // manuál víťazí
		expect(manual.informativne.pocetKrovov).toBe(6);
		expect(manual.informativne.svetlostMedziKrovmi).toBe(svetlostMedziKrovmi(VZOR.sirka, 6));
	});

	it('bez počtu krovov → svetlosť/pocetKrovov informativne = null (auto fallback beží)', () => {
		const r = spocitajNarez(VZOR);
		expect(r.informativne.pocetKrovov).toBeNull();
		expect(r.informativne.svetlostMedziKrovmi).toBeNull();
	});
});

describe('#161 — nominálna dĺžka krovu (priečka) + krovové lišty (overená konfigurácia, honest-null)', () => {
	// OVERENÁ konfigurácia golden OP260282: Massive + samostatne stojaca + zadný profil 110 + sklon + n.
	const OVERENA: PergolaNarezVstup = {
		...VZOR,
		uchytenie: 'samostatne',
		hornyProfilZadnej: 110,
		sklonStrechy: 6.1,
		pocetKrovov: 8
	};
	// VZOR hĺbka 3690, sklon 6,1° → nominál 3690/cos(6,1°) − 250
	const NOMINAL = 3690 / Math.cos((6.1 * Math.PI) / 180) - 250;

	it('overená konfigurácia (Massive+samostatne+110) + sklon + n: priečka = nominál, NIE null', () => {
		const pr = spocitajNarez(OVERENA).vypocitane.find((p) => /priečk/i.test(p.nazov))!;
		expect(pr.dlzkaRezuMm).not.toBeNull();
		expect(Math.abs((pr.dlzkaRezuMm as number) - NOMINAL)).toBeLessThan(0.02);
	});

	it('config-gate: nominál sa NEEMITUJE mimo overenej/pravidlom pokrytej konfigurácie (honest-null do Money)', () => {
		// Massive so zadným 140, Massive na stenu, Robust so zadným 140 — NEOVERENÉ → null.
		// (Robust + zadná 110 má od 25.8. Dominikovo pravidlo −220 → emituje sa, viď test nižšie.)
		const konfigy: [string, Partial<PergolaNarezVstup>][] = [
			['Massive + zadný 140', { hornyProfilZadnej: 140 }],
			['Massive na stenu', { uchytenie: 'stena' }],
			['Robust + zadný 140', { system: 'Robust', hornyProfilZadnej: 140 }]
		];
		for (const [nazov, over] of konfigy) {
			const r = spocitajNarez({ ...OVERENA, ...over });
			const pr = r.vypocitane.find((p) => /priečk/i.test(p.nazov))!;
			expect(pr.dlzkaRezuMm, `${nazov}: priečka musí byť null (neoverené)`).toBeNull();
			// a prítlačná/maskovacie sa TIEŽ neemitujú (viazané na nominál)
			expect(
				r.vypocitane.some((p) => ['18006', '18007', '18008'].includes(p.kod)),
				`${nazov}: lišty sa nesmú emitovať`
			).toBe(false);
			expect(r.nepodporovane.map((x) => x.kratky).join(' | ')).toMatch(/prítlačn|maskovac/i);
		}
	});

	it('#161 Robust vetva (ch207 1724329/1724331): priečka = hĺbka/cos − 220, lišty = nominál + 30', () => {
		// Dominik VERBATIM: „pri masíve výsuv −154,94 a pri robuste je to 124,94" (rozdiel presne
		// 30 = predný profil 140 − 110) → Robust = overená masív kotva (−250) + 30 = −220.
		// Lišty (1724331): „pri robuste je výsledok +30 a pri massive +40". Gate: samostatne +
		// zadná 110 (konfigurácia kotvy) + sklon + manuálny počet krovov.
		const r = spocitajNarez({ ...OVERENA, system: 'Robust' });
		const NOMINAL_ROBUST = 3690 / Math.cos((6.1 * Math.PI) / 180) - 220;
		const pr = r.vypocitane.find((p) => /priečk/i.test(p.nazov))!;
		expect(pr.dlzkaRezuMm).not.toBeNull();
		expect(Math.abs((pr.dlzkaRezuMm as number) - NOMINAL_ROBUST)).toBeLessThan(0.02);
		const p6 = r.vypocitane.find((p) => p.kod === '18006')!;
		expect(p6, 'prítlačná sa pri Robust + zadná 110 emituje').toBeTruthy();
		expect(Math.abs((p6.dlzkaRezuMm as number) - (NOMINAL_ROBUST + 30))).toBeLessThan(0.02);
		expect(p6.poznamka).toMatch(/30/); // poznámka nesie Robust prídavok
		// EMITOVANÉ Robust riadky nesú viditeľnú výhradu (bez Robust goldenu) — review 25.8. 🟡:
		// výhrada nesmie žiť len v null vetve, ktorá sa pri emitovaní vôbec nezobrazí.
		expect(p6.poznamkaDetail).toMatch(/na potvrdenie/i);
		expect(pr.poznamkaDetail).toMatch(/na potvrdenie/i);
		// Massive emitovaná priečka výhradu NEnesie (overená výkresom)
		const rM = spocitajNarez(OVERENA);
		const prM = rM.vypocitane.find((p) => /priečk/i.test(p.nazov))!;
		expect(prM.poznamkaDetail).not.toMatch(/na potvrdenie/i);
	});

	it('#415 prítlačná lišta (Robust): PRÍDAVOK +30 je potvrdený (Dominik priamo), odpočet dĺžky krovu ostáva samostatne na potvrdenie', () => {
		// Dominik 2.9. priamo potvrdil prídavok (+30 Robust/+40 Massive) — appka nesmie na
		// obrazovke naďalej tvrdiť, že prídavok čaká na potvrdenie (bola by to zavádzajúca
		// informácia). Odpočet dĺžky krovu (KROV_ODPOCET_ROBUST, #161) je SAMOSTATNÁ,
		// stále neoverená hodnota — jej výhrada musí zostať, len oddelene od prídavku.
		const r = spocitajNarez({ ...OVERENA, system: 'Robust' });
		const p6 = r.vypocitane.find((p) => p.kod === '18006')!;
		expect(p6.poznamkaDetail, 'prídavok musí byť opísaný ako potvrdený').toMatch(
			/prídavok[^.]*potvrden/i
		);
		expect(
			p6.poznamkaDetail,
			'prídavok už nesmie byť spárovaný s „na potvrdenie" v tej istej vete'
		).not.toMatch(/prídavok[^.]*na potvrdenie/i);
		expect(
			p6.poznamkaDetail,
			'odpočet dĺžky krovu (samostatná hodnota, #161) ostáva na potvrdenie'
		).toMatch(/(odpočet|dĺžka krovu)[^.]*na potvrdenie/i);
	});

	it('A7: sklon nad 9° → priečka aj lišty honest-null (pásmo bez vzorca nejde do Money)', () => {
		const r = spocitajNarez({ ...OVERENA, sklonStrechy: 12 });
		expect(r.vypocitane.find((p) => /priečk/i.test(p.nazov))!.dlzkaRezuMm).toBeNull();
		expect(r.vypocitane.some((p) => ['18006', '18007', '18008'].includes(p.kod))).toBe(false);
	});

	it('overená konfigurácia + n: prítlačná(18006)=n, maskovacia(18007)=n−2, krajová(18008)=2 ks; dĺžka = nominál+40', () => {
		const r = spocitajNarez(OVERENA);
		const p6 = r.vypocitane.find((p) => p.kod === '18006')!;
		const p7 = r.vypocitane.find((p) => p.kod === '18007')!;
		const p8 = r.vypocitane.find((p) => p.kod === '18008')!;
		expect(p6.pocetKs).toBe(8); // = n
		expect(p7.pocetKs).toBe(6); // n − 2
		expect(p8.pocetKs).toBe(2); // kraje
		expect(Math.abs((p6.dlzkaRezuMm as number) - (NOMINAL + 40))).toBeLessThan(0.02);
		expect(p6.dlzkaRezuMm).toBe(p7.dlzkaRezuMm); // rovnaká dĺžka
	});

	it('overená konfigurácia + sklon BEZ počtu krovov: priečka aj lišty ostávajú null (auto počet nejde do Money)', () => {
		// bez manuálneho n by priečka niesla starý auto počet ceil(š/700)+1 (výkresom vyvrátený)
		// → do Money sa dĺžka NEpustí (n-gate). Zaklapávacia tiež nie (potrebuje n pre svetlosť).
		const r = spocitajNarez({ ...OVERENA, pocetKrovov: null });
		expect(r.vypocitane.some((p) => p.kod === '18004')).toBe(true); // priečka riadok existuje
		expect(r.vypocitane.find((p) => /priečk/i.test(p.nazov))!.dlzkaRezuMm).toBeNull(); // ...s null dĺžkou
		expect(r.vypocitane.some((p) => ['18005', '18006', '18007', '18008'].includes(p.kod))).toBe(
			false
		);
	});

	it('n bez sklonu: zaklapávacia(18005) sa emituje (svetlosť je geometria), lišty nie (potrebujú nominál)', () => {
		const r = spocitajNarez({ ...VZOR, pocetKrovov: 8 }); // n, ale bez sklonu
		const z = r.vypocitane.find((p) => p.kod === '18005')!;
		expect(z).toBeTruthy();
		expect(z.dlzkaRezuMm).toBe(svetlostMedziKrovmi(VZOR.sirka, 8));
		expect(z.pocetKs).toBe(14); // 2(n−1)
		// prítlačná/maskovacie bez sklonu NIE (nominál null)
		expect(r.vypocitane.some((p) => ['18006', '18007', '18008'].includes(p.kod))).toBe(false);
	});

	it('maskovacia stredná (18007) sa NEEMITUJE pri n=2 (n−2=0), krajová aj prítlačná áno', () => {
		const r = spocitajNarez({ ...OVERENA, pocetKrovov: 2 });
		expect(r.vypocitane.some((p) => p.kod === '18007')).toBe(false); // 0 stredných
		expect(r.vypocitane.find((p) => p.kod === '18006')!.pocetKs).toBe(2);
		expect(r.vypocitane.find((p) => p.kod === '18008')!.pocetKs).toBe(2);
	});

	it('emitované krovové riadky majú výdaj tyčí (bin-packing), nie sú null', () => {
		const r = spocitajNarez(OVERENA);
		for (const kod of ['18004', '18005', '18006', '18007', '18008']) {
			const p = r.vypocitane.find((x) => x.kod === kod)!;
			expect(p.vydajTyce, `${kod} má mať výdaj`).toBeTruthy();
		}
	});

	it('svetlostMedziKrovmi vráti null (nie zápornú) keď sa krovy do šírky nezmestia', () => {
		// šírka 2000, n 50 → (2000 − 2500 − 2)/49 = záporné → null (nikdy do Money)
		expect(svetlostMedziKrovmi(2000, 50)).toBeNull();
		expect(svetlostMedziKrovmi(4990, 8)).toBe(655.43); // kladná ostáva
	});

	it('validácia odmietne priveľa krovov na šírku (záporná svetlosť by inak šla do Money)', () => {
		const chyba = chybaPergolaNarezVstupu({ ...OVERENA, sirka: 2000, pocetKrovov: 50 });
		expect(chyba).toMatch(/počet krovov|nezmestí|svetlosť/i);
		// rozumný počet prejde
		expect(chybaPergolaNarezVstupu({ ...OVERENA, sirka: 2000, pocetKrovov: 4 })).toBeNull();
	});
});
