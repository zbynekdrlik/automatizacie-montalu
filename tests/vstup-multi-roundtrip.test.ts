// Round-trip viac-posuvového vstupu: náhľad → ODOSLAŤ / SPÄŤ.
//
// Šéf 2026-07-30: „klíny po kliknutí na odpísať do Money už nie sú vidno vo
// vizualizácii". Príčina je tvar dát: skrytý formulár náhľadu (`hiddenMulti`)
// posiela `posuvy` ako JSON toho, čo server vrátil — teda UŽ SPARSOVANÝ tvar
// (`klin: {dlzka,…}`, `kolajnica: {horna,…}`), kým `parseMultiVstup` čítal len
// PLOCHÉ polia z formulára (`klinDlzka`, `kolajnicaHorna`). Pri druhom parse
// teda klín tichor zmizol — a s ním aj RUČNÁ DĹŽKA KOĽAJNICE, ktorá je
// Money-kritická (mení metre v odpise).
import { describe, it, expect } from 'vitest';
import { parseMultiVstup } from '../src/lib/server/vstup';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const base = { zak: 'ZAK1', op: 'OP1', zakaznik: 'X' };
const POSUV_PLOCHY = {
	system: 'Štandard',
	styl: '2K',
	s: '2509',
	v: '1930',
	sklo: 'Izolačné sklo 4/16/4 číre',
	otvaranie: 'P - L',
	klin: '1',
	klinDlzka: '2509',
	klinSirka: '250',
	klinV1: '120',
	klinV2: '0',
	klinKs: '2',
	kolajnicaHorna: '2690',
	kolajnicaSpodna: '2695'
};

/** presne to, čo robí náhľad: JSON.stringify(server vrátený multiVstup.posuvy) */
const znovuPosli = (posuvy: unknown[]) =>
	parseMultiVstup(fd({ ...base, posuvy: JSON.stringify(posuvy) }));

describe('parseMultiVstup — druhý parse (odoslať / späť) nesmie stratiť klín ani ručnú koľajnicu', () => {
	it('prvý parse (z formulára) klín aj koľajnicu prečíta', () => {
		const { vstup, error } = znovuPosli([POSUV_PLOCHY]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.klin).toEqual({ dlzka: 2509, sirka: 250, v1: 120, v2: 0, ks: 2 });
		expect(vstup.posuvy[0]!.kolajnica).toEqual({ horna: 2690, spodna: 2695 });
	});

	it('druhý parse (náhľad → odoslať) klín aj koľajnicu ZACHOVÁ', () => {
		const prvy = znovuPosli([POSUV_PLOCHY]).vstup;
		// náhľad posiela sparsovaný tvar späť na server
		const { vstup, error } = znovuPosli(prvy.posuvy);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.klin).toEqual(prvy.posuvy[0]!.klin);
		expect(vstup.posuvy[0]!.kolajnica).toEqual(prvy.posuvy[0]!.kolajnica);
	});

	it('opakovaný round-trip (späť a upraviť → znova náhľad → odoslať) drží hodnoty', () => {
		let v = znovuPosli([POSUV_PLOCHY]).vstup;
		for (let i = 0; i < 3; i++) v = znovuPosli(v.posuvy).vstup;
		expect(v.posuvy[0]!.klin).toEqual({ dlzka: 2509, sirka: 250, v1: 120, v2: 0, ks: 2 });
		expect(v.posuvy[0]!.kolajnica).toEqual({ horna: 2690, spodna: 2695 });
	});

	it('posuv BEZ klina a bez ručnej koľajnice ostáva bez nich (null neprepne zapínač)', () => {
		const prvy = znovuPosli([
			{
				...POSUV_PLOCHY,
				klin: '',
				klinDlzka: '',
				klinSirka: '',
				klinV1: '',
				klinV2: '',
				klinKs: '',
				kolajnicaHorna: '',
				kolajnicaSpodna: ''
			}
		]).vstup;
		expect(prvy.posuvy[0]!.klin).toBeNull();
		const { vstup, error } = znovuPosli(prvy.posuvy);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.klin).toBeNull();
		expect(vstup.posuvy[0]!.kolajnica).toBeNull();
	});

	it('sparsovaný klín s nezmyselnou hodnotou padne na chybu, nie tichor zmizne', () => {
		const { error } = znovuPosli([
			{ ...POSUV_PLOCHY, klin: { dlzka: 0, sirka: 250, v1: 120, v2: 0, ks: 1 }, kolajnica: null }
		]);
		expect(error).toBe('Posuv 1: klín — dĺžka musí byť 1–20000 mm.');
	});
});

// #110 (2026-08-03): sieťkin SYSTÉM (Štandard/Štandard +) je nové pole, ktoré musí
// prežiť presne ten istý round-trip ako klín/ručná koľajnica vyššie — inak by sa
// pri „Späť a upraviť" tichor stratila voľba, ktorú si obsluha zvolila (rovnaká
// trieda chyby ako #81/#108, len na novom poli).
const POSUV_SO_SIETKOU_STANDARD = {
	...POSUV_PLOCHY,
	system: 'Štandard +',
	sietka: '1',
	sietkaUchyt: 'madloVelke',
	sietkaSystem: 'Štandard'
};

describe('parseMultiVstup — druhý parse nesmie stratiť SYSTÉM sieťky (#110)', () => {
	it('prvý parse (z formulára) systém sieťky prečíta', () => {
		const { vstup, error } = znovuPosli([POSUV_SO_SIETKOU_STANDARD]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.sietka).toEqual({ uchyt: 'madloVelke', system: 'Štandard' });
	});

	it('druhý parse (náhľad → odoslať) systém sieťky ZACHOVÁ', () => {
		const prvy = znovuPosli([POSUV_SO_SIETKOU_STANDARD]).vstup;
		const { vstup, error } = znovuPosli(prvy.posuvy);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.sietka).toEqual(prvy.posuvy[0]!.sietka);
		expect(vstup.posuvy[0]!.sietka?.system).toBe('Štandard');
	});

	it('opakovaný round-trip (späť a upraviť ×3) drží systém sieťky', () => {
		let v = znovuPosli([POSUV_SO_SIETKOU_STANDARD]).vstup;
		for (let i = 0; i < 3; i++) v = znovuPosli(v.posuvy).vstup;
		expect(v.posuvy[0]!.sietka).toEqual({ uchyt: 'madloVelke', system: 'Štandard' });
	});

	it('sieťka BEZ zvoleného systému (rovnaký ako posuv) round-trip drží — pole ostáva chýbajúce, nie omylom vyplnené', () => {
		const posuv = { ...POSUV_PLOCHY, system: 'Štandard +', sietka: '1', sietkaUchyt: 'zamok' };
		const prvy = znovuPosli([posuv]).vstup;
		expect(prvy.posuvy[0]!.sietka).toEqual({ uchyt: 'zamok' });
		const { vstup, error } = znovuPosli(prvy.posuvy);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.sietka?.system).toBeUndefined();
	});
});
