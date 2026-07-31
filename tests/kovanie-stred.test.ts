// Kľučka NAVYŠE na stredovom krídle — len opona (2x štýly).
//
// Patrik cez Odoo „Vyroba automatizacia" (2026-07-31): „pri opone 2x2, 2x3, 2x4
// sú na pravej a ľavej strane + je navyše aj na jednom krídle v strede, kde sa
// stretávajú. Ak máme 2x3, kľučka bude okno 1, okno 6 a potom buď okno 3 alebo 4."
//
// MONEY-NEUTRÁLNE: opony majú v tabuľke komponentov 3 uzávery (a teda 3 kľučky)
// už teraz (`UZAVERY_ROBUST`), takže toto pole len HOVORÍ, ktorá kľučka a na
// ktorom stredovom okne — počty v odpise sa ním nesmú pohnúť. Tu to strážime.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup } from '../src/lib/server/vstup';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { buildCFG, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const KLUCKA = 'Obojstranná kľučka s FAB';
const zaklad = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Robust',
	sklo: 'Izolačné sklo 4/16/4 číre',
	otvaranie: 'Opona',
	s: '4700',
	v: '2850'
};

describe('kovanie stredového okna — parsovanie', () => {
	it('opona (2x2K): kľučka aj voľba okna prejdú', () => {
		const { vstup, error } = parseVstup(
			fd({ ...zaklad, styl: '2x2K', kovanieStred: KLUCKA, kovanieStredOkno: 'P' })
		);
		expect(error).toBeNull();
		expect(vstup.kovanieStred).toBe(KLUCKA);
		expect(vstup.kovanieStredOkno).toBe('P');
	});

	it('mimo opony sa stredová kľučka ZAHODÍ (2K nemá stredové krídlo)', () => {
		const { vstup } = parseVstup(
			fd({ ...zaklad, styl: '2K', otvaranie: 'P - L', kovanieStred: KLUCKA })
		);
		expect(vstup.kovanieStred).toBe('');
	});

	it('iný systém než Robust ju zahodí (kovanie je zatiaľ len robustové)', () => {
		const { vstup } = parseVstup(
			fd({ ...zaklad, system: 'Slide', styl: '2x2K', sklo: 'Kalené 8mm', kovanieStred: KLUCKA })
		);
		expect(vstup.kovanieStred).toBe('');
	});

	it('neznáma hodnota zo skriptovaného POST-u sa zahodí', () => {
		const { vstup } = parseVstup(
			fd({ ...zaklad, styl: '2x2K', kovanieStred: 'Zlatá kľučka od Patrika' })
		);
		expect(vstup.kovanieStred).toBe('');
	});

	it('neznáme okno spadne na ľavé (default), nie na chybu', () => {
		const { vstup } = parseVstup(fd({ ...zaklad, styl: '2x2K', kovanieStredOkno: 'X' }));
		expect(vstup.kovanieStredOkno).toBe('L');
	});

	it('viac posuvov: stredová kľučka je per posuv a prežije druhý parse', () => {
		const posuv = {
			system: 'Robust',
			styl: '2x3K',
			s: '6000',
			v: '2600',
			sklo: zaklad.sklo,
			otvaranie: 'Opona',
			kovanieStred: KLUCKA,
			kovanieStredOkno: 'P'
		};
		const prvy = parseMultiVstup(
			fd({ zak: 'Z', op: 'O', zakaznik: 'X', posuvy: JSON.stringify([posuv]) })
		).vstup;
		expect(prvy.posuvy[0].kovanieStred).toBe(KLUCKA);
		expect(prvy.posuvy[0].kovanieStredOkno).toBe('P');
		// náhľad posiela sparsovaný tvar späť (viď vstup-multi-roundtrip.test.ts)
		const druhy = parseMultiVstup(
			fd({ zak: 'Z', op: 'O', zakaznik: 'X', posuvy: JSON.stringify(prvy.posuvy) })
		).vstup;
		expect(druhy.posuvy[0].kovanieStred).toBe(KLUCKA);
		expect(druhy.posuvy[0].kovanieStredOkno).toBe('P');
	});
});

describe('kovanie stredového okna — Money odpis sa NEMENÍ', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const spec = { sysStyl: 'Robust|2x3K', S: 6000, V: 2600, redukciaZero: false };

	it('odpis kovania je rovnaký so stredovou kľučkou aj bez nej', () => {
		const bez = kovanieDoOdpisu(cfg, [{ ...spec }], false);
		const so = kovanieDoOdpisu(
			cfg,
			[{ ...spec, kovanieStred: KLUCKA, kovanieStredOkno: 'P' as const }],
			false
		);
		expect(bez.err).toBeNull();
		expect(so.err).toBeNull();
		expect(so.polozky).toEqual(bez.polozky);
	});

	it('opona má 3 kľučky už z tabuľky uzáverov (preto je pole len informácia)', () => {
		const { polozky, err } = kovanieDoOdpisu(cfg, [{ ...spec }], false);
		expect(err).toBeNull();
		// 3 uzávery × 2 ks (obojstranná FAB) = 6 ks kľučiek
		expect(polozky.find((p) => p.kod === 'ZASK00030')?.qty).toBe(6);
		expect(polozky.find((p) => p.kod === 'ZASK00029')?.qty).toBe(3);
	});
});
