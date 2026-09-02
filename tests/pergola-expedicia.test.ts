// Pergola — expedičný zoznam (#419). Čistý transform už vypočítaných dát nárezu
// (`spocitajNarez().vypocitane` = hotové profily s reálnymi počtami; `komponentyPergoly`
// = kusové komponenty s honest-null počtami) na výdajovo-orientovaný pohľad. Testuje sa
// KONTRAKT transformu (honest-null propagácia, pozičné číslo, súčet len známych počtov,
// poradie) + integrácia s reálnym enginom (žiadny vymyslený počet/dĺžka).
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	komponentyPergoly,
	type NarezVysledok,
	type PergolaKomponent,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';
import { expedicnyZoznam } from '../src/lib/pergola-expedicia';

const BASE: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 5760,
	hlbka: 3690,
	prednaSvetlost: 2200,
	vyskaZadna: 2900,
	pocetPrednychNoh: 4,
	uchytenie: 'stena',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: false
};

describe('#419 — expedičný zoznam: kontrakt transformu', () => {
	// syntetický NarezVysledok s riadeným `vypocitane` (zvyšok zo skutočného enginu, aby
	// bol typ platný) — profil s reálnou dĺžkou aj profil s honest-null dĺžkou.
	const bazaVys = spocitajNarez(BASE);
	const vys: NarezVysledok = {
		...bazaVys,
		vypocitane: [
			{ kod: '18017', nazov: 'Predná noha', dlzkaRezuMm: 2340, pocetKs: 4 },
			{ kod: '18018', nazov: 'Žľabový profil', dlzkaRezuMm: null, pocetKs: 2 }
		]
	};
	const komp: PergolaKomponent[] = [
		{
			typ: 'Spojka U 100×50',
			kdePouzity: 'spojka výstuhy',
			systemy: ['Massive'],
			kodCad: '24007',
			zdroj: 'test',
			pocetKs: null
		}
	];

	it('profily idú prvé, komponenty za nimi (poradie zachované)', () => {
		const e = expedicnyZoznam(vys, komp);
		expect(e.polozky.map((p) => p.skupina)).toEqual(['profil', 'profil', 'komponent']);
		expect(e.polozky[0]!.nazov).toBe('Predná noha');
		expect(e.polozky[2]!.nazov).toBe('Spojka U 100×50');
	});

	it('profil nesie reálny počet + kód + dĺžku + pozičné číslo; honest-null dĺžka ostáva null', () => {
		const e = expedicnyZoznam(vys, komp);
		expect(e.polozky[0]).toMatchObject({
			skupina: 'profil',
			poz: 1,
			kod: '18017',
			pocetKs: 4,
			dlzkaRezuMm: 2340
		});
		// pozičné číslo = poradie v Pláne rezov (pozicujDiely: cislo = index + 1)
		expect(e.polozky[1]!.poz).toBe(2);
		// honest-null dĺžka sa NEVYMÝŠĽA — ostáva null
		expect(e.polozky[1]!.dlzkaRezuMm).toBeNull();
		expect(e.polozky[1]!.pocetKs).toBe(2);
	});

	it('komponent má honest-null počet, dĺžku null, poz null a len CAD kód (nie vymyslený Money kód)', () => {
		const e = expedicnyZoznam(vys, komp);
		expect(e.polozky[2]).toMatchObject({
			skupina: 'komponent',
			poz: null,
			kod: '24007',
			pocetKs: null,
			dlzkaRezuMm: null
		});
	});

	it('spoluKusov = súčet ZNÁMYCH počtov profilov (komponent s null počtom sa NErátá)', () => {
		const e = expedicnyZoznam(vys, komp);
		expect(e.spoluKusov).toBe(6); // 4 + 2, komponent (null) sa nepripočíta
		expect(e.pocetProfilov).toBe(2);
		expect(e.pocetKomponentov).toBe(1);
	});

	it('komponent s null kodCad ostáva null (nikdy sa kód nedopĺňa)', () => {
		const kompNull: PergolaKomponent[] = [
			{
				typ: 'Krytka',
				kdePouzity: 'x',
				systemy: ['Massive'],
				kodCad: null,
				zdroj: 't',
				pocetKs: null
			}
		];
		const e = expedicnyZoznam(vys, kompNull);
		expect(e.polozky[2]!.kod).toBeNull();
	});

	it('prázdny vstup → prázdny zoznam, spoluKusov 0, žiaden pád', () => {
		const prazdny: NarezVysledok = { ...bazaVys, vypocitane: [] };
		const e = expedicnyZoznam(prazdny, []);
		expect(e.polozky).toEqual([]);
		expect(e.spoluKusov).toBe(0);
		expect(e.pocetProfilov).toBe(0);
		expect(e.pocetKomponentov).toBe(0);
	});
});

describe('#419 — expedičný zoznam: integrácia s reálnym enginom (honest, žiaden vymyslený údaj)', () => {
	const configy: Array<[string, PergolaNarezVstup]> = [
		['Massive na stenu', BASE],
		[
			'Robust samostatne',
			{ ...BASE, system: 'Robust', uchytenie: 'samostatne', hornyProfilZadnej: 110 }
		]
	];

	for (const [meno, v] of configy) {
		it(`${meno}: každý profil z nárezu je v zozname s tým istým počtom a kódom`, () => {
			const vysledok = spocitajNarez(v);
			const komponenty = komponentyPergoly(v);
			const e = expedicnyZoznam(vysledok, komponenty);

			// profily 1:1 s `vypocitane` (poradie + počet + kód + dĺžka + poz), žiaden vymyslený riadok
			const profily = e.polozky.filter((p) => p.skupina === 'profil');
			expect(profily.length).toBe(vysledok.vypocitane.length);
			profily.forEach((p, i) => {
				const src = vysledok.vypocitane[i]!;
				expect(p.kod).toBe(src.kod);
				expect(p.pocetKs).toBe(src.pocetKs);
				expect(p.dlzkaRezuMm).toBe(src.dlzkaRezuMm);
				// pozičné číslo = poradie v náreze (previazané s balónikmi vo výkrese)
				expect(p.poz).toBe(i + 1);
			});

			// komponenty 1:1 s katalógom pre systém, počty honest-null (nikdy vymyslené)
			const komp = e.polozky.filter((p) => p.skupina === 'komponent');
			expect(komp.length).toBe(komponenty.length);
			for (const k of komp) expect(k.pocetKs).toBeNull();

			// spoluKusov = súčet počtov profilov (všetky profily majú číselný počet)
			const ocakSpolu = vysledok.vypocitane.reduce((s, p) => s + p.pocetKs, 0);
			expect(e.spoluKusov).toBe(ocakSpolu);
			expect(e.spoluKusov).toBeGreaterThan(0);
		});
	}
});
