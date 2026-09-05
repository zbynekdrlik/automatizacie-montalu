// Sieťka multi (#473) — parsovanie viackusového vstupu. Kusy prichádzajú ako JSON
// pole v hidden inpute `sietkaKusy` (vzor `parseClipMultiVstup` v vstup.ts, #468
// fáza 2). Hlavičkové polia (zak/op/zakaznik/poznamka) sú ZDIEĽANÉ pre všetky kusy;
// per-kus polia (system/štýl/otvorS/otvorV/sietkaUchyt) validuje ROVNAKÁ logika ako
// jednokusový `parseSietkaSamostatnaVstup`, aby obe cesty hlásili identické chyby.
import { describe, it, expect } from 'vitest';
import { parseSietkaMultiVstup } from '../src/lib/server/sietka-samostatna';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};

const kus = (over: Record<string, unknown> = {}) => ({
	system: 'Robust',
	styl: '3K',
	otvorS: 2000,
	otvorV: 1500,
	sietkaUchyt: 'ziadny',
	...over
});

const zaklad = (kusy: unknown[]) => ({
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	poznamka: '',
	sietkaKusy: JSON.stringify(kusy)
});

describe('parseSietkaMultiVstup', () => {
	it('platný jednokusový vstup', () => {
		const { vstup, error } = parseSietkaMultiVstup(fd(zaklad([kus()])));
		expect(error).toBeNull();
		expect(vstup.zak).toBe('ZAK1');
		expect(vstup.op).toBe('OP1');
		expect(vstup.zakaznik).toBe('X');
		expect(vstup.kusy).toHaveLength(1);
		expect(vstup.kusy[0]).toMatchObject({
			zak: 'ZAK1',
			op: 'OP1',
			zakaznik: 'X',
			system: 'Robust',
			styl: '3K',
			otvorS: 2000,
			otvorV: 1500
		});
		expect(vstup.kusy[0]!.sietka).toEqual({ uchyt: 'ziadny' });
	});

	it('viackusový vstup — rôzny systém/štýl/rozmer/úchyt per kus', () => {
		const { vstup, error } = parseSietkaMultiVstup(
			fd(
				zaklad([
					kus({ system: 'Robust', styl: '2K', otvorS: 1500, otvorV: 1400, sietkaUchyt: 'zamok' }),
					kus({
						system: 'Slide',
						styl: '3K',
						otvorS: 3000,
						otvorV: 2000,
						sietkaUchyt: 'madloVelke'
					})
				])
			)
		);
		expect(error).toBeNull();
		expect(vstup.kusy).toHaveLength(2);
		expect(vstup.kusy[0]!.system).toBe('Robust');
		expect(vstup.kusy[0]!.styl).toBe('2K');
		expect(vstup.kusy[0]!.sietka).toEqual({ uchyt: 'zamok' });
		expect(vstup.kusy[1]!.system).toBe('Slide');
		expect(vstup.kusy[1]!.styl).toBe('3K');
		expect(vstup.kusy[1]!.sietka).toEqual({ uchyt: 'madloVelke' });
	});

	it('poznámka je zdieľaná hlavičková hodnota, capnutá na 300 znakov ako jednokusová', () => {
		const dlha = 'X'.repeat(400);
		const { vstup, error } = parseSietkaMultiVstup(fd({ ...zaklad([kus()]), poznamka: dlha }));
		expect(error).toBeNull();
		expect(vstup.poznamka).toHaveLength(300);
	});

	it('chýbajúce hlavičkové polia hlásia chybu', () => {
		expect(parseSietkaMultiVstup(fd({ ...zaklad([kus()]), zak: '' })).error).toMatch(/ZAK/);
		expect(parseSietkaMultiVstup(fd({ ...zaklad([kus()]), op: '' })).error).toMatch(/OP/);
		expect(parseSietkaMultiVstup(fd({ ...zaklad([kus()]), zakaznik: '' })).error).toMatch(
			/zákazník/
		);
	});

	it('prázdne pole kusov je odmietnuté', () => {
		const { error } = parseSietkaMultiVstup(fd(zaklad([])));
		expect(error).toBeTruthy();
	});

	it('nevalidný JSON v sietkaKusy je odmietnutý (nikdy nehodí výnimku)', () => {
		const f = fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', poznamka: '' });
		f.set('sietkaKusy', '{not json');
		const { error } = parseSietkaMultiVstup(f);
		expect(error).toBeTruthy();
	});

	it('viac ako 12 kusov je odmietnuté', () => {
		const kusy = Array.from({ length: 13 }, () => kus());
		const { error } = parseSietkaMultiVstup(fd(zaklad(kusy)));
		expect(error).toMatch(/12/);
	});

	it('presne 12 kusov je prijatých', () => {
		const kusy = Array.from({ length: 12 }, () => kus());
		const { error, vstup } = parseSietkaMultiVstup(fd(zaklad(kusy)));
		expect(error).toBeNull();
		expect(vstup.kusy).toHaveLength(12);
	});

	it('systém mimo Robust/Slide v 2. kuse hlási číslovanú chybu "Sieťka 2: ..."', () => {
		const { error } = parseSietkaMultiVstup(fd(zaklad([kus(), kus({ system: 'Deluxe' })])));
		expect(error).toMatch(/^Sieťka 2:.*systém/);
	});

	it('chýbajúci štýl v 1. kuse hlási číslovanú chybu "Sieťka 1: ..."', () => {
		const { error } = parseSietkaMultiVstup(fd(zaklad([kus({ styl: '' })])));
		expect(error).toMatch(/^Sieťka 1:.*štýl/);
	});

	it('rozmery otvoru mimo rozsahu v ktoromkoľvek kuse sú odmietnuté', () => {
		expect(parseSietkaMultiVstup(fd(zaklad([kus(), kus({ otvorS: 100 })]))).error).toMatch(
			/^Sieťka 2:.*Šírka otvoru/
		);
		expect(parseSietkaMultiVstup(fd(zaklad([kus({ otvorV: 100 })]))).error).toMatch(
			/^Sieťka 1:.*Výška otvoru/
		);
	});

	it('nezmyselný úchyt sa sanitizuje na „bez ničoho", nikdy nezablokuje vstup', () => {
		const { vstup, error } = parseSietkaMultiVstup(fd(zaklad([kus({ sietkaUchyt: 'nezmysel' })])));
		expect(error).toBeNull();
		expect(vstup.kusy[0]!.sietka).toEqual({ uchyt: 'ziadny' });
	});
});
