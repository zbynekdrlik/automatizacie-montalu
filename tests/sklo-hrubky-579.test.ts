// #579 časť 2 (Odoo úloha 1180 po stretnutí 28.9.: „Povolené hrúbky pri systéme si nastaví výroba"):
// povolené hrúbky Odoo skiel per systém žijú v SQLite (`cfg_sklo_hrubka`, seed = dnešná tabuľka
// `ODOO_HRUBKY_SEED`) a výroba ich mení v `/zasklenia/nastavenia` s auditom. Výroba zadáva LEN
// systém × hrúbku (mm) × druh; výpočtové sklo sa ODVODÍ pravidlom (`vypocetneSkloPre`) — nikdy sa
// nezadáva. Kombinácia, pre ktorú systém nemá výpočtové sklo, sa odmietne. Zmena sa prejaví v ponuke
// nárezáka bez releasu; výpočet/Money nezmenené (seed = snapshot `sklo-odoo-579` bez zmeny).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ODOO_KATALOG_579, ROBUST_24_MM } from './fixtures/odoo-glass-types-579';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-hrubky-579-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0';

const { db, listGlassTypes } = await import('../src/lib/server/db');
const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { fetchGlassTypes, _resetGlassTypesCache } =
	await import('../src/lib/server/odoo-glass-types');
const { ponukaSkielSystemu, vypocetneSkloPre, ODOO_HRUBKY_SEED } =
	await import('../src/lib/sklo-povolene');
const { skloHrubkyPre, pridajSkloHrubku, odoberSkloHrubku, listSkloHrubky } =
	await import('../src/lib/server/sklo-hrubky');
const { ponukaSkielPre, overSkloOdoo } = await import('../src/lib/server/sklo-odoo');
const { actions, load } = await import('../src/routes/zasklenia/nastavenia/+page.server');

function odooOn() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async () => new Response(JSON.stringify(ODOO_KATALOG_579), { status: 200 }));
}
beforeEach(() => _resetGlassTypesCache());
afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

const lokalne = (s: string) => ponukaSkielSystemu(s, listGlassTypes());
const odooVolby = async (s: string) =>
	ponukaSkielPre(s, lokalne(s), await fetchGlassTypes())
		.skupiny.flatMap((g) => g.items)
		.filter((o) => o.odoo);
const auditCount = () =>
	(db.prepare('SELECT COUNT(*) AS n FROM cfg_audit').get() as { n: number }).n;
const posledneAudit = () =>
	db.prepare('SELECT username, sys_styl, zmeny FROM cfg_audit ORDER BY id DESC LIMIT 1').get() as {
		username: string;
		sys_styl: string;
		zmeny: string;
	};

describe('#579/2 seed = dnešná tabuľka (migrácia)', () => {
	it('tabuľka z designu: Robust 24, Slide 16+6, Deluxe 6/10 kalené, Štandardy 4+6+16, Drevostavby 6+16+24', () => {
		const mm = (s: string) => skloHrubkyPre(s).map((t) => `${t.mm}:${t.druh}`);
		expect(mm('Robust')).toEqual(['24:izolacne']);
		expect(mm('Slide')).toEqual(['16:izolacne', '6:jednoduche']);
		expect(mm('Deluxe')).toEqual(['6:esg', '10:esg']);
		// #579 (Patrik 28.9.): Štandard + a starý Štandard aj 4 mm jednoduché; úloha 1218 (Patrik
		// 29.9.: „Štandardy — 4, 6, 16 mm"): bez 24 mm izolačného; Drevostavby bez zmeny
		for (const s of ['Štandard +', 'Štandard'])
			expect(mm(s)).toEqual(['6:jednoduche', '16:izolacne', '4:jednoduche']);
		expect(mm('Štandard Drevo')).toEqual(['6:jednoduche', '16:izolacne', '24:izolacne']);
		expect(skloHrubkyPre('Neznámy')).toEqual([]);
	});

	it('DB seed = ODOO_HRUBKY_SEED 1:1 (jeden zdroj s kódom)', () => {
		for (const [s, rows] of Object.entries(ODOO_HRUBKY_SEED))
			expect(
				skloHrubkyPre(s).map(({ mm, druh }) => ({ mm, druh })),
				s
			).toEqual(rows.map(({ mm, druh }) => ({ mm, druh })));
	});
});

describe('#579/2 odvodenie výpočtového skla (nikdy sa nezadáva)', () => {
	it('seed dáva presne dnešné reprezentatívne výpočtové sklá (Money-neutrálne)', () => {
		const cakane: Record<string, Record<string, string>> = {
			Robust: { '24:izolacne': 'Izolačné sklo 4/16/4 číre' },
			Slide: { '16:izolacne': 'Izolačné sklo 4/8/4 číre', '6:jednoduche': '6mm číre' },
			Deluxe: { '6:esg': 'Float kalené 6 mm', '10:esg': 'Float kalené 10 mm' }
		};
		for (const s of ['Štandard +', 'Štandard', 'Štandard Drevo'])
			cakane[s] = {
				'6:jednoduche': 'Float sklo 6 mm',
				'16:izolacne': 'Izolačné sklo 4/8/4 číre',
				'24:izolacne': 'Izolačné sklo 4/16/4 číre',
				// #579: 4 mm jednoduché sa počíta ako katalógové Float sklo 4 mm (vlastné Money kódy)
				'4:jednoduche': 'Float sklo 4 mm'
			};
		for (const [s, rows] of Object.entries(ODOO_HRUBKY_SEED))
			for (const r of rows)
				expect(vypocetneSkloPre(r.mm, r.druh, lokalne(s)), `${s} ${r.mm}:${r.druh}`).toBe(
					cakane[s]![`${r.mm}:${r.druh}`]
				);
	});

	it('kombinácia bez výpočtového skla v systéme → null', () => {
		// Robust nemá 4/8/4 (16 mm) ani jednosklá
		expect(vypocetneSkloPre(16, 'izolacne', lokalne('Robust'))).toBeNull();
		expect(vypocetneSkloPre(6, 'jednoduche', lokalne('Robust'))).toBeNull();
		// Štandard + nemá 10 mm (#504); 4 mm od #579 áno (test nižšie)
		expect(vypocetneSkloPre(10, 'jednoduche', lokalne('Štandard +'))).toBeNull();
		// Deluxe len kalené
		expect(vypocetneSkloPre(6, 'jednoduche', lokalne('Deluxe'))).toBeNull();
		// trojsklo 44 mm nemá lokálne výpočtové sklo nikde
		expect(vypocetneSkloPre(44, 'izolacne', lokalne('Štandard +'))).toBeNull();
	});

	it('#579: 4 mm jednoduché → Float sklo 4 mm v Štandard + aj starom Štandarde', () => {
		for (const s of ['Štandard +', 'Štandard'])
			expect(vypocetneSkloPre(4, 'jednoduche', lokalne(s)), s).toBe('Float sklo 4 mm');
	});

	it('nové kombinácie odvodené pravidlom: Slide 24 izolačné, Štandard + 6 kalené, Slide 10 jednoduché', () => {
		expect(vypocetneSkloPre(24, 'izolacne', lokalne('Slide'))).toBe('Izolačné sklo 4/16/4 číre');
		expect(vypocetneSkloPre(6, 'esg', lokalne('Štandard +'))).toBe('ESG kalené 6 mm');
		expect(vypocetneSkloPre(10, 'jednoduche', lokalne('Slide'))).toBe('Float sklo 10 mm');
		// stopsol/mliečne nikdy nie je reprezentatívne sklo (len číre)
		expect(vypocetneSkloPre(16, 'izolacne', ['Izolačné sklo 4/8/4 stopsol'])).toBeNull();
	});
});

describe('#579/2 zmena tabuľky sa prejaví v ponuke bez releasu + audit', () => {
	it('Slide + 24 izolačné → ponuka ukáže všetky 24 mm Odoo typy; odobratie ich skryje', async () => {
		odooOn();
		const pred = (await odooVolby('Slide')).map((o) => o.nazov);
		for (const n of ROBUST_24_MM) expect(pred).not.toContain(n);

		const a0 = auditCount();
		const r = pridajSkloHrubku({ system: 'Slide', mm: 24, druh: 'izolacne', username: 'vyroba' });
		expect(r.error).toBeNull();
		expect(auditCount()).toBe(a0 + 1);
		const a = posledneAudit();
		expect(a.username).toBe('vyroba');
		expect(a.sys_styl).toBe('Slide');
		expect(JSON.parse(a.zmeny)).toEqual([
			{
				pole: 'Povolená hrúbka skla 24 mm (izolačné)',
				stara: 'nie',
				nova: 'áno — počíta sa ako Izolačné sklo 4/16/4 číre'
			}
		]);

		const po = await odooVolby('Slide');
		for (const n of ROBUST_24_MM) {
			const o = po.find((x) => x.nazov === n);
			expect(o?.vypocet, n).toBe('Izolačné sklo 4/16/4 číre');
		}
		// server overenie odoslaného Odoo typu číta TÚ ISTÚ tabuľku
		expect(
			await overSkloOdoo({ system: 'Slide', sklo: 'Izolačné sklo 4/16/4 číre', skloOdoo: '003' })
		).toBeNull();

		const id = skloHrubkyPre('Slide').find((h) => h.mm === 24)!.id;
		expect(odoberSkloHrubku({ id, system: 'Slide', username: 'vyroba' }).error).toBeNull();
		expect(auditCount()).toBe(a0 + 2);
		expect(JSON.parse(posledneAudit().zmeny)).toEqual([
			{ pole: 'Povolená hrúbka skla 24 mm (izolačné)', stara: 'áno', nova: 'nie' }
		]);
		const spat = (await odooVolby('Slide')).map((o) => o.nazov);
		for (const n of ROBUST_24_MM) expect(spat).not.toContain(n);
		expect(
			await overSkloOdoo({ system: 'Slide', sklo: 'Izolačné sklo 4/16/4 číre', skloOdoo: '003' })
		).not.toBeNull();
	});

	it('neplatná kombinácia (Robust 16 izolačné) sa odmietne s hláškou — bez zápisu a bez auditu', () => {
		const a0 = auditCount();
		const n0 = listSkloHrubky().length;
		const r = pridajSkloHrubku({ system: 'Robust', mm: 16, druh: 'izolacne', username: 'vyroba' });
		expect(r.error).toMatch(/výpočtové sklo/);
		expect(listSkloHrubky()).toHaveLength(n0);
		expect(auditCount()).toBe(a0);
	});

	it('duplicitná hrúbka, neznámy systém, zlé mm a zlý druh sa odmietnu — každé vlastnou hláškou', () => {
		const n0 = listSkloHrubky().length;
		const a0 = auditCount();
		const zle: [{ system: string; mm: number; druh: string }, RegExp][] = [
			[{ system: 'Robust', mm: 24, druh: 'izolacne' }, /24 mm je pri systéme Robust už povolená/],
			[{ system: 'Robust', mm: 24, druh: 'jednoduche' }, /už povolená \(izolačné\)/],
			[{ system: 'Neznámy', mm: 24, druh: 'izolacne' }, /Neznámy systém „Neznámy"/],
			[{ system: 'Slide', mm: Number.NaN, druh: 'izolacne' }, /1–100 mm/],
			[{ system: 'Slide', mm: 0, druh: 'izolacne' }, /1–100 mm/],
			[{ system: 'Slide', mm: 0.99, druh: 'izolacne' }, /1–100 mm/],
			[{ system: 'Slide', mm: 100.01, druh: 'izolacne' }, /1–100 mm/],
			[{ system: 'Slide', mm: 500, druh: 'izolacne' }, /1–100 mm/],
			// hranice 1 a 100 prejdú rozsahom — odmietne ich až pravidlo výpočtového skla
			[{ system: 'Slide', mm: 1, druh: 'izolacne' }, /nemá výpočtové sklo pre 1 mm/],
			[{ system: 'Slide', mm: 100, druh: 'izolacne' }, /nemá výpočtové sklo pre 100 mm/],
			[{ system: 'Slide', mm: 24, druh: 'xyz' }, /Neznámy druh skla/]
		];
		for (const [z, hlaska] of zle)
			expect(pridajSkloHrubku({ ...z, username: 'vyroba' }).error, JSON.stringify(z)).toMatch(
				hlaska
			);
		expect(listSkloHrubky()).toHaveLength(n0);
		expect(auditCount()).toBe(a0);
	});

	it('odobratie cudzieho riadku (id iného systému) sa odmietne', () => {
		const a0 = auditCount();
		const id = skloHrubkyPre('Robust')[0]!.id;
		expect(odoberSkloHrubku({ id, system: 'Slide', username: 'x' }).error).toMatch(/neexistuje/);
		expect(skloHrubkyPre('Robust')).toHaveLength(1);
		expect(auditCount()).toBe(a0);
	});

	it('každé odmietnutie sa zaloguje (warn) s kontextom — podvrhnutý POST nie je tichý', () => {
		vi.stubEnv('LOG_LEVEL', 'warn');
		const lines: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
			lines.push(String(c));
			return true;
		});
		pridajSkloHrubku({ system: 'Neznámy', mm: 24, druh: 'izolacne', username: 'utocnik' });
		odoberSkloHrubku({ id: 999999, system: 'Slide', username: 'utocnik' });
		spy.mockRestore();
		const warn = lines.filter(
			(l) => l.includes('"level":"warn"') && l.includes('zmena odmietnutá') && l.includes('utocnik')
		);
		expect(warn).toHaveLength(2);
		expect(warn[1]).toContain('999999');
	});

	it('súbežný zápis z iného procesu (cache ho nevidí) → UNIQUE kolízia = hláška, nie výnimka', () => {
		listSkloHrubky(); // naplň cache
		db.prepare('INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)').run(
			'Slide',
			10,
			'jednoduche'
		);
		const a0 = auditCount();
		const r = pridajSkloHrubku({ system: 'Slide', mm: 10, druh: 'jednoduche', username: 'x' });
		expect(r.error).toMatch(/10 mm je pri systéme Slide už povolená/);
		expect(auditCount()).toBe(a0);
		// cache sa po kolízii obnovila → riadok je viditeľný a dá sa odobrať
		const id = skloHrubkyPre('Slide').find((h) => h.mm === 10)!.id;
		expect(odoberSkloHrubku({ id, system: 'Slide', username: 'x' }).error).toBeNull();
	});
});

// ---- editor akcie /zasklenia/nastavenia ----

function event(body: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/zasklenia/nastavenia', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'patrik', role: 'internal' } }
	} as unknown as Parameters<typeof actions.ulozit>[0];
}

describe('#579/2 editor nastavení — hrúbky skla', () => {
	it('load ukáže hrúbky zvoleného systému s odvodeným výpočtovým sklom', async () => {
		const sysStyl = 'Robust|3K';
		const d = (await load({
			url: new URL(`http://x/zasklenia/nastavenia?sysStyl=${encodeURIComponent(sysStyl)}`)
		} as Parameters<typeof load>[0])) as {
			hrubky: { mm: number; druh: string; vypocet: string | null }[];
		};
		expect(d.hrubky).toEqual([
			expect.objectContaining({ mm: 24, druh: 'izolacne', vypocet: 'Izolačné sklo 4/16/4 číre' })
		]);
	});

	it('pridatHrubku / odobratHrubku: zápis + audit pod prihláseným používateľom, chyba bez zápisu', async () => {
		const a0 = auditCount();
		const ok = (await actions.pridatHrubku(
			event({ system: 'Slide', mm: '24', druh: 'izolacne' })
		)) as { hrubkaOk?: string; hrubkaChyba?: string };
		expect(ok.hrubkaChyba).toBeUndefined();
		expect(ok.hrubkaOk).toContain('24 mm');
		expect(posledneAudit().username).toBe('patrik');

		const zle = (await actions.pridatHrubku(
			event({ system: 'Robust', mm: '16', druh: 'izolacne' })
		)) as { status?: number; data?: { hrubkaChyba?: string } };
		expect(zle.status).toBe(400);
		expect(zle.data?.hrubkaChyba).toMatch(/výpočtové sklo/);

		// číslo s „smetím" alebo prázdne pole = neplatná hrúbka (nie 24 / 0)
		for (const mm of ['24abc', '', '  '])
			expect(
				(
					(await actions.pridatHrubku(event({ system: 'Slide', mm, druh: 'izolacne' }))) as {
						data?: { hrubkaChyba?: string };
					}
				).data?.hrubkaChyba,
				mm
			).toMatch(/1–100 mm/);
		// desatinná čiarka sa prijme (6,0 = 6) — Slide 6 už povolená → duplicita, nie „1–100"
		expect(
			(
				(await actions.pridatHrubku(event({ system: 'Slide', mm: '6,0', druh: 'jednoduche' }))) as {
					data?: { hrubkaChyba?: string };
				}
			).data?.hrubkaChyba
		).toMatch(/6 mm je pri systéme Slide už povolená/);

		const id = skloHrubkyPre('Slide').find((h) => h.mm === 24)!.id;
		const del = (await actions.odobratHrubku(event({ system: 'Slide', id: String(id) }))) as {
			hrubkaOk?: string;
		};
		expect(del.hrubkaOk).toContain('24 mm');
		expect(auditCount()).toBe(a0 + 2);
		expect(skloHrubkyPre('Slide').map((h) => h.mm)).toEqual([16, 6]);
	});
});
