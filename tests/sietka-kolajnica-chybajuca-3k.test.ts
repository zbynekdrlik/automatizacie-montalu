// #124 (nadväzuje na #91 nález 5, PR #122): `sietkaKolajnicaVzorecChyba` porovnáva
// VZOREC 2K koľajnice proti jej 3K náprotivku, ale keď 3K(-variant) skupina VÔBEC
// NEEXISTUJE (`!g3k`), pôvodný kód ticho vráti `null` — `sietkaKolajnicaSwap` sa v
// tom prípade tiež ticho vzdá a NECHÁ pôvodný 2K kód v odpise, hoci appka/UI hláška
// (`popis3KKolajnicaVymena`) tvrdí, že sa odpíše 3K. Presne tá istá TRIEDA chyby ako
// #91 (appka klame o odpise), len iná príčina (chýbajúca skupina namiesto zlého
// gate). Nedosiahnuteľné cez dnešný formulár (každý `SIETKA_SYSTEMY` systém, ktorý
// dnes zobrazuje hlášku, MÁ svoju `|3K(-variant)` skupinu) — obrana proti budúcej
// dátovej zmene (nová `2K` skupina bez `3K` náprotivku cez `/zasklenia/nastavenia`
// alebo priamy DB zásah).
//
// Druhá časť (#124 bod 2, rozhodnutie z design komentára): pôvodné `if (!r3)
// continue;` (riadok existuje v 3K skupine, ale nenájde sa zodpovedajúci `rola`+`dim`
// náprotivok) je TIEŽ dôvod na chybu, nie legitímny skip — `sietkaKolajnicaSwap`
// hľadá náprotivok LEN podľa `rola` (žiadna `dim` podmienka), takže by mohol ticho
// použiť riadok s iným `dim` a jeho (možno nekompatibilným) vzorcom.
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	safeCompute,
	sietkaKolajnicaSwap,
	sietkaKolajnicaVzorecChyba,
	type SysRow,
	type RezRow,
	type Cfg
} from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

/** Hlboká kópia cfg s CELOU skupinou odstránenou — simuluje novú `2K` skupinu
 *  pridanú bez jej `3K` náprotivku (dátová zmena cez `/zasklenia/nastavenia`
 *  alebo priamy DB zásah, nie kódová). */
function bezSkupiny(base: Cfg, sysStyl: string): Cfg {
	const clone: Cfg = JSON.parse(JSON.stringify(base));
	delete clone[sysStyl];
	return clone;
}

/** Hlboká kópia cfg s JEDNÝM riadkom odstráneným zo skupiny — simuluje čiastočne
 *  nakonfigurovanú 3K skupinu (napr. len horná koľajnica, spodná chýba). */
function bezRiadku(base: Cfg, sysStyl: string, zhoda: (r: RezRow) => boolean): Cfg {
	const clone: Cfg = JSON.parse(JSON.stringify(base));
	const pred = clone[sysStyl]!.rez.length;
	clone[sysStyl]!.rez = clone[sysStyl]!.rez.filter((r) => !zhoda(r));
	expect(clone[sysStyl]!.rez.length).toBeLessThan(pred); // sabotáž musí naozaj niečo zasiahnuť
	return clone;
}

describe('#124 — CELÁ 3K(-variant) skupina chýba: fail-loud, nie ticho null', () => {
	it('Robust|3K chýba → sietkaKolajnicaVzorecChyba hlási chybu (dnes vracia null)', () => {
		const zly = bezSkupiny(cfg, 'Robust|3K');
		const err = sietkaKolajnicaVzorecChyba(zly, 'Robust', '2K');
		expect(err).not.toBeNull();
		expect(err).toContain('Robust');
		expect(err).toContain('3K');
	});

	it('Štandard +|3K IZO chýba (IZO variant, nie holé 2K) → chyba', () => {
		const zly = bezSkupiny(cfg, 'Štandard +|3K IZO');
		const err = sietkaKolajnicaVzorecChyba(zly, 'Štandard +', '2K IZO');
		expect(err).not.toBeNull();
		expect(err).toContain('Štandard +');
	});

	it('chýbajúca skupina sa premietne do safeCompute — vráti chybu, nie ticho zlý odpis', () => {
		const zly = bezSkupiny(cfg, 'Robust|3K');
		const { r, err } = safeCompute(zly, 'Robust|2K', 2509, 1930, false, 0, false, undefined, {
			uchyt: 'ziadny'
		});
		expect(r).toBeNull();
		expect(err).not.toBeNull();
	});

	it('sabotage-verify: sietkaKolajnicaSwap sám o sebe by BEZO ZMENY zvládol kód (dôkaz, prečo guard musí zasiahnuť)', () => {
		const zly = bezSkupiny(cfg, 'Robust|3K');
		const out = sietkaKolajnicaSwap(
			zly,
			'Robust',
			'2K',
			true,
			'ZASP00014',
			'Koľajnica 2K Surový 7500 mm'
		);
		expect(out.kod).toBe('ZASP00014'); // swap ticho necháva 2K kód — presne #91 trieda chyby
	});
});

describe('#124 bod 2 — 3K skupina EXISTUJE, ale konkrétny riadok (rola+dim) chýba: tiež chyba, nie skip', () => {
	it('Štandard|3K bez „Koľajnica horná" (spodná ostáva) → chyba pre horný riadok', () => {
		const zly = bezRiadku(
			cfg,
			'Štandard|3K',
			(r) => r.typ === 'profil' && r.nazov.startsWith('Koľajnica horná')
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Štandard', '2K');
		expect(err).not.toBeNull();
	});

	it('Robust|3K bez V-dim riadku (S ostáva so ZHODNÝM kódom) → chyba pre V-stranu', () => {
		const zly = bezRiadku(
			cfg,
			'Robust|3K',
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov) && r.dim === 'V'
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Robust', '2K');
		expect(err).not.toBeNull();
	});
});
