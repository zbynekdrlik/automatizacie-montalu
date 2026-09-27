// #573 (meeting výroba 25.9., ROZHODNUTÉ 27.9.): nárezák smie per systém ponúknuť LEN sklá,
// ktoré systém reálne používa — JEDEN zdroj pravdy `POVOLENE_SKLA` (`$lib/sklo-povolene`):
//   Deluxe        6 mm a 10 mm, predvolené 10 mm
//   Robust        LEN skladby 24 mm (4/16/4 číre, mliečne) — žiadne 3.3.1/3.3.2/4/6 mm
//   Štandard plus IZO 16 (izolačné), 6 mm, 3.3.1 — NIE Float 4 mm (ani pri 3K), NIE 10 mm
//   starý Štandard 6 mm, 3.3.1 — BEZ ZMENY (celý zdieľaný katalóg ako doteraz)
// Katalóg `glass_types` sa NEMENÍ (Money-neutrálne, staré odpisy sa dajú prepočítať — #570);
// allow-list filtruje len PONUKU a NOVÝ vstup z formulára (parseVstup/parseMultiVstup/znova).
import { describe, it, expect } from 'vitest';
import { glassTypesForSystem, loadCfg } from '../src/lib/server/db';
import { parseVstup, parseMultiVstup } from '../src/lib/server/vstup';
import { skloPre } from '../src/lib/server/zasklenia-sklo';
import { sklaDoPonuky } from '../src/lib/styl';
import { defaultSklo, SKLO_INE, SKLO_TRIEDY } from '../src/lib/sklo';
import { filtrujPovoleneSkla, skloPovolene, povoleneTriedyIne } from '../src/lib/sklo-povolene';

const cfg = loadCfg();
const existuje = (s: string) => !!cfg[s];

/** ponuka „Sklo (základ)" pre systém+štýl — rovnaký reťazec ako klient `sklaForSystem`
 *  (katalóg systému → allow-list #573 → IZO gate štýlu), bez sentinelu SKLO_INE. */
function ponuka(system: string, styl: string): string[] {
	const katalog = glassTypesForSystem(system).map((g) => g.nazov);
	return sklaDoPonuky(system, styl, filtrujPovoleneSkla(system, katalog), existuje);
}

describe('#573 ponuka skla per systém = tabuľka ROZHODNUTÉ', () => {
	it('Deluxe: 6 mm a 10 mm, predvolené 10 mm', () => {
		const p = ponuka('Deluxe', '3K');
		expect(p).toEqual(['Float kalené 6 mm', 'Float kalené 10 mm']);
		expect(defaultSklo(p, 'Deluxe')).toBe('Float kalené 10 mm');
	});

	it('Robust: LEN skladby 24 mm (4/16/4 číre, mliečne) — žiadne 3.3.1/3.3.2/4/6/10 mm ani 4/8/4', () => {
		const p = ponuka('Robust', '3K');
		expect([...p].sort()).toEqual(
			['Izolačné sklo 4/16/4 mliečne', 'Izolačné sklo 4/16/4 číre'].sort()
		);
		for (const g of p) expect(g).toMatch(/4\/16\/4/);
		expect(defaultSklo(p, 'Robust')).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('Štandard plus 3K: bez Float 4 mm a bez 10 mm; IZO 16, 6 mm a 3.3.1 áno', () => {
		const p = ponuka('Štandard +', '3K');
		expect(p).not.toContain('Float sklo 4 mm');
		expect(p.filter((g) => /\b4 mm\b/.test(g))).toEqual([]);
		expect(p.filter((g) => /10 mm/.test(g))).toEqual([]);
		expect(p).toContain('Float sklo 6 mm');
		expect(p).toContain('3.3.1');
		expect(p).toContain('Izolačné sklo 4/16/4 číre');
		expect(p.filter((g) => /3\.3\.2/.test(g))).toEqual([]);
		// predvolené už NIE je Float 4 mm (scr_017) — prvé neizolačné povolené = 6 mm
		expect(defaultSklo(p, 'Štandard +')).toBe('Float sklo 6 mm');
	});

	it('Štandard plus: každá povolená voľba je z katalógu (allow-list nevymýšľa sklá)', () => {
		const katalog = glassTypesForSystem('Štandard +').map((g) => g.nazov);
		for (const g of filtrujPovoleneSkla('Štandard +', katalog)) expect(katalog).toContain(g);
	});

	it('starý Štandard: 6 mm a 3.3.1 v ponuke, inak BEZ ZMENY (celý zdieľaný katalóg)', () => {
		const katalog = glassTypesForSystem('Štandard').map((g) => g.nazov);
		expect(filtrujPovoleneSkla('Štandard', katalog)).toEqual(katalog);
		const p = ponuka('Štandard', '3K');
		expect(p).toContain('Float sklo 6 mm');
		expect(p).toContain('3.3.1');
	});

	it('Slide (mimo tabuľky) — ponuka nezmenená', () => {
		const katalog = glassTypesForSystem('Slide').map((g) => g.nazov);
		expect(filtrujPovoleneSkla('Slide', katalog)).toEqual(katalog);
	});

	it('vlastná skladba: hrúbkové triedy per systém (Robust 24, Deluxe 6/10, Štandard plus bez 4/10)', () => {
		expect(povoleneTriedyIne('Robust')).toEqual([24]);
		expect(povoleneTriedyIne('Deluxe')).toEqual([6, 10]);
		expect(povoleneTriedyIne('Štandard +')).toEqual([6, 16, 24]);
		expect(povoleneTriedyIne('Slide')).toEqual([...SKLO_TRIEDY]);
		expect(povoleneTriedyIne('Štandard')).toEqual([...SKLO_TRIEDY]);
		expect(skloPovolene('Robust', SKLO_INE, 6)).toBe(false);
		expect(skloPovolene('Robust', SKLO_INE, 24)).toBe(true);
	});
});

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
const CHYBA_SKLA = 'Vyber typ skla platný pre zvolený systém a štýl.';

describe('#573 serverová validácia — sklo mimo allow-listu systému sa odmietne', () => {
	it('Robust 4/16/4 číre prejde', () => {
		expect(parseVstup(fd(zaklad)).error).toBeNull();
	});

	it('Robust 3.3.1 / Float 6 mm / 4/8/4 → rovnaká chyba ako neplatné sklo', () => {
		for (const sklo of ['3.3.1', 'Float sklo 6 mm', 'Izolačné sklo 4/8/4 číre'])
			expect(parseVstup(fd({ ...zaklad, sklo })).error).toBe(CHYBA_SKLA);
	});

	it('Štandard plus Float 4 mm / ESG 10 mm → chyba; Float 6 mm prejde', () => {
		const sp = { ...zaklad, system: 'Štandard +', styl: '3K' };
		expect(parseVstup(fd({ ...sp, sklo: 'Float sklo 4 mm' })).error).toBe(CHYBA_SKLA);
		expect(parseVstup(fd({ ...sp, sklo: 'ESG kalené 10 mm' })).error).toBe(CHYBA_SKLA);
		expect(parseVstup(fd({ ...sp, sklo: 'Float sklo 6 mm' })).error).toBeNull();
	});

	it('starý Štandard Float 4 mm prejde (bez zmeny)', () => {
		expect(
			parseVstup(fd({ ...zaklad, system: 'Štandard', styl: '3K', sklo: 'Float sklo 4 mm' })).error
		).toBeNull();
	});

	it('vlastná skladba na Robuste: trieda 6 → chyba, trieda 24 prejde', () => {
		const ine = { ...zaklad, sklo: SKLO_INE, skloPresne: '5esg/14/5esg' };
		expect(parseVstup(fd({ ...ine, skloTrieda: '6' })).error).toBe(CHYBA_SKLA);
		expect(parseVstup(fd({ ...ine, skloTrieda: '24' })).error).toBeNull();
	});

	it('viac posuvov: Robust 3.3.1 v 2. posuve → chyba s číslom zasklenia', () => {
		const posuv = {
			system: 'Robust',
			styl: '3K',
			s: 3000,
			v: 2400,
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'P - L'
		};
		const ok = parseMultiVstup(
			fd({ zak: 'Z', op: 'O', zakaznik: 'X', posuvy: JSON.stringify([posuv, posuv]) })
		);
		expect(ok.error).toBeNull();
		const zle = parseMultiVstup(
			fd({
				zak: 'Z',
				op: 'O',
				zakaznik: 'X',
				posuvy: JSON.stringify([posuv, { ...posuv, sklo: '3.3.1' }])
			})
		);
		expect(zle.error).toBe('Zasklenie 2: vyber typ skla platný pre zvolený systém a štýl.');
	});

	it('REKOMPUTA starého odpisu (Robust 3.3.1) ostáva možná — skloPre allow-list NEaplikuje (#570)', () => {
		expect(skloPre(cfg, 'Robust', '3K', '3.3.1')?.nazov).toBe('3.3.1');
	});
});
