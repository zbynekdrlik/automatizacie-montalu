// Pergola — TESNENIA (gumy) do rezervačného odpisu (#339). Tri pravidlá z callu
// s Dominikom (31.8.): (1) tesnenie na sklá = dĺžka stropného profilu × 4; (2)
// tesnenie žľabu = dĺžka žľabu; (3) tesnenie kotviaceho = dĺžka kotviaceho profilu.
// Overuje, že:
//  - #2/#3 majú jednoznačný základ (žľab 18021/18018, kotviaci 18019 = šírka) a
//    spočítajú sa,
//  - #1 je ODLOŽENÉ (stav 'caka', dĺžka null) — základ „stropný profil" je
//    nejednoznačný, nikdy hádané číslo,
//  - základ, ktorý nie je v náreze, degraduje na 'caka' (nikdy vymyslené číslo),
//  - žiadne tesnenie (kod: null) sa NIKDY nedostane do Money odpisu (job.polozky).
import { describe, it, expect } from 'vitest';
import {
	spocitajTesnenia,
	buildRezervaciaRozpis,
	rezervaciaJob,
	type TesnenieRozmer
} from '../src/lib/server/pergola-rezervacia';
import type { Polozka } from '../src/lib/server/money';
import {
	spocitajNarez,
	PREDNA_SVETLOST_STD,
	type PergolaNarezVstup,
	type NarezVysledok
} from '../src/lib/pergola-narez';

// štandardná pergola z callu: Robust, na stenu, zasklená (default svelte formulára)
const STD: PergolaNarezVstup = {
	system: 'Robust',
	sirka: 5000,
	hlbka: 3500,
	prednaSvetlost: PREDNA_SVETLOST_STD, // 2200
	vyskaZadna: 2900,
	pocetPrednychNoh: 4,
	uchytenie: 'stena',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: false,
	sklonStrechy: null,
	jednoduchaBezZasklenia: false,
	vystuhaProfil: null,
	zvodFrezovat: false,
	zvodFrezovanieSHmm: null,
	strechaSklo: '',
	obvodoveZasklenie: ''
};

const IDENT = { zak: 'ZAK2026999', op: 'OP260999', zakaznik: 'E2E Test' };

describe('spocitajTesnenia (#339) — dĺžky tesnení pergoly', () => {
	const vysledok = spocitajNarez(STD);
	const t = spocitajTesnenia(vysledok);
	const by = (id: string) => t.find((x) => x.id === id)!;

	it('vráti presne tri tesnenia (na sklá, žľab, kotviaci)', () => {
		expect(t.map((x) => x.id).sort()).toEqual(['kotviaci', 'na-skla', 'zlab']);
	});

	it('#2 tesnenie žľabu = dĺžka žľabu (18021/18018) — pre šírku 5000 = 5000 mm', () => {
		const zlabRow = vysledok.vypocitane.find((p) => p.kod === '18021' || p.kod === '18018');
		expect(zlabRow?.dlzkaRezuMm).toBe(5000);
		const zlab = by('zlab');
		expect(zlab.stav).toBe('ok');
		expect(zlab.koef).toBe(1);
		expect(zlab.dlzkaMm).toBe(5000);
		expect(zlab.kod).toBeNull(); // do Money zatiaľ nejde
	});

	it('#3 tesnenie kotviaceho = dĺžka kotviaceho (18019) — pre šírku 5000 = 5000 mm', () => {
		const kotvRow = vysledok.vypocitane.find((p) => p.kod === '18019');
		expect(kotvRow?.dlzkaRezuMm).toBe(5000);
		const k = by('kotviaci');
		expect(k.stav).toBe('ok');
		expect(k.koef).toBe(1);
		expect(k.dlzkaMm).toBe(5000);
		expect(k.kod).toBeNull();
	});

	it('#1 tesnenie na sklá = ČAKÁ (základ „stropný profil" nejednoznačný, nikdy hádané)', () => {
		const s = by('na-skla');
		expect(s.stav).toBe('caka');
		expect(s.dlzkaMm).toBeNull();
		expect(s.koef).toBe(4);
		expect(s.dovod).toBeTruthy();
		expect(s.kod).toBeNull();
	});

	it('dĺžka = súčet dlzkaRezuMm × pocetKs × koef (priama väzba na nárez, nie hardcode)', () => {
		const zlabRow = vysledok.vypocitane.find((p) => p.kod === '18021' || p.kod === '18018')!;
		expect(by('zlab').dlzkaMm).toBe(zlabRow.dlzkaRezuMm! * zlabRow.pocetKs * 1);
		const kotvRow = vysledok.vypocitane.find((p) => p.kod === '18019')!;
		expect(by('kotviaci').dlzkaMm).toBe(kotvRow.dlzkaRezuMm! * kotvRow.pocetKs * 1);
	});

	it('širšia zákazka → dlhšie tesnenie (žľab/kotviaci sledujú šírku)', () => {
		const sirsi = spocitajTesnenia(spocitajNarez({ ...STD, sirka: 6200 }));
		expect(sirsi.find((x) => x.id === 'zlab')!.dlzkaMm).toBe(6200);
		expect(sirsi.find((x) => x.id === 'kotviaci')!.dlzkaMm).toBe(6200);
	});

	it('základ, ktorý nie je v náreze → čaká (nikdy vymyslené číslo)', () => {
		const prazdny = spocitajTesnenia({ vypocitane: [] } as unknown as NarezVysledok);
		for (const x of prazdny) {
			expect(x.stav).toBe('caka');
			expect(x.dlzkaMm).toBeNull();
		}
	});
});

describe('Money-safety (#339) — tesnenia NIKDY nevojdú do Money odpisu', () => {
	it('KOMPILAČNÁ zámka: TesnenieRozmer (kod:null) sa NEDÁ priradiť na Polozka', () => {
		// Falsifikovateľný TYPOVÝ invariant (kontroluje `npm run check`): `kod:null` (a chýbajúce
		// `qty`) blokuje priradenie na Polozka (`kod:string`). Keď niekto oslabí zámku (rozšíri
		// `kod` na `string|null` a pridá `qty`), tento `@ts-expect-error` zhasne a typecheck padne.
		// @ts-expect-error — tesnenie sa štrukturálne nesmie dať priradiť na Money Polozka
		const _lock: Polozka = null as unknown as TesnenieRozmer;
		expect(_lock).toBeNull();
	});

	it('tesnenia sú v rozpise (na zobrazenie), ale žiadne v job.polozky', () => {
		const res = buildRezervaciaRozpis(STD, IDENT);
		expect(res.rozpis).not.toBeNull();
		const rozpis = res.rozpis!;
		expect(rozpis.tesnenia.length).toBe(3);

		const job = rezervaciaJob(STD, IDENT, rozpis, 'tester');
		// žiadny Money riadok nie je tesnenie
		expect(job.polozky.some((p) => /tesnenie/i.test(p.nazov))).toBe(false);
		// každý Money riadok má reálny (string) kód — tesnenie s kod:null by tu neprešlo typom
		for (const p of job.polozky) expect(typeof p.kod).toBe('string');
	});
});
