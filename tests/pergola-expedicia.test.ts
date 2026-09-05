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

	it('profily idú prvé, komponenty za nimi, drobný materiál na konci (poradie zachované)', () => {
		const e = expedicnyZoznam(vys, komp);
		expect(e.polozky.map((p) => p.skupina)).toEqual([
			'profil',
			'profil',
			'komponent',
			'drobny-material'
		]);
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

	it('prázdny vstup → len drobný materiál, spoluKusov 0, žiaden pád', () => {
		const prazdny: NarezVysledok = { ...bazaVys, vypocitane: [] };
		const e = expedicnyZoznam(prazdny, []);
		// aj bez profilov/komponentov je tam vždy catch-all drobný materiál
		expect(e.polozky.length).toBe(1);
		expect(e.polozky[0]!.skupina).toBe('drobny-material');
		expect(e.spoluKusov).toBe(0);
		expect(e.pocetProfilov).toBe(0);
		expect(e.pocetKomponentov).toBe(0);
	});
});

describe('#419 extended scope — strešné sklo, FIX výplne, tesnenia, drobný materiál', () => {
	const bazaVys = spocitajNarez(BASE);
	const vys: NarezVysledok = {
		...bazaVys,
		vypocitane: [
			{ kod: '18017', nazov: 'Predná noha', dlzkaRezuMm: 2340, pocetKs: 4 }
		]
	};
	const komp: PergolaKomponent[] = [];

	it('strešné sklo sa objaví ako skupina stresne-sklo s rozmerInfo', () => {
		const e = expedicnyZoznam(vys, komp, {
			strechaSklo: { pocetTabul: 7, sirkaMm: 705.4, dlzkaMm: 3259.76, typ: 'Float kalené 6 mm' }
		});
		const skla = e.polozky.filter((p) => p.skupina === 'stresne-sklo');
		expect(skla.length).toBe(1);
		expect(skla[0]!.nazov).toContain('Strešné sklo');
		expect(skla[0]!.nazov).toContain('Float kalené 6 mm');
		expect(skla[0]!.pocetKs).toBe(7);
		expect(skla[0]!.rozmerInfo).toContain('705,4');
		expect(skla[0]!.rozmerInfo).toContain('3259,76');
		expect(e.pocetSkiel).toBe(1);
	});

	it('strešné sklo s honest-null dĺžkou → rozmerInfo obsahuje —', () => {
		const e = expedicnyZoznam(vys, komp, {
			strechaSklo: { pocetTabul: 7, sirkaMm: 705.4, dlzkaMm: null, typ: 'STADUR' }
		});
		const skla = e.polozky.filter((p) => p.skupina === 'stresne-sklo');
		expect(skla[0]!.rozmerInfo).toBe('—');
	});

	it('strešné sklo s pocetTabul null → nevloží sa', () => {
		const e = expedicnyZoznam(vys, komp, {
			strechaSklo: { pocetTabul: null, sirkaMm: null, dlzkaMm: null, typ: null }
		});
		expect(e.polozky.filter((p) => p.skupina === 'stresne-sklo').length).toBe(0);
		expect(e.pocetSkiel).toBe(0);
	});

	it('FIX výplne sa objavia so skupinou fix-vypln a rozmerInfo', () => {
		const e = expedicnyZoznam(vys, komp, {
			fix: {
				zapnuty: true,
				zrkadlo: false,
				vykres: {
					polia: [
						{ sirka: 3500, vLavo: 2200, vPravo: 2900, sikma: 3600, m2: 8.9 }
					],
					S: 3500,
					V1: 2200,
					V2: 2900,
					alfa: 11.3,
					klesaVpravo: true,
					sikmaCelkom: 3600,
					uholOstry: 78.7,
					uholTupy: 101.3,
					kumulSirka: [3500],
					kumulSikma: [3600],
					vyskyStlpikov: [0, 2200],
					m2: 8.9
				}
			}
		});
		const fixy = e.polozky.filter((p) => p.skupina === 'fix-vypln');
		expect(fixy.length).toBe(1);
		expect(fixy[0]!.nazov).toContain('FIX výplň');
		expect(fixy[0]!.pocetKs).toBe(1); // zrkadlo=false → 1 kus
		expect(fixy[0]!.rozmerInfo).toContain('3500');
		expect(e.pocetFixov).toBe(1);
	});

	it('FIX zrkadlo NEDVOJÍ kusy (rovnaká konštrukcia otočená)', () => {
		const e = expedicnyZoznam(vys, komp, {
			fix: {
				zapnuty: true,
				zrkadlo: true,
				vykres: {
					polia: [
						{ sirka: 1750, vLavo: 2200, vPravo: 2900, sikma: 1800, m2: 4.5 },
						{ sirka: 1750, vLavo: 2200, vPravo: 2900, sikma: 1800, m2: 4.5 }
					],
					S: 3500,
					V1: 2200,
					V2: 2900,
					alfa: 11.3,
					klesaVpravo: true,
					sikmaCelkom: 3600,
					uholOstry: 78.7,
					uholTupy: 101.3,
					kumulSirka: [1750, 3500],
					kumulSikma: [1800, 3600],
					vyskyStlpikov: [0, 2200, 2200],
					m2: 9
				}
			}
		});
		const fixy = e.polozky.filter((p) => p.skupina === 'fix-vypln');
		expect(fixy.length).toBe(2); // 2 polia
		// zrkadlo nedvojí — každé pole stále 1 kus
		expect(fixy[0]!.pocetKs).toBe(1);
		expect(fixy[1]!.pocetKs).toBe(1);
	});

	it('FIX vypnutý → žiadne fix-vypln položky', () => {
		const e = expedicnyZoznam(vys, komp, {
			fix: { zapnuty: false, zrkadlo: false, vykres: null }
		});
		expect(e.polozky.filter((p) => p.skupina === 'fix-vypln').length).toBe(0);
		expect(e.pocetFixov).toBe(0);
	});

	it('tesnenia s stav ok sa objavia s dĺžkou a skupinou tesnenie', () => {
		const e = expedicnyZoznam(vys, komp, {
			tesnenia: [
				{ id: 'zlab', nazov: 'Tesnenie žľabu', dlzkaMm: 5760, stav: 'ok', koef: 1, vzorec: '', kod: null },
				{ id: 'kotviaci', nazov: 'Tesnenie kotviaceho', dlzkaMm: 5760, stav: 'ok', koef: 1, vzorec: '', kod: null },
				{ id: 'na-skla', nazov: 'Tesnenie na sklá', dlzkaMm: null, stav: 'caka', koef: 4, vzorec: '', kod: null }
			]
		});
		const tesn = e.polozky.filter((p) => p.skupina === 'tesnenie');
		expect(tesn.length).toBe(2); // len stav=ok
		expect(tesn[0]!.dlzkaRezuMm).toBe(5760);
		expect(tesn[0]!.pocetKs).toBeNull(); // tesnenia sú merané dĺžkou, nie kusmi
		expect(e.pocetTesneni).toBe(2);
		// tesnenia s stav=caka → honestNullSkupiny
		expect(e.honestNullSkupiny).toContain('tesnenia');
	});

	it('drobný materiál je VŽDY na konci s honest-null', () => {
		const e = expedicnyZoznam(vys, komp);
		const posledny = e.polozky[e.polozky.length - 1]!;
		expect(posledny.skupina).toBe('drobny-material');
		expect(posledny.pocetKs).toBeNull();
		expect(posledny.dlzkaRezuMm).toBeNull();
		expect(e.honestNullSkupiny).toContain('drobný materiál');
	});

	it('poradie skupín: profily → komponenty → sklo → FIX → tesnenia → drobný materiál', () => {
		const e = expedicnyZoznam(vys, komp, {
			strechaSklo: { pocetTabul: 3, sirkaMm: 700, dlzkaMm: 3000, typ: 'Sklo' },
			fix: {
				zapnuty: true,
				zrkadlo: false,
				vykres: {
					polia: [{ sirka: 3000, vLavo: 2000, vPravo: 2500, sikma: 3100, m2: 7 }],
					S: 3000, V1: 2000, V2: 2500, alfa: 9, klesaVpravo: true,
					sikmaCelkom: 3100, uholOstry: 81, uholTupy: 99,
					kumulSirka: [3000], kumulSikma: [3100], vyskyStlpikov: [0, 2000], m2: 7
				}
			},
			tesnenia: [
				{ id: 'zlab', nazov: 'Tesnenie', dlzkaMm: 5000, stav: 'ok', koef: 1, vzorec: '', kod: null }
			]
		});
		const skupiny = e.polozky.map((p) => p.skupina);
		const posledny = skupiny.lastIndexOf('profil');
		const prvyKomp = skupiny.indexOf('drobny-material');
		// profily sú pred drobným materiálom
		expect(posledny).toBeLessThan(prvyKomp);
		// check poradia: profil < stresne-sklo < fix-vypln < tesnenie < drobny-material
		const prvySklo = skupiny.indexOf('stresne-sklo');
		const prvyFix = skupiny.indexOf('fix-vypln');
		const prvyTesn = skupiny.indexOf('tesnenie');
		expect(prvySklo).toBeGreaterThan(posledny);
		expect(prvyFix).toBeGreaterThan(prvySklo);
		expect(prvyTesn).toBeGreaterThan(prvyFix);
		expect(prvyKomp).toBeGreaterThan(prvyTesn);
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
