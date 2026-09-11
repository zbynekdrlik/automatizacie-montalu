// #235 slice 2 — vlastná (nekatalógová) skladba skla „Iné (vlastná skladba)" v nárezáku.
//
// Patrik (úloha 625) objednáva aj skladby, ktoré nie sú v katalógu (napr. „5esg/14/5esg").
// Voľba SKLO_INE + hrúbková trieda skladby (4/6/10/16/24 mm) dáva syntetické sklo, ktoré sa
// počíta BIT-IDENTICKY ako katalógové sklo tej istej triedy; text ide na plán/tlač/objednávku,
// cena je honest-null. Tento test dokazuje: (1) compute-ekvivalenciu s katalógom, (2) tesnenie
// (Money) podľa triedy, (3) honest-null cenu, (4) serverovú validáciu, (5) perzistenciu detailu
// + „Použiť znova", (6) multi-posuv cestu + objednávku skla. NIČ test-related nesmie ísť do
// ostrého Money (MONEY_LIVE=0).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SKLO_INE, ineHrubka, ineHrubkaTrieda, jeSkloTrieda } from '../src/lib/sklo';
import { klasifikujSkloPreTesnenie } from '../src/lib/tesnenie';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-vlastna-skladba-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { db } = await import('../src/lib/server/db');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { znovaZOdpisu } = await import('../src/lib/server/znova');

const USER = { id: 1, username: 'tester', role: 'internal' as const };

function callAction(
	name: 'nahlad' | 'odoslat' | 'nahladMulti' | 'pridatSklaMulti',
	o: Record<string, string>
) {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	const event = {
		request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
		locals: { user: USER }
	};
	// akcie majú per-route RequestEvent typ; v teste im stačí request+locals (rovnaký vzor
	// ako existujúce testy s `as Parameters<...>[0]`, tu generický cez `as unknown as`)
	const fn = actions[name] as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
	return fn(event);
}
const nahlad = (o: Record<string, string>) => callAction('nahlad', o);
const odoslat = (o: Record<string, string>) => callAction('odoslat', o);
const nahladMulti = (o: Record<string, string>) => callAction('nahladMulti', o);

const lastDetail = () =>
	JSON.parse(
		(
			db.prepare('SELECT detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
				detail: string;
			}
		).detail
	);
const lastId = () =>
	(db.prepare('SELECT id FROM odpis_log ORDER BY id DESC LIMIT 1').get() as { id: number }).id;

// Slide potrebuje farebný kód R7016 (R9005 zámok má 0 ks sklad) — inak by odoslanie padlo.
const SLIDE = {
	op: '01',
	zakaznik: 'X',
	system: 'Slide',
	styl: '3K',
	s: '3000',
	v: '2000',
	otvaranie: 'P - L',
	farbaKovania: 'R7016'
};
const STDPLUS = {
	op: '01',
	zakaznik: 'X',
	system: 'Štandard +',
	styl: '4K',
	s: '3000',
	v: '2000',
	otvaranie: 'P - L'
};

// ---- (1) tesnenie klasifikácia z triedy (pure) — vlastné sklo ----

describe('klasifikujSkloPreTesnenie — vlastná skladba klasifikuje z triedy (#235 slice 2)', () => {
	it('trieda mapuje na Dominikovo pravidlo', () => {
		expect(klasifikujSkloPreTesnenie(SKLO_INE, 4)).toBe('tesnenie4');
		expect(klasifikujSkloPreTesnenie(SKLO_INE, 6)).toBe('tesnenie6');
		expect(klasifikujSkloPreTesnenie(SKLO_INE, 10)).toBe('nezname');
		expect(klasifikujSkloPreTesnenie(SKLO_INE, 16)).toBe('izolacne');
		expect(klasifikujSkloPreTesnenie(SKLO_INE, 24)).toBe('izolacne');
	});
	it('katalógové sklo (bez triedy) ostáva name-based — bit-identické', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 4 mm')).toBe('tesnenie4');
		expect(klasifikujSkloPreTesnenie('Float sklo 6 mm')).toBe('tesnenie6');
		expect(klasifikujSkloPreTesnenie('Izolačné sklo 4/8/4 číre')).toBe('izolacne');
		expect(klasifikujSkloPreTesnenie('Float sklo 10 mm')).toBe('nezname');
	});
});

// ---- (2) compute-ekvivalencia s katalógom (Slide redukcia_zero z triedy) ----

describe('vlastná skladba sa počíta ako katalógové sklo tej istej triedy (#235 slice 2)', () => {
	it('Slide vlastná IZO (24) = katalógová IZO; vlastná (6) = 6mm; navzájom sa líšia (redukcia)', async () => {
		const izoKatalog = (await nahlad({
			...SLIDE,
			sklo: 'Izolačné sklo 4/8/4 číre',
			zak: 'ZAK-C1'
		})) as Record<string, unknown>;
		const izoVlastna = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: '24',
			zak: 'ZAK-C2'
		})) as Record<string, unknown>;
		const sklo6Katalog = (await nahlad({ ...SLIDE, sklo: '6mm číre', zak: 'ZAK-C3' })) as Record<
			string,
			unknown
		>;
		const sklo6Vlastna = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: ' nejaké 6 sklo ',
			skloTrieda: '6',
			zak: 'ZAK-C4'
		})) as Record<string, unknown>;

		for (const r of [izoKatalog, izoVlastna, sklo6Katalog, sklo6Vlastna])
			expect(r.step).toBe('nahlad');
		const odpis = (r: Record<string, unknown>) =>
			JSON.stringify((r.plan as { odpis: unknown }).odpis);

		// vlastná IZO 24 (hrubkaTrieda 16 → redukcia_zero=true) == katalógová Slide IZO
		expect(odpis(izoVlastna)).toBe(odpis(izoKatalog));
		// vlastná trieda 6 (redukcia_zero=false) == katalógové 6mm
		expect(odpis(sklo6Vlastna)).toBe(odpis(sklo6Katalog));
		// a IZO vs 6mm sa v Slide LÍŠIA (dôkaz, že trieda naozaj riadi redukciu)
		expect(odpis(izoVlastna)).not.toBe(odpis(sklo6Vlastna));
	});
});

// ---- (3) honest-null cena ----

describe('vlastná skladba má honest-null cenu (#235 slice 2)', () => {
	it('skloCeny variant = sentinel → eurM2 null („cena nedostupná")', async () => {
		const r = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: '24',
			zak: 'ZAK-P1'
		})) as Record<string, unknown>;
		expect(r.step).toBe('nahlad');
		const sc = r.skloCeny as {
			radky: { eurM2: number | null; spolu: number | null }[];
			kompletne: boolean;
		};
		expect(sc.radky[0]!.eurM2).toBeNull();
		expect(sc.radky[0]!.spolu).toBeNull();
	});
});

// ---- (4) tesnenie v Money odpise podľa triedy (Štandard +) ----

describe('vlastná skladba — tesnenie (Money) podľa triedy v Štandard + (#235 slice 2)', () => {
	const kodySkla = async (skloTrieda: string) => {
		const r = (await nahlad({
			...STDPLUS,
			sklo: SKLO_INE,
			skloPresne: 'vlastné ' + skloTrieda,
			skloTrieda,
			zak: 'ZAK-T' + skloTrieda
		})) as Record<string, unknown>;
		expect(r.step).toBe('nahlad');
		return (r.kovanie as { kod: string }[]).map((p) => p.kod);
	};
	it('trieda 6 → ZASK00006 v odpise', async () => {
		expect(await kodySkla('6')).toContain('ZASK00006');
	});
	it('trieda 4 → ZASK00005 v odpise', async () => {
		expect(await kodySkla('4')).toContain('ZASK00005');
	});
	it('trieda 24 (izolačné) → žiadne zasklievacie tesnenie (bez gumy)', async () => {
		const kody = await kodySkla('24');
		expect(kody).not.toContain('ZASK00005');
		expect(kody).not.toContain('ZASK00006');
	});
});

// ---- (5) serverová validácia ----

describe('vlastná skladba — serverová validácia (#235 slice 2)', () => {
	it('„Iné" bez textu skladby → chyba', async () => {
		const r = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloTrieda: '24',
			skloPresne: '',
			zak: 'ZAK-V1'
		})) as Record<string, unknown>;
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('zloženie skla');
	});
	it('„Iné" bez triedy → chyba', async () => {
		const r = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			zak: 'ZAK-V2'
		})) as Record<string, unknown>;
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('triedu');
	});
	it('„Iné" s neplatnou triedou (99) → chyba (triedu)', async () => {
		const r = (await nahlad({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: 'x',
			skloTrieda: '99',
			zak: 'ZAK-V3'
		})) as Record<string, unknown>;
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('triedu');
	});
});

// ---- (6) perzistencia detailu + „Použiť znova" ----

describe('vlastná skladba — detail + „Použiť znova" (#235 slice 2)', () => {
	it('detail nesie text (sklo), sentinel (skloZaklad) a triedu; znova ich obnoví', async () => {
		const r = (await odoslat({
			...SLIDE,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: '24',
			zak: 'ZAK-D1',
			op: '01',
			zakaznik: 'X'
		})) as Record<string, unknown>;
		expect(r.step).toBe('hotovo');
		expect(lastDetail()).toMatchObject({
			sklo: '5esg/14/5esg',
			skloZaklad: SKLO_INE,
			skloTrieda: 24
		});
		const znova = znovaZOdpisu(lastId());
		expect(znova?.vstup).toMatchObject({
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: 24
		});
		expect(znova?.chybajuce).toEqual([]); // sentinel sa NESMIE ohlásiť ako „neponúka sa"
	});
});

// ---- (7) multi-posuv (zimná záhrada) + objednávka skla ----

describe('vlastná skladba — multi-posuv cesta (#235 slice 2)', () => {
	const multiBase = { zak: 'ZAK-M1', op: '01', zakaznik: 'X', farbaKovania: 'R7016' };
	const posuvyJSON = JSON.stringify([
		{
			system: 'Slide',
			styl: '3K',
			s: '3000',
			v: '2000',
			sklo: 'Izolačné sklo 4/8/4 číre',
			otvaranie: 'P - L'
		},
		{
			system: 'Slide',
			styl: '3K',
			s: '3000',
			v: '2000',
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: 24,
			otvaranie: 'P - L'
		}
	]);

	it('nahladMulti spočíta vlastnú skladbu v druhom posuve (bez pádu, text na pláne)', async () => {
		const r = (await nahladMulti({ ...multiBase, posuvy: posuvyJSON })) as Record<string, unknown>;
		expect(r.step).toBe('nahladMulti');
		// PosuvInfo.skloNazov (display echo do plánu) druhého posuvu = TEXT, nie sentinel
		const posuvy = (r.multi as { posuvy: { skloNazov: string }[] }).posuvy;
		expect(posuvy[1]!.skloNazov).toBe('5esg/14/5esg');
	});

	it('objednávka skla (multi) preberie TEXT skladby ako typSkla', async () => {
		// pridatSklaMulti spraví INSERT, potom redirect(303) — SvelteKit redirect je throw;
		// insert prebehne PRED ním, takže redirect zachytíme a overíme DB.
		await callAction('pridatSklaMulti', { ...multiBase, zak: 'ZAK-M2', posuvy: posuvyJSON }).catch(
			() => undefined
		);
		const rows = db
			.prepare('SELECT typ_skla FROM objednavka_skla WHERE zak = ? ORDER BY id')
			.all('ZAK-M2') as { typ_skla: string }[];
		// 2 posuvy → 2 riadky; druhý je vlastná skladba
		expect(rows.map((r) => r.typ_skla)).toContain('5esg/14/5esg');
	});
});

// ---- (8) čisté helpery odvodenia syntetického skla z triedy ----

describe('sklo.ts helpery — odvodenie syntetického skla z triedy (#235 slice 2)', () => {
	it('jeSkloTrieda akceptuje len 4/6/10/16/24', () => {
		for (const t of [4, 6, 10, 16, 24]) expect(jeSkloTrieda(t)).toBe(true);
		for (const t of [0, 5, 8, 20, 99, '6', null, undefined]) expect(jeSkloTrieda(t)).toBe(false);
	});
	it('ineHrubkaTrieda: 4/6/10 → 6 (jednoduché), 16/24 → 16 (izolačné)', () => {
		expect(ineHrubkaTrieda(4)).toBe(6);
		expect(ineHrubkaTrieda(6)).toBe(6);
		expect(ineHrubkaTrieda(10)).toBe(6);
		expect(ineHrubkaTrieda(16)).toBe(16);
		expect(ineHrubkaTrieda(24)).toBe(16);
	});
	it('ineHrubka: Deluxe 10 → 10, Deluxe iné → 6, mimo Deluxe → 0 (bit-identické s katalógom)', () => {
		expect(ineHrubka('Deluxe', 10)).toBe(10);
		expect(ineHrubka('Deluxe', 6)).toBe(6);
		expect(ineHrubka('Deluxe', 4)).toBe(6);
		expect(ineHrubka('Deluxe', 24)).toBe(6);
		expect(ineHrubka('Slide', 10)).toBe(0);
		expect(ineHrubka('Robust', 24)).toBe(0);
		expect(ineHrubka('Štandard +', 6)).toBe(0);
	});
});

// ---- (9) Deluxe: vlastná trieda 6/10 vyberá kladka/klzný ako katalógové Float kalené ----

describe('vlastná skladba — Deluxe hrubka (kladka/klzný) podľa triedy (#235 slice 2)', () => {
	const DELUXE = {
		op: '01',
		zakaznik: 'X',
		system: 'Deluxe',
		styl: '3K',
		s: '3000',
		v: '2000',
		otvaranie: 'P - L',
		farbaKovania: 'R9006' // Deluxe 10mm krytky (#354)
	};
	const odpisJSON = (r: Record<string, unknown>) =>
		JSON.stringify((r.plan as { odpis: unknown }).odpis);

	it('vlastná (10) = Float kalené 10 mm; vlastná (6) = Float kalené 6 mm; 6 vs 10 sa líšia', async () => {
		const kat10 = (await nahlad({
			...DELUXE,
			sklo: 'Float kalené 10 mm',
			zak: 'ZAK-DX1'
		})) as Record<string, unknown>;
		const vl10 = (await nahlad({
			...DELUXE,
			sklo: SKLO_INE,
			skloPresne: 'vlastné 10',
			skloTrieda: '10',
			zak: 'ZAK-DX2'
		})) as Record<string, unknown>;
		const kat6 = (await nahlad({ ...DELUXE, sklo: 'Float kalené 6 mm', zak: 'ZAK-DX3' })) as Record<
			string,
			unknown
		>;
		const vl6 = (await nahlad({
			...DELUXE,
			sklo: SKLO_INE,
			skloPresne: 'vlastné 6',
			skloTrieda: '6',
			zak: 'ZAK-DX4'
		})) as Record<string, unknown>;
		for (const r of [kat10, vl10, kat6, vl6]) expect(r.step).toBe('nahlad');
		// hrubka 10 vyberá iný kladka/klzný profil než hrubka 6 → odpis sa líši
		expect(odpisJSON(vl10)).toBe(odpisJSON(kat10));
		expect(odpisJSON(vl6)).toBe(odpisJSON(kat6));
		expect(odpisJSON(vl10)).not.toBe(odpisJSON(vl6));
	});
});

// ---- (10) RED-1: system×štýl IZO gate — vlastná IZO nesmie obísť katalógový filter ----

describe('vlastná skladba — IZO gate (RED-1, #235 slice 2)', () => {
	const odpisJSON = (r: Record<string, unknown>) =>
		JSON.stringify((r.plan as { odpis: unknown }).odpis);

	// #504 (round 3) pridal Štandard + opona IZO nárezáky (2x2K/2x3K/2x4K IZO — 2x4K
	// overený 1:1 z Money, 2x2K/2x3K ODVODENÉ, `SYSSTYL_ODVODENE`) — tento test bol
	// pôvodne NEGATÍVNY príklad ("opona nemá IZO nárezák"), ale tá premisa je teraz
	// neplatná: `cfg_seed.json` má „Štandard +|2x2K IZO" aj „…|2x3K IZO" aj „…|2x4K IZO",
	// takže KAŽDÝ Štandard/Štandard + štýl (basic aj opona) má IZO náprotivok a gate
	// (`skloPre` v `+page.server.ts`) ho pre TIETO dva systémy už nikdy neodmietne —
	// negatívna vetva (system×štýl bez IZO nárezáku) nie je s aktuálnym seedom
	// dosiahnuteľná. Test je preto prevedený na POZITÍVNY prípad (rovnaký vzor ako
	// susedný „Štandard + 4K" test nižšie) — dokazuje, že vlastná IZO skladba na opone
	// teraz prejde a počíta identicky ako katalógová IZO.
	it('Štandard + opona (2x2K, IZO nárezák pridaný #504) + Iné + trieda 24 → PRIJATÉ (== katalógová IZO)', async () => {
		const base = {
			op: '01',
			zakaznik: 'X',
			system: 'Štandard +',
			styl: '2x2K',
			s: '3000',
			v: '2000',
			otvaranie: 'Opona'
		};
		const kat = (await nahlad({
			...base,
			sklo: 'Izolačné sklo 4/8/4 číre',
			zak: 'ZAK-G1'
		})) as Record<string, unknown>;
		const vl = (await nahlad({
			...base,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: '24',
			zak: 'ZAK-G1b'
		})) as Record<string, unknown>;
		expect(kat.step).toBe('nahlad'); // #504: opona 2x2K IZO nárezák existuje
		expect(vl.step).toBe('nahlad');
		expect(odpisJSON(vl)).toBe(odpisJSON(kat)); // vlastná IZO == katalógová IZO (IZO nárezák)
	});

	it('Štandard + 4K (IZO nárezák existuje) + Iné + 24 = katalógová IZO 4/8/4 (IZO nárezák)', async () => {
		const kat = (await nahlad({
			...STDPLUS,
			sklo: 'Izolačné sklo 4/8/4 číre',
			zak: 'ZAK-G2'
		})) as Record<string, unknown>;
		const vl = (await nahlad({
			...STDPLUS,
			sklo: SKLO_INE,
			skloPresne: '5esg/14/5esg',
			skloTrieda: '24',
			zak: 'ZAK-G3'
		})) as Record<string, unknown>;
		expect(kat.step).toBe('nahlad'); // IZO nárezák pre 4K existuje (inak by bol filtrovaný)
		expect(vl.step).toBe('nahlad');
		expect(odpisJSON(vl)).toBe(odpisJSON(kat)); // vlastná IZO == katalógová IZO (IZO nárezák)
	});

	it('Robust (Money-neutrálne sklo) + Iné + 24 = katalógová Robust IZO 4/16/4', async () => {
		const base = {
			op: '01',
			zakaznik: 'X',
			system: 'Robust',
			styl: '2K',
			s: '3000',
			v: '2000',
			otvaranie: 'P - L',
			farbaKovania: 'R9005' // Robust kovanie má farebný variant (#338) — inak nahlad padne
		};
		const kat = (await nahlad({
			...base,
			sklo: 'Izolačné sklo 4/16/4 číre',
			zak: 'ZAK-G4'
		})) as Record<string, unknown>;
		const vl = (await nahlad({
			...base,
			sklo: SKLO_INE,
			skloPresne: 'čokoľvek',
			skloTrieda: '24',
			zak: 'ZAK-G5'
		})) as Record<string, unknown>;
		expect(kat.step).toBe('nahlad');
		expect(vl.step).toBe('nahlad');
		expect(odpisJSON(vl)).toBe(odpisJSON(kat)); // Robust: sklo Money-neutrálne → identické
	});
});

// ---- (11) multi-posuv serverová validácia vlastnej skladby ----

describe('vlastná skladba — multi validácia (#235 slice 2)', () => {
	const posuvIne = (extra: Record<string, unknown>) =>
		JSON.stringify([
			{
				system: 'Slide',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Izolačné sklo 4/8/4 číre',
				otvaranie: 'P - L'
			},
			{
				system: 'Slide',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: SKLO_INE,
				otvaranie: 'P - L',
				...extra
			}
		]);
	const base = { zak: 'ZAK-MV', op: '01', zakaznik: 'X', farbaKovania: 'R7016' };

	it('posuv „Iné" bez textu → chyba (zloženie skla)', async () => {
		const r = (await nahladMulti({ ...base, posuvy: posuvIne({ skloTrieda: 24 }) })) as Record<
			string,
			unknown
		>;
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('zloženie skla');
	});
	it('posuv „Iné" bez triedy → chyba (trieda)', async () => {
		const r = (await nahladMulti({
			...base,
			posuvy: posuvIne({ skloPresne: '5esg/14/5esg' })
		})) as Record<string, unknown>;
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('triedu');
	});
});
