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
import { insertDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';
import { verejnaCenaPreModel } from '../src/lib/server/konfigurator-cena';

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
