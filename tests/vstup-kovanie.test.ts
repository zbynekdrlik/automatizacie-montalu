// Kovanie krídla (kľučka) — Patrik 2026-07-27: dva selecty (ľavá/pravá strana),
// pri KAŽDOM posuve sólo, len pre Robust. Display-only → do Money odpisu nesmie
// vstúpiť nič; tu strážime parsovanie + whitelist + systémovú bránu.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup, sanitizeKovanie, KOVANIA } from '../src/lib/server/vstup';
import { buildCFG, computeMulti, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const zaklad = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Robust',
	styl: '3K',
	s: '4645',
	v: '2320',
	sklo: 'Izolačné sklo 4/16/4 číre',
	otvaranie: 'P - L'
};

describe('KOVANIA — presne 4 možnosti podľa dielne', () => {
	it('zoznam sedí s tým, čo poslal Patrik', () => {
		expect(KOVANIA).toEqual([
			'Jednostranná kľučka z vnútra bez FAB',
			'Obojstranná kľučka bez FAB',
			'Jednostranná kľučka z vnútra s FAB',
			'Obojstranná kľučka s FAB'
		]);
	});
});

describe('sanitizeKovanie', () => {
	it('Robust + hodnota zo zoznamu → prejde', () => {
		expect(sanitizeKovanie('Robust', 'Obojstranná kľučka s FAB')).toBe('Obojstranná kľučka s FAB');
	});
	it('iný systém → zahodí (kovanie je zatiaľ len robustové)', () => {
		for (const sys of ['Slide', 'Deluxe', 'Štandard +', ''])
			expect(sanitizeKovanie(sys, 'Obojstranná kľučka s FAB')).toBe('');
	});
	it('neznáma hodnota (skriptovaný POST) → zahodí', () => {
		expect(sanitizeKovanie('Robust', 'zlatá kľučka')).toBe('');
		expect(sanitizeKovanie('Robust', undefined)).toBe('');
		expect(sanitizeKovanie('Robust', 42)).toBe('');
	});
});

describe('parseVstup — jeden posuv', () => {
	it('obe strany sa uložia a vstup je platný', () => {
		const { vstup, error } = parseVstup(
			fd({
				...zaklad,
				kovanieL: 'Obojstranná kľučka s FAB',
				kovanieP: 'Jednostranná kľučka z vnútra bez FAB'
			})
		);
		expect(error).toBeNull();
		expect(vstup.kovanieL).toBe('Obojstranná kľučka s FAB');
		expect(vstup.kovanieP).toBe('Jednostranná kľučka z vnútra bez FAB');
	});

	it('nezadané kovanie = prázdne (nič sa nekreslí) a NIE je to chyba', () => {
		const { vstup, error } = parseVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.kovanieL).toBe('');
		expect(vstup.kovanieP).toBe('');
	});

	it('Slide posuv kovanie zahodí, ale vstup ostáva platný', () => {
		const { vstup, error } = parseVstup(
			fd({
				...zaklad,
				system: 'Slide',
				styl: '3K',
				sklo: 'Izolačné sklo 4/8/4 číre',
				kovanieL: 'Obojstranná kľučka s FAB',
				kovanieP: 'Obojstranná kľučka bez FAB'
			})
		);
		expect(error).toBeNull();
		expect(vstup.kovanieL).toBe('');
		expect(vstup.kovanieP).toBe('');
	});
});

describe('parseMultiVstup — kovanie je PER POSUV („sólo")', () => {
	const posuvy = [
		{
			system: 'Robust',
			styl: '3K',
			s: '4645',
			v: '2320',
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'P - L',
			kovanieL: 'Obojstranná kľučka s FAB',
			kovanieP: 'Jednostranná kľučka z vnútra bez FAB'
		},
		{
			system: 'Robust',
			styl: '2K',
			s: '3000',
			v: '2320',
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'L - P',
			kovanieL: 'Jednostranná kľučka z vnútra s FAB',
			kovanieP: 'Obojstranná kľučka bez FAB'
		},
		{
			system: 'Slide',
			styl: '2K',
			s: '3000',
			v: '2200',
			sklo: 'Izolačné sklo 4/8/4 číre',
			otvaranie: 'P - L',
			kovanieL: 'Obojstranná kľučka s FAB',
			kovanieP: 'Obojstranná kľučka s FAB'
		}
	];

	it('každý posuv má svoje kovanie; Slide posuv ho nedostane', () => {
		const { vstup, error } = parseMultiVstup(
			fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(posuvy) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy.map((p) => [p.kovanieL, p.kovanieP])).toEqual([
			['Obojstranná kľučka s FAB', 'Jednostranná kľučka z vnútra bez FAB'],
			['Jednostranná kľučka z vnútra s FAB', 'Obojstranná kľučka bez FAB'],
			['', '']
		]);
	});

	it('chýbajúce kovanie v JSON-e → prázdne, bez chyby', () => {
		const bez = posuvy.map(({ kovanieL: _l, kovanieP: _p, ...rest }) => rest);
		const { vstup, error } = parseMultiVstup(
			fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(bez) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy.every((p) => p.kovanieL === '' && p.kovanieP === '')).toBe(true);
	});
});

describe('computeMulti — kovanie je len prieťahové pole, výpočet nemení', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const spec = (kov: { kovanieL?: string; kovanieP?: string }) => [
		{
			sysStyl: 'Robust|3K',
			S: 4645,
			V: 2320,
			redukciaZero: true,
			skloHrubka: 0,
			otvaranie: 'P - L',
			sklo: 'Izolačné sklo 4/16/4 číre',
			...kov
		}
	];

	it('kovanie sa vráti v posuvoch (pre náhľad) a odpis je identický ako bez neho', () => {
		const bez = computeMulti(cfg, spec({}))!;
		const s = computeMulti(
			cfg,
			spec({
				kovanieL: 'Obojstranná kľučka s FAB',
				kovanieP: 'Jednostranná kľučka z vnútra bez FAB'
			})
		)!;
		expect(s.posuvy[0].kovanieL).toBe('Obojstranná kľučka s FAB');
		expect(s.posuvy[0].kovanieP).toBe('Jednostranná kľučka z vnútra bez FAB');
		expect(s.odpis).toEqual(bez.odpis);
		expect(s.material).toEqual(bez.material);
	});
});
