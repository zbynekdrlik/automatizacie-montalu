// Klín zasklenia — Patrik 2026-07-27: zapínač per posuv + 4 kóty (dĺžka, šírka/
// hĺbka, výška 1, výška 2) + počet ks. DISPLAY-ONLY: nesmie zmeniť ani jeden
// riadok Money odpisu. Tu strážime parsovanie, rozsahy (skriptovaný POST obíde
// HTML5 min/max) a Money-neutralitu výpočtu.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup, parseKlin } from '../src/lib/server/vstup';
import { klinPopis, KLIN_MAX_ROZMER, KLIN_MAX_KS } from '../src/lib/klin';
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
const klinFd = {
	klin: '1',
	klinDlzka: '4645',
	klinSirka: '250',
	klinV1: '350',
	klinV2: '120',
	klinKs: '2'
};

describe('parseKlin', () => {
	const raw = { on: '1', dlzka: '4645', sirka: '250', v1: '350', v2: '120', ks: '2' };

	it('vypnutý zapínač → žiadny klín a žiadna chyba (klín je nepovinný)', () => {
		for (const on of ['', '0', undefined, false, null])
			expect(parseKlin({ ...raw, on })).toEqual({ klin: null, error: null });
	});

	it('zapnutý s platnými rozmermi → klín aj s desatinnou čiarkou', () => {
		expect(parseKlin(raw)).toEqual({
			klin: { dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 },
			error: null
		});
		// dielňa píše čísla s čiarkou
		expect(parseKlin({ ...raw, dlzka: '4645,5' }).klin?.dlzka).toBe(4645.5);
	});

	it('nevyplnený počet = 1 ks', () => {
		expect(parseKlin({ ...raw, ks: '' }).klin?.ks).toBe(1);
		expect(parseKlin({ ...raw, ks: undefined }).klin?.ks).toBe(1);
		// zlomkový počet sa zaokrúhli (0,5 kusa klina neexistuje)
		expect(parseKlin({ ...raw, ks: '2,4' }).klin?.ks).toBe(2);
	});

	it('dĺžka aj šírka musia byť kladné a v rozsahu', () => {
		expect(parseKlin({ ...raw, dlzka: '0' }).error).toMatch(/dĺžka/);
		expect(parseKlin({ ...raw, dlzka: '' }).error).toMatch(/dĺžka/);
		expect(parseKlin({ ...raw, dlzka: String(KLIN_MAX_ROZMER + 1) }).error).toMatch(/dĺžka/);
		expect(parseKlin({ ...raw, sirka: '-5' }).error).toMatch(/šírka/);
		expect(parseKlin({ ...raw, sirka: String(KLIN_MAX_ROZMER + 1) }).error).toMatch(/šírka/);
	});

	it('jedna výška smie byť 0 (klín dobehnutý do ostra), obe 0 nie', () => {
		expect(parseKlin({ ...raw, v2: '0' }).error).toBeNull();
		expect(parseKlin({ ...raw, v1: '0' }).error).toBeNull();
		expect(parseKlin({ ...raw, v1: '0', v2: '0' }).error).toMatch(/aspoň jednu výšku/);
		expect(parseKlin({ ...raw, v1: '-1' }).error).toMatch(/výšky/);
		expect(parseKlin({ ...raw, v2: String(KLIN_MAX_ROZMER + 1) }).error).toMatch(/výšky/);
	});

	it('počet kusov mimo rozsahu → chyba', () => {
		expect(parseKlin({ ...raw, ks: String(KLIN_MAX_KS + 1) }).error).toMatch(/počet kusov/);
		expect(parseKlin({ ...raw, ks: '-3' }).error).toMatch(/počet kusov/);
	});
});

describe('parseVstup — klín jedného posuvu', () => {
	it('zapnutý klín sa uloží', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, ...klinFd }));
		expect(error).toBeNull();
		expect(vstup.klin).toEqual({ dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 });
	});

	it('bez klina je vstup platný a klín je null', () => {
		const { vstup, error } = parseVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.klin).toBeNull();
	});

	it('zapnutý klín s nezmyselným rozmerom zablokuje celý vstup', () => {
		const { error } = parseVstup(fd({ ...zaklad, ...klinFd, klinSirka: '0' }));
		expect(error).toMatch(/^Klín: šírka/);
	});

	it('rozmery klina bez zapínača sa ignorujú (checkbox je vypnutý)', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, ...klinFd, klin: '' }));
		expect(error).toBeNull();
		expect(vstup.klin).toBeNull();
	});
});

describe('parseMultiVstup — klín je PER POSUV', () => {
	const posuv = (extra: Record<string, unknown> = {}) => ({
		system: 'Robust',
		styl: '3K',
		s: '4645',
		v: '2320',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		...extra
	});
	const multi = (posuvy: unknown[]) =>
		parseMultiVstup(fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(posuvy) }));

	it('klín má len ten posuv, ktorý ho má zapnutý', () => {
		const { vstup, error } = multi([
			posuv({
				klin: '1',
				klinDlzka: '4645',
				klinSirka: '250',
				klinV1: '350',
				klinV2: '120',
				klinKs: '2'
			}),
			posuv()
		]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].klin).toEqual({ dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 });
		expect(vstup.posuvy[1].klin).toBeNull();
	});

	it('nezmyselný klín na 2. posuve pomenuje posuv v chybe', () => {
		const { error } = multi([
			posuv(),
			posuv({ klin: '1', klinDlzka: '4645', klinSirka: '250', klinV1: '0', klinV2: '0' })
		]);
		expect(error).toBe('Posuv 2: klín — zadaj aspoň jednu výšku.');
	});
});

describe('MONEY-NEUTRALITA — klín nesmie zmeniť odpis ani materiál', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const spec = (
		klin: { dlzka: number; sirka: number; v1: number; v2: number; ks: number } | null
	) => [
		{
			sysStyl: 'Robust|3K',
			S: 4645,
			V: 2320,
			redukciaZero: true,
			skloHrubka: 0,
			otvaranie: 'P - L',
			sklo: 'Izolačné sklo 4/16/4 číre',
			klin
		}
	];

	it('odpis aj materiál sú identické s klinom a bez neho; klín sa vráti pre náhľad', () => {
		const bez = computeMulti(cfg, spec(null))!;
		const s = computeMulti(cfg, spec({ dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 }))!;
		expect(s.odpis).toEqual(bez.odpis);
		expect(s.material).toEqual(bez.material);
		expect(s.posuvy[0].klin).toEqual({ dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 });
		expect(bez.posuvy[0].klin).toBeNull();
	});
});

describe('klinPopis — jeden riadok do plánu a histórie', () => {
	it('vypíše počet, obe kóty a obe výšky', () => {
		expect(klinPopis({ dlzka: 4645, sirka: 250, v1: 350, v2: 120, ks: 2 })).toBe(
			'2× klín 4645 × 250 mm, výška 350 → 120 mm'
		);
	});
	it('desatinné čísla píše s čiarkou (dielňa)', () => {
		expect(klinPopis({ dlzka: 4645.5, sirka: 250, v1: 350, v2: 0, ks: 1 })).toBe(
			'1× klín 4645,5 × 250 mm, výška 350 → 0 mm'
		);
	});
});
