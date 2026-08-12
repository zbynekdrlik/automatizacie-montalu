// Bazén návrhový výkres (#139) — geometria + validácia. Vzorové hodnoty z OBOCH
// reálnych vzorov: OP260027 rev.3 (10500×3788×1600, S5, koľajisko 13000) a
// OP260055 (8570×4250×750, S4, koľajisko 11100). Presné vzťahy zdôvodnené v
// design komentári na #139 a hlavičkovom komentári `$lib/bazen-navrh.ts`.
import { describe, it, expect } from 'vitest';
import {
	variantaZSekcii,
	presahKolajniska,
	sekcieVysky,
	sekciePozicie,
	posuvPopis,
	dverePopis,
	predvyplnenyNazov,
	chybaBazenNavrhVstupu,
	POCET_SEKCII_MIN,
	POCET_SEKCII_MAX,
	ZATVORENA_DLZKA_MIN,
	ZATVORENA_DLZKA_MAX,
	HLBKA_MIN,
	HLBKA_MAX,
	VYSKA_MIN,
	VYSKA_MAX,
	DLZKA_KOLAJISKA_MIN,
	DLZKA_KOLAJISKA_MAX,
	VYSKA_CELA_MIN,
	VYSKA_CELA_MAX,
	type BazenNavrhVstup
} from '../src/lib/bazen-navrh';

const VZOR_OP260055: BazenNavrhVstup = {
	zatvorenaDlzka: 8570,
	hlbka: 4250,
	vyskaMax: 750,
	vyskaMin: 480,
	pocetSekcii: 4,
	dlzkaKolajiska: 11100,
	dverovaSekcia: 1,
	kolaj: 'jednokolaj',
	smer: 'vpravo',
	dvereSmer: 'vlavo',
	model: 'PREMIER',
	vyplna: 'PC 3 mm číry',
	aretacia: 'VPRAVO',
	vyskaCela: 96.2,
	op: 'OP260055',
	nazov: '',
	revizia: '1',
	vypracoval: 'test',
	rezimVykresu: 'technicky',
	ral: '9006-STRIEBORNA JŠ',
	ralKod: '9006'
};

const VZOR_OP260027: BazenNavrhVstup = {
	zatvorenaDlzka: 10500,
	hlbka: 3788,
	vyskaMax: 1600,
	vyskaMin: 1320,
	pocetSekcii: 5,
	dlzkaKolajiska: 13000,
	dverovaSekcia: 1,
	kolaj: 'dvojkolaj',
	smer: 'vpravo',
	dvereSmer: 'vlavo',
	model: '',
	vyplna: 'PC 3 mm číry',
	aretacia: 'V PRAVO',
	vyskaCela: 90,
	op: 'OP260027',
	nazov: '',
	revizia: '3',
	vypracoval: 'test',
	rezimVykresu: 'technicky',
	ral: '7016-ANTRACIT JŠ',
	ralKod: '7016'
};

describe('variantaZSekcii — VARIANTA = "S{počet sekcií}"', () => {
	it('OP260055: 4 sekcie → S4', () => {
		expect(variantaZSekcii(4)).toBe('S4');
	});
	it('OP260027: 5 sekcií → S5', () => {
		expect(variantaZSekcii(5)).toBe('S5');
	});
	it('zaokrúhli na celé, minimálne S1', () => {
		expect(variantaZSekcii(3.7)).toBe('S4');
		expect(variantaZSekcii(0)).toBe('S1');
		expect(variantaZSekcii(-2)).toBe('S1');
	});
});

describe('presahKolajniska — dĺžka koľajiska − zatvorená dĺžka, presne sedí na oboch vzoroch', () => {
	it('OP260055: 11100−8570 = 2530', () => {
		expect(presahKolajniska(11100, 8570)).toBe(2530);
	});
	it('OP260027: 13000−10500 = 2500', () => {
		expect(presahKolajniska(13000, 10500)).toBe(2500);
	});
});

describe('sekcieVysky — lineárna kaskáda medzi najvyššou a najnižšou sekciou', () => {
	it('OP260027: 5 sekcií, 1600→1320 → [1600,1530,1460,1390,1320] (1390 nezávisle overená kóta na VIEW A)', () => {
		expect(sekcieVysky(5, 1600, 1320)).toEqual([1600, 1530, 1460, 1390, 1320]);
	});
	it('OP260055: 4 sekcie, 750→480 → [750,660,570,480]', () => {
		expect(sekcieVysky(4, 750, 480)).toEqual([750, 660, 570, 480]);
	});
	it('1 sekcia → [vyskaMax] (žiadna kaskáda)', () => {
		expect(sekcieVysky(1, 1000, 1000)).toEqual([1000]);
	});
	it('rovnaké výšky → konštantné pole (žiadny kolaps na kaskádu)', () => {
		expect(sekcieVysky(3, 900, 900)).toEqual([900, 900, 900]);
	});
	// review nález #139 (🔴, dokumentácia fixu v BazenNavrhVykres.svelte): pri 1
	// sekcii vyskaMin NEVSTUPUJE do výsledku vôbec, aj keď sa líši od vyskaMax —
	// jedna sekcia nekaskáduje. Kresliaca komponenta preto MUSÍ čítať výšku
	// z tohto poľa (vysky[0]/vysky[posledná]), NIKDY priamo vstup.vyskaMax/
	// vyskaMin — inak by vytlačila kótu s textom, ktorý nesedí s nakreslenou
	// geometriou (napr. čiara dlhá 1600mm s popiskom "1200").
	it('1 sekcia s ROZDIELNYMI vyskaMax/vyskaMin → vyskaMin sa v poli vôbec nezjaví (vysky[0] je jediná pravda)', () => {
		const v = sekcieVysky(1, 1600, 1200);
		expect(v).toEqual([1600]);
		expect(v[v.length - 1]).toBe(1600); // NIE 1200
	});
});

describe('sekciePozicie — rovnomerné vizuálne delenie, posledná hranica presne na zatvorenaDlzka', () => {
	it('4 sekcie, 8570mm → 5 hraníc, posledná presne 8570 (nie zaokrúhľovacia chyba)', () => {
		const p = sekciePozicie(8570, 4);
		expect(p).toHaveLength(5);
		expect(p[0]).toBe(0);
		expect(p[p.length - 1]).toBe(8570);
	});
	it('rovnomerné rozdelenie — 4 rovnaké kroky', () => {
		const p = sekciePozicie(4000, 4);
		expect(p).toEqual([0, 1000, 2000, 3000, 4000]);
	});
	it('kombinácia, ktorá by pri postupnom násobení dala zaokrúhľovaciu chybu, stále skončí presne na celkovej dĺžke', () => {
		// 8570/3 = 2856,666... — over že posledná hranica nie je "8569,9" ani "8570,1"
		const p = sekciePozicie(8570, 3);
		expect(p[p.length - 1]).toBe(8570);
	});
	it('neplatná (nekladná) dĺžka → nulové pozície, nie NaN', () => {
		expect(sekciePozicie(0, 4)).toEqual([0, 0, 0, 0, 0]);
	});

	// review nález #139 (🟡): ručne zadaná šírka prvej sekcie musí SKUTOČNE
	// posunúť prvú hranicu tam, kam ukazuje jej kóta — inak kóta meria niečo iné,
	// než je nakreslené (OP260027 vzor: reálna prvá sekcia 2140mm ≠ schematické
	// rovnomerné delenie 10500/5=2100mm).
	describe('sirkaPrvejOverride (3. parameter) — prvá hranica na SKUTOČNEJ zadanej šírke', () => {
		it('OP260027 vzor: 5 sekcií, 10500mm, override 2140 → prvá hranica presne 2140', () => {
			const p = sekciePozicie(10500, 5, 2140);
			expect(p[0]).toBe(0);
			expect(p[1]).toBe(2140);
			expect(p[p.length - 1]).toBe(10500);
		});
		it('zvyšná dĺžka (10500-2140=8360) sa rovnomerne rozdelí medzi ostávajúce 4 sekcie', () => {
			const p = sekciePozicie(10500, 5, 2140);
			const krok = (10500 - 2140) / 4;
			expect(p[2]).toBeCloseTo(2140 + krok, 5);
			expect(p[3]).toBeCloseTo(2140 + krok * 2, 5);
			expect(p[4]).toBeCloseTo(2140 + krok * 3, 5);
		});
		it('bez override (undefined) sa správa ako predtým — rovnomerné delenie', () => {
			expect(sekciePozicie(10500, 5, undefined)).toEqual(sekciePozicie(10500, 5));
		});
		it('override pri 1 sekcii sa ignoruje (žiadny "zvyšok" na rozdelenie)', () => {
			expect(sekciePozicie(5000, 1, 2000)).toEqual([0, 5000]);
		});
		it('override väčší než celková dĺžka sa orezáva na celkovú dĺžku', () => {
			const p = sekciePozicie(4000, 4, 9000);
			expect(p[1]).toBe(4000);
			// zvyšok pre ostatné sekcie je 0 — všetky splynú na konci
			expect(p[2]).toBe(4000);
		});
		it('nekladný override (0 alebo záporný) sa ignoruje — späť na rovnomerné delenie', () => {
			expect(sekciePozicie(4000, 4, 0)).toEqual(sekciePozicie(4000, 4));
			expect(sekciePozicie(4000, 4, -100)).toEqual(sekciePozicie(4000, 4));
		});
	});
});

describe('posuvPopis — dvojkoľaj bez smeru, jednokoľaj so smerom (presne sedí na oboch vzoroch)', () => {
	it('OP260027: dvojkoľaj → "OBOJSMERNÝ" (smer sa ignoruje)', () => {
		expect(posuvPopis('dvojkolaj', 'vpravo')).toBe('OBOJSMERNÝ');
		expect(posuvPopis('dvojkolaj', 'vlavo')).toBe('OBOJSMERNÝ');
	});
	it('OP260055: jednokoľaj vpravo → "JEDNOKOĽAJ VPRAVO"', () => {
		expect(posuvPopis('jednokolaj', 'vpravo')).toBe('JEDNOKOĽAJ VPRAVO');
	});
	it('jednokoľaj vľavo → "JEDNOKOĽAJ VĽAVO"', () => {
		expect(posuvPopis('jednokolaj', 'vlavo')).toBe('JEDNOKOĽAJ VĽAVO');
	});
});

describe('dverePopis — smer dverí je NEZÁVISLÝ od smeru posuvu (OP260055: POSUV vpravo, DVERE vľavo)', () => {
	it('vľavo', () => {
		expect(dverePopis('vlavo')).toBe('VĽAVO');
	});
	it('vpravo', () => {
		expect(dverePopis('vpravo')).toBe('VPRAVO');
	});
});

describe('predvyplnenyNazov — "{zatvorenaDlzka}x{hlbka}x{vyskaMax}", vždy skutočná kóta výšky', () => {
	it('OP260055: 8570x4250x750', () => {
		expect(predvyplnenyNazov(8570, 4250, 750)).toBe('8570x4250x750');
	});
	it('OP260027: 10500x3788x1600 — VŽDY vyskaMax (skutočná kóta), nikdy nezhodné "tretie číslo" z názvu vzoru (1700)', () => {
		expect(predvyplnenyNazov(10500, 3788, 1600)).toBe('10500x3788x1600');
	});
	it('neplatné vstupy vrátia prázdny reťazec (nikdy "0x0x0")', () => {
		expect(predvyplnenyNazov(0, 3788, 1600)).toBe('');
		expect(predvyplnenyNazov(10500, 0, 1600)).toBe('');
		expect(predvyplnenyNazov(10500, 3788, 0)).toBe('');
	});
});

describe('chybaBazenNavrhVstupu — validácia (rovnaká disciplína ako chybaPergolaNavrhVstupu)', () => {
	it('oba reálne vzory prejdú bez chyby', () => {
		expect(chybaBazenNavrhVstupu(VZOR_OP260055)).toBeNull();
		expect(chybaBazenNavrhVstupu(VZOR_OP260027)).toBeNull();
	});

	it(`zatvorená dĺžka mimo ${ZATVORENA_DLZKA_MIN}–${ZATVORENA_DLZKA_MAX} zamietnutá`, () => {
		expect(
			chybaBazenNavrhVstupu({ ...VZOR_OP260055, zatvorenaDlzka: ZATVORENA_DLZKA_MIN - 1 })
		).toMatch(/Zatvorená dĺžka/);
		expect(
			chybaBazenNavrhVstupu({ ...VZOR_OP260055, zatvorenaDlzka: ZATVORENA_DLZKA_MAX + 1 })
		).toMatch(/Zatvorená dĺžka/);
	});

	it(`hĺbka mimo ${HLBKA_MIN}–${HLBKA_MAX} zamietnutá`, () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, hlbka: HLBKA_MIN - 1 })).toMatch(/Hĺbka/);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, hlbka: HLBKA_MAX + 1 })).toMatch(/Hĺbka/);
	});

	it(`výšky mimo ${VYSKA_MIN}–${VYSKA_MAX} zamietnuté`, () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, vyskaMax: VYSKA_MIN - 1 })).toMatch(
			/najvyššej/
		);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, vyskaMin: VYSKA_MAX + 1 })).toMatch(
			/najnižšej/
		);
	});

	it('najnižšia sekcia vyššia než najvyššia — zamietnuté', () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, vyskaMax: 480, vyskaMin: 750 })).toMatch(
			/nemôže byť väčšia/
		);
	});

	it(`počet sekcií mimo ${POCET_SEKCII_MIN}–${POCET_SEKCII_MAX} zamietnutý`, () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, pocetSekcii: POCET_SEKCII_MIN - 1 })).toMatch(
			/Počet sekcií/
		);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, pocetSekcii: POCET_SEKCII_MAX + 1 })).toMatch(
			/Počet sekcií/
		);
	});

	it(`dĺžka koľajiska mimo ${DLZKA_KOLAJISKA_MIN}–${DLZKA_KOLAJISKA_MAX} zamietnutá`, () => {
		expect(
			chybaBazenNavrhVstupu({ ...VZOR_OP260055, dlzkaKolajiska: DLZKA_KOLAJISKA_MIN - 1 })
		).toMatch(/Dĺžka koľajiska/);
	});

	it('dĺžka koľajiska kratšia než zatvorená dĺžka — zamietnutá (presah nemôže byť záporný)', () => {
		expect(
			chybaBazenNavrhVstupu({ ...VZOR_OP260055, dlzkaKolajiska: VZOR_OP260055.zatvorenaDlzka - 1 })
		).toMatch(/musí byť väčšia než zatvorená dĺžka/);
	});

	// review nález #139 (🔴): PÔVODNE bola rovnosť dovolená (presah=0) — degenerovaná
	// nulovej-dĺžky "presah" kóta v BazenNavrhVykres.svelte by spôsobila pád
	// (each_key_duplicate, .claude/rules/vykres.md). Teraz musí byť PRESAH KLADNÝ.
	it('dĺžka koľajiska ROVNÁ zatvorenej dĺžke (presah=0) — zamietnutá', () => {
		expect(
			chybaBazenNavrhVstupu({ ...VZOR_OP260055, dlzkaKolajiska: VZOR_OP260055.zatvorenaDlzka })
		).toMatch(/musí byť väčšia než zatvorená dĺžka/);
	});

	it('sirkaSekcieOverride nekladná — zamietnutá', () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, sirkaSekcieOverride: 0 })).toMatch(
			/Ručná šírka sekcie/
		);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, sirkaSekcieOverride: -100 })).toMatch(
			/Ručná šírka sekcie/
		);
	});

	it('sirkaSekcieOverride kladná — platná', () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, sirkaSekcieOverride: 2183.2 })).toBeNull();
	});

	it('dverová sekcia mimo 1..pocetSekcii zamietnutá', () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, dverovaSekcia: 0 })).toMatch(/Dverová sekcia/);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, dverovaSekcia: 5 })).toMatch(/Dverová sekcia/);
	});

	it(`výška čela mimo ${VYSKA_CELA_MIN}–${VYSKA_CELA_MAX} zamietnutá`, () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, vyskaCela: VYSKA_CELA_MIN - 1 })).toMatch(
			/Výška čela/
		);
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, vyskaCela: VYSKA_CELA_MAX + 1 })).toMatch(
			/Výška čela/
		);
	});

	it('MODEL je voliteľný (OP260027 ho nemá vôbec vyplnený)', () => {
		expect(chybaBazenNavrhVstupu({ ...VZOR_OP260055, model: '' })).toBeNull();
	});
});
