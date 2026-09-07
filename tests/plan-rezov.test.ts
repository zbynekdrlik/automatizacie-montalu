// Testy pre #482 — Plán rezov (univerzálny optimalizátor rezov z CAD tabuľky).
// Vektory z Dominikových reálnych dát (brány — Plán rezov príloha issue).
import { describe, it, expect } from 'vitest';
import { parsePlanRezov, parsePlanRezovFormData } from '../src/lib/server/plan-rezov-vstup';
import { spocitajPlanRezov } from '../src/lib/server/plan-rezov';

// ──── Parser ────

describe('parsePlanRezov — tab-separovaný vstup', () => {
	const sample = [
		'10001 STABILIZAČNÝ PROFIL 100X50\t1\t5330',
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t1550',
		'10001 STABILIZAČNÝ PROFIL 100X50\t1\t4030',
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t1450',
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t940',
		'10001 STABILIZAČNÝ PROFIL 100X50\t1\t5650',
		'10001 STABILIZAČNÝ PROFIL 100X50\t1\t4250',
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t975',
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t1350',
		'18013 PROFIL 110x110 V2\t2\t1700',
		'18013 PROFIL 110x110 V2\t2\t1600',
		'AL_50x30x2\t4\t1865',
		'AL_50x30x2\t4\t1975',
		'lat 80x19\t22\t1252',
		'lat 80x19\t24\t1254'
	].join('\n');

	it('parsuje všetkých 15 riadkov', () => {
		const { riadky, preskocene } = parsePlanRezov(sample);
		expect(riadky.length).toBe(15);
		expect(preskocene.length).toBe(0);
	});

	it('prvý riadok má správny názov, ks a rez', () => {
		const { riadky } = parsePlanRezov(sample);
		expect(riadky[0]).toEqual({
			nazov: '10001 STABILIZAČNÝ PROFIL 100X50',
			ks: 1,
			rezMm: 5330
		});
	});

	it('posledný riadok (lat 80x19) má ks=24 a rez=1254', () => {
		const { riadky } = parsePlanRezov(sample);
		expect(riadky[14]).toEqual({
			nazov: 'lat 80x19',
			ks: 24,
			rezMm: 1254
		});
	});
});

describe('parsePlanRezov — tolerancie', () => {
	it('preskočí prázdne riadky a hlavičky', () => {
		const text = ['Číslo\tNázov\tks\tRez', '', '10001 PROFIL\t3\t2000', '  ', 'KONIEC'].join('\n');
		const { riadky, preskocene } = parsePlanRezov(text);
		expect(riadky.length).toBe(1);
		// hlavička + KONIEC sú preskočené
		expect(preskocene.length).toBe(2);
	});

	it('space-separovaný riadok funguje', () => {
		const text = 'lat 80x19  22  1252';
		const { riadky } = parsePlanRezov(text);
		expect(riadky.length).toBe(1);
		expect(riadky[0]).toEqual({ nazov: 'lat 80x19', ks: 22, rezMm: 1252 });
	});

	it('akceptuje desatinnú čiarku', () => {
		const text = 'AL_50\t4\t1865,5';
		const { riadky } = parsePlanRezov(text);
		expect(riadky[0]!.rezMm).toBe(1865.5);
	});

	it('s extra stĺpcami (výdaj materiálu) parsuje správne', () => {
		const text = '10001 STABILIZAČNÝ PROFIL 100X50\t1\t5330\t5,330';
		const { riadky } = parsePlanRezov(text);
		expect(riadky.length).toBe(1);
		expect(riadky[0]!.rezMm).toBe(5330);
	});
});

// ──── Zoskupenie + optimalizácia ────

describe('spocitajPlanRezov — vzorové dáta z brán (6000 mm tyče)', () => {
	const riadky = [
		// 10001 STABILIZAČNÝ PROFIL 100X50
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 5330 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1550 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 4030 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1450 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 940 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 5650 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 4250 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 975 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1350 },
		// 18013
		{ nazov: '18013 PROFIL 110x110 V2', ks: 2, rezMm: 1700 },
		{ nazov: '18013 PROFIL 110x110 V2', ks: 2, rezMm: 1600 },
		// AL_50x30x2
		{ nazov: 'AL_50x30x2', ks: 4, rezMm: 1865 },
		{ nazov: 'AL_50x30x2', ks: 4, rezMm: 1975 },
		// lat 80x19
		{ nazov: 'lat 80x19', ks: 22, rezMm: 1252 },
		{ nazov: 'lat 80x19', ks: 24, rezMm: 1254 }
	];

	it('výsledok má 4 profily', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		expect(v.profily.length).toBe(4);
	});

	it('profily sú v správnom poradí (poradie vloženia)', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		expect(v.profily.map((p) => p.nazov)).toEqual([
			'10001 STABILIZAČNÝ PROFIL 100X50',
			'18013 PROFIL 110x110 V2',
			'AL_50x30x2',
			'lat 80x19'
		]);
	});

	it('10001 STABILIZAČNÝ PROFIL — 14 kusov celkom', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const p = v.profily[0]!;
		const celkomKs = p.material.rezy.reduce((s, r) => s + r.ks, 0);
		expect(celkomKs).toBe(14); // 1+2+1+2+2+1+1+2+2
	});

	it('lat 80x19 — 46 kusov celkom (22+24)', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const p = v.profily[3]!;
		const celkomKs = p.material.rezy.reduce((s, r) => s + r.ks, 0);
		expect(celkomKs).toBe(46);
	});

	it('18013 PROFIL 110x110 V2 — 2 tyče pri 6000 mm (4 ks, max 1700 mm)', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const p = v.profily[1]!;
		// 4 kusy (2×1700 + 2×1600) na 6000 mm tyčiach:
		// tyč 1: 1700 + 1700 + 1600 = 5000 + medzery = 5012 → vojde
		// tyč 2: 1600 → vojde
		// FFD: sort desc: 1700, 1700, 1600, 1600
		// tyč 1: 1700(+4) → zostane 4296; +1700(+4) → 2592; +1600(+4) → 988 → vojde
		// tyč 2: 1600(+4) → 4396
		expect(p.material.tyce).toBe(2);
	});

	it('AL_50x30x2 — 3 tyče pri 6000 mm (rezy do ~2000 = max 3 per tyč)', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const p = v.profily[2]!;
		// 8 ks: 4×1975 + 4×1865; FFD desc: 1975,1975,1975,1975,1865,1865,1865,1865
		// tyč 1: 1975+4=1979 → 4021; +1975+4=1979 → 2042; +1975+4 → 63 (vojde 3)
		// tyč 2: 1975+4=1979 → 4021; +1865+4=1869 → 2152; +1865+4=1869 → 283 (vojde 3)
		// tyč 3: 1865+4=1869 → 4131; +1865+4=1869 → 2262 (vojde 2)
		expect(p.material.tyce).toBe(3);
	});

	it('celkový počet tyčí > 0', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		expect(v.tyceSpolu).toBeGreaterThan(0);
	});

	it('žiadne varovania pri 6000 mm (žiadny rez > 6000)', () => {
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		// 5650 + 4 = 5654 < 6000 → vojde; ale 5650+4=5654 < 6000 = OK
		expect(v.tooLong.length).toBe(0);
	});
});

describe('spocitajPlanRezov — 7500 mm tyče', () => {
	const riadky = [
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 5330 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1550 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 4030 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1450 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 940 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 5650 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 1, rezMm: 4250 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 975 },
		{ nazov: '10001 STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1350 }
	];

	it('6000 mm = 6 tyčí, 7500 mm = 5 tyčí (exact FFD vectors)', () => {
		const v6 = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const v7 = spocitajPlanRezov({ dlzkaTyce: 7500, reznaMedzera: 4, riadky });
		expect(v6.tyceSpolu).toBe(6);
		expect(v7.tyceSpolu).toBe(5);
	});
});

describe('spocitajPlanRezov — zoskupenie rovnakých rezov', () => {
	it('dva riadky s rovnakým profilom a dĺžkou sa zlúčia (2+3 = 5 ks)', () => {
		const riadky = [
			{ nazov: 'PROFIL X', ks: 2, rezMm: 1500 },
			{ nazov: 'PROFIL X', ks: 3, rezMm: 1500 }
		];
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		expect(v.profily.length).toBe(1);
		const p = v.profily[0]!;
		// rezy pole má len 1 záznam (zlúčené)
		expect(p.material.rezy.length).toBe(1);
		expect(p.material.rezy[0]!.ks).toBe(5);
		expect(p.material.rezy[0]!.rozmer).toBe(1500);
	});
});

describe('spocitajPlanRezov — tooLong varovania', () => {
	it('rez dlhší ako tyč sa reportuje', () => {
		const riadky = [{ nazov: 'PROFIL', ks: 1, rezMm: 7000 }];
		const v = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		expect(v.tooLong.length).toBe(1);
		expect(v.tooLong[0]!.nazov).toBe('PROFIL');
		expect(v.varovania.length).toBeGreaterThan(0);
	});
});

// ──── FormData parser ────

describe('parsePlanRezovFormData', () => {
	it('validný vstup sa sparsuje', () => {
		const fd = new FormData();
		fd.set('dlzkaTyce', '6000');
		fd.set('reznaMedzera', '4');
		fd.set('cad', '10001 PROFIL\t2\t1500\nlat 80x19\t10\t1252');
		const result = parsePlanRezovFormData(fd);
		expect('vstup' in result).toBe(true);
		if ('vstup' in result) {
			expect(result.vstup.riadky.length).toBe(2);
			expect(result.vstup.dlzkaTyce).toBe(6000);
		}
	});

	it('prázdny CAD text = chyba', () => {
		const fd = new FormData();
		fd.set('dlzkaTyce', '6000');
		fd.set('cad', '');
		const result = parsePlanRezovFormData(fd);
		expect('error' in result).toBe(true);
	});

	it('neplatná dĺžka tyče = chyba', () => {
		const fd = new FormData();
		fd.set('dlzkaTyce', 'abc');
		fd.set('cad', 'PROFIL\t2\t1500');
		const result = parsePlanRezovFormData(fd);
		expect('error' in result).toBe(true);
	});

	it('default rezná medzera je 4 (keď chýba)', () => {
		const fd = new FormData();
		fd.set('dlzkaTyce', '6000');
		fd.set('cad', 'PROFIL\t2\t1500');
		const result = parsePlanRezovFormData(fd);
		expect('vstup' in result).toBe(true);
		if ('vstup' in result) {
			expect(result.vstup.reznaMedzera).toBe(4);
		}
	});
});
