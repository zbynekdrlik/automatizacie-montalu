// Bazén návrhový výkres (#139) — parsovanie formulára. Rovnaká disciplína ako
// pergola-navrh-vstup.test.ts / zasklenia-navrh-vstup.test.ts.
import { describe, it, expect } from 'vitest';
import { parseBazenNavrhVstup } from '../src/lib/server/bazen-navrh-vstup';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};

// vektor OP260055
const zaklad = {
	zatvorenaDlzka: '8570',
	hlbka: '4250',
	vyskaMax: '750',
	vyskaMin: '480',
	pocetSekcii: '4',
	dlzkaKolajiska: '11100',
	dverovaSekcia: '1',
	kolaj: 'jednokolaj',
	smer: 'vpravo',
	dvereSmer: 'vlavo',
	vyskaCela: '96,2', // slovenská desatinná čiarka — presne ako na vzore
	op: 'OP260055'
};

describe('parseBazenNavrhVstup', () => {
	it('platný vzorový vstup (OP260055) prejde bez chyby', () => {
		const { vstup, error } = parseBazenNavrhVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.zatvorenaDlzka).toBe(8570);
		expect(vstup.hlbka).toBe(4250);
		expect(vstup.vyskaMax).toBe(750);
		expect(vstup.vyskaMin).toBe(480);
		expect(vstup.pocetSekcii).toBe(4);
		expect(vstup.dlzkaKolajiska).toBe(11100);
		expect(vstup.vyskaCela).toBeCloseTo(96.2, 5);
	});

	it('desatinná čiarka v číselných poliach prejde (vyskaCela 96,2)', () => {
		const { vstup } = parseBazenNavrhVstup(fd(zaklad));
		expect(vstup.vyskaCela).toBeCloseTo(96.2, 5);
	});

	it('sirkaSekcieOverride s desatinnou čiarkou prejde (2183,2)', () => {
		const { vstup } = parseBazenNavrhVstup(fd({ ...zaklad, sirkaSekcieOverride: '2183,2' }));
		expect(vstup.sirkaSekcieOverride).toBeCloseTo(2183.2, 5);
	});

	it('prázdny sirkaSekcieOverride = undefined (kóta sa NEVYTLAČÍ, appka nehádže)', () => {
		const { vstup } = parseBazenNavrhVstup(fd(zaklad));
		expect(vstup.sirkaSekcieOverride).toBeUndefined();
	});

	it('kolaj: chýbajúca/neplatná hodnota = default "jednokolaj"', () => {
		const bezKolaj = { ...zaklad };
		delete (bezKolaj as Record<string, string>).kolaj;
		const { vstup } = parseBazenNavrhVstup(fd(bezKolaj));
		expect(vstup.kolaj).toBe('jednokolaj');
	});

	it('kolaj=dvojkolaj prejde', () => {
		const { vstup } = parseBazenNavrhVstup(fd({ ...zaklad, kolaj: 'dvojkolaj' }));
		expect(vstup.kolaj).toBe('dvojkolaj');
	});

	it('smer: chýbajúca/neplatná hodnota = default "vpravo"', () => {
		const bezSmer = { ...zaklad };
		delete (bezSmer as Record<string, string>).smer;
		const { vstup } = parseBazenNavrhVstup(fd(bezSmer));
		expect(vstup.smer).toBe('vpravo');
	});

	it('dvereSmer je NEZÁVISLÝ od smer (POSUV vpravo, DVERE vľavo súčasne — presne OP260055)', () => {
		const { vstup } = parseBazenNavrhVstup(fd({ ...zaklad, smer: 'vpravo', dvereSmer: 'vlavo' }));
		expect(vstup.smer).toBe('vpravo');
		expect(vstup.dvereSmer).toBe('vlavo');
	});

	it('model je voliteľný — chýbajúci prejde ako prázdny reťazec, žiadna chyba (OP260027 ho nemá)', () => {
		const { vstup, error } = parseBazenNavrhVstup(fd({ ...zaklad, model: '' }));
		expect(error).toBeNull();
		expect(vstup.model).toBe('');
	});

	it('textové polia sú orezané na max dĺžku', () => {
		const { vstup } = parseBazenNavrhVstup(
			fd({ ...zaklad, model: 'x'.repeat(200), vyplna: 'y'.repeat(100), aretacia: 'z'.repeat(100) })
		);
		expect(vstup.model.length).toBe(60);
		expect(vstup.vyplna.length).toBe(60);
		expect(vstup.aretacia.length).toBe(60);
	});

	it('neplatný vstup (zatvorená dĺžka mimo rozsahu) vráti chybu', () => {
		const { error } = parseBazenNavrhVstup(fd({ ...zaklad, zatvorenaDlzka: '100' }));
		expect(error).toMatch(/Zatvorená dĺžka/);
	});

	// #150 disciplína znovupoužitá — farebný režim + RAL ako výber
	describe('rezimVykresu/ralKod', () => {
		it('chýbajúce rezimVykresu = default "technicky"', () => {
			const { vstup } = parseBazenNavrhVstup(fd(zaklad));
			expect(vstup.rezimVykresu).toBe('technicky');
		});
		it('rezimVykresu=farebny prejde', () => {
			const { vstup } = parseBazenNavrhVstup(fd({ ...zaklad, rezimVykresu: 'farebny' }));
			expect(vstup.rezimVykresu).toBe('farebny');
		});
		it('neplatná hodnota rezimVykresu sa tichým fallbackom vráti na "technicky" (nikdy chyba)', () => {
			const { vstup, error } = parseBazenNavrhVstup(fd({ ...zaklad, rezimVykresu: 'neexistuje' }));
			expect(error).toBeNull();
			expect(vstup.rezimVykresu).toBe('technicky');
		});
		it('chýbajúce ralKod = prázdny reťazec (nie chyba — RAL ostáva voliteľný)', () => {
			const { vstup, error } = parseBazenNavrhVstup(fd(zaklad));
			expect(error).toBeNull();
			expect(vstup.ralKod).toBe('');
		});
		it('ralKod sa parsuje ako obyčajný text (validácia farby je na vypočítanej strane, nie tu)', () => {
			const { vstup } = parseBazenNavrhVstup(fd({ ...zaklad, ralKod: '9006' }));
			expect(vstup.ralKod).toBe('9006');
		});
	});

	it('#144-štýl OP je voliteľné — chýbajúce OP nie je chyba', () => {
		const { error, vstup } = parseBazenNavrhVstup(fd({ ...zaklad, op: '' }));
		expect(error).toBeNull();
		expect(vstup.op).toBe('');
	});
});
