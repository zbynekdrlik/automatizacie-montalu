// #91 — pojistka proti opakovaniu presne toho, čo sa stalo: UI hláška
// „appka automaticky odpíše 3K koľajnicu (2 ks + 2 ks)" klamala pre Štandard/
// Štandard +, lebo mala DELENÚ hornú+spodnú koľajnicu (dva odlišné Money kódy, po
// 1 ks), nie jednu obvodovú v dvoch kusoch ako Robust/Slide. `popis3KKolajnicaVymena`
// (sietka.ts) je client-safe a NEMÁ prístup k `cfg` — rozlišuje podľa statického
// zoznamu `SIETKA_SYSTEMY_DELENA_KOLAJNICA`. Tento test overuje, že ten zoznam
// zodpovedá REALITE v `cfg_seed.json` (cez `rolaKolajnice`, ten istý zdroj pravdy,
// ktorý používa `sietkaKolajnicaSwap` v compute.ts) — takže keď niekedy pribudne
// ďalší systém so sieťkou a delenou koľajnicou, tento test PADNE namiesto toho, aby
// UI opäť ticho klamalo o počte kusov.
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	sietkaKolajnicaSwap,
	sietkaKolajnicaVzorecChyba,
	type SysRow,
	type RezRow,
	type Cfg
} from '../src/lib/server/compute';
import { rolaKolajnice } from '../src/lib/kolajnica';
import {
	SIETKA_SYSTEMY,
	SIETKA_SYSTEMY_DELENA_KOLAJNICA,
	popis3KKolajnicaVymena,
	potrebuje3KKolajnicu
} from '../src/lib/sietka';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

/** Systém/štýl skupiny zo `SIETKA_SYSTEMY`, pri ktorých appka 3K-koľajnicovú hlášku
 *  zobrazí (`potrebuje3KKolajnicu`) — odvodené zo skutočných kľúčov `cfg`, nie
 *  natvrdo vypísané, takže nový systém/IZO-variant sa do testov zaradí sám. Zdieľané
 *  nálezom 3 (swap MUSÍ zmeniť kód) aj #124 (chýbajúca 3K skupina MUSÍ nahlásiť chybu). */
const styloveSkupiny = Object.keys(cfg)
	.map((sysStyl) => {
		const i = sysStyl.indexOf('|');
		return { sysStyl, system: sysStyl.slice(0, i), styl: sysStyl.slice(i + 1) };
	})
	.filter(({ system, styl }) => SIETKA_SYSTEMY.includes(system) && potrebuje3KKolajnicu(styl));

/** Má systém v cfg (podľa jeho `|2K` variantu) DELENÚ koľajnicu (horná+spodná)? */
function maDelenuKolajnicuVCfg(system: string): boolean {
	const g = cfg[`${system}|2K`];
	const kolajnice = (g?.rez ?? []).filter(
		(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov)
	);
	expect(kolajnice.length).toBeGreaterThan(0); // vektor musí mať 2K koľajnicu, inak test o ničom nehovorí
	return kolajnice.some((r) => rolaKolajnice(r.nazov) !== null);
}

describe('#91 — SIETKA_SYSTEMY_DELENA_KOLAJNICA musí byť v zhode s cfg_seed.json', () => {
	for (const system of SIETKA_SYSTEMY) {
		it(`${system}: statický zoznam sa zhoduje s rolaKolajnice() na živej konfigurácii`, () => {
			const delenaVCfg = maDelenuKolajnicuVCfg(system);
			const delenaVZozname = SIETKA_SYSTEMY_DELENA_KOLAJNICA.includes(system);
			expect(delenaVZozname).toBe(delenaVCfg);
		});
	}

	it('popis3KKolajnicaVymena: presný text pre delenú vs. jednu obvodovú koľajnicu', () => {
		expect(popis3KKolajnicaVymena('Robust')).toBe('3K koľajnicu (2 ks + 2 ks) namiesto 2K');
		expect(popis3KKolajnicaVymena('Slide')).toBe('3K koľajnicu (2 ks + 2 ks) namiesto 2K');
		expect(popis3KKolajnicaVymena('Štandard')).toBe(
			'3K koľajnicu (hornú aj spodnú, po 1 ks) namiesto 2K'
		);
		expect(popis3KKolajnicaVymena('Štandard +')).toBe(
			'3K koľajnicu (hornú aj spodnú, po 1 ks) namiesto 2K'
		);
	});
});

// #91 nález 3 (adversariálna revízia PR #122): predošlý test vyššie porovnáva
// LEN ručný zoznam `SIETKA_SYSTEMY_DELENA_KOLAJNICA` proti `cfg['<system>|2K']`
// — nikdy nezavolá `sietkaKolajnicaSwap`, nikdy sa nepozrie na iný štýl než
// holé `'2K'`. Diera z nálezu 1 (IZO sklo vôbec nespúšťa swap) preň bola
// konštrukčne neviditeľná, a keby sa `Štandard +|3K` niekedy premenovalo
// alebo preradilo, swap by ticho spadol na pôvodný 2K kód a VŠETKÝCH 717
// (teraz 719) ostatných testov by ostalo zelených — presne #91 verbatim.
//
// Skutočný invariant, riadený ŽIVÝM `cfg_seed.json` (nie ručným zoznamom):
// pre KAŽDÝ systém zo `SIETKA_SYSTEMY` a KAŽDÝ jeho štýl, pri ktorom appka
// hlásku zobrazí (`potrebuje3KKolajnicu`), musí `sietkaKolajnicaSwap` vrátiť
// INÝ kód než vstupný, pre KAŽDÝ `Koľajnica` riadok tej skupiny. Systémy aj
// štýly sa berú zo skutočných kľúčov `cfg` (nie natvrdo vypísané) — nový
// systém alebo nová IZO/variant skupina sa do testu zaradí sama.
describe('#91 nález 3 — sietkaKolajnicaSwap MUSÍ vymeniť KAŽDÚ koľajnicu, pre KAŽDÝ systém/štýl s hláškou', () => {
	// dosiahnuteľnosť: musí pokrývať aj IZO štýl, nielen holé '2K' — inak by
	// bola diera z nálezu 1 preň znovu neviditeľná, presne ako v predošlej
	// verzii tohto testu.
	it('zoznam skupín pokrýva aj IZO štýl, nielen holé 2K (Štandard +)', () => {
		const styly = styloveSkupiny.filter((s) => s.system === 'Štandard +').map((s) => s.styl);
		expect(styly).toContain('2K');
		expect(styly).toContain('2K IZO');
	});

	it('nájdených skupín je aspoň toľko, koľko systémov v SIETKA_SYSTEMY (vektor nie je prázdny)', () => {
		expect(styloveSkupiny.length).toBeGreaterThanOrEqual(SIETKA_SYSTEMY.length);
	});

	for (const { sysStyl, system, styl } of styloveSkupiny) {
		it(`${sysStyl}: KAŽDÁ Koľajnica sa so zapnutou sieťkou zmení na iný kód`, () => {
			const kolajnice = cfg[sysStyl].rez.filter(
				(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov)
			);
			expect(kolajnice.length).toBeGreaterThan(0); // vektor musí mať čo testovať

			for (const r of kolajnice) {
				const out = sietkaKolajnicaSwap(cfg, system, styl, true, r.kod, r.nazov);
				expect(out.kod, `${sysStyl}: „${r.nazov}" (${r.kod}) sa nezmenilo`).not.toBe(r.kod);
			}
		});
	}
});

// #124 — rozšírenie invariantu: NIELEN že skupina/riadok EXISTUJE a swap zmení kód
// (nález 3 vyššie), ale aj že keď 3K(-variant) skupina CHÝBA, `sietkaKolajnicaVzorecChyba`
// to zachytí NAHLAS pre KAŽDÚ skupinu z `SIETKA_SYSTEMY`, ktorá sieťkovú výmenu
// potrebuje — nie len pre jeden-dva ručne vybrané prípady (`sietka-kolajnica-chybajuca-3k.test.ts`
// overuje mechanizmus na Robust/Štandard +; tento blok ho overuje MECHANIZMOVO naprieč
// KAŽDOU `styloveSkupiny` skupinou, odvodenou zo živého `cfg`, presne ako nález 3).
describe('#124 — sietkaKolajnicaVzorecChyba MUSÍ nahlásiť chybu, keď 3K(-variant) skupina chýba, pre KAŽDÚ skupinu s hláškou', () => {
	/** Hlboká kópia cfg s CELOU 3K(-variant) skupinou odstránenou. */
	function bezSkupiny(base: typeof cfg, sysStylChybajucej: string): Cfg {
		const clone: Cfg = JSON.parse(JSON.stringify(base));
		expect(clone[sysStylChybajucej]).toBeDefined(); // sabotáž musí naozaj niečo zmazať
		delete clone[sysStylChybajucej];
		return clone;
	}

	for (const { sysStyl, system, styl } of styloveSkupiny) {
		const g3kSysStyl = `${system}|${styl.replace(/^2K/, '3K')}`;
		it(`${sysStyl}: chýbajúca „${g3kSysStyl}" → sietkaKolajnicaVzorecChyba hlási chybu (nie ticho null)`, () => {
			const zly = bezSkupiny(cfg, g3kSysStyl);
			const err = sietkaKolajnicaVzorecChyba(zly, system, styl);
			expect(err, `${sysStyl}: chýbajúca 3K skupina mala nahlásiť chybu`).not.toBeNull();
			expect(err).toContain(system);
		});
	}
});
