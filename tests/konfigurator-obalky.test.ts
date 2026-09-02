// #427: cenníkové ROZMEROVÉ OBÁLKY vystavené do UI (oplotenie per-typ, bazén per-model).
// Overuje, že odvodené obálky (`konfigurator-obalky.ts`) (1) presne sedia s dokumentovaným rozsahom,
// (2) ANTI-DRIFT sondou zodpovedajú REÁLNEMU správaniu cenových modulov (`vypocitajCenu*`) — bod NA
// hranici obálky má cenu, bod TESNE ZA ňou je individuálna ponuka — takže obálka nikdy neklame o tom,
// čo má v katalógu cenu, a zmena seedu posunie oboje spolu (alebo test spadne), a (3) že `load`
// oboch route obálku naozaj pošle klientovi (wiring), pričom serializovaná obálka nesie LEN rozmery.
import { describe, it, expect } from 'vitest';
import {
	OPLOTENIE_OBALKY,
	BAZEN_OBALKY,
	oplotenieObalka,
	bazenObalka
} from '../src/lib/server/konfigurator-obalky';
import { vypocitajCenuOplotenie } from '../src/lib/server/konfigurator-oplotenie-cena';
import { vypocitajCenuBazen } from '../src/lib/server/konfigurator-bazen-cena';
import type { OplotenieTypKod } from '../src/lib/konfigurator-oplotenie';
import type { BazenModel } from '../src/lib/konfigurator-bazen';

describe('#427 obálky — presné hranice odvodené zo seedu', () => {
	it('OPLOTENIE_OBALKY má presné per-typ rozmery (model-nezávislé; výška 0,6–2,0 m všade)', () => {
		expect(OPLOTENIE_OBALKY).toEqual({
			diel: { vyska: { minMm: 600, maxMm: 2000 }, sirka: { minMm: 1000, maxMm: 3500 } },
			kridlova: { vyska: { minMm: 600, maxMm: 2000 }, sirka: { minMm: 1000, maxMm: 6000 } },
			posuvna: { vyska: { minMm: 600, maxMm: 2000 }, sirka: { minMm: 1000, maxMm: 6000 } },
			samonosna: { vyska: { minMm: 600, maxMm: 2000 }, sirka: { minMm: 1000, maxMm: 6000 } },
			branka: { vyska: { minMm: 600, maxMm: 2000 }, sirka: { minMm: 1000, maxMm: 1500 } }
		});
	});

	it('BAZEN_OBALKY má presné per-model rozmery (dĺžka 3–12,5 m; šírka sa líši per model)', () => {
		expect(BAZEN_OBALKY).toEqual({
			Premier: { dlzka: { minMm: 3000, maxMm: 12500 }, sirka: { minMm: 2000, maxMm: 6000 } },
			Star: { dlzka: { minMm: 3000, maxMm: 12500 }, sirka: { minMm: 2000, maxMm: 4500 } },
			Exclusive: { dlzka: { minMm: 3000, maxMm: 12500 }, sirka: { minMm: 2000, maxMm: 5500 } }
		});
	});

	it('accessory oplotenieObalka/bazenObalka vracajú tú istú obálku (a undefined pre neznámy kľúč)', () => {
		expect(oplotenieObalka('branka')).toBe(OPLOTENIE_OBALKY.branka);
		expect(bazenObalka('Star')).toBe(BAZEN_OBALKY.Star);
		expect(oplotenieObalka('ATYP' as OplotenieTypKod)).toBeUndefined();
		expect(bazenObalka('Nieco' as BazenModel)).toBeUndefined();
	});
});

// ANTI-DRIFT: obálka musí zodpovedať REÁLNEMU správaniu cenových modulov. Pre KAŽDÝ typ/model:
//  - roh (min×min) aj (maxV×maxŠ) MÁ cenu (obálka nesľubuje viac, než katalóg naozaj má),
//  - o krok ZA maxom (šírka +500 mm / výška +100 mm) je individuálna ponuka (obálka nie je príliš úzka).
// Tak zmena seedu buď posunie obálku AJ toto správanie spolu, alebo test spadne.
const OPL_CENOVY_MODEL = 'ARIEL'; // ktorýkoľvek cenový model (obálka je model-nezávislá)

describe('#427 obálky — anti-drift proti vypocitajCenuOplotenie', () => {
	for (const typ of Object.keys(OPLOTENIE_OBALKY) as OplotenieTypKod[]) {
		const o = OPLOTENIE_OBALKY[typ];
		it(`${typ}: rohy obálky majú cenu, o krok za maxom individuálna`, () => {
			// min×min roh má cenu
			expect(
				vypocitajCenuOplotenie({
					typ,
					model: OPL_CENOVY_MODEL,
					vyskaMm: o.vyska.minMm,
					sirkaMm: o.sirka.minMm,
					pocet: 1
				}).druh
			).toBe('cena');
			// maxV×maxŠ roh má cenu
			expect(
				vypocitajCenuOplotenie({
					typ,
					model: OPL_CENOVY_MODEL,
					vyskaMm: o.vyska.maxMm,
					sirkaMm: o.sirka.maxMm,
					pocet: 1
				}).druh
			).toBe('cena');
			// o 500 mm širšie než max šírka → individuálna
			expect(
				vypocitajCenuOplotenie({
					typ,
					model: OPL_CENOVY_MODEL,
					vyskaMm: o.vyska.maxMm,
					sirkaMm: o.sirka.maxMm + 500,
					pocet: 1
				}).druh
			).toBe('individualna-ponuka');
			// o 100 mm vyššie než max výška → individuálna
			expect(
				vypocitajCenuOplotenie({
					typ,
					model: OPL_CENOVY_MODEL,
					vyskaMm: o.vyska.maxMm + 100,
					sirkaMm: o.sirka.maxMm,
					pocet: 1
				}).druh
			).toBe('individualna-ponuka');
		});
	}
});

describe('#427 obálky — anti-drift proti vypocitajCenuBazen', () => {
	for (const model of Object.keys(BAZEN_OBALKY) as BazenModel[]) {
		const o = BAZEN_OBALKY[model];
		it(`${model}: rohy obálky majú cenu, o krok za maxom individuálna`, () => {
			expect(
				vypocitajCenuBazen({ model, dlzkaMm: o.dlzka.minMm, sirkaMm: o.sirka.minMm }).druh
			).toBe('cena');
			expect(
				vypocitajCenuBazen({ model, dlzkaMm: o.dlzka.maxMm, sirkaMm: o.sirka.maxMm }).druh
			).toBe('cena');
			// o 500 mm širšie než max šírka → individuálna
			expect(
				vypocitajCenuBazen({ model, dlzkaMm: o.dlzka.maxMm, sirkaMm: o.sirka.maxMm + 500 }).druh
			).toBe('individualna-ponuka');
			// o 500 mm dlhšie než max dĺžka → individuálna
			expect(
				vypocitajCenuBazen({ model, dlzkaMm: o.dlzka.maxMm + 500, sirkaMm: o.sirka.maxMm }).druh
			).toBe('individualna-ponuka');
		});
	}
});

// WIRING + money-safety: `load` oboch route obálku pošle klientovi, a serializovaná obálka nesie LEN
// rozmery (žiadna cena/VO/Money kód — deep-equal na presnú rozmerovú štruktúru je najsilnejší dôkaz).
const { load: oplotenieLoad } = await import('../src/routes/konfigurator/oplotenie/+page.server');
const { load: bazenLoad } = await import('../src/routes/konfigurator/bazen/+page.server');

describe('#427 obálky — load() ich pošle klientovi (wiring)', () => {
	it('oplotenie load() nesie data.obalky === OPLOTENIE_OBALKY', async () => {
		const data = (await oplotenieLoad({} as Parameters<typeof oplotenieLoad>[0])) as {
			obalky: typeof OPLOTENIE_OBALKY;
		};
		expect(data.obalky).toEqual(OPLOTENIE_OBALKY);
		// serializovaná obálka = LEN rozmery (žiadna cena/€/VO/Money kód)
		const json = JSON.stringify(data.obalky);
		expect(json).not.toMatch(/€|EUR\b|cena|priceB2B|cennik|moneyKod|hladina/i);
	});

	it('bazén load() nesie data.obalky === BAZEN_OBALKY', async () => {
		const data = (await bazenLoad({} as Parameters<typeof bazenLoad>[0])) as {
			obalky: typeof BAZEN_OBALKY;
		};
		expect(data.obalky).toEqual(BAZEN_OBALKY);
		const json = JSON.stringify(data.obalky);
		expect(json).not.toMatch(/€|EUR\b|cena|priceB2B|cennik|moneyKod|hladina/i);
	});
});
