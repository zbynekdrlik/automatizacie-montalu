// BS DELUXE komponenty do Money odpisu (#354, Dominik — att 14668/14670).
// MONEY-KRITICKÉ: rovnaká disciplína ako #338 — čísla sa odvodzujú z existujúcej
// cfg_seed geometrie (Dorazový/Kladkový/Klzný profil pocetKs), nie z odhadu; chýbajúca
// hrúbka/farba pre farbo-závislú položku je HLASNÁ chyba, nikdy tichá nula.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat, zakladPoctov, type PosuvSpec } from '../src/lib/server/compute';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import {
	komponentyPre,
	KOMPONENTY_DELUXE,
	KOVANIE_NEUPLNE
} from '../src/lib/server/komponenty-cfg';
import { parseFarba } from '../src/lib/server/vstup';
import type { Farba } from '../src/lib/komponenty';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

const specD = (sysStyl: string, skloHrubka: number | undefined, S = 3000, V = 2200): PosuvSpec => ({
	sysStyl,
	S,
	V,
	redukciaZero: false,
	skloHrubka
});
const kovD = (specs: PosuvSpec[], farba?: Farba) => kovanieDoOdpisu(cfg, specs, false, farba);
const qty = (r: { polozky: { kod: string; qty: number }[] }, kod: string) =>
	r.polozky.find((p) => p.kod === kod)?.qty;
const R3 = (x: number) => Math.round(x * 1000) / 1000;

describe('komponentyPre(Deluxe) — 10mm + 6mm live (#431 kolo 2: krytky evidované v RAL)', () => {
	it('vracia madlo + obe kefy + 6× 10mm + 6× 6mm krytku', () => {
		const komp = komponentyPre('Deluxe')!;
		expect(komp).toBe(KOMPONENTY_DELUXE);
		const kody = komp.map((k) => k.kod).sort();
		expect(kody).toEqual(
			[
				'ZASK00007',
				'ZASK00049',
				// 6mm krytky (#431 kolo 2, Dominik úloha 574 — 0-ks caution #354 prekonaná)
				'ZASK202519',
				'ZASK202520',
				'ZASK202521',
				'ZASK202522',
				'ZASK202523',
				'ZASK202524',
				// 10mm krytky
				'ZASK202525',
				'ZASK202526',
				'ZASK202527',
				'ZASK202528',
				'ZASK202529',
				'ZASK202530',
				'ZASK202542'
			].sort()
		);
	});

	it('6mm krytky nesú hrubkaSkla=6 + farbu R9006/R9005; 10mm hrubkaSkla=10 + R9006/R7016', () => {
		const komp = komponentyPre('Deluxe')!;
		const krytky6 = komp.filter((k) => k.hrubkaSkla === 6);
		const krytky10 = komp.filter((k) => k.hrubkaSkla === 10);
		expect(krytky6.map((k) => k.farba).sort()).toEqual(['R9005', 'R9005', 'R9005', 'R9006', 'R9006', 'R9006']);
		expect(krytky10.map((k) => k.farba).sort()).toEqual(['R7016', 'R7016', 'R7016', 'R9006', 'R9006', 'R9006']);
	});

	it('KOVANIE_NEUPLNE.Deluxe už NEEXISTUJE — 6mm krytky teraz idú do odpisu (#431 kolo 2)', () => {
		// 6mm aj 10mm objednávka je teraz KOMPLETNÁ (krytky+madlo+kefy) — bývalá
		// funkcia hlásiaca „6mm krytky nie sú v odpise" je nepravdivá a je odstránená.
		expect(KOVANIE_NEUPLNE.Deluxe).toBeUndefined();
	});
});

describe('zakladPoctov — Deluxe kladkový/klzný dĺžka (#354)', () => {
	it('dĺžka = súčet rezov kladkového/klzného profilu z reálneho plánu (10mm)', () => {
		const r = computeFlat(cfg, 'Deluxe|3K', 3000, 2200, false, 10)!;
		const kladkovy = r.material.filter((m) => /klad/i.test(m.nazov));
		const rucneKlad = kladkovy.reduce(
			(s, m) => s + m.rezy.reduce((a, x) => a + x.rozmer * x.ks, 0),
			0
		);
		expect(kladkovy.length).toBeGreaterThan(0);
		expect(zakladPoctov(r).dlzkaKladkovehoMm).toBe(rucneKlad);

		const klzny = r.material.filter((m) => /klzn/i.test(m.nazov));
		const rucneKlzn = klzny.reduce(
			(s, m) => s + m.rezy.reduce((a, x) => a + x.rozmer * x.ks, 0),
			0
		);
		expect(klzny.length).toBeGreaterThan(0);
		expect(zakladPoctov(r).dlzkaKlznehoMm).toBe(rucneKlzn);
	});

	it('6mm a 10mm rátajú z PRÁVE JEDNÉHO profilu (žiadne krížové miešanie kódov)', () => {
		// Kladkový 6mm (ZASP202416) a 10mm (ZASP202417) majú v cfg_seed rovnaký
		// rezný vzorec (rovnaká dĺžka), ale sú to DVA RÔZNE Money kódy — hrúbka
		// vyberá KTORÝ sa reže, `profilCuts` (existujúci filter) zaručí, že r.material
		// nesie len ten zvolený, nikdy oba naraz.
		const r6 = computeFlat(cfg, 'Deluxe|3K', 3000, 2200, false, 6)!;
		const r10 = computeFlat(cfg, 'Deluxe|3K', 3000, 2200, false, 10)!;
		expect(zakladPoctov(r6).dlzkaKladkovehoMm).toBeGreaterThan(0);
		expect(zakladPoctov(r10).dlzkaKladkovehoMm).toBeGreaterThan(0);
		expect(r6.material.some((m) => m.kod === 'ZASP202416')).toBe(true); // kladkový 6mm
		expect(r6.material.some((m) => m.kod === 'ZASP202417')).toBe(false); // NIE 10mm
		expect(r10.material.some((m) => m.kod === 'ZASP202417')).toBe(true); // kladkový 10mm
		expect(r10.material.some((m) => m.kod === 'ZASP202416')).toBe(false); // NIE 6mm
	});
});

describe('krajná/stredová krytka — konšt./naStyk formula (#354, design komentár na tikete)', () => {
	const pripady: [string, number][] = [
		['Deluxe|2K', 2],
		['Deluxe|3K', 3],
		['Deluxe|4K', 4],
		['Deluxe|5K', 5],
		['Deluxe|6K', 6],
		['Deluxe|2x2K', 4],
		['Deluxe|2x3K', 6],
		['Deluxe|2x4K', 8]
	];

	it('krajná krytka = konštanta 2 na KAŽDOM štýle (aj opona)', () => {
		for (const [ss] of pripady) {
			const r = kovD([specD(ss, 10)], 'R9006');
			expect(r.err).toBeNull();
			expect(qty(r, 'ZASK202529')).toBe(2);
		}
	});

	it('stredová L aj P = počet krídel − 1 (počet stykov)', () => {
		for (const [ss, n] of pripady) {
			const r = kovD([specD(ss, 10)], 'R9006');
			expect(r.err).toBeNull();
			expect(qty(r, 'ZASK202525')).toBe(n - 1); // stredová L
			expect(qty(r, 'ZASK202527')).toBe(n - 1); // stredová P
		}
	});

	it('madlo D56 = konštanta 2 na KAŽDOM štýle, nezávisle od RAL/hrúbky', () => {
		for (const [ss] of pripady) {
			expect(qty(kovD([specD(ss, 10)], 'R9006'), 'ZASK00049')).toBe(2);
			// #431 kolo 2: 6mm už MÁ farebné krytky → farba je teraz potrebná aj na 6mm
			expect(qty(kovD([specD(ss, 6)], 'R9006'), 'ZASK00049')).toBe(2);
		}
	});

	it('6mm krajná krytka = 2, stredová L/P = počet krídel − 1 (rovnaké pravidlá ako 10mm, #431 kolo 2)', () => {
		for (const [ss, n] of pripady) {
			const r = kovD([specD(ss, 6)], 'R9006');
			expect(r.err).toBeNull();
			expect(qty(r, 'ZASK202523')).toBe(2); // krajná 6mm R9006
			expect(qty(r, 'ZASK202519')).toBe(n - 1); // stredová L 6mm R9006
			expect(qty(r, 'ZASK202521')).toBe(n - 1); // stredová P 6mm R9006
		}
	});
});

describe('tesniace kefy — súčet dĺžky kladkového/klzného × 2 (#354)', () => {
	it('ZASK00007 (kladkový) a ZASK202542 (klzný) sedia s zakladPoctov', () => {
		const spec = specD('Deluxe|3K', 10);
		const r = kovD([spec], 'R9006');
		const z = zakladPoctov(computeFlat(cfg, spec.sysStyl, spec.S, spec.V, false, 10)!);
		expect(qty(r, 'ZASK00007')).toBe(R3((2 * z.dlzkaKladkovehoMm) / 1000));
		expect(qty(r, 'ZASK202542')).toBe(R3((2 * z.dlzkaKlznehoMm) / 1000));
	});

	it('kefy sú farbo/hrúbko-neutrálne — rovnaké m na 6mm aj 10mm pri tej istej geometrii', () => {
		const spec6 = specD('Deluxe|3K', 6);
		const spec10 = specD('Deluxe|3K', 10);
		const k6 = kovD([spec6], 'R9006');
		const k10 = kovD([spec10], 'R9006');
		expect(qty(k6, 'ZASK00007')).toBeGreaterThan(0);
		expect(qty(k6, 'ZASK202542')).toBeGreaterThan(0);
		expect(qty(k10, 'ZASK00007')).toBeGreaterThan(0);
		expect(qty(k10, 'ZASK202542')).toBeGreaterThan(0);
	});
});

describe('RAL × hrúbka skla — fail-loud disciplína (#354)', () => {
	it('10mm objednávka bez zvolenej farby → HLASNÁ chyba (krytka to potrebuje)', () => {
		const r = kovD([specD('Deluxe|3K', 10)]);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
	});

	it('chýbajúca hrúbka skla (undefined) → HLASNÁ chyba, nikdy tichý default na 0', () => {
		const r = kovD([specD('Deluxe|3K', undefined)], 'R9006');
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/hrúbk/i);
	});

	it('R9005 (Robust/Štandard farba) pre 10mm Deluxe → HLASNÁ chyba, NIE tichý odpis bez krytiek (#354 review nález)', () => {
		// R9005 nesedí na ŽIADEN 10mm Deluxe variant (len R9006/R7016) — pred review
		// opravou by toto ticho vynechalo všetkých 6 krytiek s `err: null` (presne
		// nedopísaný Money odpis, ktorý nikto nevidí). Musí byť chyba, nie absent.
		const r = kovD([specD('Deluxe|3K', 10)], 'R9005');
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
		expect(r.err).toMatch(/R9005/);
	});

	it('R9005 pre 6mm Deluxe → pošle R9005 6mm krytky (#431 kolo 2: 6mm ponúka R9006/R9005)', () => {
		const r = kovD([specD('Deluxe|3K', 6)], 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK202520')).toBe(2); // stredová L 6mm R9005
		expect(qty(r, 'ZASK202522')).toBe(2); // stredová P 6mm R9005
		expect(qty(r, 'ZASK202524')).toBe(2); // krajná 6mm R9005
		// R9006 6mm varianty absent (zvolili sme R9005)
		for (const k of ['ZASK202519', 'ZASK202521', 'ZASK202523']) expect(qty(r, k)).toBeUndefined();
		expect(qty(r, 'ZASK00049')).toBe(2);
	});

	it('R7016 pre 6mm Deluxe → HLASNÁ chyba (6mm ponúka len R9006/R9005, nie R7016; #431 kolo 2)', () => {
		// R7016 existuje len pre 10mm krytky. Na 6mm objednávke nesedí na ŽIADEN
		// farebný 6mm kandidát → fail-loud (nikdy tichý odpis bez krytiek).
		const r = kovD([specD('Deluxe|3K', 6)], 'R7016');
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
		expect(r.err).toMatch(/R7016/);
	});

	it('6mm bez zvolenej farby → HLASNÁ chyba (krytky ju teraz potrebujú aj na 6mm; #431 kolo 2)', () => {
		const r = kovD([specD('Deluxe|3K', 6)]);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
	});

	it('R9006 pošle len R9006 variant, R7016 vôbec (absent, nie 0)', () => {
		const r = kovD([specD('Deluxe|3K', 10)], 'R9006');
		expect(qty(r, 'ZASK202525')).toBeGreaterThan(0); // stredová L R9006
		expect(qty(r, 'ZASK202526')).toBeUndefined(); // stredová L R7016
	});

	it('R7016 pošle len R7016 variant, R9006 vôbec', () => {
		const r = kovD([specD('Deluxe|3K', 10)], 'R7016');
		expect(qty(r, 'ZASK202526')).toBeGreaterThan(0); // stredová L R7016
		expect(qty(r, 'ZASK202525')).toBeUndefined(); // stredová L R9006
	});
});

describe('zmiešaná zákazka Robust + Deluxe — JEDNA farbaKovania (#354 review nález 🔴)', () => {
	// Robust používa R9005/R7016, 10mm Deluxe R9006/R7016 — DVE rôzne farebné
	// dvojice zdieľajú jedno objednávkové pole `farbaKovania` (Robust+Standard mali
	// do #354 tú istú dvojicu, takže tento konflikt nemohol nastať). Zvolená farba,
	// ktorá sedí LEN jednému systému, musí zastaviť CELÝ odpis chybou — nikdy ho
	// nesmie poslať s tichy vynechanou farebnou rodinou druhého systému.
	it('R9005 (sedí Robustu, nesedí 10mm Deluxe) → chyba, žiadny riadok', () => {
		const r = kovD([specD('Robust|2K', undefined), specD('Deluxe|3K', 10)], 'R9005');
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
	});

	it('R9006 (sedí Deluxe, nesedí Robustu) → chyba, žiadny riadok', () => {
		const r = kovD([specD('Robust|2K', undefined), specD('Deluxe|3K', 10)], 'R9006');
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farb/i);
	});

	it('R7016 (sedí OBOM) → kompletný odpis, žiadna chyba', () => {
		const r = kovD([specD('Robust|2K', undefined), specD('Deluxe|3K', 10)], 'R7016');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK202534')).toBeGreaterThan(0); // Robust kľučka R7016
		expect(qty(r, 'ZASK202526')).toBeGreaterThan(0); // Deluxe stredová L R7016
	});
});

describe('parseFarba — R9006 (#354, Deluxe krytky)', () => {
	it('akceptuje R9006 rovnako ako R9005/R7016', () => {
		expect(parseFarba('R9006')).toBe('R9006');
		expect(parseFarba('R9005')).toBe('R9005');
		expect(parseFarba('R7016')).toBe('R7016');
	});

	it('neznáma hodnota → null (fail-loud v engine, nie tichý default)', () => {
		expect(parseFarba('R9999')).toBeNull();
		expect(parseFarba('')).toBeNull();
		expect(parseFarba(null)).toBeNull();
	});
});
