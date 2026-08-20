// Ručne zadaná dĺžka koľajnice — Patrik 2026-07-28: „pri štandardoch chce iný rozmer
// koľajnice, hornú 2690 mm a spodnú 2695 mm. Robust a slide sa to stať nemôže, max ešte
// delux." MONEY-KRITICKÉ: rez sa zmení → balenie na tyče → metre v odpise.
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	computeFlat,
	computeMulti,
	oversizeCut,
	safeCompute,
	systemyRucnaKolajnica
} from '../src/lib/server/compute';
import { parseKolajnica } from '../src/lib/server/vstup';
import { popisRucnejKolajnice, rolaKolajnice } from '../src/lib/kolajnica';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);
const kod = (r: ReturnType<typeof computeFlat>, k: string) => r!.material.find((m) => m.kod === k)!;
const metre = (r: { odpis: { kod: string; metre: number }[] }, k: string) =>
	r.odpis.find((o) => o.kod === k)?.metre;

describe('rolaKolajnice — rola profilu z jeho názvu', () => {
	it('rozlíši hornú a spodnú koľajnicu', () => {
		expect(rolaKolajnice('Koľajnica horná 4K Surový 7500 mm')).toBe('horna');
		expect(rolaKolajnice('Koľajnica spodná 2K  Surový 7500 mm')).toBe('spodna');
	});

	it('obvodová koľajnica (Robust/Slide) ani iný profil rolu nemajú', () => {
		expect(rolaKolajnice('Koľajnica 2K Surový 7500 mm')).toBeNull();
		expect(rolaKolajnice('Koľajnica 2K Slide Surový 7500 mm')).toBeNull();
		expect(rolaKolajnice('Rámový profil Surový 7500 mm')).toBeNull();
		expect(rolaKolajnice('')).toBeNull();
	});

	it('REGRESIA: „á" nie je ASCII slovný znak — regex nesmie stáť na \\b', () => {
		// pôvodná verzia mala /^Koľajnica\s+horná\b/ a NIKDY nesedela → ručná dĺžka
		// sa ticho ignorovala (odpis vyzeral správne, rez bol zlý)
		for (const n of seed.rez.map((r) => r.nazov).filter((n) => n.includes('Koľajnica horná')))
			expect(rolaKolajnice(n)).toBe('horna');
		for (const n of seed.rez.map((r) => r.nazov).filter((n) => n.includes('Koľajnica spodná')))
			expect(rolaKolajnice(n)).toBe('spodna');
	});
});

describe('systemyRucnaKolajnica — kde to má zmysel', () => {
	it('LEN systémy s oddelenou hornou + spodnou: Deluxe, Štandard +, Štandard', () => {
		expect(systemyRucnaKolajnica(cfg).sort()).toEqual(['Deluxe', 'Štandard', 'Štandard +']);
	});

	it('Robust ani Slide tam nie sú (jedna obvodová koľajnica) — Patrik', () => {
		const s = systemyRucnaKolajnica(cfg);
		expect(s).not.toContain('Robust');
		expect(s).not.toContain('Slide');
	});
});

describe('parseKolajnica — serverová validácia (skriptovaný POST obíde HTML5)', () => {
	it('prázdne polia = nezadané (žiadna chyba, žiadny override)', () => {
		expect(parseKolajnica('', '')).toEqual({ kolajnica: null, error: null });
		expect(parseKolajnica(undefined, null)).toEqual({ kolajnica: null, error: null });
		expect(parseKolajnica('0', '')).toEqual({ kolajnica: null, error: null });
	});

	it('Patrikove hodnoty prejdú', () => {
		expect(parseKolajnica('2690', '2695')).toEqual({
			kolajnica: { horna: 2690, spodna: 2695 },
			error: null
		});
	});

	it('dá sa zadať len jedna z dvoch', () => {
		expect(parseKolajnica('2690', '')).toEqual({ kolajnica: { horna: 2690 }, error: null });
		expect(parseKolajnica('', '2695')).toEqual({ kolajnica: { spodna: 2695 }, error: null });
	});

	it('desatinná čiarka aj zaokrúhlenie na mm', () => {
		expect(parseKolajnica('2690,4', '2694,6')).toEqual({
			kolajnica: { horna: 2690, spodna: 2695 },
			error: null
		});
	});

	it('preklep mimo rozsahu padne (26 mm, 26900 mm, text)', () => {
		expect(parseKolajnica('26', '').error).toMatch(/horná/);
		expect(parseKolajnica('', '26900').error).toMatch(/spodná/);
		expect(parseKolajnica('abc', '').error).toMatch(/horná/);
		expect(parseKolajnica('26', '').kolajnica).toBeNull();
	});
});

describe('computeFlat — ručná dĺžka mení REZ koľajnice a nič iné', () => {
	// Patrikov prípad: Štandard + 4K IZO, 3447 × 2097, horná 2690 / spodná 2695
	const bez = computeFlat(cfg, 'Štandard +|4K IZO', 3447, 2097, false)!;
	const s = computeFlat(cfg, 'Štandard +|4K IZO', 3447, 2097, false, 0, false, {
		horna: 2690,
		spodna: 2695
	})!;

	it('KĽÚČOVÉ: horná sa reže na 2690, spodná na 2695 (namiesto šírky 3447)', () => {
		expect(kod(bez, 'ZASP00036').rezy).toEqual([{ rozmer: 3447, ks: 1 }]);
		expect(kod(bez, 'ZASP00033').rezy).toEqual([{ rozmer: 3447, ks: 1 }]);
		expect(kod(s, 'ZASP00036').rezy).toEqual([{ rozmer: 2690, ks: 1 }]);
		expect(kod(s, 'ZASP00033').rezy).toEqual([{ rozmer: 2695, ks: 1 }]);
	});

	it('ostatné profily aj sklo sú NEDOTKNUTÉ', () => {
		const ineProfily = (r: typeof bez) =>
			r.material.filter((m) => !['ZASP00036', 'ZASP00033'].includes(m.kod));
		expect(ineProfily(s)).toEqual(ineProfily(bez));
		expect(s.sklo).toEqual(bez.sklo);
	});

	it('v tomto prípade odpis do Money ostáva 7,5 m (kratší kus, stále jedna tyč)', () => {
		expect(metre(s, 'ZASP00036')).toBe(7.5);
		expect(metre(s, 'ZASP00033')).toBe(7.5);
		expect(s.odpis).toEqual(bez.odpis);
	});

	it('bez zadania (undefined aj prázdny objekt) je výsledok IDENTICKÝ ako predtým', () => {
		expect(computeFlat(cfg, 'Štandard +|4K IZO', 3447, 2097, false, 0, false, {})).toEqual(bez);
		expect(computeFlat(cfg, 'Štandard +|4K IZO', 3447, 2097, false, 0, false, undefined)).toEqual(
			bez
		);
	});

	it('zadať sa dá aj len jedna koľajnica — druhá ostane podľa šírky', () => {
		const lenH = computeFlat(cfg, 'Štandard|2K', 3000, 2400, false, 0, false, { horna: 2690 })!;
		expect(kod(lenH, 'ZASP00107').rezy).toEqual([{ rozmer: 2690, ks: 1 }]);
		expect(kod(lenH, 'ZASP00104').rezy).toEqual([{ rozmer: 3000, ks: 1 }]);
	});
});

describe('Robust a Slide sa to stať nemôže (Patrik) — override ich neovplyvní', () => {
	for (const sysStyl of ['Robust|2K', 'Slide|3K']) {
		it(`${sysStyl}: obvodová koľajnica ostáva na rozmeroch otvoru`, () => {
			const bez = computeFlat(cfg, sysStyl, 3000, 2200, false)!;
			const s = computeFlat(cfg, sysStyl, 3000, 2200, false, 0, false, {
				horna: 2690,
				spodna: 2695
			})!;
			expect(s).toEqual(bez);
		});
	}
});

describe('Money odpis sa MENÍ, keď sa zmení počet tyčí', () => {
	const mk = (kol?: { horna?: number; spodna?: number }) => ({
		sysStyl: 'Štandard +|2K',
		S: 4000,
		V: 2000,
		redukciaZero: false,
		kolajnica: kol
	});

	it('dva posuvy 4000 mm: 2× tyč (15 m) → ručne 3600 mm sa zmestia na jednu (7,5 m)', () => {
		const bez = computeMulti(cfg, [mk(), mk()])!;
		expect(metre(bez, 'ZASP00107')).toBe(15);
		expect(metre(bez, 'ZASP00104')).toBe(15);
		const kol = { horna: 3600, spodna: 3600 };
		const s = computeMulti(cfg, [mk(kol), mk(kol)])!;
		expect(metre(s, 'ZASP00107')).toBe(7.5);
		expect(metre(s, 'ZASP00104')).toBe(7.5);
	});

	it('ručná dĺžka je PER POSUV — druhý posuv si drží svoju šírku', () => {
		const r = computeMulti(cfg, [mk({ horna: 3600, spodna: 3600 }), mk()])!;
		const h = r.material.find((m) => m.kod === 'ZASP00107')!;
		expect(h.rezy.map((x) => x.rozmer).sort((a, b) => a - b)).toEqual([3600, 4000]);
		expect(r.posuvy[0]!.kolajnica).toEqual({ horna: 3600, spodna: 3600 });
		expect(r.posuvy[1]!.kolajnica).toBeNull();
	});
});

describe('bezpečnostné zábrany', () => {
	it('kus dlhší než tyč padne aj pri ručnom zadaní (nie tichý polovičný odpis)', () => {
		expect(oversizeCut(cfg, 'Štandard +|2K', 3000, 2400, false, 0)).toBeNull();
		const err = oversizeCut(cfg, 'Štandard +|2K', 3000, 2400, false, 0, { horna: 7499 });
		expect(err).toMatch(/dlhší než tyč 7500/);
		expect(
			safeCompute(cfg, 'Štandard +|2K', 3000, 2400, false, 0, false, { horna: 7499 }).r
		).toBeNull();
	});

	it('safeCompute s platným zadaním prejde a nesie nový rez', () => {
		const { r, err } = safeCompute(cfg, 'Štandard +|2K', 3000, 2400, false, 0, false, {
			horna: 2690,
			spodna: 2695
		});
		expect(err).toBeNull();
		expect(kod(r, 'ZASP00107').rezy).toEqual([{ rozmer: 2690, ks: 1 }]);
	});

	it('„prídavná koľajnica" (iný kód spodnej) sa s ručnou dĺžkou nebije', () => {
		const r = computeFlat(cfg, 'Štandard +|2K', 3000, 2400, false, 0, true, { spodna: 2695 })!;
		// prídavná = spodná o veľkosť väčšia (ZASP00104 → ZASP00030), dĺžka ručná
		expect(kod(r, 'ZASP00030').rezy).toEqual([{ rozmer: 2695, ks: 1 }]);
		expect(r.material.find((m) => m.kod === 'ZASP00104')).toBeUndefined();
	});
});

describe('popisRucnejKolajnice — čo uvidí dielňa na pláne', () => {
	it('vypíše len zadané hodnoty', () => {
		expect(popisRucnejKolajnice({ horna: 2690, spodna: 2695 })).toBe(
			'koľajnica ručne: horná 2690 mm · spodná 2695 mm'
		);
		expect(popisRucnejKolajnice({ spodna: 2695 })).toBe('koľajnica ručne: spodná 2695 mm');
		expect(popisRucnejKolajnice(null)).toBe('');
		expect(popisRucnejKolajnice({})).toBe('');
	});
});
