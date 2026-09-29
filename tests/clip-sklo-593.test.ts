// #593 (Odoo úlohy 1214/1216/1217, Marek 29.9.): CLIP zábradlie
//   (1) výplň ponúka Odoo sklá 6 mm (jednoduché → šablóna `klasika`) a 16 mm (izolačné → `izo`) —
//       ten istý mechanizmus ako nárezák zasklení (#579/#594): `cfg_sklo_hrubka` systém „CLIP",
//       ponuka len Odoo typov, pri nedostupnom Odoo dnešné dve voľby. Money odpis sa NEMENÍ.
//   (2) „Pridať sklá do objednávky" — producent `objednavka_skla` modul `clip`: na zábradlie jeden
//       riadok „Zábradlie i" s N kusmi rozmeru výplne (šablóny Patrika), idempotentne.
//   (3) nové zábradlie preberá RAL farbu prvého (kým ju obsluha ručne nezmení).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ODOO_KATALOG_579, type OdooRow } from './fixtures/odoo-glass-types-579';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clip-sklo-593-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { fetchGlassTypes, _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const { skloHrubkyPre } = await import('../src/lib/server/sklo-hrubky');
const {
	CLIP_SYSTEM,
	lokalnySkloClip,
	ponukaSkielClip,
	parseClipVstupSOdoo,
	parseClipMultiVstupSOdoo,
	sklaClip
} = await import('../src/lib/server/clip-sklo');
const { volbaSkla, rozlozVolbu } = await import('../src/lib/sklo-odoo');
const { computeClip, rozmerSklaClip, ralZabradlia, bezZabradlia, CLIP_VYPLN_POPIS } =
	await import('../src/lib/clip');
const { parseClipVstup } = await import('../src/lib/server/vstup');
const clip = await import('../src/routes/clip/+page.server');
const { db } = await import('../src/lib/server/db');
const { listSklaPreZakazku, pridajSklo } = await import('../src/lib/server/objednavka-skla');

function odooOn(rows: OdooRow[] = ODOO_KATALOG_579) {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async () => new Response(JSON.stringify(rows), { status: 200 }));
}
function odooOff() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async () => new Response('boom', { status: 500 }));
}

beforeEach(() => {
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});
afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

function fd(body: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return f;
}
function ev(body: Record<string, string>, username = 'tester') {
	return {
		request: new Request('http://x/clip', { method: 'POST', body: fd(body) }),
		locals: { user: { id: 1, username, role: 'internal' } }
	} as never;
}

const vsetky = <T>(sk: { items: T[] }[]): T[] => sk.flatMap((g) => g.items);
const IZO_484 = 'Izolačné sklo 4/8/4- číre (Ug=1,1)';

describe('#593 (1) povolené hrúbky CLIP v cfg_sklo_hrubka', () => {
	it('čerstvá DB má CLIP 6 mm jednoduché + 16 mm izolačné', () => {
		expect(CLIP_SYSTEM).toBe('CLIP');
		expect(skloHrubkyPre('CLIP').map((h) => ({ mm: h.mm, druh: h.druh }))).toEqual([
			{ mm: 6, druh: 'jednoduche' },
			{ mm: 16, druh: 'izolacne' }
		]);
	});
});

describe('#593 (1) ponuka výplne CLIP z Odoo', () => {
	it('Odoo dostupné: LEN Odoo typy 6 mm jednoduché (→ klasika) a 16 mm izolačné (→ izo)', async () => {
		odooOn();
		const p = ponukaSkielClip(await fetchGlassTypes());
		const v = vsetky(p.skupiny);
		expect(p.skupiny.every((g) => g.label.startsWith('Odoo — '))).toBe(true);
		expect(v.every((o) => o.value.startsWith('odoo:') && o.odoo !== '')).toBe(true);
		const izo = v.filter((o) => o.vypocet === 'izo').map((o) => o.nazov);
		const klasika = v.filter((o) => o.vypocet === 'klasika').map((o) => o.nazov);
		expect(izo.sort()).toEqual(
			['IZOS DOUBLE 3.3.1-6-4 (VSG)', 'IZOS DOUBLE 6-6-4', IZO_484].sort()
		);
		expect(klasika.sort()).toEqual(
			[
				'Drôtené sklo 6mm',
				'ESG Float bronz/šedý 6mm',
				'ESG Float čirý 6mm',
				'ESG Stopsol Classic Clear 6mm',
				'Float bronz/šedý 6mm',
				'Float čirý 6mm',
				'VSG 33.1',
				'VSG 33.2'
			].sort()
		);
		// 16 mm jednosklo (VSG 88.2), 24 mm izolačné, 4/10 mm sa neponúkajú
		expect(v.map((o) => o.nazov)).not.toContain('VSG 88.2');
		expect(v.map((o) => o.nazov)).not.toContain('IZOS DOUBLE 4-16-4 TH');
		expect(v.map((o) => o.nazov)).not.toContain('Float čirý 4mm');
		expect(v.length).toBe(11);
	});

	it('predvolená voľba izo = presný Odoo náprotivok 4/8/4 číre; klasika = VSG 33.1', async () => {
		odooOn();
		const sk = ponukaSkielClip(await fetchGlassTypes()).skupiny;
		const izo = vsetky(sk).find((o) => o.value === volbaSkla('izo', '', sk))!;
		expect(izo.nazov).toBe(IZO_484);
		const kl = vsetky(sk).find((o) => o.value === volbaSkla('klasika', '', sk))!;
		expect(kl.nazov).toBe('VSG 33.1');
		// výber Odoo typu nastaví šablónu podľa druhu
		expect(rozlozVolbu(izo.value, sk)).toEqual({ sklo: 'izo', skloOdoo: izo.odoo });
		const float = vsetky(sk).find((o) => o.nazov === 'Float čirý 6mm')!;
		expect(rozlozVolbu(float.value, sk)).toEqual({ sklo: 'klasika', skloOdoo: 'OP003' });
	});

	it('Odoo nedostupné → dnešné dve voľby (izo / klasika), bez Odoo typu', async () => {
		odooOff();
		const p = ponukaSkielClip(await fetchGlassTypes());
		expect(p.skupiny).toHaveLength(1);
		expect(p.skupiny[0]!.items).toEqual([
			{
				value: 'izo',
				label: 'IZO (4-8-4)',
				nazov: 'IZO (4-8-4)',
				vypocet: 'izo',
				odoo: '',
				naprotivok: true
			},
			{
				value: 'klasika',
				label: 'klasika (3.3.1 číre)',
				nazov: 'klasika (3.3.1 číre)',
				vypocet: 'klasika',
				odoo: '',
				naprotivok: true
			}
		]);
		expect(CLIP_VYPLN_POPIS).toEqual({ izo: 'IZO (4-8-4)', klasika: 'klasika (3.3.1 číre)' });
	});

	it('CLIP bez povolených hrúbok → záloha (dve lokálne voľby), nie prázdny select', async () => {
		odooOn();
		const p = ponukaSkielClip(await fetchGlassTypes(), []);
		expect(vsetky(p.skupiny).map((o) => o.value)).toEqual(['izo', 'klasika']);
	});

	it('Odoo bez skla jednej šablóny → tá šablóna dostane lokálnu voľbu (vždy voliteľná)', async () => {
		odooOn(ODOO_KATALOG_579.filter((r) => r.total_thickness_mm !== 6));
		const sk = ponukaSkielClip(await fetchGlassTypes()).skupiny;
		const v = vsetky(sk);
		expect(v.filter((o) => o.vypocet === 'izo').every((o) => o.odoo !== '')).toBe(true);
		expect(v.filter((o) => o.vypocet === 'klasika')).toEqual([
			{
				value: 'klasika',
				label: 'klasika (3.3.1 číre)',
				nazov: 'klasika (3.3.1 číre)',
				vypocet: 'klasika',
				odoo: '',
				naprotivok: true
			}
		]);
		expect(volbaSkla('klasika', '', sk)).toBe('klasika');
		// a naopak bez 16 mm izolačných
		_resetGlassTypesCache();
		odooOn(ODOO_KATALOG_579.filter((r) => r.total_thickness_mm !== 16));
		const sk2 = ponukaSkielClip(await fetchGlassTypes()).skupiny;
		expect(
			vsetky(sk2)
				.filter((o) => o.vypocet === 'izo')
				.map((o) => o.value)
		).toEqual(['izo']);
		expect(vsetky(sk2).filter((o) => o.vypocet === 'klasika').length).toBeGreaterThan(1);
	});

	it('lokálny typ skla pre objednávku bez Odoo voľby = katalógový názov (matcher #556)', () => {
		expect(lokalnySkloClip('izo')).toBe('Izolačné sklo 4/8/4 číre');
		expect(lokalnySkloClip('klasika')).toBe('3.3.1');
	});
});

const HLAVA = { zak: 'Z593', op: 'OP593', zakaznik: 'Test 593' };

describe('#593 (1) server overí zvolený Odoo typ voči šablóne', () => {
	it('izolačný typ + izo → OK, doplní názov', async () => {
		odooOn();
		const r = await parseClipVstupSOdoo(
			fd({
				...HLAVA,
				typ: 'izo',
				variant: '2',
				sirka: '3000',
				vyska: '1000',
				skloOdoo: 'IZOS DOUBLE 6-6-4'
			})
		);
		expect(r.error).toBeNull();
		expect(r.vstup.skloOdoo).toBe('IZOS DOUBLE 6-6-4');
		expect(r.vstup.skloOdooNazov).toBe('IZOS DOUBLE 6-6-4');
	});

	it('izolačný typ + klasika → chyba (typ sa počíta šablónou IZO)', async () => {
		odooOn();
		const r = await parseClipVstupSOdoo(
			fd({
				...HLAVA,
				typ: 'klasika',
				variant: '2',
				sirka: '3000',
				vyska: '1000',
				skloOdoo: 'IZOS DOUBLE 6-6-4'
			})
		);
		expect(r.error).toMatch(/IZOS DOUBLE 6-6-4/);
	});

	it('neznámy / neponúkaný typ (24 mm) → chyba', async () => {
		odooOn();
		const r = await parseClipVstupSOdoo(
			fd({ ...HLAVA, typ: 'izo', variant: '2', sirka: '3000', vyska: '1000', skloOdoo: '003' })
		);
		expect(r.error).not.toBeNull();
	});

	it('Odoo nedostupné → typ prijatý bez overenia, bez názvu', async () => {
		odooOff();
		const r = await parseClipVstupSOdoo(
			fd({ ...HLAVA, typ: 'izo', variant: '2', sirka: '3000', vyska: '1000', skloOdoo: 'X' })
		);
		expect(r.error).toBeNull();
		expect(r.vstup.skloOdoo).toBe('X');
		expect(r.vstup.skloOdooNazov).toBeUndefined();
	});

	it('multi: chyba nesie číslo zábradlia', async () => {
		odooOn();
		const kusy = [
			{ typ: 'izo', variant: 1, sirka: 1500, vyska: 1000, ral: '', skloOdoo: IZO_484 },
			{ typ: 'izo', variant: 1, sirka: 1500, vyska: 1000, ral: '', skloOdoo: 'OP003' }
		];
		const r = await parseClipMultiVstupSOdoo(fd({ ...HLAVA, clipKusy: JSON.stringify(kusy) }));
		expect(r.error).toMatch(/^Zábradlie 2: /);
		expect(r.vstup.kusy[0]!.skloOdooNazov).toBe(IZO_484);
	});

	it('bez skloOdoo: vstup nemá kľúč skloOdoo (detail starých odpisov byte-identický)', () => {
		const { vstup } = parseClipVstup(
			fd({ ...HLAVA, typ: 'klasika', variant: '4', sirka: '3000', vyska: '1000' })
		);
		expect('skloOdoo' in vstup).toBe(false);
	});

	it('Money: výpočet s Odoo typom je identický ako bez neho', async () => {
		odooOn();
		const base = { ...HLAVA, typ: 'izo', variant: '3', sirka: '3000', vyska: '1200' };
		const s = await parseClipVstupSOdoo(fd({ ...base, skloOdoo: 'IZOS DOUBLE 6-6-4' }));
		const b = parseClipVstup(fd(base));
		expect(computeClip(s.vstup)).toEqual(computeClip(b.vstup));
	});

	it('odoslat: detail nesie zvolený Odoo typ (vstupRaw), odpis nezmenený', async () => {
		odooOn();
		const r = (await clip.actions.odoslat(
			ev({
				...HLAVA,
				zak: 'Z593-ODP',
				typ: 'izo',
				variant: '2',
				sirka: '3000',
				vyska: '1000',
				skloOdoo: IZO_484
			})
		)) as { step: string; finalOut: { kod: string; qty: number }[] };
		expect(r.step).toBe('hotovo');
		expect(Object.fromEntries(r.finalOut.map((o) => [o.kod, o.qty]))).toEqual({
			ZASP00116: 2,
			ZASP00125: 1,
			ZASP00119: 2
		});
		const detail = JSON.parse(
			(
				db.prepare('SELECT detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
					detail: string;
				}
			).detail
		);
		expect(detail.vstupRaw.skloOdoo).toBe(IZO_484);
		expect(detail.vstupRaw.skloOdooNazov).toBe(IZO_484);
	});
});

describe('#593 (2) rozmer skla výplne a producent riadkov', () => {
	it('rozmer skla = rozmer výplne zo šablóny, zaokrúhlený na mm (zo surovej hodnoty)', () => {
		// izo B1 3000×1000: (3000 − 77)/2 − 8 = 1453,5 → 1454; 1000 − 56 = 944
		expect(rozmerSklaClip({ variant: 2, sirka: 3000, vyska: 1000 })).toEqual({
			sirka: 1454,
			vyska: 944
		});
		// N=3 3000×1200: (3000 − 106)/3 − 8 = 956,666… → 957
		expect(rozmerSklaClip({ variant: 3, sirka: 3000, vyska: 1200 })).toEqual({
			sirka: 957,
			vyska: 1144
		});
		// surová 1000,45 by po R1 (1000,5) dala 1001 — musí byť 1000
		expect(rozmerSklaClip({ variant: 1, sirka: 1056.45, vyska: 1000 }).sirka).toBe(1000);
	});

	it('2 zábradlia N=3 → 2 riadky × 3 ks rozmeru výplne, typ = Odoo typ alebo lokálny', () => {
		const kus = (typ: 'izo' | 'klasika', sirka: number, skloOdoo?: string) => ({
			...HLAVA,
			caka: false,
			typ,
			variant: 3,
			sirka,
			vyska: 1200,
			ral: '',
			...(skloOdoo ? { skloOdoo } : {})
		});
		const s = sklaClip([kus('izo', 3000, 'IZOS DOUBLE 6-6-4'), kus('klasika', 2400)], {
			zak: 'Z593',
			op: 'OP593',
			createdBy: 'tester'
		});
		expect(s).toEqual([
			{
				zak: 'Z593',
				op: 'OP593',
				modul: 'clip',
				popis: 'Zábradlie 1',
				sirkaMm: 957,
				vyskaMm: 1144,
				pocet: 3,
				typSkla: 'IZOS DOUBLE 6-6-4',
				m2: (957 * 1144 * 3) / 1e6,
				createdBy: 'tester'
			},
			{
				zak: 'Z593',
				op: 'OP593',
				modul: 'clip',
				popis: 'Zábradlie 2',
				sirkaMm: 757,
				vyskaMm: 1144,
				pocet: 3,
				typSkla: '3.3.1',
				m2: (757 * 1144 * 3) / 1e6,
				createdBy: 'tester'
			}
		]);
	});
});

type SklaVysledok = {
	step: string;
	sklaPridane: { pridane: number; zak: string; upozornenieCudzie: string | null };
	error?: string;
};

describe('#593 (2) akcie pridatSkla / pridatSklaMulti', () => {
	it('single: vloží „Zábradlie 1" (N ks), ostane na kontrole, opakovanie neduplikuje', async () => {
		odooOff();
		const body = {
			...HLAVA,
			zak: 'Z593-S',
			typ: 'izo',
			variant: '2',
			sirka: '3000',
			vyska: '1000'
		};
		const r1 = (await clip.actions.pridatSkla(ev(body))) as SklaVysledok;
		expect(r1.step).toBe('kontrola');
		expect(r1.sklaPridane).toEqual({ pridane: 1, zak: 'Z593-S', upozornenieCudzie: null });
		const rows = listSklaPreZakazku('Z593-S');
		expect(
			rows.map((p) => [p.modul, p.popis, p.sirkaMm, p.vyskaMm, p.pocet, p.typSkla, p.op])
		).toEqual([['clip', 'Zábradlie 1', 1454, 944, 2, 'Izolačné sklo 4/8/4 číre', 'OP593']]);
		const r2 = (await clip.actions.pridatSkla(ev(body))) as SklaVysledok;
		expect(r2.sklaPridane.pridane).toBe(0);
		expect(listSklaPreZakazku('Z593-S')).toHaveLength(1);
	});

	it('single: zvolený Odoo typ ide do objednávky presne', async () => {
		odooOn();
		await clip.actions.pridatSkla(
			ev({
				...HLAVA,
				zak: 'Z593-O',
				typ: 'klasika',
				variant: '1',
				sirka: '1500',
				vyska: '1000',
				skloOdoo: 'OP003'
			})
		);
		expect(listSklaPreZakazku('Z593-O').map((p) => p.typSkla)).toEqual(['OP003']);
	});

	it('single: neplatný vstup → form s chybou, nič sa nevloží', async () => {
		odooOff();
		const r = (await clip.actions.pridatSkla(
			ev({ ...HLAVA, zak: 'Z593-E', typ: 'izo', variant: '4', sirka: '100', vyska: '1000' })
		)) as SklaVysledok;
		expect(r.step).toBe('form');
		expect(r.error).toBeTruthy();
		expect(listSklaPreZakazku('Z593-E')).toHaveLength(0);
	});

	it('multi: 2 zábradlia N=3 → 2 riadky × 3 ks, idempotentne, kontrolaMulti', async () => {
		odooOff();
		const kusy = [
			{ typ: 'izo', variant: 3, sirka: 3000, vyska: 1200, ral: '' },
			{ typ: 'klasika', variant: 3, sirka: 2400, vyska: 1200, ral: '' }
		];
		const body = { ...HLAVA, zak: 'Z593-M', clipKusy: JSON.stringify(kusy) };
		const r1 = (await clip.actions.pridatSklaMulti(ev(body))) as SklaVysledok;
		expect(r1.step).toBe('kontrolaMulti');
		expect(r1.sklaPridane.pridane).toBe(2);
		expect(
			listSklaPreZakazku('Z593-M').map((p) => [p.popis, p.sirkaMm, p.vyskaMm, p.pocet, p.typSkla])
		).toEqual([
			['Zábradlie 1', 957, 1144, 3, 'Izolačné sklo 4/8/4 číre'],
			['Zábradlie 2', 757, 1144, 3, '3.3.1']
		]);
		const r2 = (await clip.actions.pridatSklaMulti(ev(body))) as SklaVysledok;
		expect(r2.sklaPridane.pridane).toBe(0);
		expect(listSklaPreZakazku('Z593-M')).toHaveLength(2);
	});

	it('podklad s riadkami iného používateľa → upozornenie (nie blok)', async () => {
		odooOff();
		pridajSklo({
			zak: 'Z593-C',
			modul: 'manual',
			popis: 'V.O.',
			sirkaMm: 500,
			vyskaMm: 400,
			pocet: 1,
			typSkla: 'Float 4',
			createdBy: 'alice'
		});
		const r = (await clip.actions.pridatSkla(
			ev({ ...HLAVA, zak: 'Z593-C', typ: 'izo', variant: '1', sirka: '1500', vyska: '1000' }, 'bob')
		)) as SklaVysledok;
		expect(r.sklaPridane.pridane).toBe(1);
		expect(r.sklaPridane.upozornenieCudzie).toMatch(/alice/);
	});
});

describe('#593 (3) RAL farba nového zábradlia', () => {
	it('ďalšie zábradlie bez ručnej zmeny preberá farbu prvého', () => {
		const kusy = [{ ral: 'RAL 7016' }, { ral: '' }, { ral: '' }];
		expect(ralZabradlia(kusy, 0)).toBe('RAL 7016');
		expect(ralZabradlia(kusy, 1)).toBe('RAL 7016');
		expect(ralZabradlia(kusy, 2)).toBe('RAL 7016');
	});

	it('ručne zmenená farba sa zmenou prvého neprepíše', () => {
		const kusy = [
			{ ral: 'RAL 9005' },
			{ ral: 'RAL 7016', ralVlastna: true },
			{ ral: '', ralVlastna: false }
		];
		expect(ralZabradlia(kusy, 1)).toBe('RAL 7016');
		expect(ralZabradlia(kusy, 2)).toBe('RAL 9005');
		// aj ručne vymazaná farba ostane prázdna (obsluha to tak chcela)
		expect(ralZabradlia([{ ral: 'RAL 9005' }, { ral: '', ralVlastna: true }], 1)).toBe('');
	});

	it('odstránenie PRVÉHO zábradlia: preberajúce si farbu ponechajú, ručná ostane ručná', () => {
		const kusy = [
			{ id: 'a', ral: 'RAL 7016' },
			{ id: 'b', ral: '' },
			{ id: 'c', ral: 'RAL 3000', ralVlastna: true },
			{ id: 'd', ral: '' }
		];
		const r = bezZabradlia(kusy, 0);
		expect(r.map((k) => k.id)).toEqual(['b', 'c', 'd']);
		expect(r.map((_, i) => ralZabradlia(r, i))).toEqual(['RAL 7016', 'RAL 3000', 'RAL 7016']);
		// zmena nového prvého sa prenesie len do preberajúceho (d), nie do ručného (c)
		const zmena = r.map((k, i) => (i === 0 ? { ...k, ral: 'RAL 9005' } : k));
		expect(zmena.map((_, i) => ralZabradlia(zmena, i))).toEqual([
			'RAL 9005',
			'RAL 3000',
			'RAL 9005'
		]);
		expect(kusy[1]!.ral).toBe(''); // vstup sa nemení (čistá funkcia)
	});

	it('odstránenie iného než prvého / neplatný index / posledné zábradlie', () => {
		const kusy = [{ ral: 'RAL 7016' }, { ral: '' }, { ral: '' }];
		const r = bezZabradlia(kusy, 1);
		expect(r).toEqual([{ ral: 'RAL 7016' }, { ral: '' }]);
		expect(ralZabradlia(r, 1)).toBe('RAL 7016');
		expect(bezZabradlia(kusy, 7)).toEqual(kusy);
		expect(bezZabradlia(kusy, -1)).toEqual(kusy);
		expect(bezZabradlia([{ ral: 'X' }], 0)).toEqual([{ ral: 'X' }]);
	});

	it('index mimo poľa → prázdna farba', () => {
		expect(ralZabradlia([], 0)).toBe('');
		expect(ralZabradlia([{ ral: 'RAL 9005' }], 3)).toBe('');
	});
});

describe('#593 page load /clip', () => {
	it('load vracia ponuku výplne (Odoo → Odoo voľby; nedostupné → izo/klasika)', async () => {
		odooOn();
		const on = (await clip.load({} as never)) as {
			live: boolean;
			ponukaSkiel: { skupiny: { items: { odoo: string }[] }[] };
		};
		expect(on.live).toBe(false);
		expect(vsetky(on.ponukaSkiel.skupiny).every((o) => o.odoo !== '')).toBe(true);
		_resetGlassTypesCache();
		odooOff();
		const off = (await clip.load({} as never)) as {
			ponukaSkiel: { skupiny: { items: { value: string }[] }[] };
		};
		expect(vsetky(off.ponukaSkiel.skupiny).map((o) => o.value)).toEqual(['izo', 'klasika']);
	});
});
