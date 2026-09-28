// #576 (Marek D., Odoo úloha 1180): výber „Typ skla" na podklade objednávky skla = plochý zoznam
// ~99 Odoo typov (`montalu.glass.type`) — neprehľadné. `zoskupTypySkla` zoskupí typy do `<optgroup>`
// podľa Odoo `category` v PEVNOM poradí so slovenskými názvami, kandidátov matchera #556 navrch
// („Odporúčané") a „iné sklo" na koniec. Hodnoty (`value`) sa NEMENIA → uložené riadky aj Odoo
// payload ostávajú bit-identické. Money-NEUTRÁLNE (len zobrazenie pickera).
import { describe, it, expect } from 'vitest';
import {
	zoskupTypySkla,
	neznameKategorie,
	PORADIE_SKUPIN,
	SENTINEL_INE_SKLO,
	type TypSklaVolba
} from '../src/lib/objednavka-skla-typy';

const t = (
	value: string,
	label: string,
	category: string
): TypSklaVolba & { category: string } => ({
	value,
	label,
	category
});

// Syntetické typy (NIE PROD literály) — po jednom-dvoch v každej Odoo kategórii + neznáma + prázdna.
const TYPY = [
	t('V2', 'VSG Zeta', 'vsg'),
	t('V1', 'VSG Alfa', 'vsg'),
	t('E1', 'ESG Číre', 'esg'),
	t('R1', 'Float Šedé', 'rezane'),
	t('R2', 'Float Biele', 'rezane'),
	t('I1', 'IZO Dvojsklo', 'izolacne'),
	t('X1', 'Zrkadlo', 'zrkadla'),
	t('L1', 'Lokálne sklo', '')
];

describe('zoskupTypySkla (#576)', () => {
	it('bez kandidátov: skupiny v pevnom poradí IZOS → ESG → VSG → Rezané → Ostatné → iné sklo', () => {
		const g = zoskupTypySkla(TYPY, []);
		expect(g.map((x) => x.label)).toEqual([
			'Izolačné (IZOS)',
			'Kalené ESG',
			'Lepené VSG',
			'Rezané / float',
			'Ostatné',
			'Iné sklo'
		]);
	});

	it('kandidáti matchera sú navrchu v skupine „Odporúčané" a v kategóriách sa neopakujú', () => {
		const g = zoskupTypySkla(TYPY, [
			{ value: 'V1', label: 'VSG Alfa' },
			{ value: 'E1', label: 'ESG Číre' }
		]);
		expect(g[0]).toEqual({
			label: 'Odporúčané',
			items: [
				{ value: 'V1', label: 'VSG Alfa' },
				{ value: 'E1', label: 'ESG Číre' }
			]
		});
		const vsetkyHodnoty = g.flatMap((x) => x.items.map((i) => i.value));
		expect(vsetkyHodnoty.filter((v) => v === 'V1')).toHaveLength(1);
		expect(vsetkyHodnoty.filter((v) => v === 'E1')).toHaveLength(1);
		// ESG skupina ostala prázdna → vynechá sa (žiadna prázdna `<optgroup>`)
		expect(g.map((x) => x.label)).not.toContain('Kalené ESG');
	});

	it('v skupine zoradené podľa názvu (slovenské triedenie), hodnoty nezmenené', () => {
		const g = zoskupTypySkla(TYPY, []);
		const vsg = g.find((x) => x.label === 'Lepené VSG');
		expect(vsg?.items).toEqual([
			{ value: 'V1', label: 'VSG Alfa' },
			{ value: 'V2', label: 'VSG Zeta' }
		]);
		const rez = g.find((x) => x.label === 'Rezané / float');
		expect(rez?.items.map((i) => i.value)).toEqual(['R2', 'R1']);
	});

	it('neznáma aj prázdna kategória (lokálny fallback) → „Ostatné"', () => {
		const g = zoskupTypySkla(TYPY, []);
		expect(g.find((x) => x.label === 'Ostatné')?.items.map((i) => i.value)).toEqual(['L1', 'X1']);
	});

	it('„iné sklo" je VŽDY posledné, so sentinelom (aj pri prázdnom katalógu)', () => {
		const posledna = (g: ReturnType<typeof zoskupTypySkla>) => g[g.length - 1];
		for (const g of [zoskupTypySkla(TYPY, []), zoskupTypySkla([], [])]) {
			expect(posledna(g)).toEqual({
				label: 'Iné sklo',
				items: [{ value: SENTINEL_INE_SKLO, label: 'iné sklo (vlastný typ + cena/m²)' }]
			});
		}
		expect(zoskupTypySkla([], [])).toHaveLength(1);
	});

	it('každý katalógový typ je v pickeri práve raz (nič sa nestratí)', () => {
		const g = zoskupTypySkla(TYPY, [{ value: 'I1', label: 'IZO Dvojsklo' }]);
		const hodnoty = g
			.flatMap((x) => x.items.map((i) => i.value))
			.filter((v) => v !== SENTINEL_INE_SKLO);
		expect([...hodnoty].sort()).toEqual(TYPY.map((x) => x.value).sort());
	});

	it('kandidát, ktorý nie je v katalógu, sa aj tak ponúkne v „Odporúčané"', () => {
		const g = zoskupTypySkla([], [{ value: 'Z9', label: 'Kandidát mimo' }]);
		expect(g[0]).toEqual({ label: 'Odporúčané', items: [{ value: 'Z9', label: 'Kandidát mimo' }] });
	});
});

describe('neznameKategorie + PORADIE_SKUPIN (#576 review)', () => {
	it('vráti len NEPRÁZDNE neznáme kategórie (normalizované, bez duplicít, zoradené)', () => {
		expect(
			neznameKategorie([
				{ category: 'vsg' },
				{ category: ' IZOLACNE ' },
				{ category: '' },
				{ category: 'zrkadla' },
				{ category: 'Zrkadla' },
				{ category: 'ornament' }
			])
		).toEqual(['ornament', 'zrkadla']);
		expect(neznameKategorie(TYPY)).toEqual(['zrkadla']);
	});

	it('kategória s veľkými písmenami/medzerami sa zaradí do správnej skupiny', () => {
		const g = zoskupTypySkla([t('Q1', 'Kalené Q', ' ESG ')], []);
		expect(g.map((x) => x.label)).toEqual(['Kalené ESG', 'Iné sklo']);
	});

	it('PORADIE_SKUPIN = poradie, v akom ich zoskupTypySkla vracia', () => {
		expect(PORADIE_SKUPIN).toEqual([
			'Odporúčané',
			'Izolačné (IZOS)',
			'Kalené ESG',
			'Lepené VSG',
			'Rezané / float',
			'Ostatné',
			'Iné sklo'
		]);
		const g = zoskupTypySkla(TYPY, [{ value: 'V1', label: 'VSG Alfa' }]);
		const idx = g.map((x) => PORADIE_SKUPIN.indexOf(x.label));
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx).not.toContain(-1);
	});
});
