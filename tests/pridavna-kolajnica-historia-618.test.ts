// Odoo úloha 1459 — starý „Štandard" IZO mal prídavnú spodnú koľajnicu natvrdo vo vzorci, checkbox
// „Prídavná koľajnica" pri ňom neexistoval, takže odpisy uložené PRED zmenou majú v `detail`
// `pridavnaKolajnica: false`, hoci do Money išla zväčšená spodná. Po zmene (vzorec = základná,
// prídavnú pridá checkbox) musí „Použiť znova" aj rekomputa pre kiosk/backfill nárezákov
// takýto STARÝ odpis zopakovať rovnako → flag sa odvodí z histórie.
//
// Hranica „starý odpis" = chýba príznak `pridavnaVolbaStandard` v `detail` (nové odpisy ho majú
// vždy). Samotný flag sa nedá použiť — pri starom Štandarde bol vždy false.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pridavna-618-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'p.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { db, loadCfg } = await import('../src/lib/server/db');
const { znovaZOdpisu } = await import('../src/lib/server/znova');
const { mapOdpisToLines } = await import('../src/lib/server/backfill-narezaky');
const { recomputeVstup } = await import('../src/lib/server/zasklenia-sklo');
const zasklenia = await import('../src/routes/zasklenia/+page.server');
const { pridavnaKolajnicaZHistorie, PRIDAVNA_VOLBA_DETAIL, POZOR_PRIDAVNA_Z_HISTORIE } =
	await import('../src/lib/server/pridavna-kolajnica-historia');

const IZO = 'Izolačné sklo 4/8/4 číre';
const FLOAT = 'Float sklo 6 mm';

/** vloží záznam do histórie priamo (nič neodpisuje) */
function vlozOdpis(zak: string, detail: unknown): number {
	return Number(
		db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
				 VALUES ('zasklenia', ?, '01', 'Zákazník', 0, 0, '/tmp', 'x.xlsx', 'h', ?, 'test')`
			)
			.run(zak, JSON.stringify(detail)).lastInsertRowid
	);
}

const posuv = (system: string, styl: string, sietka: unknown = null) => ({ system, styl, sietka });

describe('pridavnaKolajnicaZHistorie — čistá funkcia', () => {
	it('nový odpis (príznak v detail) → uložená hodnota platí presne, aj false', () => {
		for (const ulozena of [false, true]) {
			expect(
				pridavnaKolajnicaZHistorie(
					{ ...PRIDAVNA_VOLBA_DETAIL, ...posuv('Štandard', '3K IZO') },
					ulozena
				)
			).toEqual({ pridavna: ulozena, presne: true });
		}
		expect(PRIDAVNA_VOLBA_DETAIL).toEqual({ pridavnaVolbaStandard: true });
	});

	it('starý odpis starého Štandardu IZO → true (spodná bola natvrdo zväčšená)', () => {
		for (const styl of ['2K IZO', '3K IZO', '4K IZO', '2x2K IZO', '2x3K IZO', '2x4K IZO'])
			expect(pridavnaKolajnicaZHistorie(posuv('Štandard', styl), false), styl).toEqual({
				pridavna: true,
				presne: true
			});
	});

	it('starý odpis starého Štandardu basic → false (prídavná tam nikdy nebola)', () => {
		expect(pridavnaKolajnicaZHistorie(posuv('Štandard', '3K'), false)).toEqual({
			pridavna: false,
			presne: true
		});
	});

	it('starý odpis iného systému → uložená hodnota (pravidlo sa preň nemenilo)', () => {
		for (const ulozena of [false, true]) {
			expect(pridavnaKolajnicaZHistorie(posuv('Štandard +', '3K IZO'), ulozena)).toEqual({
				pridavna: ulozena,
				presne: true
			});
			expect(pridavnaKolajnicaZHistorie(posuv('Robust', '2K'), ulozena)).toEqual({
				pridavna: ulozena,
				presne: true
			});
		}
	});

	it('detail bez systému/štýlu (minimálny záznam) → uložená hodnota', () => {
		expect(pridavnaKolajnicaZHistorie({}, true)).toEqual({ pridavna: true, presne: true });
		expect(pridavnaKolajnicaZHistorie({}, false)).toEqual({ pridavna: false, presne: true });
	});

	it('zimná záhrada len so starým Štandardom IZO → true pre všetky posuvy', () => {
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard', '2K IZO')] },
				false
			)
		).toEqual({ pridavna: true, presne: true });
	});

	it('zimná záhrada starý Štandard IZO + Štandard + s prídavnou → true presne', () => {
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard +', '3K IZO')] },
				true
			)
		).toEqual({ pridavna: true, presne: true });
	});

	it('zmiešaná zimná záhrada, ktorú jeden checkbox nezopakuje → uložená hodnota + upozornenie', () => {
		// IZO starý Štandard potreboval zväčšenú, Štandard + bez prídavnej nie
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard +', '3K IZO')] },
				false
			)
		).toEqual({ pridavna: false, presne: false });
		// IZO a basic starého Štandardu v jednej zákazke
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard', '3K')] },
				false
			)
		).toEqual({ pridavna: false, presne: false });
	});

	it('sieťka na 2K: koľajnice určuje sieťka (flag nemá vplyv) — starý 2K IZO sa presne nezopakuje', () => {
		const sietka = { uchyt: 'ziadny' };
		expect(pridavnaKolajnicaZHistorie(posuv('Štandard', '2K IZO', sietka), false)).toEqual({
			pridavna: true,
			presne: false
		});
		// basic 2K so sieťkou: dnes aj po zmene 3K sada → presne, flag sa nevyžaduje
		expect(pridavnaKolajnicaZHistorie(posuv('Štandard', '2K', sietka), false)).toEqual({
			pridavna: false,
			presne: true
		});
		// sieťka na 2K Štandard + nekoliduje so starým Štandardom IZO v inom posuve
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard +', '2K', sietka)] },
				false
			)
		).toEqual({ pridavna: true, presne: true });
		// opona (2x…) sieťku do Money nedáva → bežné pravidlo
		expect(pridavnaKolajnicaZHistorie(posuv('Štandard', '2x2K IZO', sietka), false)).toEqual({
			pridavna: true,
			presne: true
		});
	});

	it('štýl bez prídavnej koľajnice (Štandard + 6K) neovplyvní výsledok', () => {
		expect(
			pridavnaKolajnicaZHistorie(
				{ posuvy: [posuv('Štandard', '3K IZO'), posuv('Štandard +', '6K IZO')] },
				false
			)
		).toEqual({ pridavna: true, presne: true });
	});
});

describe('„Použiť znova" — starý odpis starého Štandardu IZO sa zopakuje rovnako', () => {
	const detailJeden = (styl: string, sklo: string, extra: Record<string, unknown> = {}) => ({
		system: 'Štandard',
		styl,
		s: 3000,
		v: 2400,
		sklo,
		skloZaklad: sklo,
		otvaranie: 'P - L',
		pridavnaKolajnica: false,
		...extra
	});

	it('starý 3K IZO (bez príznaku, flag false) → predvyplní prídavnú koľajnicu', () => {
		const z = znovaZOdpisu(vlozOdpis('ZAK-618-Z1', detailJeden('3K IZO', IZO)))!;
		expect(z.vstup!.pridavnaKolajnica).toBe(true);
		expect(z.chybajuce).toEqual([]);
	});

	it('nový 3K IZO s ODŠKRTNUTOU prídavnou (príznak) → ostane odškrtnutá', () => {
		const z = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z2', detailJeden('3K IZO', IZO, { ...PRIDAVNA_VOLBA_DETAIL }))
		)!;
		expect(z.vstup!.pridavnaKolajnica).toBe(false);
	});

	it('starý basic 3K → bez prídavnej', () => {
		const z = znovaZOdpisu(vlozOdpis('ZAK-618-Z3', detailJeden('3K', FLOAT)))!;
		expect(z.vstup!.pridavnaKolajnica).toBe(false);
	});

	it('starý 2K IZO so sieťkou → prídavná + upozornenie, že sa presne nezopakuje', () => {
		const z = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z4', detailJeden('2K IZO', IZO, { sietka: { uchyt: 'ziadny' } }))
		)!;
		expect(z.vstup!.pridavnaKolajnica).toBe(true);
		expect(z.chybajuce).toEqual([POZOR_PRIDAVNA_Z_HISTORIE]);
	});

	it('stará zimná záhrada 3K IZO + 2K IZO (príloha úlohy) → prídavná pre obe', () => {
		const p = (styl: string) => ({
			system: 'Štandard',
			styl,
			s: 3000,
			v: 2400,
			sklo: IZO,
			skloZaklad: IZO,
			otvaranie: 'P - L'
		});
		const z = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z5', {
				zimnaZahrada: true,
				multiZasklenie: true,
				pridavnaKolajnica: false,
				posuvy: [p('3K IZO'), p('2K IZO')]
			})
		)!;
		expect(z.multiVstup!.pridavnaKolajnica).toBe(true);
		expect(z.chybajuce).toEqual([]);
	});

	// Odpis ukladá VYPOČÍTANÝ štýl (`3K IZO`), formulár Štandardov ponúka len počet krídel (IZO
	// vyberá sklo) — bez prevodu formulár štýl „3K IZO" nenašiel v ponuke a prepol ho na prvý (2K),
	// takže „Použiť znova" IZO odpisu ticho predvyplnilo INÝ nárezák (nález pri úlohe 1459).
	it('IZO odpis Štandardu → štýl bez prípony IZO (formulár ponúka len počet krídel)', () => {
		const z = znovaZOdpisu(vlozOdpis('ZAK-618-Z6', detailJeden('3K IZO', IZO)))!;
		expect(z.vstup!.styl).toBe('3K');
		expect(z.chybajuce).toEqual([]);
		const plus = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z7', {
				...detailJeden('2x3K IZO', IZO),
				system: 'Štandard +',
				...PRIDAVNA_VOLBA_DETAIL
			})
		)!;
		expect(plus.vstup!.styl).toBe('2x3K');
		// Robust/Slide/Deluxe majú štýl 1:1 — nemení sa
		const robust = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z8', {
				...detailJeden('3K', 'Izolačné sklo 4/16/4 číre'),
				system: 'Robust'
			})
		)!;
		expect(robust.vstup!.styl).toBe('3K');
	});

	it('stará zimná záhrada IZO → štýly posuvov bez prípony IZO', () => {
		const p = (styl: string) => ({
			system: 'Štandard',
			styl,
			s: 3000,
			v: 2400,
			sklo: IZO,
			skloZaklad: IZO,
			otvaranie: 'P - L'
		});
		const z = znovaZOdpisu(
			vlozOdpis('ZAK-618-Z9', {
				multiZasklenie: true,
				pridavnaKolajnica: false,
				posuvy: [p('3K IZO'), p('2K IZO')]
			})
		)!;
		expect(z.multiVstup!.posuvy.map((x) => x.styl)).toEqual(['3K', '2K']);
	});

	it('upozornenie je text pre obsluhu bez interných odkazov', () => {
		expect(POZOR_PRIDAVNA_Z_HISTORIE).toMatch(/Prídavná koľajnica/);
		expect(POZOR_PRIDAVNA_Z_HISTORIE).not.toMatch(/#\d|úloha|Patrik|v60/);
	});
});

describe('kiosk / backfill nárezákov — rekomputa starého odpisu dá tú istú koľajnicu ako Money', () => {
	const cfg = loadCfg();
	const vstup = {
		zak: 'ZAK-618-B',
		op: 'OP261459',
		zakaznik: 'Test',
		system: 'Štandard',
		styl: '3K',
		s: 3000,
		v: 2400,
		sklo: IZO,
		skloPresne: '',
		skloTrieda: null,
		otvaranie: 'P - L',
		kovanieL: '',
		kovanieP: '',
		kovanieStred: '',
		kovanieStredOkno: 'L' as const,
		vrtanieZamku: 1050,
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		kliny: [],
		kolajnica: null,
		sietka: null
	};
	// uložené Money položky starého odpisu = zväčšená spodná (rovnaké ako s prídavnou dnes)
	const ulozene = recomputeVstup({ ...vstup, pridavnaKolajnica: true }, cfg).r!.odpis.map((o) => ({
		kod: o.kod,
		nazov: o.nazov,
		qty: o.metre,
		mj: 'm' as const
	}));
	const row = (detail: unknown) => ({
		id: 1,
		modul: 'zasklenia',
		zak: 'ZAK-618-B',
		op: 'OP261459',
		zakaznik: 'Test',
		live: 1,
		content_hash: 'h',
		detail: JSON.stringify(detail),
		created_at: '2026-10-20 10:00:00'
	});
	const spodne = (m: { kod?: string; nazov: string }[]) =>
		m.filter((x) => /^Koľajnica\s+spodná/.test(x.nazov)).map((x) => x.kod);

	it('predpoklad: uložený odpis má zväčšenú spodnú ZASP00033', () => {
		expect(ulozene.map((p) => p.kod)).toContain('ZASP00033');
	});

	it('starý odpis (bez príznaku) → spodná ZASP00033, žiadny drift', () => {
		const res = mapOdpisToLines(
			row({ system: 'Štandard', styl: '3K IZO', pridavnaKolajnica: false, vstupRaw: vstup }),
			ulozene,
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(spodne(res.material)).toEqual(['ZASP00033']);
		expect(res.drift).toBe(false);
	});

	it('nový odpis s odškrtnutou prídavnou → základná spodná ZASP00030', () => {
		const res = mapOdpisToLines(
			row({
				...PRIDAVNA_VOLBA_DETAIL,
				system: 'Štandard',
				styl: '3K IZO',
				pridavnaKolajnica: false,
				vstupRaw: vstup
			}),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(spodne(res.material)).toEqual(['ZASP00030']);
	});

	it('stará zimná záhrada 3K IZO + 2K IZO → zväčšené spodné ZASP00033 + ZASP00030', () => {
		const pv = (styl: string) => ({
			system: 'Štandard',
			styl,
			s: 3000,
			v: 2400,
			sklo: IZO,
			skloPresne: '',
			skloTrieda: null,
			otvaranie: 'P - L',
			kovanieL: '',
			kovanieP: '',
			kovanieStred: '',
			kovanieStredOkno: 'L' as const,
			kliny: [],
			kolajnica: null,
			sietka: null
		});
		const multi = {
			zak: 'ZAK-618-BM',
			op: 'OP261460',
			zakaznik: 'Test',
			poznamka: '',
			ral: '',
			caka: false,
			pridavnaKolajnica: false,
			jednostrannaFab: false,
			farbaKovania: null,
			posuvy: [pv('3K'), pv('2K')]
		};
		const res = mapOdpisToLines(
			row({
				multiZasklenie: true,
				zimnaZahrada: true,
				pridavnaKolajnica: false,
				posuvy: [
					{ system: 'Štandard', styl: '3K IZO' },
					{ system: 'Štandard', styl: '2K IZO' }
				],
				vstupRaw: multi
			}),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(spodne(res.material).sort()).toEqual(['ZASP00030', 'ZASP00033']);
	});
});

describe('odoslanie zasklení — nový odpis nesie príznak a Money položky podľa checkboxu', () => {
	function fd(body: Record<string, string>): FormData {
		const f = new FormData();
		for (const [k, v] of Object.entries(body)) f.append(k, v);
		return f;
	}
	const ev = (body: Record<string, string>) =>
		({
			request: new Request('http://x/zasklenia', { method: 'POST', body: fd(body) }),
			locals: { user: { id: 1, username: 'tester', role: 'internal' } }
		}) as never;
	const posledny = () =>
		db.prepare('SELECT id, detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
			id: number;
			detail: string;
		};
	const polozky = (id: number) =>
		(
			db.prepare('SELECT kod FROM odpis_polozky WHERE odpis_log_id = ?').all(id) as {
				kod: string;
			}[]
		).map((p) => p.kod);
	const ZAKLAD = {
		op: '01',
		zakaznik: 'X',
		system: 'Štandard',
		styl: '3K',
		s: '3000',
		v: '2400',
		sklo: IZO,
		otvaranie: 'P - L',
		farbaKovania: 'R9005'
	};

	it('starý Štandard 3K IZO s prídavnou → ZASP00033 do Money + príznak v detail', async () => {
		const r = await zasklenia.actions.odoslat(
			ev({ ...ZAKLAD, zak: 'ZAK-618-O1', pridavnaKolajnica: '1' })
		);
		expect(r).toMatchObject({ step: 'hotovo' });
		const p = posledny();
		const d = JSON.parse(p.detail) as Record<string, unknown>;
		expect(d.pridavnaVolbaStandard).toBe(true);
		expect(d.pridavnaKolajnica).toBe(true);
		expect(polozky(p.id)).toContain('ZASP00033');
		expect(polozky(p.id)).not.toContain('ZASP00030');
	});

	it('starý Štandard 3K IZO bez prídavnej → základná ZASP00030 do Money', async () => {
		const r = await zasklenia.actions.odoslat(ev({ ...ZAKLAD, zak: 'ZAK-618-O2' }));
		expect(r).toMatchObject({ step: 'hotovo' });
		const p = posledny();
		expect((JSON.parse(p.detail) as Record<string, unknown>).pridavnaVolbaStandard).toBe(true);
		expect(polozky(p.id)).toContain('ZASP00030');
		expect(polozky(p.id)).not.toContain('ZASP00033');
	});

	it('zimná záhrada (3K IZO + 2K IZO) bez prídavnej → spodné 3K a 2K, príznak v detail', async () => {
		const posuvy = JSON.stringify([
			{ system: 'Štandard', styl: '3K', s: 3000, v: 2400, sklo: IZO, otvaranie: 'P - L' },
			{ system: 'Štandard', styl: '2K', s: 2600, v: 2400, sklo: IZO, otvaranie: 'P - L' }
		]);
		const r = await zasklenia.actions.odoslatMulti(
			ev({ zak: 'ZAK-618-O3', op: '01', zakaznik: 'X', farbaKovania: 'R9005', posuvy })
		);
		expect(r).toMatchObject({ step: 'hotovoMulti' });
		const p = posledny();
		expect((JSON.parse(p.detail) as Record<string, unknown>).pridavnaVolbaStandard).toBe(true);
		expect(polozky(p.id)).toEqual(expect.arrayContaining(['ZASP00030', 'ZASP00104']));
		expect(polozky(p.id)).not.toContain('ZASP00033');
	});
});
