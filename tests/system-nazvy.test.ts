// Zobrazované názvy systémov (Patrik 2026-07-31: „štandard plus", „starý štandard").
//
// Toto je DISPLAY-ONLY vrstva. Testy tu strážia dve veci naraz:
//   1. že sa človeku ukáže nový názov,
//   2. že sa KĽÚČ konfigurácie (`Štandard +|4K IZO`) nikde neprepisuje — na ňom visia
//      nárezáky, b2b limity aj história odpisov, takže jeho zmena by bola Money-chyba.
import { describe, it, expect } from 'vitest';
import { nazovSystemu, nazovSysStyl } from '../src/lib/system-nazvy';
import cfg from '../src/lib/server/cfg_seed.json';

describe('nazovSystemu — čo vidí obsluha', () => {
	it('„Štandard +" sa zobrazuje ako „Štandard plus"', () => {
		expect(nazovSystemu('Štandard +')).toBe('Štandard plus');
	});

	it('starší „Štandard" sa zobrazuje ako „Starý štandard"', () => {
		expect(nazovSystemu('Štandard')).toBe('Starý štandard');
	});

	it('ostatné systémy sa nemenia', () => {
		for (const s of ['Robust', 'Slide', 'Deluxe']) expect(nazovSystemu(s)).toBe(s);
	});

	it('neznámy systém prejde nezmenený (nespadne ani nevráti prázdno)', () => {
		expect(nazovSystemu('Nový systém')).toBe('Nový systém');
		expect(nazovSystemu('')).toBe('');
	});
});

describe('nazovSysStyl — celý kľúč na výpis', () => {
	it('rozdelí kľúč a premenuje len systém', () => {
		expect(nazovSysStyl('Štandard +|4K IZO')).toBe('Štandard plus 4K IZO');
		expect(nazovSysStyl('Štandard|2x3K')).toBe('Starý štandard 2x3K');
		expect(nazovSysStyl('Robust|3K')).toBe('Robust 3K');
	});

	it('reťazec bez „|" je samotný systém', () => {
		expect(nazovSysStyl('Štandard +')).toBe('Štandard plus');
	});
});

describe('MONEY-KRITICKÉ: kľúče konfigurácie sa touto zmenou NESMÚ pohnúť', () => {
	const sysStyly = (cfg as { sys: { sysStyl: string }[] }).sys.map((r) => r.sysStyl);

	it('cfg stále obsahuje pôvodné kľúče „Štandard +|…" a „Štandard|…"', () => {
		expect(sysStyly).toContain('Štandard +|4K IZO');
		expect(sysStyly).toContain('Štandard|2x3K IZO');
	});

	it('v cfg sa neobjavil žiadny kľúč s novým zobrazovaným názvom', () => {
		expect(sysStyly.some((s) => s.startsWith('Štandard plus'))).toBe(false);
		expect(sysStyly.some((s) => s.startsWith('Starý štandard'))).toBe(false);
	});

	it('premenovanie je jednosmerné — funkcia kľúč needituje, len ho číta', () => {
		const pred = [...sysStyly];
		sysStyly.forEach((s) => nazovSysStyl(s));
		expect(sysStyly).toEqual(pred);
	});
});
