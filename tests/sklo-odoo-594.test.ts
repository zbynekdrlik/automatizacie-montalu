// #594 (Odoo úloha 1218, Marek 29.9.: „preco tam su nejake skla appky tam maju byt iba odoo"):
// keď je Odoo dostupné, nárezák zasklení ponúka v „Sklo (základ)" LEN Odoo typy skla (skupiny
// „Odoo — <druh>") + „Iné (vlastná skladba)" — skupina „Sklá appky" zmizne. Obracia ROZHODNUTÉ #579
// („lokálne sklá ostávajú"). Predvolené sklo systému = Odoo voľba, ktorej VÝPOČTOVÉ sklo je dnešné
// lokálne predvolené (pri viacerých prvá v poradí `zoskupTypySkla` — viditeľná v selecte). Odoo
// nedostupné → dnešná lokálna ponuka (záloha). „Použiť znova" starého odpisu s lokálnym sklom →
// Odoo voľba s tým výpočtovým sklom, inak lokálne sklo ako JEDINÁ doplnková voľba „pôvodné sklo z
// appky". Výpočet / Money nezmenené (snapshot `sklo-odoo-579` ostáva).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ODOO_KATALOG_579, type OdooRow } from './fixtures/odoo-glass-types-579';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-odoo-594-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { fetchGlassTypes, _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const { listGlassTypes } = await import('../src/lib/server/db');
const { ponukaSkielSystemu, predvoleneSklo, ODOO_HRUBKY_SEED } =
	await import('../src/lib/sklo-povolene');
const { ponukaSkielPre, PREFIX_ODOO_SKUPINY } = await import('../src/lib/server/sklo-odoo');
const { ponukaPreStyl, volbaSkla, rozlozVolbu, skloOdooPre, POVODNE_SKLO_APPKY } =
	await import('../src/lib/sklo-odoo');
const { SKLO_INE } = await import('../src/lib/sklo');

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
const ponuka = async (system: string) =>
	ponukaSkielPre(system, lokalne(system), await fetchGlassTypes());
const vsetky = <T>(sk: { items: T[] }[]): T[] => sk.flatMap((g) => g.items);

const CIRE_24 = 'Izolačné sklo 4/16/4 číre';
const MLIECNE_24 = 'Izolačné sklo 4/16/4 mliečne';

// riadky ŽIVÉHO PROD katalógu 29.9.2026 s odtieňmi, ktoré matcher #594 nově rozlišuje
const r = (
	total_thickness_mm: number,
	category: string,
	name: string,
	cennik_code: string,
	composition: string | false = false
): OdooRow => ({
	name,
	category,
	cennik_code,
	composition,
	total_thickness_mm,
	pane_count: category === 'izolacne' ? 'dvojsklo' : 'jednosklo'
});
const PROD_ODTIENE_594: OdooRow[] = [
	r(4, 'esg', 'ESG Float extračirý 4mm', 'OP008E'),
	r(4, 'esg', 'ESG Matelux čirý 4mm', 'OP025E'),
	r(6, 'esg', 'ESG Float extračirý 6mm', 'OP009E'),
	r(6, 'esg', 'ESG Matelux čirý 6mm', 'OP027E'),
	r(10, 'esg', 'ESG Float extračirý 10mm', 'OP011E'),
	r(10, 'esg', 'ESG Matelux čirý 10mm', 'OP029E'),
	r(6, 'rezane', 'Float extračirý 6mm', 'OP009', '6 extračirý'),
	r(6, 'rezane', 'Matelux čirý 6mm', 'OP027', '6 matelux'),
	r(24, 'izolacne', 'Izolačné sklo 4/16/4- Mliečne', '012', '4/16/4- Mliečne')
];

describe('#594 ponuka pri dostupnom Odoo = LEN Odoo typy', () => {
	it('žiadna lokálna voľba ani skupina „Sklá appky" v žiadnom systéme', async () => {
		odooOn();
		for (const s of Object.keys(ODOO_HRUBKY_SEED)) {
			const p = await ponuka(s);
			expect(p.skupiny.length, s).toBeGreaterThan(0);
			for (const g of p.skupiny) expect(g.label, s).toMatch(new RegExp(`^${PREFIX_ODOO_SKUPINY}`));
			for (const o of vsetky(p.skupiny)) expect(o.odoo, `${s}: ${o.value}`).not.toBe('');
		}
	});

	it('Odoo nedostupné → dnešná lokálna ponuka (záloha), bez skupín a bez popisov', async () => {
		const p = await ponuka('Robust');
		expect(p.skupiny.map((g) => g.label)).toEqual(['']);
		expect(vsetky(p.skupiny).map((o) => o.value)).toEqual(lokalne('Robust'));
		expect(vsetky(p.skupiny).map((o) => o.label)).toEqual(lokalne('Robust'));
	});
});

describe('#594 predvolené sklo = Odoo voľba s dnešným predvoleným výpočtovým sklom', () => {
	for (const system of ['Robust', 'Štandard +', 'Deluxe', 'Slide']) {
		it(`${system}: predvolené lokálne sklo → prvá Odoo voľba počítaná ním (posiela sa jej typ)`, async () => {
			odooOn();
			const p = await ponuka(system);
			const pov = lokalne(system);
			const def = predvoleneSklo(pov, system);
			const sk = ponukaPreStyl(p, pov, def);
			const prva = vsetky(sk).find((o) => o.vypocet === def);
			expect(prva, `${system}: Odoo voľba pre ${def}`).toBeTruthy();
			expect(prva!.odoo).not.toBe('');
			// žiadna doplnková lokálna voľba — predvolené sklo má Odoo náprotivok
			expect(vsetky(sk).every((o) => o.odoo !== '')).toBe(true);
			expect(volbaSkla(def, '', sk)).toBe(prva!.value);
			expect(rozlozVolbu(volbaSkla(def, '', sk), sk)).toEqual({ sklo: def, skloOdoo: prva!.odoo });
			expect(skloOdooPre(p, pov, def, '')).toBe(prva!.odoo);
		});
	}

	it('explicitne zvolený Odoo typ s tým istým výpočtovým sklom ostáva zvolený', async () => {
		odooOn();
		const p = await ponuka('Robust');
		const sk = ponukaPreStyl(p, lokalne('Robust'), CIRE_24);
		const posledna = vsetky(sk)
			.filter((o) => o.vypocet === CIRE_24)
			.at(-1)!;
		expect(volbaSkla(CIRE_24, posledna.odoo, sk)).toBe(posledna.value);
		expect(skloOdooPre(p, lokalne('Robust'), CIRE_24, posledna.odoo)).toBe(posledna.odoo);
	});
});

describe('#594 „Použiť znova" starého odpisu s lokálnym sklom', () => {
	it('lokálne sklo s Odoo náprotivkom → predvyberie Odoo voľbu (bez doplnkovej voľby)', async () => {
		odooOn();
		const p = await ponuka('Štandard +');
		const pov = lokalne('Štandard +');
		const sk = ponukaPreStyl(p, pov, 'ESG kalené 6 mm');
		const v = volbaSkla('ESG kalené 6 mm', '', sk);
		const o = vsetky(sk).find((x) => x.value === v)!;
		expect(o.odoo).not.toBe('');
		expect(o.vypocet).toBe('ESG kalené 6 mm');
		expect(vsetky(sk).every((x) => x.odoo !== '')).toBe(true);
	});

	it('lokálne sklo BEZ Odoo náprotivku → jediná doplnková voľba „pôvodné sklo z appky"', async () => {
		odooOn(); // výrez nemá 24 mm mliečne → Robust mliečne nemá Odoo voľbu
		const p = await ponuka('Robust');
		const pov = lokalne('Robust');
		expect(pov).toContain(MLIECNE_24);
		const sk = ponukaPreStyl(p, pov, MLIECNE_24);
		const lok = vsetky(sk).filter((o) => o.odoo === '');
		expect(lok).toHaveLength(1);
		expect(lok[0]!.value).toBe(MLIECNE_24);
		expect(lok[0]!.vypocet).toBe(MLIECNE_24);
		expect(lok[0]!.label).toBe(`${MLIECNE_24} · ${POVODNE_SKLO_APPKY}`);
		expect(volbaSkla(MLIECNE_24, '', sk)).toBe(MLIECNE_24);
		expect(rozlozVolbu(MLIECNE_24, sk)).toEqual({ sklo: MLIECNE_24, skloOdoo: '' });
		expect(skloOdooPre(p, pov, MLIECNE_24, '')).toBe('');
		// pri inom zvolenom skle sa doplnková voľba neukáže
		expect(vsetky(ponukaPreStyl(p, pov, CIRE_24)).some((o) => o.odoo === '')).toBe(false);
	});

	it('Odoo typ s mliečnym náprotivkom (PROD „Izolačné sklo 4/16/4- Mliečne") → predvyberie ho', async () => {
		odooOn([...ODOO_KATALOG_579, ...PROD_ODTIENE_594]);
		const p = await ponuka('Robust');
		const sk = ponukaPreStyl(p, lokalne('Robust'), MLIECNE_24);
		const o = vsetky(sk).find((x) => x.value === volbaSkla(MLIECNE_24, '', sk))!;
		expect(o.odoo).toBe('012');
		expect(o.vypocet).toBe(MLIECNE_24);
	});

	it('„Iné (vlastná skladba)" ani sklo mimo povolenej ponuky štýlu nedostane doplnkovú voľbu', async () => {
		odooOn();
		const p = await ponuka('Robust');
		const pov = lokalne('Robust');
		expect(vsetky(ponukaPreStyl(p, pov, SKLO_INE)).some((o) => o.odoo === '')).toBe(false);
		expect(vsetky(ponukaPreStyl(p, pov, 'Float sklo 6 mm')).some((o) => o.odoo === '')).toBe(false);
	});
});

describe('#594 Money-neutralita — nové odtiene matchera nemenia výpočtové sklo Odoo voľby', () => {
	it('extračiré / Matelux sa počítajú ako doteraz (kalené ostáva kalené)', async () => {
		odooOn([...ODOO_KATALOG_579, ...PROD_ODTIENE_594]);
		const vyp = async (s: string) =>
			Object.fromEntries(
				vsetky((await ponuka(s)).skupiny)
					.filter((o) => o.odoo)
					.map((o) => [o.nazov, o.vypocet])
			);
		const std = await vyp('Štandard +');
		expect(std['ESG Float extračirý 6mm']).toBe('ESG kalené 6 mm');
		expect(std['ESG Matelux čirý 6mm']).toBe('ESG kalené 6 mm');
		expect(std['ESG Float extračirý 4mm']).toBe('ESG kalené 4 mm');
		expect(std['ESG Matelux čirý 4mm']).toBe('ESG kalené 4 mm');
		expect(std['Float extračirý 6mm']).toBe('Float sklo 6 mm');
		expect(std['Matelux čirý 6mm']).toBe('Float sklo 6 mm');
		const dlx = await vyp('Deluxe');
		expect(dlx['ESG Float extračirý 10mm']).toBe('Float kalené 10 mm');
		expect(dlx['ESG Matelux čirý 10mm']).toBe('Float kalené 10 mm');
		expect(dlx['ESG Float extračirý 6mm']).toBe('Float kalené 6 mm');
	});
});
