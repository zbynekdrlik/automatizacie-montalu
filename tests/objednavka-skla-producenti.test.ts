// #496 round 2: unit test — producenti (zasklenia, FIX, pergola) zapisujú sklá do objednavka_skla
import { describe, it, expect } from 'vitest';

describe('objednavka-skla producenti — zasklenia', () => {
	it('single posuv compute → NoveSklo mapping + DB insert', async () => {
		const { pridajSklaHromadne, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');
		const { safeCompute } = await import('../src/lib/server/compute');
		const { loadCfg } = await import('../src/lib/server/db');

		const cfg = loadCfg();
		const sysStyl = Object.keys(cfg)[0]!;
		const { r } = safeCompute(
			cfg,
			sysStyl,
			2000,
			2200,
			false,
			0,
			false,
			undefined,
			undefined,
			null
		);
		expect(r).not.toBeNull();
		if (!r) return;

		const system = sysStyl.split('|')[0] ?? 'Robust';
		const styl = sysStyl.split('|')[1] ?? 'basic';
		const count = pridajSklaHromadne([
			{
				zak: 'ZAK-PROD-ZASK-01',
				op: 'OP01',
				modul: 'zasklenia',
				popis: `${system} ${styl}`,
				sirkaMm: r.sklo.sirka,
				vyskaMm: r.sklo.vyska,
				pocet: r.sklo.pocet,
				typSkla: 'Float 4mm',
				createdBy: 'test'
			}
		]);

		expect(count).toBe(1);
		const list = listSklaPreZakazku('ZAK-PROD-ZASK-01');
		expect(list.length).toBe(1);
		expect(list[0]!.modul).toBe('zasklenia');
		expect(list[0]!.sirkaMm).toBe(r.sklo.sirka);
		expect(list[0]!.vyskaMm).toBe(r.sklo.vyska);
		expect(list[0]!.pocet).toBe(r.sklo.pocet);
		expect(list[0]!.typSkla).toBe('Float 4mm');
		expect(list[0]!.sikmy).toBe(false);
	});
});

describe('objednavka-skla producenti — FIX', () => {
	it('šikmý FIX polia → NoveSklo mapping (vLavoMm/vPravoMm, sikmy=true)', async () => {
		const { pridajSklaHromadne, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');
		const { pocitajFix } = await import('../src/lib/fix');

		const r = pocitajFix(3000, 2000, 1500, [1500, 1500]);
		expect(r.polia.length).toBe(2);

		const polozky = r.polia.map((pole, i) => ({
			zak: 'ZAK-PROD-FIX-01',
			op: 'OP01',
			modul: 'fix',
			popis: `FIX pole ${i + 1}`,
			sirkaMm: pole.sirka,
			vyskaMm: null as number | null,
			vLavoMm: pole.vLavo,
			vPravoMm: pole.vPravo,
			pocet: 1,
			typSkla: 'Float 4mm',
			sikmy: true,
			m2: pole.m2,
			createdBy: 'test'
		}));

		const count = pridajSklaHromadne(polozky);
		expect(count).toBe(2);

		const list = listSklaPreZakazku('ZAK-PROD-FIX-01');
		expect(list.length).toBe(2);

		// all sikmy
		for (const item of list) {
			expect(item.modul).toBe('fix');
			expect(item.sikmy).toBe(true);
			expect(item.vyskaMm).toBeNull();
			expect(item.vLavoMm).toBeGreaterThan(0);
			expect(item.vPravoMm).toBeGreaterThan(0);
		}

		// per-pole dimensions are correct
		expect(list[0]!.sirkaMm).toBe(r.polia[0]!.sirka);
		expect(list[0]!.vLavoMm).toBe(r.polia[0]!.vLavo);
		expect(list[0]!.vPravoMm).toBe(r.polia[0]!.vPravo);
	});

	it('rovný FIX polia → NoveSklo mapping (vyskaMm, sikmy=false)', async () => {
		const { pridajSklaHromadne, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');
		const { pocitajFix } = await import('../src/lib/fix');

		// rovný: V1 === V2
		const r = pocitajFix(2000, 1800, 1800, [1000, 1000]);
		expect(r.polia.length).toBe(2);
		// rovný → polia have vLavo === vPravo
		expect(r.polia[0]!.vLavo).toBe(r.polia[0]!.vPravo);

		const polozky = r.polia.map((pole, i) => ({
			zak: 'ZAK-PROD-FIX-02',
			op: 'OP01',
			modul: 'fix',
			popis: `FIX pole ${i + 1}`,
			sirkaMm: pole.sirka,
			vyskaMm: pole.vLavo, // rovný = height is vLavo (=vPravo)
			vLavoMm: null as number | null,
			vPravoMm: null as number | null,
			pocet: 1,
			typSkla: 'Float 6mm',
			sikmy: false,
			m2: pole.m2,
			createdBy: 'test'
		}));

		const count = pridajSklaHromadne(polozky);
		expect(count).toBe(2);

		const list = listSklaPreZakazku('ZAK-PROD-FIX-02');
		expect(list.length).toBe(2);

		for (const item of list) {
			expect(item.modul).toBe('fix');
			expect(item.sikmy).toBe(false);
			expect(item.vyskaMm).toBe(1800);
			expect(item.vLavoMm).toBeNull();
			expect(item.vPravoMm).toBeNull();
		}
	});
});

describe('objednavka-skla producenti — pergola strešné sklo', () => {
	it('spocitajStrechaSklo → NoveSklo mapping (honest-null disciplína)', async () => {
		const { pridajSklaHromadne, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');
		const { spocitajStrechaSklo } = await import('../src/lib/pergola-sklo');

		// Complete input — overená konfigurácia (samostatne, zadný 110, sklon 6.1°)
		const vstup = {
			system: 'Massive' as const,
			sirka: 4990,
			hlbka: 3470,
			prednaSvetlost: 2200,
			vyskaZadna: 2790,
			hornyProfilZadnej: 110 as 110 | 140,
			uchytenie: 'samostatne' as const,
			zosilnenyNosnik: false,
			vystuhaProfil: undefined,
			sklonStrechy: 6.1,
			strechaSkloTyp: '4.4.2 číre',
			zasklena: true,
			jednoduchaBezZasklenia: false,
			pocetKrovov: 8,
			prieckaLight: false,
			pocetPrednychNoh: 2,
			pocetZadnychNoh: 2
		};

		const geo = spocitajStrechaSklo(vstup);
		expect(geo.sirkaMm).not.toBeNull();
		expect(geo.pocetTabul).not.toBeNull();
		expect(geo.pocetTabul).toBe(7); // 8 krovov - 1

		const polozky = [
			{
				zak: 'ZAK-PROD-PERGOLA-01',
				op: 'OP01',
				modul: 'pergola',
				popis: `Strešné sklo — ${geo.typ}`,
				sirkaMm: geo.sirkaMm!,
				vyskaMm: geo.dlzkaMm,
				pocet: geo.pocetTabul!,
				typSkla: geo.typ ?? '',
				createdBy: 'test'
			}
		];

		const count = pridajSklaHromadne(polozky);
		expect(count).toBe(1);

		const list = listSklaPreZakazku('ZAK-PROD-PERGOLA-01');
		expect(list.length).toBe(1);
		expect(list[0]!.modul).toBe('pergola');
		expect(list[0]!.pocet).toBe(7);
		expect(list[0]!.sirkaMm).toBe(geo.sirkaMm);
		expect(list[0]!.typSkla).toBe('4.4.2 číre');
	});

	it('honest-null — no glass when sirkaMm is null (no typ selected)', async () => {
		const { spocitajStrechaSklo } = await import('../src/lib/pergola-sklo');

		const vstup = {
			system: 'Robust' as const,
			sirka: 4990,
			hlbka: 3470,
			prednaSvetlost: 2200,
			vyskaZadna: 2790,
			hornyProfilZadnej: 110 as 110 | 140,
			uchytenie: 'samostatne' as const,
			zosilnenyNosnik: false,
			vystuhaProfil: undefined,
			sklonStrechy: 6.1,
			strechaSkloTyp: '', // no type selected
			zasklena: true,
			jednoduchaBezZasklenia: false,
			pocetKrovov: 8,
			prieckaLight: false,
			pocetPrednychNoh: 2,
			pocetZadnychNoh: 2
		};

		const geo = spocitajStrechaSklo(vstup);
		// Without type → sirkaMm is null → no glass should be added
		expect(geo.sirkaMm).toBeNull();
		expect(geo.pocetTabul).toBeNull();
	});

	it('honest-null — no glass when pocetKrovov not set', async () => {
		const { spocitajStrechaSklo } = await import('../src/lib/pergola-sklo');

		const vstup = {
			system: 'Massive' as const,
			sirka: 4990,
			hlbka: 3470,
			prednaSvetlost: 2200,
			vyskaZadna: 2790,
			hornyProfilZadnej: 110 as 110 | 140,
			uchytenie: 'samostatne' as const,
			zosilnenyNosnik: false,
			vystuhaProfil: undefined,
			sklonStrechy: 6.1,
			strechaSkloTyp: '4.4.2 číre',
			zasklena: true,
			jednoduchaBezZasklenia: false,
			// pocetKrovov not set (undefined)
			prieckaLight: false,
			pocetPrednychNoh: 2,
			pocetZadnychNoh: 2
		};

		const geo = spocitajStrechaSklo(vstup);
		// Without krovov → pocetTabul null
		expect(geo.pocetTabul).toBeNull();
	});
});
