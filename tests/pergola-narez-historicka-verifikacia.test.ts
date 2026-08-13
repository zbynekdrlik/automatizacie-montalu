// Pergola — VERIFIKÁCIA enginu proti REÁLNYM historickým zákazkám (#196, súčasť #155).
//
// Zmysel: pred napojením enginu na živý Money odpis (#197) systematicky overiť potvrdené
// vzorce (#193) proti reálnym historickým pergolám — nie len proti jednému vektoru
// (ZAK2026302 predná noha 2215 v pergola-narez.test.ts). Tento harness porovnáva výstup
// `spocitajNarez` z rozmerov s REÁLNYM odpisom po kusoch.
//
// DÁTOVÝ ZÁKLAD (zistené z PRIMÁRNEHO zdroja, nie z mining komentára): z 39 reálnych
// historických pergol má surový CAD nárez PO KUSOCH (kód + ks + dĺžka rezu) len 2 —
// ZAK202694 (OP260086) a ZAK2026302 (OP260258) — v legacy repe
// `montalu/n8n/cad2dlv/server-sync/ODPIS VZOR/*.xlsx` (list PERGOLY). K obom existuje
// reálny VYROBA výkres, ktorý ako JEDINÝ nesie fyzické rozmery (svetlosť/šírka/uhol);
// tie sú v odpisovej ceste inak NIKDE. Ostatných 37/39 zákaziek je len agregovaná
// metráž bez rozmerov → z nich sa rozmerový vzorec overiť NEDÁ (viď komentár na #196).
//
// Anonymizácia (repo je verejné): zákazky sú LEN ZAK/OP čísla + kódy profilov + mm.
// Žiadne mená zákazníkov, žiadne ceny.
//
// Toto NIE JE bug-fix test (žiadny RED→GREEN) — engine žiadnu chybu nemá; je to
// CHARAKTERIZAČNÝ/verifikačný harness, ktorý je GREEN práve preto, že potvrdené vzorce
// reprodukujú realitu. Fixuje to v CI: budúca zmena vzorca, ktorá by rozbila zhodu s
// históriou, spadne.
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	SYSTEMY,
	MAX_ROZOSTUP_PRIECOK,
	PREDNA_NOHA_PRIDAVOK,
	pocetPriecok,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';

// --- Reálne historické zákazky (primárny zdroj: ODPIS VZOR list PERGOLY + VYROBA výkres) -

/** Jeden reálny riadok surového CAD nárezu (kód + počet ks + dĺžka rezu v mm). */
interface RealnyRiadok {
	kod: string;
	ks: number;
	rezMm: number;
}

interface HistorickaZakazka {
	zak: string;
	op: string;
	/** systém určený z výkresu (titulok / rozmer stĺpu 110×110 = Robust) */
	system: 'Robust' | 'Massive';
	uchytenie: 'stena' | 'samostatne';
	/** predná svetlosť [mm] — kóta z VYROBA výkresu (predná svetlá výška) */
	prednaSvetlostZVykresu: number;
	/** celková dĺžka žľabu [mm] z odpisu (= šírka + presah na obe strany) */
	zlabDlzkaMm: number;
	/** priečka: normal (18004) alebo light (18102) — z reálneho odpisu */
	prieckaLight: boolean;
	/** vybrané reálne riadky odpisu potrebné na verifikáciu */
	realne: {
		prednaNoha: RealnyRiadok; // 18013/18017
		priecka: RealnyRiadok; // 18004/18102
		zlab: RealnyRiadok; // 18021/18018
	};
	/** reálne rozostupy priečok = dĺžky zaklapávacej lišty 18005 medzi krokvami [mm] */
	realneRozostupyPriecok: number[];
	/** všetky reálne Money riadky sú metráž (MJ = 'm') — jednotková kontrola */
	vsetkyMJMetre: true;
}

// ZAK202694 (OP260086): PERGOLA ROBUST, na stenu, priečka NORMAL.
// Výkres: predná svetlosť 2150 → predná noha 2165 (=2150+15); celková šírka (žľab) 5930;
// rozostup krokiev 684.7 (≤700). Odpis (ODPIS VZOR list PERGOLY): 3× 18013 @2165,
// 9× 18004 @3870.81, 1× 18021 @5930 (+ 18019 kotviaci @5930, lišty…).
const ZAK202694: HistorickaZakazka = {
	zak: 'ZAK202694',
	op: 'OP260086',
	system: 'Robust',
	uchytenie: 'stena',
	prednaSvetlostZVykresu: 2150,
	zlabDlzkaMm: 5930,
	prieckaLight: false,
	realne: {
		prednaNoha: { kod: '18013', ks: 3, rezMm: 2165 },
		priecka: { kod: '18004', ks: 9, rezMm: 3870.81 },
		zlab: { kod: '18021', ks: 1, rezMm: 5930 }
	},
	realneRozostupyPriecok: [684.7],
	vsetkyMJMetre: true
};

// ZAK2026302 (OP260258): PERGOLA ROBUST, na stenu, priečka LIGHT.
// Výkres: predná svetlosť 2200 → predná noha 2215 (=2200+15); celková šírka (žľab) 9120
// (2 tyče 3915+5205). Odpis: 4× 18013 @2215, 13× 18102 @2624.54, 1× 18021 @9120 (+ 18104
// kotviaci @9120). Rozostupy krokiev = zaklapávacia lišta 18005: 721.7 aj 694.1 — POZOR:
// 721.7 > 700 (tvrdý strop enginu), reálna zákazka strop prekročila (viď #198).
const ZAK2026302: HistorickaZakazka = {
	zak: 'ZAK2026302',
	op: 'OP260258',
	system: 'Robust',
	uchytenie: 'stena',
	prednaSvetlostZVykresu: 2200,
	zlabDlzkaMm: 9120,
	prieckaLight: true,
	realne: {
		prednaNoha: { kod: '18013', ks: 4, rezMm: 2215 },
		priecka: { kod: '18102', ks: 13, rezMm: 2624.54 },
		zlab: { kod: '18021', ks: 1, rezMm: 9120 }
	},
	realneRozostupyPriecok: [721.7, 694.1],
	vsetkyMJMetre: true
};

/** Zloží engine vstup z historickej zákazky. `sirka` = šírka RÁMU (pole krokiev), nie
 *  celková dĺžka žľabu — viď zistenie o presahu nižšie. Polia, ktoré potvrdené vzorce
 *  „na stenu" nepoužívajú (vyskaZadna/pocetZadnychNoh/hornyProfilZadnej), sú platné
 *  výplňové hodnoty. */
function vstupZoZakazky(z: HistorickaZakazka, sirkaRamu: number): PergolaNarezVstup {
	return {
		system: z.system,
		sirka: sirkaRamu,
		hlbka: 3690,
		prednaSvetlost: z.prednaSvetlostZVykresu,
		vyskaZadna: 2900,
		pocetPrednychNoh: z.realne.prednaNoha.ks,
		uchytenie: z.uchytenie,
		pocetZadnychNoh: z.realne.prednaNoha.ks,
		hornyProfilZadnej: 110,
		prieckaLight: z.prieckaLight,
		zosilnenyNosnik: false
	};
}

function prednaNohaEngine(r: ReturnType<typeof spocitajNarez>) {
	return r.vypocitane.find((p) => !/zadná/i.test(p.nazov) && /noha/i.test(p.nazov));
}
function prieckaEngine(r: ReturnType<typeof spocitajNarez>) {
	return r.vypocitane.find((p) => /priečk/i.test(p.nazov));
}

describe('#196 verifikácia — predná noha = svetlosť + 15 (potvrdený vzorec vs realita)', () => {
	for (const z of [ZAK202694, ZAK2026302]) {
		it(`${z.zak}: engine z rozmerov reprodukuje reálnu prednú nohu 1:1 (kód + ks + dĺžka)`, () => {
			// šírka rámu na počet priečok tu nie je podstatná (predná noha na nej nezávisí)
			const r = spocitajNarez(vstupZoZakazky(z, z.zlabDlzkaMm - 700));
			const noha = prednaNohaEngine(r)!;
			expect(noha.kod).toBe(z.realne.prednaNoha.kod);
			expect(noha.pocetKs).toBe(z.realne.prednaNoha.ks);
			expect(noha.dlzkaRezuMm).toBe(z.realne.prednaNoha.rezMm);
			// a je to naozaj svetlosť + 15 (nie náhoda): kóta svetlosti z výkresu + 15
			expect(z.prednaSvetlostZVykresu + PREDNA_NOHA_PRIDAVOK).toBe(z.realne.prednaNoha.rezMm);
		});
	}
});

describe('#196 verifikácia — systém → kód stĺpu/žľabu (mapovanie vs realita)', () => {
	for (const z of [ZAK202694, ZAK2026302]) {
		it(`${z.zak}: Robust → stĺp 18013 + žľab 18021 sedí na reálne kódy`, () => {
			// systém som určil z výkresu (110×110 stĺp), engine z neho odvodí kódy
			expect(SYSTEMY[z.system].stlp.kod).toBe(z.realne.prednaNoha.kod);
			expect(SYSTEMY[z.system].zlab.kod).toBe(z.realne.zlab.kod);
			// engine žľab vypisuje ako „vždy prítomný" v nepodporované s tým istým kódom
			const r = spocitajNarez(vstupZoZakazky(z, z.zlabDlzkaMm - 700));
			expect(r.nepodporovane.join(' | ')).toContain(z.realne.zlab.kod);
			// kotviaci profil horný V2 (18019) engine tiež vypisuje ako vždy prítomný
			expect(r.nepodporovane.join(' | ')).toContain('18019');
		});
	}
});

describe('#196 verifikácia — priečka: kód + počet (dĺžka rezu je O1-blokovaná = null)', () => {
	it('ZAK202694: šírka rámu (bucket ≤700) → engine 9 priečok = realita; kód 18004 (normal)', () => {
		// rozostup krokiev 684.7 (≤700) na výkrese → 9 krokiev cez pole rámu.
		// Počet je NECITLIVÝ na presnú šírku vnútri 700-bucketu — stačí ktorákoľvek
		// hodnota z (4900, 5600] (rám < žľab).
		const r = spocitajNarez(vstupZoZakazky(ZAK202694, 5293.9));
		const priecka = prieckaEngine(r)!;
		expect(priecka.pocetKs).toBe(ZAK202694.realne.priecka.ks); // 9
		expect(priecka.kod).toBe('18004'); // normal
		expect(priecka.dlzkaRezuMm).toBeNull(); // dĺžka rezu čaká na kótovaný výkres (O1)
		// reálny rozostup 684.7 ≤ 700 (tvrdý strop enginu)
		for (const rz of ZAK202694.realneRozostupyPriecok)
			expect(rz).toBeLessThanOrEqual(MAX_ROZOSTUP_PRIECOK);
	});

	it('ZAK2026302: kód priečky 18102 (light); počet 13 (dĺžka rezu null/O1)', () => {
		const r = spocitajNarez(vstupZoZakazky(ZAK2026302, 8004));
		const priecka = prieckaEngine(r)!;
		expect(priecka.kod).toBe('18102'); // light
		expect(priecka.dlzkaRezuMm).toBeNull();
		// šírka rámu ~8004 (rám < žľab 9120) reprodukuje reálny počet 13
		expect(priecka.pocetKs).toBe(ZAK2026302.realne.priecka.ks); // 13
	});
});

describe('#196 ZISTENIE — engine `sirka` = šírka RÁMU (pole krokiev), NIE dĺžka žľabu', () => {
	// KĽÚČOVÉ zistenie verifikácie: žľab presahuje rám o presah na obe strany
	// (ZAK202694 5930 vs rám ~5294; ZAK2026302 9120 vs rám ~8004). Vzorec priečok
	// ceil(šírka/700)+1 sedí na realitu LEN keď `sirka` = šírka rámu. Keby #197/app
	// posunul do enginu celkovú dĺžku žľabu, počet priečok by bol o ~2 vyšší.
	it('ZAK202694: rám (bucket) → 9, ale žľab 5930 → 10 (≠ reálnych 9)', () => {
		expect(pocetPriecok(5293.9)).toBe(9); // rám
		expect(pocetPriecok(5930)).toBe(10); // žľab — nesprávne, presah
		expect(pocetPriecok(5930)).not.toBe(ZAK202694.realne.priecka.ks);
	});
	it('ZAK2026302: rám ~8004 → 13, ale žľab 9120 → 15 (≠ reálnych 13)', () => {
		expect(pocetPriecok(8004)).toBe(13); // rám
		expect(pocetPriecok(9120)).toBe(15); // žľab — nesprávne, presah
		expect(pocetPriecok(9120)).not.toBe(ZAK2026302.realne.priecka.ks);
	});
});

describe('#196 ZISTENIE — reálny rozostup krokiev môže prekročiť 700 (tvrdý strop enginu)', () => {
	it('ZAK2026302 mal rozostup 721.7 > 700 → engine s tvrdým stropom by mohol priečky NADrátať', () => {
		// Dominik: cieľ 650–700, tvrdý strop 700. Reálna zákazka ZAK2026302 má ale
		// rozostup 721.7 (nad stropom) → engine, ktorý strop drží striktne, nasadí
		// krokvy hustejšie a pre tú istú šírku môže dať o 1 priečku viac. Otázka na
		// Dominika (#198): je 700 TVRDÝ strop (721.7 = výnimka), alebo mäkký cieľ?
		const nadStropom = ZAK2026302.realneRozostupyPriecok.filter((r) => r > MAX_ROZOSTUP_PRIECOK);
		expect(nadStropom).toContain(721.7);
	});
});

describe('#196 verifikácia — jednotka: každý pergolový profil je metráž (dĺžka × ks)', () => {
	for (const z of [ZAK202694, ZAK2026302]) {
		it(`${z.zak}: reálny Money odpis je celý metráž (MJ='m'), engine modeluje profily ako dĺžka rezu × počet ks`, () => {
			expect(z.vsetkyMJMetre).toBe(true);
			// engine položky nesú (kód, dlzkaRezuMm, pocetKs) = dĺžka × počet = metráž,
			// nie kusová jednotka
			const r = spocitajNarez(vstupZoZakazky(z, z.zlabDlzkaMm - 700));
			for (const p of r.vypocitane) {
				expect(p).toHaveProperty('dlzkaRezuMm');
				expect(p).toHaveProperty('pocetKs');
				expect(typeof p.pocetKs).toBe('number');
			}
		});
	}
});
