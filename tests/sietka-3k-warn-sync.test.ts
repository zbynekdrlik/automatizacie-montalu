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
import { buildCFG, type SysRow, type RezRow } from '../src/lib/server/compute';
import { rolaKolajnice } from '../src/lib/kolajnica';
import {
	SIETKA_SYSTEMY,
	SIETKA_SYSTEMY_DELENA_KOLAJNICA,
	popis3KKolajnicaVymena
} from '../src/lib/sietka';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

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
