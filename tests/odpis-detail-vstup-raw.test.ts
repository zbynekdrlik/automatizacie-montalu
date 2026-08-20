// #156 (krok 0 pre #155): appka doteraz zahadzovala surový vstup odpisu — v
// `odpis_log.detail` boli len odvodené/vybrané polia. Pre budúce generovanie
// nárezu z rozmerov (#155) je surový vstup tréningová/verifikačná dáta, ktorá sa
// nesmú stratiť. Tento test overuje, že KAŽDÝ z troch modulov (pergola, zasklenia
// — jednoposuv aj viac posuvov, bazén) uloží surový vstup 1:1 do `detail`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-detail-raw-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { db } = await import('../src/lib/server/db');
const pergola = await import('../src/routes/pergola/+page.server');
const zasklenia = await import('../src/routes/zasklenia/+page.server');
const bazen = await import('../src/routes/bazen/+page.server');
const { transform, comboOptionLabel } = await import('../src/lib/server/pergola');
const { parseVstup, parseMultiVstup, parseBazenVstup } = await import('../src/lib/server/vstup');

function fd(body: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return f;
}

function ev(mod: string, body: Record<string, string>) {
	return {
		request: new Request('http://x/' + mod, { method: 'POST', body: fd(body) }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as never;
}

const lastDetail = () =>
	JSON.parse(
		(
			db.prepare('SELECT detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
				detail: string;
			}
		).detail
	);

describe('pergola — detail.cad + detail.komboVolby (#156)', () => {
	// jediný riadok s rezom 9120 > 7500 vyvolá 1 comboCase (rovnaký profil ako
	// v tests/pergola.test.ts STEPANOVSKY vektore, overený proti Money)
	const CAD = '18021 ZLABOVY PROFIL 110 V2\t1\t9120';

	it('surový CAD text sa uloží 1:1 do detail.cad', async () => {
		const r = await pergola.actions.odoslat(
			ev('pergola', { zak: 'ZAK-P1', op: '01', zakaznik: 'X', cad: CAD })
		);
		expect(r).toMatchObject({ step: 'hotovo' });
		expect(lastDetail().cad).toBe(CAD);
	});

	it('zvolená (NIE default) kombinácia tyčí sa uloží do detail.komboVolby', async () => {
		const t = transform(CAD);
		expect(t.comboCases.length).toBe(1);
		// vyber alternatívu odlišnú od default (options[0] = najmenej odpadu = default)
		const alt = t.comboCases[0]!.options[1];
		expect(alt).toBeTruthy();
		const altLabel = comboOptionLabel(alt!, false);

		const r = await pergola.actions.odoslat(
			ev('pergola', { zak: 'ZAK-P2', op: '01', zakaznik: 'X', cad: CAD, combo_0: altLabel })
		);
		expect(r).toMatchObject({ step: 'hotovo' });
		const d = lastDetail();
		expect(d.cad).toBe(CAD);
		expect(Array.isArray(d.komboVolby)).toBe(true);
		expect(d.komboVolby).toHaveLength(1);
		expect(d.komboVolby[0]).toMatchObject({
			idx: 0,
			fieldLabel: t.comboCases[0]!.fieldLabel,
			selected: altLabel
		});
		// zvolená hodnota NIE je default (inak by test o ničom nevypovedal)
		expect(d.komboVolby[0].selected).not.toBe(comboOptionLabel(t.comboCases[0]!.options[0]!, true));
	});

	// review nález #1: detail.cad musí byť bound-ovaný, nie neobmedzený
	it('patologicky veľký CAD paste sa v detail.cad odstrihne na CAD_DETAIL_MAX (20 000 znakov)', async () => {
		const line = '18004 PRIECKOVY PROFIL 105\t9\t3871';
		// \r\n (nie holé \n) — presne to, čo reálny <textarea> multipart form-data POST
		// pošle (aj tento testový FormData/Request round-trip to tak serializuje);
		// parseCad() si \r pri parsovaní strihá sám (L205), takže na výpočet to nemá vplyv
		const bigCad = Array(700).fill(line).join('\r\n');
		expect(bigCad.length).toBeGreaterThan(20000);

		const r = await pergola.actions.odoslat(
			ev('pergola', { zak: 'ZAK-P3', op: '01', zakaznik: 'X', cad: bigCad })
		);
		expect(r).toMatchObject({ step: 'hotovo' });
		const d = lastDetail();
		expect(d.cad.length).toBe(20000);
		expect(d.cad).toBe(bigCad.slice(0, 20000));
		// explicitný timeout: pod Stryker perTest inštrumentáciou (pergola.ts v diff scope)
		// stojí 700-riadkový CAD parse viac než default 5 s — trieda z testing.md (#261
		// login-timing precedens): timeout rieši trpezlivosť harnessu, tvrdenie sa nemení
	}, 30_000);
});

describe('zasklenia — jednoposuv: detail.vstupRaw == naparsovaný Vstup 1:1 (#156)', () => {
	// review nález #2: klin/kolajnica/sietka NEsmú ostať null, inak toEqual
	// nedokáže, že sa vnorené objekty naozaj prenesú (nielen ploché polia)
	const BODY = {
		zak: 'ZAK-Z1',
		op: '01',
		zakaznik: 'X',
		system: 'Slide',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/8/4 číre',
		otvaranie: 'P - L',
		poznamka: 'test poznámka',
		ral: 'RAL 9016',
		klin: '1',
		klinDlzka: '500',
		klinSirka: '300',
		klinV1: '200',
		klinV2: '150',
		klinKs: '2',
		kolajnicaHorna: '2690',
		kolajnicaSpodna: '2695',
		sietka: '1',
		sietkaUchyt: 'zamok'
	};

	it('vstupRaw je hlboko rovný tomu, čo parseVstup naparsuje z tých istých polí (vrátane klin/kolajnica/sietka)', async () => {
		const { vstup: expected } = parseVstup(fd(BODY));
		expect(expected.klin).not.toBeNull();
		expect(expected.kolajnica).not.toBeNull();
		expect(expected.sietka).not.toBeNull();
		const r = await zasklenia.actions.odoslat(ev('zasklenia', BODY));
		expect(r).toMatchObject({ step: 'hotovo' });
		const d = lastDetail();
		expect(d.vstupRaw).toEqual(expected);
	});
});

describe('zasklenia — viac posuvov: detail.vstupRaw == naparsovaný MultiVstup 1:1 (#156)', () => {
	// review nález #2: prvý posuv nesie vnorené klin/kolajnica/sietka objekty
	const posuvy = JSON.stringify([
		{
			system: 'Slide',
			styl: '3K',
			s: 3000,
			v: 2000,
			sklo: 'Izolačné sklo 4/8/4 číre',
			otvaranie: 'P - L',
			klin: { dlzka: 500, sirka: 300, v1: 200, v2: 150, ks: 2 },
			kolajnica: { horna: 2690, spodna: 2695 },
			sietka: { uchyt: 'zamok' }
		}
	]);
	const BODY = { zak: 'ZAK-Z2', op: '01', zakaznik: 'X', posuvy };

	it('vstupRaw je hlboko rovný tomu, čo parseMultiVstup naparsuje z tých istých polí (vrátane klin/kolajnica/sietka)', async () => {
		const { vstup: expected } = parseMultiVstup(fd(BODY));
		expect(expected.posuvy[0]!.klin).not.toBeNull();
		expect(expected.posuvy[0]!.kolajnica).not.toBeNull();
		expect(expected.posuvy[0]!.sietka).not.toBeNull();
		const r = await zasklenia.actions.odoslatMulti(ev('zasklenia', BODY));
		expect(r).toMatchObject({ step: 'hotovoMulti' });
		const d = lastDetail();
		expect(d.vstupRaw).toEqual(expected);
	});
});

describe('bazén — detail.vstupRaw == naparsovaný BazenVstup 1:1 (#156)', () => {
	const BODY = {
		zak: 'ZAK-B1',
		op: '01',
		zakaznik: 'X',
		model: 'Premier / Exclusive',
		kolaj: 'Jednokolaj',
		pocetSekcii: '3',
		pocetPriecok: '2',
		vs4500: '1',
		ss6000: '1',
		dlzkaKolajnic: '10000',
		prieckovy4300: '1',
		vyklopneCelo: '1'
	};

	it('vstupRaw nesie AJ polia, ktoré doterajší detail vôbec neukladal (pocetPriecok, vs4500…)', async () => {
		const { vstup: expected } = parseBazenVstup(fd(BODY));
		const r = await bazen.actions.odoslat(ev('bazen', BODY));
		expect(r).toMatchObject({ step: 'hotovo' });
		const d = lastDetail();
		expect(d.vstupRaw).toEqual(expected);
		// explicitne — presne tie polia, čo issue #156 volá ako chýbajúce
		expect(d.vstupRaw.pocetPriecok).toBe(2);
		expect(d.vstupRaw.vs4500).toBe(1);
		expect(d.vstupRaw.dlzkaKolajnic).toBe(10000);
		expect(d.vstupRaw.prieckovy4300).toBe(1);
		expect(d.vstupRaw.vyklopneCelo).toBe(1);
	});
});
