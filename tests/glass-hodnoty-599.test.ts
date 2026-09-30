// review #599: `hodnotyOdooTypov` = JEDINÉ pravidlo finálnej `value` Odoo typu skla — používa ho
// picker (`odoo-glass-types.ts`) aj mapa cien `price_m2` (`odoo-prices.ts`), aby sa cena vždy
// priradila k tomu istému kľúču, aký má typ v pickeri (kópia pravidla sa rozišla na hranách).
import { describe, it, expect } from 'vitest';
import { hodnotyOdooTypov } from '../src/lib/server/glass-match';

const t = (value: string, name: string) => ({ value, name });

describe('hodnotyOdooTypov', () => {
	it('unikátny kód ostáva value', () => {
		const { items, dupes } = hodnotyOdooTypov([t('IZ-1', 'Izo A'), t('IZ-2', 'Izo A')]);
		expect(items.map((i) => i.value)).toEqual(['IZ-1', 'IZ-2']);
		expect(dupes.size).toBe(0);
	});

	it('kód zdieľaný viacerými typmi → value = name pre všetkých nositeľov', () => {
		const { items, dupes } = hodnotyOdooTypov([t('001', 'Izo 4/8/4'), t('001', 'IZOS 4-16-4')]);
		expect(items.map((i) => i.value)).toEqual(['Izo 4/8/4', 'IZOS 4-16-4']);
		expect([...dupes]).toEqual(['001']);
	});

	it('kód typu A = názov typu B bez kódu → A dostane svoj názov, B ostane pod názvom', () => {
		const { items } = hodnotyOdooTypov([t('X', 'Typ A'), t('X', 'X')]);
		expect(items.map((i) => i.value)).toEqual(['Typ A', 'X']);
	});

	it('kolízia aj po náhrade názvom → druhý riadok sa zahodí (prvý vyhráva)', () => {
		const { items } = hodnotyOdooTypov([t('D', 'Rovnaké'), t('D', 'Rovnaké')]);
		expect(items).toHaveLength(1);
		expect(items[0]!.value).toBe('Rovnaké');
	});
});
