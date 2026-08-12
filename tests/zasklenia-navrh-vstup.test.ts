// Zasklenia návrhový výkres (#162) — parsovanie formulára. Rovnaká disciplína ako
// tests/pergola-navrh-vstup.test.ts.
import { describe, it, expect } from 'vitest';
import { parseZaskleniaNavrhVstup, type SysStylRow } from '../src/lib/server/zasklenia-navrh-vstup';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};

const styly: SysStylRow[] = [
	{ sysStyl: 'Robust|2K', system: 'Robust', styl: '2K', N: 2 },
	{ sysStyl: 'Robust|3K', system: 'Robust', styl: '3K', N: 3 }
];

const zaklad = {
	system: 'Robust',
	styl: '2K',
	s: '3000',
	v: '2000',
	otvaranie: 'P - L'
};

describe('parseZaskleniaNavrhVstup', () => {
	it('platný vzorový vstup prejde bez chyby, n sa ZNOVUPOUŽIJE z listSysStyly (2)', () => {
		const { vstup, error } = parseZaskleniaNavrhVstup(fd(zaklad), styly);
		expect(error).toBeNull();
		expect(vstup.n).toBe(2);
		expect(vstup.sysStyl).toBe('Robust|2K');
		expect(vstup.s).toBe(3000);
		expect(vstup.v).toBe(2000);
	});

	it('iný štýl v tom istom systéme dá iné n (3)', () => {
		const { vstup, error } = parseZaskleniaNavrhVstup(fd({ ...zaklad, styl: '3K' }), styly);
		expect(error).toBeNull();
		expect(vstup.n).toBe(3);
	});

	it('neplatná kombinácia systém+štýl je chyba, n=0', () => {
		const { vstup, error } = parseZaskleniaNavrhVstup(fd({ ...zaklad, styl: 'neexistuje' }), styly);
		expect(error).toMatch(/platnú kombináciu/i);
		expect(vstup.n).toBe(0);
	});

	it('desatinná čiarka v šírke/výške prejde', () => {
		const { vstup } = parseZaskleniaNavrhVstup(fd({ ...zaklad, s: '3000,5', v: '2000,5' }), styly);
		expect(vstup.s).toBe(3000.5);
		expect(vstup.v).toBe(2000.5);
	});

	it('bez klinu — klinZapnuty chýba/nie je "1" -> klin je null', () => {
		const { vstup } = parseZaskleniaNavrhVstup(fd(zaklad), styly);
		expect(vstup.klin).toBeNull();
	});

	it('klín zapnutý s platnými rozmermi', () => {
		const { vstup, error } = parseZaskleniaNavrhVstup(
			fd({
				...zaklad,
				klinZapnuty: '1',
				klinDlzka: '1000',
				klinSirka: '500',
				klinV1: '100',
				klinV2: '50',
				klinKs: '2'
			}),
			styly
		);
		expect(error).toBeNull();
		expect(vstup.klin).toEqual({ dlzka: 1000, sirka: 500, v1: 100, v2: 50, ks: 2 });
	});

	// #162 review nález: predtým sa polovične/vôbec nevyplnený, ale ZAPNUTÝ klín
	// tichým Math.min/max-clampom stal "platným" 1mm rozmerom bez chyby — teraz
	// (rovnaká disciplína ako $lib/server/vstup.ts) je to REÁLNA chyba, klin sa
	// NEODMLČÍ na null.
	it('klín zapnutý ale bez rozmerov (dlzka aj sirka <= 0) -> chyba, nie tichý null', () => {
		const { vstup, error } = parseZaskleniaNavrhVstup(fd({ ...zaklad, klinZapnuty: '1' }), styly);
		expect(vstup.klin).toEqual({ dlzka: 0, sirka: 0, v1: 0, v2: 0, ks: 1 });
		expect(error).toMatch(/klín.*dĺžka/i);
	});

	it('klín zapnutý s dĺžkou ale bez šírky -> chyba (nie tichý clamp na 1mm)', () => {
		const { error } = parseZaskleniaNavrhVstup(
			fd({ ...zaklad, klinZapnuty: '1', klinDlzka: '1000' }),
			styly
		);
		expect(error).toMatch(/klín.*šírka/i);
	});

	it('klín zapnutý s platnou dĺžkou/šírkou ale v1=v2=0 -> chyba (neviditeľný plochý klin)', () => {
		const { error } = parseZaskleniaNavrhVstup(
			fd({ ...zaklad, klinZapnuty: '1', klinDlzka: '1000', klinSirka: '500' }),
			styly
		);
		expect(error).toMatch(/klín.*výšku/i);
	});

	it('bez ručnej koľajnice -> kolajnica je null', () => {
		const { vstup } = parseZaskleniaNavrhVstup(fd(zaklad), styly);
		expect(vstup.kolajnica).toBeNull();
	});

	it('ručná koľajnica — len horná zadaná', () => {
		const { vstup } = parseZaskleniaNavrhVstup(fd({ ...zaklad, kolajnicaHorna: '2690' }), styly);
		expect(vstup.kolajnica).toEqual({ horna: 2690, spodna: undefined });
	});

	it('ručná koľajnica mimo rozsahu (26 namiesto 2690, preklep) sa ignoruje', () => {
		const { vstup } = parseZaskleniaNavrhVstup(fd({ ...zaklad, kolajnicaHorna: '26' }), styly);
		expect(vstup.kolajnica).toBeNull();
	});

	it('rezimVykresu default = technicky, "farebny" sa prevezme', () => {
		const { vstup: v1 } = parseZaskleniaNavrhVstup(fd(zaklad), styly);
		expect(v1.rezimVykresu).toBe('technicky');
		const { vstup: v2 } = parseZaskleniaNavrhVstup(
			fd({ ...zaklad, rezimVykresu: 'farebny' }),
			styly
		);
		expect(v2.rezimVykresu).toBe('farebny');
	});

	it('nazov/ral/ralKod sa parsujú ako text', () => {
		const { vstup } = parseZaskleniaNavrhVstup(
			fd({ ...zaklad, nazov: 'Ponuka pre ZAK202699', ral: '7016 ANTRACIT', ralKod: '7016' }),
			styly
		);
		expect(vstup.nazov).toBe('Ponuka pre ZAK202699');
		expect(vstup.ral).toBe('7016 ANTRACIT');
		expect(vstup.ralKod).toBe('7016');
	});
});
