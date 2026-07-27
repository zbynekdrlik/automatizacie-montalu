// Audit #32: `cnt()` v parseBazenVstup zaokrúhľuje POČTY na celé čísla. Zlomok
// sekcie (2,5) by v BOM vzorcoch vyrobil zlomkové/záporné množstvá, ktoré by
// prešli do Money. Test drží zaokrúhlenie + clamp na 0..max.
import { describe, it, expect } from 'vitest';
import { parseBazenVstup } from '../src/lib/server/vstup';

function fd(extra: Record<string, string>) {
	const f = new FormData();
	// povinné polia, aby validácia nespadla skôr než na počtoch
	f.append('zak', 'ZAK1');
	f.append('op', 'OP1');
	f.append('zakaznik', 'X');
	f.append('dlzkaKolajnic', '5000');
	for (const [k, v] of Object.entries(extra)) f.set(k, v);
	return f;
}

describe('parseBazenVstup — cnt() celé počty (audit #32)', () => {
	it('zlomkový počet sa zaokrúhli (2,5 → 3; 2,4 → 2) — nikdy nejde zlomok do BOM', () => {
		expect(parseBazenVstup(fd({ pocetSekcii: '2.5' })).vstup.pocetSekcii).toBe(3);
		expect(parseBazenVstup(fd({ pocetSekcii: '2.4' })).vstup.pocetSekcii).toBe(2);
	});

	it('desatinná čiarka funguje rovnako ako bodka (2,5 → 3)', () => {
		expect(parseBazenVstup(fd({ pocetSekcii: '2,5' })).vstup.pocetSekcii).toBe(3);
	});

	it('záporný počet → 0, nezmysel („abc") → 0', () => {
		expect(parseBazenVstup(fd({ pocetPriecok: '-3' })).vstup.pocetPriecok).toBe(0);
		expect(parseBazenVstup(fd({ pocetPriecok: 'abc' })).vstup.pocetPriecok).toBe(0);
	});

	it('počet nad strop sa capne na 100 (preklep 1000 nezaplaví Money)', () => {
		expect(parseBazenVstup(fd({ vs4500: '1000' })).vstup.vs4500).toBe(100);
	});

	it('zaokrúhlenie platí pre VŠETKY počtové polia, nie len pocetSekcii', () => {
		const v = parseBazenVstup(
			fd({
				vs4500: '1.5',
				vs6000: '1.4',
				ss4500: '2.5',
				ss6000: '0.6',
				ms4500: '3.5',
				ms6000: '4.49',
				prieckovy4300: '1.5',
				prieckovy6000: '2.5',
				vyklopneCelo: '0.5'
			})
		).vstup;
		expect([
			v.vs4500,
			v.vs6000,
			v.ss4500,
			v.ss6000,
			v.ms4500,
			v.ms6000,
			v.prieckovy4300,
			v.prieckovy6000,
			v.vyklopneCelo
		]).toEqual([2, 1, 3, 1, 4, 4, 2, 3, 1]);
	});

	it('dĺžka koľajníc NIE je počet — zlomok zostáva (5000,5 mm je legitímny rozmer)', () => {
		expect(parseBazenVstup(fd({ dlzkaKolajnic: '5000.5' })).vstup.dlzkaKolajnic).toBe(5000.5);
	});
});
