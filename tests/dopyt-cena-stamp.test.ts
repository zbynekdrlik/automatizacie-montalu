// #309 — opečiatkovanie ceny + verzie cenníka pri PODANÍ dopytu (historická presnosť).
// Jadro defektu: `regeneratePonukaPdf` prepočítava orientačnú cenu zo ŽIVEJ matice
// (`cennik-pergola.json`), takže re-download starého dopytu NEreprodukuje dokument, ktorý
// zákazník reálne dostal — každá zmena matice retroaktívne prepíše „historické" PDF.
//
// RED (defekt tvar): opečiatkuj cenu ODLIŠNÚ od tej, ktorú by dala živá matica (= stojí za
// „inú/staršiu maticu"), regeneruj PDF a over, že regen reprodukuje OPEČIATKOVANÚ hodnotu,
// nie živú. Bez fixu regen prepočíta zo živej matice → opečiatkovaná hodnota v PDF chýba.
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';
import { CENNIK_VERZIA, verejnaCenaPreModel } from '../src/lib/server/konfigurator-cena';
import {
	cenaZoStampu,
	opeciatkujCenu,
	stampNaStlpce,
	type CenaStamp
} from '../src/lib/server/dopyt-cena-stamp';

const CFG = { system: 'Robust', model: 'ROBUST', sirka: 3000, hlbka: 4000, farba: 'RAL 7016' };

describe('#309 re-download reprodukuje OPEČIATKOVANÚ cenu (nie živú maticu)', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('regen opečiatkovaného dopytu ukáže uloženú cenu aj keď sa líši od živej matice', async () => {
		// „Historická" opečiatkovaná cena — zámerne ODLIŠNÁ od toho, čo dá živá matica pre 3000×4000
		// ROBUST (= reprezentuje maticu platnú v čase podania, ktorá sa medzitým zmenila).
		const STAMP_BEZ_DPH = 1234.0;
		const STAMP_S_DPH = Math.round(1234.0 * 1.23 * 100) / 100; // 1517,82
		const zivaCena = verejnaCenaPreModel({ hlbkaMm: 4000, sirkaMm: 3000, model: 'ROBUST' });
		// sanity: opečiatkovaná cena sa REÁLNE líši od živej (inak by test nič nedokazoval)
		expect(zivaCena.druh).toBe('cena');
		if (zivaCena.druh === 'cena') expect(zivaCena.sDph).not.toBe(STAMP_S_DPH);

		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify(CFG),
				meno: 'Ján Novák',
				email: 'jan@example.com',
				telefon: '',
				miesto: 'Bratislava',
				poznamka: ''
			},
			{
				cena: {
					druh: 'cena',
					model: 'ROBUST',
					bezDph: STAMP_BEZ_DPH,
					sDph: STAMP_S_DPH,
					hlbkaGridM: 4,
					sirkaGridM: 3
				},
				cennikVerzia: '2020-01-01T00:00:00.000Z#deadbeefcafe'
			}
		);

		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		const subject = (await PDFDocument.load(out!.bytes)).getSubject() ?? '';
		// regen MUSÍ niesť OPEČIATKOVANÚ cenu (1 517,82 € s DPH), nie prepočet zo živej matice
		expect(subject).toContain('1 517,82 € s DPH');
	});
});

describe('#309 CENNIK_VERZIA (verzia cenníka)', () => {
	it('má tvar <vytazene>#<12-hex hash>', () => {
		expect(CENNIK_VERZIA).toMatch(/^.+#[0-9a-f]{12}$/);
		// obsahuje ISO čas vyťaženia zo seedu
		expect(CENNIK_VERZIA).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe('#309 opeciatkujCenu', () => {
	it('rozmery prítomné → opečiatkuje konkrétnu cenu + aktuálnu verziu', () => {
		const s = opeciatkujCenu({ sirka: 4000, hlbka: 4000, model: 'ROBUST' });
		expect(s.cennikVerzia).toBe(CENNIK_VERZIA);
		expect(s.cena).not.toBeNull();
		expect(s.cena!.druh).toBe('cena');
	});

	it('rozmery chýbajú → cena null, verzia sa aj tak uloží (audit)', () => {
		const s = opeciatkujCenu({ system: 'Robust' });
		expect(s.cena).toBeNull();
		expect(s.cennikVerzia).toBe(CENNIK_VERZIA);
	});
});

describe('#309 stampNaStlpce (pečiatka → uložiteľné stĺpce)', () => {
	it('bez stampu → všetko NULL (neopečiatkovaný riadok)', () => {
		expect(stampNaStlpce(undefined)).toEqual({
			cena_druh: null,
			cena_bez_dph: null,
			cena_s_dph: null,
			cena_hlbka_grid_m: null,
			cena_sirka_grid_m: null,
			cena_model: null,
			cennik_verzia: null
		});
	});

	it('cena null (bez rozmerov) → sumy NULL, verzia sa uloží', () => {
		const cols = stampNaStlpce({ cena: null, cennikVerzia: 'v#1' });
		expect(cols.cena_druh).toBeNull();
		expect(cols.cennik_verzia).toBe('v#1');
	});

	it('druh cena → uloží sumy, grid rozmery, model a verziu', () => {
		const stamp: CenaStamp = {
			cena: {
				druh: 'cena',
				model: 'MASSIVE',
				bezDph: 100,
				sDph: 123,
				hlbkaGridM: 4.5,
				sirkaGridM: 5
			},
			cennikVerzia: 'v#2'
		};
		expect(stampNaStlpce(stamp)).toEqual({
			cena_druh: 'cena',
			cena_bez_dph: 100,
			cena_s_dph: 123,
			cena_hlbka_grid_m: 4.5,
			cena_sirka_grid_m: 5,
			cena_model: 'MASSIVE',
			cennik_verzia: 'v#2'
		});
	});

	it('individualna-ponuka → cena_druh + model + verzia, sumy NULL', () => {
		const cols = stampNaStlpce({
			cena: { druh: 'individualna-ponuka', model: 'LIGHT', dovod: 'mimo katalógu' },
			cennikVerzia: 'v#3'
		});
		expect(cols.cena_druh).toBe('individualna-ponuka');
		expect(cols.cena_model).toBe('LIGHT');
		expect(cols.cena_bez_dph).toBeNull();
		expect(cols.cena_s_dph).toBeNull();
	});
});

describe('#309 cenaZoStampu (rekonštrukcia z uložených stĺpcov)', () => {
	const nulColy = {
		cena_bez_dph: null,
		cena_s_dph: null,
		cena_hlbka_grid_m: null,
		cena_sirka_grid_m: null,
		cena_model: null,
		cennik_verzia: null
	};

	it('cena_druh === null → null (neopečiatkovaný riadok)', () => {
		expect(cenaZoStampu({ cena_druh: null, ...nulColy })).toBeNull();
	});

	it('druh cena → VerejnaCena so sumami a gridom', () => {
		const c = cenaZoStampu({
			cena_druh: 'cena',
			cena_bez_dph: 100,
			cena_s_dph: 123,
			cena_hlbka_grid_m: 4,
			cena_sirka_grid_m: 5,
			cena_model: 'ROBUST',
			cennik_verzia: 'v#1'
		});
		expect(c).toEqual({
			druh: 'cena',
			model: 'ROBUST',
			bezDph: 100,
			sDph: 123,
			hlbkaGridM: 4,
			sirkaGridM: 5
		});
	});

	it('druh individualna-ponuka → VerejnaCena individualna (dovod prázdny, nevykresľuje sa)', () => {
		const c = cenaZoStampu({
			cena_druh: 'individualna-ponuka',
			...nulColy,
			cena_model: 'MASSIVE'
		});
		expect(c).toEqual({ druh: 'individualna-ponuka', model: 'MASSIVE', dovod: '' });
	});
});

describe('#309 uloženie + regen pre stampované varianty', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('DB round-trip: insert s pečiatkou → getDopyt → cenaZoStampu vráti tú istú cenu', () => {
		const stamp = opeciatkujCenu({ sirka: 4000, hlbka: 4000, model: 'ROBUST' });
		const id = insertDopyt(
			{ konfiguracia: '{}', meno: 'A', email: 'a@b.sk', telefon: '', miesto: '', poznamka: '' },
			stamp
		);
		const row = getDopyt(id)!;
		expect(row.cennik_verzia).toBe(CENNIK_VERZIA);
		expect(cenaZoStampu(row)).toEqual(stamp.cena);
	});

	it('regen opečiatkovaného individualna-ponuka dopytu ukáže „Cena na vyžiadanie"', async () => {
		const id = insertDopyt(
			{
				konfiguracia: JSON.stringify({ system: 'X', sirka: 3000, hlbka: 4000 }),
				meno: 'B',
				email: 'b@x.sk',
				telefon: '',
				miesto: '',
				poznamka: ''
			},
			{ cena: { druh: 'individualna-ponuka', model: 'LIGHT', dovod: 'x' }, cennikVerzia: 'v#4' }
		);
		const out = await regeneratePonukaPdf(id);
		const subject = (await PDFDocument.load(out!.bytes)).getSubject() ?? '';
		expect(subject).toContain('Cena na vyžiadanie');
		expect(subject).toContain('model LIGHT');
	});

	it('neopečiatkovaný (starý) riadok → regen honest-degrade prepočíta zo živej matice', async () => {
		// bez pečiatky (starý caller) → cena_druh NULL → regen prepočíta (nezmenené správanie)
		const id = insertDopyt({
			konfiguracia: JSON.stringify({ system: 'X', model: 'ROBUST', sirka: 4000, hlbka: 4000 }),
			meno: 'C',
			email: 'c@x.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const ziva = verejnaCenaPreModel({ hlbkaMm: 4000, sirkaMm: 4000, model: 'ROBUST' });
		expect(ziva.druh).toBe('cena');
		const out = await regeneratePonukaPdf(id);
		const subject = (await PDFDocument.load(out!.bytes)).getSubject() ?? '';
		// prepočítaná (živá) cena je v PDF (honest-degrade — historickú sme neuložili)
		expect(subject).toContain('Orientačná cena:');
	});
});
