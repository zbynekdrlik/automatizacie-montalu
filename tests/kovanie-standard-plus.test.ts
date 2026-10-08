// #604 (Odoo úloha 1261, Patrik 30.9.2026: „štandard neobsahuje kefy, zamykáč a kladku")
// — Štandard + je ten istý systém RS STANDARD (iné sú len profily/rozmery), takže jeho
// odpis dostane TEN ISTÝ zoznam KOMPONENTY_STANDARD: kladka dvojitá ZASK00002 (2/krídlo),
// protikus ZASK20252 (1/zámok), automatický zámok ZASK202531 R9005 / ZASK202532 R7016
// (podľa farby kovania, počet podľa štýlu) a kefa ZASK00007 (kladkový profil × 2, m).
//
// MONEY-KRITICKÉ: tieto riadky sú výdaj zo skladu. Testy držia:
//   1. Štandard + dostane kovanie (dovtedy `komponentyPre('Štandard +')` = null → odpis
//      niesol len profily, sklo a tesnenia — 65 ostrých posuvov od 1.9.),
//   2. počty sa odvodia z REÁLNEJ konfigurácie (krídla = N štýlu, kefa z dĺžky kladkového),
//   3. ostatné systémy (starý Štandard, Robust, Slide, Deluxe) sa NEZMENIA ani o riadok.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat, zakladPoctov, type PosuvSpec } from '../src/lib/server/compute';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { KOMPONENTY_STANDARD, komponentyPre } from '../src/lib/server/komponenty-cfg';
import type { Farba } from '../src/lib/komponenty';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

/** Reálny posuv: IZO štýl ide s 16 mm sklom, basic so 6 mm (ako ich volí formulár). */
const spec = (sysStyl: string, S = 3000, V = 2200): PosuvSpec => ({
	sysStyl,
	S,
	V,
	redukciaZero: false,
	skloHrubka: sysStyl.endsWith(' IZO') ? 16 : 6
});
const kov = (specs: PosuvSpec[], farba: Farba | undefined = 'R9005') =>
	kovanieDoOdpisu(cfg, specs, false, farba);
const qty = (r: { polozky: { kod: string; qty: number }[] }, kod: string) =>
	r.polozky.find((p) => p.kod === kod)?.qty;
/** Kefa ZASK00007 = súčet dĺžok kladkového profilu × 2, v metroch (3 desatinné). */
const kefaM = (s: PosuvSpec) => {
	const r = computeFlat(cfg, s.sysStyl, s.S, s.V, false, s.skloHrubka ?? 0)!;
	return Math.round(2 * zakladPoctov(r).dlzkaKladkovehoMm) / 1000;
};

describe('#604 Štandard + — komponenty RS STANDARD', () => {
	it('komponentyPre(Štandard +) je TÁ ISTÁ tabuľka ako starý Štandard', () => {
		expect(komponentyPre('Štandard +')).toBe(KOMPONENTY_STANDARD);
	});

	it('Štandard + 2K R9005: kladka 4, protikus 2, zámok R9005 2, kefa = kladkový × 2 (m)', () => {
		const s = spec('Štandard +|2K');
		const r = kov([s], 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00002')).toBe(4); // 2 ks × 2 krídla
		expect(qty(r, 'ZASK20252')).toBe(2); // protikus = počet zámkov
		expect(qty(r, 'ZASK202531')).toBe(2); // 2 koncové okná
		expect(qty(r, 'ZASK202532')).toBeUndefined(); // R7016 variant absent, nie 0
		expect(kefaM(s)).toBeGreaterThan(0); // kladkový profil Štandard + MÁ dĺžku
		expect(qty(r, 'ZASK00007')).toBe(kefaM(s));
		expect(r.polozky.find((p) => p.kod === 'ZASK00007')!.mj).toBe('m');
		// ZASK202541 ostáva honest-null ako pri Štandarde — operátor to musí vidieť
		expect(r.warn).toMatch(/ZASK202541/);
	});

	it('Štandard + 3K R7016: zámok ide ako R7016 (ZASK202532), R9005 variant vôbec', () => {
		const r = kov([spec('Štandard +|3K')], 'R7016');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00002')).toBe(6);
		expect(qty(r, 'ZASK202532')).toBe(2);
		expect(qty(r, 'ZASK202531')).toBeUndefined();
		expect(qty(r, 'ZASK20252')).toBe(2);
	});

	it('Štandard + 2x3K (opona): 3 zámky, 3 protikusy, kladka 12', () => {
		const s = spec('Štandard +|2x3K');
		const r = kov([s], 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00002')).toBe(12);
		expect(qty(r, 'ZASK202531')).toBe(3);
		expect(qty(r, 'ZASK20252')).toBe(3);
		expect(qty(r, 'ZASK00007')).toBe(kefaM(s));
	});

	it('Štandard + 3K IZO: rovnaký počet zámkov ako basic (IZO je o skle, nie o zámkoch)', () => {
		const izo = kov([spec('Štandard +|3K IZO')], 'R9005');
		const basic = kov([spec('Štandard +|3K')], 'R9005');
		expect(izo.err).toBeNull();
		expect(qty(izo, 'ZASK202531')).toBe(qty(basic, 'ZASK202531'));
		expect(qty(izo, 'ZASK20252')).toBe(qty(basic, 'ZASK20252'));
		expect(qty(izo, 'ZASK00002')).toBe(6);
		expect(qty(izo, 'ZASK00007')).toBeGreaterThan(0);
	});

	it('KAŽDÝ Štandard + štýl z cfg (aj 5K/6K, aj IZO) sa spočíta bez chyby v OBOCH farbách', () => {
		const styly = Object.keys(cfg).filter((x) => x.startsWith('Štandard +|'));
		expect(styly.length).toBeGreaterThanOrEqual(16);
		for (const sysStyl of styly)
			for (const farba of ['R9005', 'R7016'] as const) {
				const s = spec(sysStyl);
				const r = kov([s], farba);
				const N = cfg[sysStyl]!.N;
				// „1 ks zámku na koncové okno": jednoduchý posuv 2 koncové krídla, opona (2x…) 3
				const zamky = sysStyl.split('|')[1]!.startsWith('2x') ? 3 : 2;
				const zamokKod = farba === 'R9005' ? 'ZASK202531' : 'ZASK202532';
				expect({
					sysStyl,
					farba,
					err: r.err,
					kladka: qty(r, 'ZASK00002'),
					zamok: qty(r, zamokKod),
					protikus: qty(r, 'ZASK20252'),
					kefa: qty(r, 'ZASK00007')
				}).toEqual({
					sysStyl,
					farba,
					err: null,
					kladka: 2 * N,
					zamok: zamky,
					protikus: zamky,
					kefa: kefaM(s)
				});
				expect(kefaM(s)).toBeGreaterThan(0);
			}
	});

	it('Štandard + bez zvolenej farby → HLASNÁ chyba, nikdy tichý default na jednu farbu', () => {
		// priamo, nie cez `kov` — explicitné `undefined` by spustilo jeho default 'R9005'
		const r = kovanieDoOdpisu(cfg, [spec('Štandard +|2K')], false, undefined);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/Kovanie/);
	});

	it('zimná záhrada Štandard + 2K + Štandard + 3K: kusy sa sčítajú za posuvy', () => {
		const r = kov([spec('Štandard +|2K'), spec('Štandard +|3K')], 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00002')).toBe(4 + 6);
		expect(qty(r, 'ZASK202531')).toBe(2 + 2);
		expect(qty(r, 'ZASK20252')).toBe(2 + 2);
	});

	it('zmiešaná zákazka Robust + Štandard +: oba systémy dostanú svoje kovanie', () => {
		const r = kov([spec('Robust|2K'), spec('Štandard +|2K')], 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4); // Robust kladka
		expect(qty(r, 'ZASK00002')).toBe(4); // Štandard + kladka dvojitá
		expect(qty(r, 'ZASK202531')).toBe(2); // Štandard + zámok R9005
		expect(qty(r, 'ZASK202533')).toBe(4); // Robust kľučka R9005
	});
});

// money-odpis 2n: zmiešaná zákazka (Štandard + s INÝM farebným systémom) so VŠETKÝMI tromi
// farbami — každá farba buď sedí OBOM posuvom (kompletný odpis; Deluxe môže spadnúť na
// predvolenú R9006 s VIDITEĽNÝM varovaním), alebo je HLASNÁ chyba. Nikdy tiché vynechanie.
describe('#604 zmiešaná zákazka Štandard + s iným farebným systémom — všetky tri farby', () => {
	const deluxe = (h: 6 | 10) => ({ ...spec('Deluxe|3K'), skloHrubka: h });
	const plus = spec('Štandard +|3K');
	const ok = (r: ReturnType<typeof kov>) => {
		expect(r.err).toBeNull();
		expect(r.polozky.length).toBeGreaterThan(0);
		expect(qty(r, 'ZASK00002')).toBe(6); // Štandard + 3K kladky vždy
		expect(qty(r, 'ZASK20252')).toBe(2);
	};
	const chyba = (r: ReturnType<typeof kov>, re: RegExp) => {
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(re);
	};

	it('Deluxe 10 mm + Štandard +, R9005: Deluxe krytky na predvolenú R9006 (s varovaním), Š+ zámok R9005', () => {
		const r = kov([deluxe(10), plus], 'R9005');
		ok(r);
		expect(qty(r, 'ZASK202531')).toBe(2);
		expect(qty(r, 'ZASK202525')).toBe(2); // krytka stredová L 10 mm R9006
		expect(r.warn).toMatch(/posuv 1: zvolená farba R9005 nie je platná pre systém Deluxe/);
		expect(r.warn).toMatch(/ZASK202541/);
	});

	it('Deluxe 10 mm + Štandard +, R7016: oba posuvy R7016, žiadna náhrada farby', () => {
		const r = kov([deluxe(10), plus], 'R7016');
		ok(r);
		expect(qty(r, 'ZASK202532')).toBe(2);
		expect(qty(r, 'ZASK202526')).toBe(2); // krytka stredová L 10 mm R7016
		expect(r.warn).not.toMatch(/predvolená/);
	});

	it('Deluxe 10 mm + Štandard +, R9006: HLASNÁ chyba na posuve Štandard + (R9006 preň neplatí)', () => {
		chyba(
			kov([deluxe(10), plus], 'R9006'),
			/posuv 2: systém Štandard \+ — zvolená farba R9006 preň nie je platná/
		);
	});

	it('Deluxe 6 mm + Štandard +, R9005: oba posuvy R9005', () => {
		const r = kov([deluxe(6), plus], 'R9005');
		ok(r);
		expect(qty(r, 'ZASK202531')).toBe(2);
		expect(qty(r, 'ZASK202520')).toBe(2); // krytka stredová L 6 mm R9005
	});

	it('Deluxe 6 mm + Štandard +, R7016: Deluxe na predvolenú R9006 (s varovaním), Š+ zámok R7016', () => {
		const r = kov([deluxe(6), plus], 'R7016');
		ok(r);
		expect(qty(r, 'ZASK202532')).toBe(2);
		expect(qty(r, 'ZASK202519')).toBe(2); // krytka stredová L 6 mm R9006
		expect(r.warn).toMatch(/posuv 1: zvolená farba R7016 nie je platná pre systém Deluxe/);
	});

	it('Deluxe 6 mm + Štandard +, R9006: HLASNÁ chyba na posuve Štandard +', () => {
		chyba(kov([deluxe(6), plus], 'R9006'), /posuv 2: systém Štandard \+ — zvolená farba R9006/);
	});

	it('Slide + Štandard +: R7016 kompletné, R9005 chyba na Slide (bez skladu), R9006 chyba', () => {
		const r = kov([spec('Slide|2K'), plus], 'R7016');
		ok(r);
		expect(qty(r, 'ZASK202538')).toBe(2); // Slide zámok R7016
		expect(qty(r, 'ZASK202532')).toBe(2); // Štandard + zámok R7016
		chyba(
			kov([spec('Slide|2K'), plus], 'R9005'),
			/posuv 1: systém Slide — zvolená farba R9005 preň nie je platná/
		);
		chyba(kov([spec('Slide|2K'), plus], 'R9006'), /posuv 1: zvolená farba R9006 nesedí/);
	});

	it('Robust + Štandard +: R9005 aj R7016 kompletné, R9006 chyba', () => {
		for (const farba of ['R9005', 'R7016'] as const) {
			const r = kov([spec('Robust|2K'), plus], farba);
			ok(r);
			expect(qty(r, farba === 'R9005' ? 'ZASK202533' : 'ZASK202534')).toBe(4); // Robust kľučka
			expect(qty(r, farba === 'R9005' ? 'ZASK202531' : 'ZASK202532')).toBe(2); // Š+ zámok
		}
		chyba(kov([spec('Robust|2K'), plus], 'R9006'), /posuv 1: zvolená farba R9006 nesedí/);
	});
});

// Výstup kovanieDoOdpisu PRED opravou #604 (zachytený na 0.25.61) — oprava pridáva LEN
// Štandard +; tieto systémy sa nesmú zmeniť ani o riadok, množstvo, poradie či hlášku.
describe('#604 ostatné systémy bez zmeny (výstup pred opravou)', () => {
	const STANDARD_WARN =
		'STANDARD: tesniaca kefa ZASK202541 (4,8×5 mm) zatiaľ NIE JE v odpise kovania — neznáma rola profilu, doplniť ručne.';

	it('starý Štandard 2K R9005', () => {
		expect(kov([spec('Štandard|2K')], 'R9005')).toEqual({
			polozky: [
				{ kod: 'ZASK00002', nazov: 'Kladka dvojitá', qty: 4, mj: 'ks' },
				{ kod: 'ZASK20252', nazov: 'Protikus zamku', qty: 2, mj: 'ks' },
				{ kod: 'ZASK202531', nazov: 'Automaticky zamok R9005', qty: 2, mj: 'ks' },
				{ kod: 'ZASK00007', nazov: 'Tesniaca kefa 4,8×4 mm', qty: 11.536, mj: 'm' }
			],
			err: null,
			warn: STANDARD_WARN
		});
	});

	it('starý Štandard 2x3K IZO R7016', () => {
		expect(kov([spec('Štandard|2x3K IZO')], 'R7016')).toEqual({
			polozky: [
				{ kod: 'ZASK00002', nazov: 'Kladka dvojitá', qty: 12, mj: 'ks' },
				{ kod: 'ZASK20252', nazov: 'Protikus zamku', qty: 3, mj: 'ks' },
				{ kod: 'ZASK202532', nazov: 'Automaticky zamok R7016', qty: 3, mj: 'ks' },
				{ kod: 'ZASK00007', nazov: 'Tesniaca kefa 4,8×4 mm', qty: 10.848, mj: 'm' }
			],
			err: null,
			warn: STANDARD_WARN
		});
	});

	it('Robust 2K R9005', () => {
		expect(kov([spec('Robust|2K')], 'R9005')).toEqual({
			polozky: [
				{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' },
				{ kod: 'ZASK00029', nazov: 'Uzáver RS ROBSUT', qty: 2, mj: 'ks' },
				{ kod: 'ZASK202533', nazov: 'Kľučka R9005', qty: 4, mj: 'ks' },
				{ kod: 'ZASK00031', nazov: 'Podložka uzáveru', qty: 10, mj: 'ks' },
				{ kod: 'ZASK00032', nazov: 'Protikus uzáveru', qty: 4, mj: 'ks' },
				{ kod: 'ZASK00033', nazov: 'Protikus uzáveru podložka', qty: 4, mj: 'ks' },
				{ kod: 'ZASK202535', nazov: 'Krytka vložky R9005', qty: 4, mj: 'ks' },
				{ kod: 'ZASK00036', nazov: 'Krytka krídla', qty: 4, mj: 'ks' },
				{ kod: 'ZASK00037', nazov: 'Rohovník obvodový', qty: 8, mj: 'ks' },
				{ kod: 'ZASK00038', nazov: 'Rohovník krídla', qty: 8, mj: 'ks' },
				{ kod: 'ZASK00039', nazov: 'Rohovník zarovnávací', qty: 16, mj: 'ks' },
				{ kod: 'ZASK20242', nazov: 'Tesnenie zasklievacie 12', qty: 7.278, mj: 'm' },
				{ kod: 'ZASK20241', nazov: 'Tesnenie zasklievacie 10', qty: 7.278, mj: 'm' },
				{ kod: 'ZASK00041', nazov: 'Kefové tesnenie 7x,3,5', qty: 4.26, mj: 'm' },
				{ kod: 'ZASK00042', nazov: 'Kefové tesnenie 7x5,00', qty: 20.592, mj: 'm' }
			],
			err: null,
			warn: null
		});
	});

	it('Slide 2K R7016', () => {
		const r = kov([spec('Slide|2K')], 'R7016');
		expect(r.err).toBeNull();
		expect(r.polozky).toEqual([
			{ kod: 'ZASK20253', nazov: 'Kladka RS SLIDE', qty: 4, mj: 'ks' },
			{ kod: 'ZASK202538', nazov: 'Automaticky zamok RS SLIDE R7016', qty: 2, mj: 'ks' },
			{ kod: 'ZASK20255', nazov: 'Protikus zamku', qty: 2, mj: 'ks' },
			{ kod: 'ZASK20256', nazov: 'Krytka ramoveho profilu', qty: 4, mj: 'ks' },
			{ kod: 'ZASK20257', nazov: 'Rohovnik zarovnavaci', qty: 16, mj: 'ks' },
			{ kod: 'ZASK00037', nazov: 'Rohovník obvodový', qty: 16, mj: 'ks' },
			{ kod: 'ZASK20242', nazov: 'Tesnenie zasklievacie 12', qty: 7.258, mj: 'm' },
			{ kod: 'ZASK20241', nazov: 'Tesnenie zasklievacie 10', qty: 7.258, mj: 'm' },
			{ kod: 'ZASK20259', nazov: 'Kefové tesnenie 5x8', qty: 20.492, mj: 'm' }
		]);
		expect(r.warn).toMatch(/ZASK20258/); // madlo 0 ks (#357) — hláška nezmenená
	});

	it('Deluxe 3K 10 mm R9006', () => {
		expect(kov([{ ...spec('Deluxe|3K'), skloHrubka: 10 }], 'R9006')).toEqual({
			polozky: [
				{ kod: 'ZASK202525', nazov: 'Krytka stredová L 10 mm R9006', qty: 2, mj: 'ks' },
				{ kod: 'ZASK202527', nazov: 'Krytka stredová P 10 mm R9006', qty: 2, mj: 'ks' },
				{ kod: 'ZASK202529', nazov: 'Krytka krajná 10 mm R9006', qty: 2, mj: 'ks' },
				{ kod: 'ZASK00049', nazov: 'Madlo D56', qty: 2, mj: 'ks' },
				{ kod: 'ZASK00007', nazov: 'Tesniaca kefa 4,8×4 mm', qty: 6.018, mj: 'm' },
				{ kod: 'ZASK202542', nazov: 'Tesniaca kefa 4,8×7 mm', qty: 6.018, mj: 'm' }
			],
			err: null,
			warn: null
		});
	});
});
