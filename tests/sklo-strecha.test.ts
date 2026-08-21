// Mapovanie typu strešného skla pergoly → Money TS kód (#235, cesta A). PURE modul,
// žiadna DB — netreba DATABASE_PATH (auto-izolácia ho aj tak nastaví). Kódy potvrdené
// read-only lookupom proti Money (dôkaz v názve, #235 comment 5370182946); typy bez
// kódu = honest-null (NIKDY 0 €). Konzument mapovania bude #223.
import { describe, it, expect } from 'vitest';
import { SKLO_STRECHA_TYPY, skloStrechaMoneyKod } from '../src/lib/sklo-strecha';

describe('skloStrechaMoneyKod — 6 potvrdených mapovaní (dôkaz v Money názve)', () => {
	const potvrdene: [string, string][] = [
		['4.4.2 číre', 'TS00070'], // Lepené sklo 4.4.2 s čírou fóliou
		['4.4.2 mliečne', 'TS00071'], // Lepené sklo 4.4.2 s matnou fóliou
		['5.5.2 číre', 'TS00076'], // Lepené sklo 5.5.2 s čírou fóliou
		['IZO 4.4.2-8-6 číre', 'TS00014'], // Izolačné sklo 4.4.2-8- 6 číre
		['IZO 4.4.2-8-6 mliečne', 'TS00129'], // Izolačné sklo 4.4.2-8- 6 mliečne
		['4.4.2 mliečne/8/6 mliečne', 'TS00012'] // Izolačné sklo 4.4.2 mliečne/8/6 mliečne
	];
	it.each(potvrdene)('%s → %s', (nazov, kod) => {
		expect(skloStrechaMoneyKod(nazov)).toBe(kod);
	});
});

describe('skloStrechaMoneyKod — typy bez potvrdeného kódu = null (honest-null, NIKDY 0 €)', () => {
	// Money nemá pre tieto TS kód; otázka na Dominika je na #198, tu sa NErieši.
	const bezKodu = [
		'5.5.2 mliečne',
		'IZO 4.4.2-10-6',
		'IZO 5.5.2-8-6',
		'IZO 5.5.2-10-6',
		'polykarbonát 16 mm číry',
		'polykarbonát 16 mm mliečny',
		'polykarbonát 16 mm bronz',
		'STADUR 24 mm'
	];
	it.each(bezKodu)('%s → null', (nazov) => {
		expect(skloStrechaMoneyKod(nazov)).toBeNull();
	});
});

describe('skloStrechaMoneyKod — neznámy názov = null (nič sa nedopočítava)', () => {
	it('názov mimo katalógu → null', () => {
		expect(skloStrechaMoneyKod('nič také')).toBeNull();
		expect(skloStrechaMoneyKod('')).toBeNull();
	});
	it('zasklievacie sklo NIE JE strešný typ (iný katalóg) → null', () => {
		// katalóg zasklení (glass_types) je oddelený — jeho názvy sa sem nesmú „preliať"
		expect(skloStrechaMoneyKod('Izolačné sklo 4/16/4 číre')).toBeNull();
		expect(skloStrechaMoneyKod('Izolačné sklo 4/8/4 číre')).toBeNull();
	});
});

describe('SKLO_STRECHA_TYPY — katalóg strešného skla', () => {
	it('14 variantov: 6 s kódom + 8 bez kódu', () => {
		expect(SKLO_STRECHA_TYPY).toHaveLength(14);
		expect(SKLO_STRECHA_TYPY.filter((t) => t.moneyKod !== null)).toHaveLength(6);
		expect(SKLO_STRECHA_TYPY.filter((t) => t.moneyKod === null)).toHaveLength(8);
	});
	it('žiadny potvrdený kód nie je prázdny ani „0" — vždy reálny TS kód (honest-null, nie 0 €)', () => {
		for (const t of SKLO_STRECHA_TYPY) {
			if (t.moneyKod !== null) expect(t.moneyKod).toMatch(/^TS\d+$/);
		}
	});
	it('žiadne duplicitné názvy', () => {
		const mena = SKLO_STRECHA_TYPY.map((t) => t.nazov);
		expect(new Set(mena).size).toBe(mena.length);
	});
	it('funkcia je konzistentná s tabuľkou (každý riadok → jeho kód)', () => {
		for (const t of SKLO_STRECHA_TYPY) {
			expect(skloStrechaMoneyKod(t.nazov)).toBe(t.moneyKod);
		}
	});
});
