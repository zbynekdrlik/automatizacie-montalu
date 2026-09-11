// Čisté helpery pre RAL/krytka voľbu v zasklenia formulári (#431 kolo 2). Reaktivita
// (Svelte $effect poradie, „Použiť znova") sa overuje E2E; tu len čistá logika:
// z ktorých farieb sa skladá select pre danú množinu posuvov × hrúbok, a ako sa
// z (systém, sklo) odvodí fyzická hrúbka pre filtrovanie krytka-farieb.
import { describe, it, expect } from 'vitest';
import { ralOptionsPre, hrubkaPreSklo, type RalPar } from '../src/lib/zasklenia-form';
import { SKLO_INE } from '../src/lib/sklo';

const SKLA = [
	{ nazov: 'Float kalené 10 mm', system: 'Deluxe', hrubka: 10 },
	{ nazov: 'Float kalené 6 mm', system: 'Deluxe', hrubka: 6 },
	{ nazov: 'Izolačné sklo 4/16/4 číre', system: 'Robust', hrubka: 24 }
];

// per-systém RAL páry, ako ich posiela server (config-derived z komponentyPre):
// Deluxe krytky sú hrúbko-špecifické, Robust kovanie hrúbko-neutrálne.
const RAL: Record<string, RalPar[]> = {
	Deluxe: [
		{ farba: 'R9006', hrubkaSkla: 10 },
		{ farba: 'R7016', hrubkaSkla: 10 },
		{ farba: 'R9006', hrubkaSkla: 6 },
		{ farba: 'R9005', hrubkaSkla: 6 }
	],
	Robust: [{ farba: 'R9005' }, { farba: 'R7016' }]
};

describe('hrubkaPreSklo — fyzická hrúbka zvoleného skla (#431 kolo 2)', () => {
	it('katalógové Deluxe sklo: z data.skla.hrubka', () => {
		expect(hrubkaPreSklo('Deluxe', 'Float kalené 10 mm', '', SKLA)).toBe(10);
		expect(hrubkaPreSklo('Deluxe', 'Float kalené 6 mm', '', SKLA)).toBe(6);
	});

	it('vlastná skladba (SKLO_INE): z triedy cez ineHrubka (trieda 10 → 10, inak 6)', () => {
		expect(hrubkaPreSklo('Deluxe', SKLO_INE, 10, SKLA)).toBe(10);
		expect(hrubkaPreSklo('Deluxe', SKLO_INE, 6, SKLA)).toBe(6);
		expect(hrubkaPreSklo('Deluxe', SKLO_INE, 16, SKLA)).toBe(6);
	});

	it('neznáme/nezvolené sklo → null (žiadny hrúbkový filter)', () => {
		expect(hrubkaPreSklo('Deluxe', '', '', SKLA)).toBeNull();
		expect(hrubkaPreSklo('Deluxe', 'Neexistuje', '', SKLA)).toBeNull();
		expect(hrubkaPreSklo('Deluxe', SKLO_INE, '', SKLA)).toBeNull();
	});
});

describe('ralOptionsPre — možnosti RAL selectu podľa hrúbky (#431 kolo 2)', () => {
	it('Deluxe 6mm → R9006/R9005 (nie R7016)', () => {
		expect(ralOptionsPre([{ system: 'Deluxe', hrubka: 6 }], RAL)).toEqual(['R9006', 'R9005']);
	});

	it('Deluxe 10mm → R9006/R7016 (nie R9005)', () => {
		expect(ralOptionsPre([{ system: 'Deluxe', hrubka: 10 }], RAL)).toEqual(['R9006', 'R7016']);
	});

	it('Deluxe s neznámou hrúbkou → všetky (UX fallback; server je autoritatívny)', () => {
		expect(ralOptionsPre([{ system: 'Deluxe', hrubka: null }], RAL).sort()).toEqual(
			['R7016', 'R9005', 'R9006'].sort()
		);
	});

	it('hrúbko-neutrálny systém (Robust) → farby nezávisle od hrúbky', () => {
		expect(ralOptionsPre([{ system: 'Robust', hrubka: null }], RAL)).toEqual(['R9005', 'R7016']);
	});

	it('zmiešaná zimná záhrada 6mm + 10mm Deluxe → únia R9006/R9005/R7016 (default R9006 sedí obom)', () => {
		const out = ralOptionsPre(
			[
				{ system: 'Deluxe', hrubka: 6 },
				{ system: 'Deluxe', hrubka: 10 }
			],
			RAL
		);
		expect(out).toContain('R9006');
		expect(out).toContain('R9005');
		expect(out).toContain('R7016');
	});

	it('zmiešaná Robust + 10mm Deluxe → únia bez duplicít', () => {
		const out = ralOptionsPre(
			[
				{ system: 'Robust', hrubka: null },
				{ system: 'Deluxe', hrubka: 10 }
			],
			RAL
		);
		expect(out.sort()).toEqual(['R7016', 'R9005', 'R9006'].sort());
		expect(new Set(out).size).toBe(out.length); // žiadne duplicity
	});
});
