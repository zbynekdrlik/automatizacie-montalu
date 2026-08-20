// #91 nález 5 (adversariálna revízia PR #122): `sietkaKolajnicaSwap` kopíruje len
// `{kod, nazov}` z 3K náprotivku a drží dĺžkový vzorec (dim/koef/offset/delitN/
// dlzkaTyce) PÔVODNÉHO 2K riadku — v tichom predpoklade, že 2K aj 3K koľajnica majú
// TOTOŽNÝ vzorec. `offset` je pritom živo editovateľný v `/zasklenia/nastavenia`
// (per riadok, per `poradie`) — kto ho zmení len na jednej strane, appka by so
// sieťkou ticho napísala do Money článok s dĺžkou z DRUHEJ strany. Namiesto tichého
// zlého odpisu `sietkaKolajnicaVzorecChyba` zlyhá nahlas (rovnaká disciplína ako
// `missingHrubkaProfile`) — tento test overuje, že (a) na dnešnom `cfg_seed.json`
// je no-op pre KAŽDÝ systém so sieťkou, (b) skutočne zachytí nezhodu, (c) je
// zapojený do `safeCompute`/`safeComputeMulti`, takže sa nikdy nezapíše zlý odpis.
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	safeCompute,
	safeComputeMulti,
	sietkaKolajnicaVzorecChyba,
	type SysRow,
	type RezRow,
	type Cfg
} from '../src/lib/server/compute';
import { SIETKA_SYSTEMY } from '../src/lib/sietka';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

describe('#91 nález 5 — sietkaKolajnicaVzorecChyba je no-op na dnešnom cfg_seed.json', () => {
	for (const system of SIETKA_SYSTEMY) {
		for (const styl of ['2K', '2K IZO']) {
			const sysStyl = `${system}|${styl}`;
			if (!cfg[sysStyl]) continue; // nie každý systém má IZO variant (Robust/Slide)
			it(`${sysStyl}: žiadna nezhoda vzorca proti jeho 3K náprotivku`, () => {
				expect(sietkaKolajnicaVzorecChyba(cfg, system, styl)).toBeNull();
			});
		}
	}

	it('nie-2K štýl (napr. 3K, 2x2K) sa vôbec nekontroluje — swap sa naň nevzťahuje', () => {
		expect(sietkaKolajnicaVzorecChyba(cfg, 'Robust', '3K')).toBeNull();
		expect(sietkaKolajnicaVzorecChyba(cfg, 'Štandard +', '2x2K')).toBeNull();
	});

	it('neznámy systém/štýl (skupina neexistuje) — žiadny crash, null', () => {
		expect(sietkaKolajnicaVzorecChyba(cfg, 'Neexistuje', '2K')).toBeNull();
	});
});

/** Hlboká kópia cfg s JEDNÝM zmeneným poľom na jednom riadku — simuluje živú
 *  úpravu vzorca cez `/zasklenia/nastavenia` (per riadok, per `poradie`). */
function mutujRiadok(
	base: Cfg,
	sysStyl: string,
	zhoda: (r: RezRow) => boolean,
	patch: Partial<RezRow>
): Cfg {
	const clone: Cfg = JSON.parse(JSON.stringify(base));
	const rows = clone[sysStyl]!.rez.filter(zhoda);
	expect(rows.length).toBeGreaterThan(0); // sabotáž musí naozaj niečo zasiahnuť
	for (const r of rows) Object.assign(r, patch);
	return clone;
}

describe('#91 nález 5 — sabotáž: nezhoda vzorca MUSÍ byť zachytená nahlas', () => {
	it('offset posunutý len na 2K strane (Štandard +, horná) → chyba, nie ticho zlý odpis', () => {
		const zly = mutujRiadok(
			cfg,
			'Štandard +|2K',
			(r) => r.typ === 'profil' && r.nazov.startsWith('Koľajnica horná'),
			{ offset: 5 }
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Štandard +', '2K');
		expect(err).not.toBeNull();
		expect(err).toContain('Koľajnica');
		expect(err).toContain('Štandard +');
	});

	it('offset posunutý len na 3K strane (Robust, obvodová koľajnica) → chyba', () => {
		const zly = mutujRiadok(
			cfg,
			'Robust|3K',
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov),
			{ offset: -3 }
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Robust', '2K');
		expect(err).not.toBeNull();
	});

	it('dlzkaTyce sa rozíde (napr. 3K koľajnica na inej dĺžke tyče) → chyba', () => {
		const zly = mutujRiadok(
			cfg,
			'Štandard|3K IZO',
			(r) => r.typ === 'profil' && r.nazov.startsWith('Koľajnica spodná'),
			{ dlzkaTyce: 6000 }
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Štandard', '2K IZO');
		expect(err).not.toBeNull();
	});

	it('koef/delitN sa rozíde → chyba', () => {
		const zly = mutujRiadok(
			cfg,
			'Slide|3K',
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov),
			{ delitN: 1 }
		);
		const err = sietkaKolajnicaVzorecChyba(zly, 'Slide', '2K');
		expect(err).not.toBeNull();
	});

	it('nesúvisiaci riadok (dim=V pri Robust/Slide, druhá kópia rovnakého kódu) mutovaný samostatne — swap ostáva bezpečný, lebo dim sa páruje presne (nie krížom S↔V)', () => {
		// zmutuje LEN V-riadok Robust|3K — S-riadok (a teda S-strana swapu) musí
		// ostať v poriadku; V-strana musí chybu nahlásiť. Dokazuje, že guard
		// páruje podľa `dim`, nie len podľa role (inak by V-mutácia falošne
		// nahlásila/nenahlásila chybu na S-strane).
		const zly = mutujRiadok(
			cfg,
			'Robust|3K',
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov) && r.dim === 'V',
			{ offset: 7 }
		);
		expect(sietkaKolajnicaVzorecChyba(zly, 'Robust', '2K')).not.toBeNull();
	});
});

describe('#91 nález 5 — zapojené do safeCompute/safeComputeMulti (nikdy sa nezapíše zlý odpis)', () => {
	it('safeCompute vráti chybu namiesto výpočtu, keď je vzorec rozídený a sieťka je zapnutá', () => {
		const zly = mutujRiadok(
			cfg,
			'Štandard +|2K',
			(r) => r.typ === 'profil' && r.nazov.startsWith('Koľajnica horná'),
			{ offset: 5 }
		);
		const { r, err } = safeCompute(zly, 'Štandard +|2K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		});
		expect(r).toBeNull();
		expect(err).toContain('Koľajnica');
	});

	it('safeCompute BEZ sieťky prejde aj s rozídeným vzorcom (swap sa vôbec nevolá)', () => {
		const zly = mutujRiadok(
			cfg,
			'Štandard +|2K',
			(r) => r.typ === 'profil' && r.nazov.startsWith('Koľajnica horná'),
			{ offset: 5 }
		);
		const { r, err } = safeCompute(
			zly,
			'Štandard +|2K',
			3000,
			1850,
			false,
			0,
			false,
			undefined,
			null
		);
		expect(err).toBeNull();
		expect(r).not.toBeNull();
	});

	it('safeComputeMulti vráti chybu (s číslom posuvu) namiesto výpočtu', () => {
		const zly = mutujRiadok(
			cfg,
			'Robust|3K',
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov),
			{ offset: -3 }
		);
		const { r, err } = safeComputeMulti(zly, [
			{
				sysStyl: 'Robust|2K',
				S: 2509,
				V: 1930,
				redukciaZero: true,
				skloHrubka: 0,
				sietka: { uchyt: 'ziadny' }
			}
		]);
		expect(r).toBeNull();
		expect(err).toContain('Posuv 1');
	});
});
