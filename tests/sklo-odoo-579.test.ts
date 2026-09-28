// #579 (owner 28.9.: „v odoo je vela skiel, 24mm hrubka a maju byt pre typ robust ak pouziva 24mm
// tak ma mu ponuknut vsetky skla z tou hrubkou"): nárezák zasklení ponúka v „Sklo (základ)" Odoo
// typy skla (`montalu.glass.type`) podľa HRÚBKY, ktorú systém používa. Hrúbka je spojka medzi Odoo a
// výpočtom: zvolený Odoo typ → hrúbková trieda → REPREZENTATÍVNE lokálne výpočtové sklo → vzorce /
// profily / Money NEZMENENÉ. Objednávka skla nesie PRESNE zvolený Odoo typ. Odoo nedostupné →
// dnešná lokálna ponuka. Typ s hrúbkou 0 (dátová chyba v Odoo) sa neponúka + zaloguje.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ODOO_KATALOG_579, ROBUST_24_MM, type OdooRow } from './fixtures/odoo-glass-types-579';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-odoo-579-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { fetchGlassTypes, _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const { listGlassTypes } = await import('../src/lib/server/db');
const { ponukaSkielSystemu, odooTriedyPre, ODOO_HRUBKY } = await import('../src/lib/sklo-povolene');
const { ponukaSkielPre } = await import('../src/lib/server/sklo-odoo');
const { ponukaPreStyl, volbaSkla, rozlozVolbu, ODOO_PREFIX } = await import('../src/lib/sklo-odoo');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { listSklaPreZakazku } = await import('../src/lib/server/objednavka-skla');
const { znovaZOdpisu } = await import('../src/lib/server/znova');
const { listOdpisy } = await import('../src/lib/server/money');

const LOCALS = { user: { id: 1, username: 'tester', role: 'internal' } };

function odooOn(rows: OdooRow[] = ODOO_KATALOG_579) {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async () => new Response(JSON.stringify(rows), { status: 200 }));
}

beforeEach(() => {
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});
afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

const lokalne = (system: string) => ponukaSkielSystemu(system, listGlassTypes());
const odooMena = (p: { skupiny: { items: { odoo: string; nazov: string }[] }[] }) =>
	p.skupiny.flatMap((g) => g.items.filter((o) => o.odoo).map((o) => o.nazov)).sort();
const lokalneVPonuke = (p: { skupiny: { items: { odoo: string; value: string }[] }[] }) =>
	p.skupiny.flatMap((g) => g.items.filter((o) => !o.odoo).map((o) => o.value));

async function ponuka(system: string) {
	return ponukaSkielPre(system, lokalne(system), await fetchGlassTypes());
}

describe('#579 fetchGlassTypes — hrúbka + duplicitný cenníkový kód', () => {
	it('číta total_thickness_mm, typ s duplicitným kódom sa NEZAHODÍ (value = presný názov)', async () => {
		odooOn();
		const res = await fetchGlassTypes();
		expect(res.source).toBe('odoo');
		const al = res.items.find((t) => t.name === 'IZOS DOUBLE 4-16-4 AL');
		const izo16 = res.items.find((t) => t.name.startsWith('Izolačné sklo 4/8/4'));
		expect(al).toBeTruthy();
		expect(izo16).toBeTruthy();
		// prvý nositeľ kódu „001" si ho ponechá, ďalší dostane presný názov (Odoo resolve_glass_type
		// páruje aj presný názov) — žiadny typ z katalógu nesmie potichu zmiznúť
		expect(izo16!.value).toBe('001');
		expect(al!.value).toBe('IZOS DOUBLE 4-16-4 AL');
		expect(al!.hrubkaMm).toBe(24);
		expect(izo16!.hrubkaMm).toBe(16);
		const values = res.items.map((t) => t.value);
		expect(new Set(values).size).toBe(values.length);
		expect(res.items).toHaveLength(ODOO_KATALOG_579.length);
	});

	it('typ s hrúbkou 0 → zaloguje sa warn (dátová chyba v Odoo)', async () => {
		vi.stubEnv('LOG_LEVEL', 'warn');
		odooOn();
		const lines: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
			lines.push(String(c));
			return true;
		});
		await fetchGlassTypes();
		spy.mockRestore();
		const warn = lines.filter(
			(l) => l.includes('"level":"warn"') && l.includes('ESG Stopsol Classic Clear')
		);
		expect(warn).toHaveLength(1);
	});
});

describe('#579 jeden zdroj hrúbok per systém (sklo-povolene.ts)', () => {
	it('tabuľka z designu: Robust 24, Slide 16+6, Deluxe 6/10 kalené, Štandardy 6+16+24', () => {
		const mm = (s: string) => odooTriedyPre(s).map((t) => `${t.mm}:${t.druh}`);
		expect(mm('Robust')).toEqual(['24:izolacne']);
		expect(mm('Slide')).toEqual(['16:izolacne', '6:jednoduche']);
		expect(mm('Deluxe')).toEqual(['6:esg', '10:esg']);
		for (const s of ['Štandard +', 'Štandard', 'Štandard Drevo'])
			expect(mm(s)).toEqual(['6:jednoduche', '16:izolacne', '24:izolacne']);
		expect(odooTriedyPre('Neznámy')).toEqual([]);
	});

	it('reprezentatívne výpočtové sklo každej triedy je v lokálnej ponuke systému', () => {
		for (const [system, triedy] of Object.entries(ODOO_HRUBKY))
			for (const t of triedy) expect(lokalne(system), `${system} ${t.mm}`).toContain(t.sklo);
	});
});

describe('#579 ponuka „Sklo (základ)" z Odoo podľa hrúbky', () => {
	it('Robust: VŠETKY Odoo typy 24 mm + lokálne sklá bez Odoo náprotivku', async () => {
		odooOn();
		const p = await ponuka('Robust');
		expect(odooMena(p)).toEqual([...ROBUST_24_MM].sort());
		// „4/16/4 mliečne" v Odoo náprotivok nemá → ostáva (skupina „Z appky");
		// „4/16/4 číre" nahradili IZOS DOUBLE AL/TH → zo zoznamu zmizne, jeho zástupca = AL
		expect(lokalneVPonuke(p)).toEqual(['Izolačné sklo 4/16/4 mliečne']);
		const al = p.skupiny.flatMap((g) => g.items).find((o) => o.nazov === 'IZOS DOUBLE 4-16-4 AL');
		expect(p.zastupca['Izolačné sklo 4/16/4 číre']).toBe(al!.value);
		// každý Odoo typ Robustu sa počíta ako 4/16/4 číre (jediná trieda, vzorec od skla nezávisí)
		for (const o of p.skupiny.flatMap((g) => g.items).filter((o) => o.odoo))
			expect(o.vypocet).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('nové 24 mm sklo pridané v Odoo sa objaví bez zmeny appky', async () => {
		odooOn([
			...ODOO_KATALOG_579,
			{
				name: 'IZOS DOUBLE 4-16-4 WARM',
				category: 'izolacne',
				cennik_code: 'X77',
				composition: '4 - 16 - 4',
				total_thickness_mm: 24,
				pane_count: 'dvojsklo'
			}
		]);
		expect(odooMena(await ponuka('Robust'))).toContain('IZOS DOUBLE 4-16-4 WARM');
	});

	it('typ s hrúbkou 0 sa neponúkne v žiadnom systéme', async () => {
		odooOn();
		for (const s of Object.keys(ODOO_HRUBKY))
			expect(odooMena(await ponuka(s))).not.toContain('ESG Stopsol Classic Clear');
	});

	it('Deluxe: len kalené (ESG) 6 a 10 mm; 6 → Float kalené 6 mm, 10 → Float kalené 10 mm', async () => {
		odooOn();
		const p = await ponuka('Deluxe');
		const items = p.skupiny.flatMap((g) => g.items).filter((o) => o.odoo);
		expect(items.map((o) => o.nazov).sort()).toEqual(
			[
				'ESG Float bronz/šedý 10mm',
				'ESG Float bronz/šedý 6mm',
				'ESG Float čirý 10mm',
				'ESG Float čirý 6mm',
				'ESG Stopsol Classic Clear 6mm'
			].sort()
		);
		for (const o of items)
			expect(o.vypocet).toBe(o.nazov.includes('10mm') ? 'Float kalené 10 mm' : 'Float kalené 6 mm');
	});

	it('Štandard plus: 16 mm LEN izolačné (VSG 88.2 nie), 24 mm izolačné, 6 mm jednosklá', async () => {
		odooOn();
		const p = await ponuka('Štandard +');
		const mena = odooMena(p);
		expect(mena).not.toContain('VSG 88.2');
		expect(mena).toContain('Izolačné sklo 4/8/4- číre (Ug=1,1)');
		expect(mena).toContain('IZOS DOUBLE 6-6-4');
		expect(mena).toEqual(expect.arrayContaining(ROBUST_24_MM));
		expect(mena).toContain('Float čirý 6mm');
		expect(mena).toContain('VSG 33.1');
		expect(mena).not.toContain('Float čirý 10mm');
		expect(mena).not.toContain('IZOS TRIPLE 4-16-4-16-4 AL');
		const by = (n: string) => p.skupiny.flatMap((g) => g.items).find((o) => o.nazov === n)!;
		// jednoznačná zhoda matchera #556 → presne to lokálne sklo; inak predvolené sklo triedy
		expect(by('ESG Float čirý 6mm').vypocet).toBe('ESG kalené 6 mm');
		expect(by('Float čirý 6mm').vypocet).toBe('Float sklo 6 mm');
		expect(by('Drôtené sklo 6mm').vypocet).toBe('Float sklo 6 mm');
		expect(by('IZOS DOUBLE 6-6-4').vypocet).toBe('Izolačné sklo 4/8/4 číre');
		expect(by('IZOS DOUBLE 5ESG-14-5ESG').vypocet).toBe('Izolačné sklo 4/16/4 číre');
		// stopsol (povlak, ktorý matcher nerozlišuje) sa NESKRYJE za IZOS AL/TH
		expect(lokalneVPonuke(p)).toContain('Izolačné sklo 4/16/4 stopsol');
		// hodnoty volieb sú unikátne (kľúč {#each}) a Odoo voľby sa nebijú s lokálnymi názvami
		const vals = p.skupiny.flatMap((g) => g.items).map((o) => o.value);
		expect(new Set(vals).size).toBe(vals.length);
		for (const o of p.skupiny.flatMap((g) => g.items).filter((o) => o.odoo))
			expect(o.value.startsWith(ODOO_PREFIX)).toBe(true);
	});

	it('Odoo nedostupné → lokálna ponuka ako doteraz (fallback, žiadny zástupca)', async () => {
		// integrácia nenakonfigurovaná = lokálny fallback
		const p = ponukaSkielPre('Robust', lokalne('Robust'), await fetchGlassTypes());
		expect(lokalneVPonuke(p)).toEqual(lokalne('Robust'));
		expect(odooMena(p)).toEqual([]);
		expect(p.zastupca).toEqual({});
	});
});

describe('#579 klient — výber voľby (select) ↔ výpočtové sklo + Odoo typ', () => {
	it('volbaSkla / rozlozVolbu: Odoo voľba nesie výpočtové sklo, skryté lokálne sklo → zástupca', async () => {
		odooOn();
		const p = await ponuka('Robust');
		const sk = ponukaPreStyl(p, lokalne('Robust'));
		const tesc = sk.flatMap((g) => g.items).find((o) => o.nazov === 'IZOS DOUBLE 5ESG-14-5ESG')!;
		expect(rozlozVolbu(tesc.value, sk)).toEqual({
			sklo: 'Izolačné sklo 4/16/4 číre',
			skloOdoo: 'IZOS DOUBLE 5ESG-14-5ESG'
		});
		expect(volbaSkla('Izolačné sklo 4/16/4 číre', 'IZOS DOUBLE 5ESG-14-5ESG', sk, p.zastupca)).toBe(
			tesc.value
		);
		// predvolené lokálne „4/16/4 číre" (skryté) sa zobrazí ako prvý Odoo náprotivok (AL)
		expect(volbaSkla('Izolačné sklo 4/16/4 číre', '', sk, p.zastupca)).toBe(
			p.zastupca['Izolačné sklo 4/16/4 číre']
		);
		// lokálne sklo v ponuke → samo seba, Odoo typ prázdny
		expect(rozlozVolbu('Izolačné sklo 4/16/4 mliečne', sk)).toEqual({
			sklo: 'Izolačné sklo 4/16/4 mliečne',
			skloOdoo: ''
		});
	});

	it('štýl bez IZO nárezáku odfiltruje aj Odoo izolačné voľby (rovnaký gate ako lokálne)', async () => {
		odooOn();
		const p = await ponuka('Štandard +');
		// povolené výpočtové sklá štýlu bez IZO = len jednosklá
		const sk = ponukaPreStyl(p, ['Float sklo 6 mm', 'ESG kalené 6 mm', '3.3.1', '3.3.1 mliečne']);
		const vsetky = sk.flatMap((g) => g.items);
		expect(vsetky.some((o) => o.nazov === 'IZOS DOUBLE 4-16-4 AL')).toBe(false);
		expect(vsetky.some((o) => o.nazov === 'Float čirý 6mm')).toBe(true);
		expect(sk.every((g) => g.items.length > 0)).toBe(true);
	});

	it('bez serverovej ponuky (napr. neznámy systém) = lokálne názvy 1:1', () => {
		const sk = ponukaPreStyl(undefined, ['A', 'B']);
		expect(sk.flatMap((g) => g.items).map((o) => o.value)).toEqual(['A', 'B']);
	});
});

// ---- server akcie ----

function robustForm(extra: Record<string, string> = {}) {
	const fd = new FormData();
	const base: Record<string, string> = {
		zak: 'ZAK-579',
		op: 'OPDL579',
		zakaznik: 'X',
		system: 'Robust',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		farbaKovania: 'R7016'
	};
	for (const [k, v] of Object.entries({ ...base, ...extra })) fd.append(k, v);
	return fd;
}
type Akcia = keyof typeof actions;
async function akcia(name: Akcia, fd: FormData) {
	const a = actions[name] as (e: unknown) => Promise<Record<string, unknown>>;
	return a({
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: LOCALS
	});
}

describe('#579 akcie — výpočet nezmenený, objednávka nesie Odoo typ', () => {
	it('IZOS DOUBLE 5ESG-14-5ESG sa počíta PRESNE ako 4/16/4 číre (Money-neutrálne)', async () => {
		odooOn();
		const lok = await akcia('nahlad', robustForm());
		const odoo = await akcia('nahlad', robustForm({ skloOdoo: 'IZOS DOUBLE 5ESG-14-5ESG' }));
		expect(lok.step).toBe('nahlad');
		expect(odoo.step).toBe('nahlad');
		expect(odoo.plan).toEqual(lok.plan);
		expect(odoo.kovanie).toEqual(lok.kovanie);
		expect(odoo.planHash).toBe(lok.planHash);
		const v = odoo.vstup as { sklo: string; skloOdoo: string; skloOdooNazov: string };
		expect(v.sklo).toBe('Izolačné sklo 4/16/4 číre');
		expect(v.skloOdoo).toBe('IZOS DOUBLE 5ESG-14-5ESG');
		expect(v.skloOdooNazov).toBe('IZOS DOUBLE 5ESG-14-5ESG');
	});

	it('pridatSkla: objednávka skla nesie PRESNE zvolený Odoo typ (bez matchera)', async () => {
		odooOn();
		await akcia(
			'pridatSkla',
			robustForm({ zak: 'ZAK-579-A', skloOdoo: 'IZOS DOUBLE 5ESG-14-5ESG' })
		);
		expect(listSklaPreZakazku('ZAK-579-A').map((r) => r.typSkla)).toEqual([
			'IZOS DOUBLE 5ESG-14-5ESG'
		]);
		await akcia('pridatSkla', robustForm({ zak: 'ZAK-579-B', skloOdoo: '003' }));
		expect(listSklaPreZakazku('ZAK-579-B').map((r) => r.typSkla)).toEqual(['003']);
	});

	it('pridatSklaMulti: každý posuv nesie svoj Odoo typ', async () => {
		odooOn();
		const fd = new FormData();
		for (const [k, v] of Object.entries({ zak: 'ZAK-579-M', op: 'OPDL579M', zakaznik: 'X' }))
			fd.append(k, v);
		fd.append('farbaKovania', 'R7016');
		const posuv = {
			system: 'Robust',
			styl: '3K',
			s: 3000,
			v: 2000,
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'P - L'
		};
		fd.append(
			'posuvy',
			JSON.stringify([
				{ ...posuv, skloOdoo: '003' },
				{ ...posuv, s: 2500, skloOdoo: 'IZOS DOUBLE 5ESG-14-5ESG' }
			])
		);
		const r = await akcia('pridatSklaMulti', fd);
		expect(r.step).toBe('nahladMulti');
		expect(
			listSklaPreZakazku('ZAK-579-M')
				.map((x) => x.typSkla)
				.sort()
		).toEqual(['003', 'IZOS DOUBLE 5ESG-14-5ESG']);
	});

	it('Odoo typ, ktorý k systému nepatrí (16 mm pre Robust), server odmietne', async () => {
		odooOn();
		const r = await akcia('nahlad', robustForm({ skloOdoo: 'IZOS DOUBLE 6-6-4' }));
		expect(r.step).toBe('form');
		expect(String(r.error)).toContain('Odoo');
	});

	it('Odoo typ nesediaci s výpočtovým sklom (podvrhnutý POST) server odmietne', async () => {
		odooOn();
		const r = await akcia(
			'nahlad',
			robustForm({ sklo: 'Izolačné sklo 4/16/4 mliečne', skloOdoo: 'IZOS DOUBLE 4-16-4 AL' })
		);
		expect(r.step).toBe('form');
	});

	it('odoslat: detail nesie Odoo typ (plán/história) a „Použiť znova" ho obnoví', async () => {
		odooOn();
		const r = await akcia(
			'odoslat',
			robustForm({ zak: 'ZAK-579-Z', skloOdoo: 'IZOS DOUBLE 5ESG-14-5ESG' })
		);
		expect(r.step).toBe('hotovo');
		const row = listOdpisy().find((o) => o.zak === 'ZAK-579-Z')!;
		const d = JSON.parse(row.detail) as Record<string, unknown>;
		expect(d.sklo).toBe('IZOS DOUBLE 5ESG-14-5ESG');
		expect(d.skloZaklad).toBe('Izolačné sklo 4/16/4 číre');
		expect(d.skloOdoo).toBe('IZOS DOUBLE 5ESG-14-5ESG');
		const z = znovaZOdpisu(row.id)!;
		expect(z.vstup!.sklo).toBe('Izolačné sklo 4/16/4 číre');
		expect(z.vstup!.skloOdoo).toBe('IZOS DOUBLE 5ESG-14-5ESG');
		// Odoo názov NIE je „presné zloženie" — to ostáva prázdne
		expect(z.vstup!.skloPresne).toBe('');
	});
});
