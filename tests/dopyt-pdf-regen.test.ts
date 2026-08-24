// #282/#279 Fáza C — znovu-vygenerovanie PDF ponuky pre uložený dopyt. Overuje, že sa PDF
// regeneruje z ULOŽENEJ konfigurácie (metadáta = testovateľný kanál hodnôt, viď dopyt-ponuka.md),
// názov súboru, orientačná MO cena (Fáza C) bez VO ceny, a null pre neexistujúce id. Zdieľaná
// test DB (v26). Pozn.: regen počíta cenu z AKTUÁLNEHO cenníka (historická presnosť → #309).
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { db } from '../src/lib/server/db';
import { insertDopyt } from '../src/lib/server/dopyt-store';
import { regeneratePonukaPdf } from '../src/lib/server/dopyt-pdf';

const CFG = {
	system: 'Robust',
	model: 'ROBUST',
	typStrechy: 'bioklimatická lamelová',
	sirka: 3000,
	hlbka: 4000,
	farba: 'RAL 7016',
	sklo: 'Deluxe Float'
};

describe('regeneratePonukaPdf (#282)', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('regeneruje platné PDF z uloženej konfigurácie (reálne hodnoty v metadátach)', async () => {
		const id = insertDopyt({
			konfiguracia: JSON.stringify(CFG),
			meno: 'Ján Novák',
			email: 'jan@example.com',
			telefon: '',
			miesto: 'Bratislava',
			poznamka: ''
		});
		const out = await regeneratePonukaPdf(id);
		expect(out).not.toBeNull();
		expect(Buffer.from(out!.bytes.slice(0, 5)).toString()).toBe('%PDF-');

		const doc = await PDFDocument.load(out!.bytes);
		const subject = doc.getSubject() ?? '';
		// uložená konfigurácia sa reálne dostala do PDF
		expect(subject).toContain('Robust');
		expect(subject).toContain('3000 × 4000 mm');
		expect(subject).toContain('RAL 7016');
		expect(subject).toContain('Deluxe Float');
		// #279 Fáza C: regenerované PDF nesie ORIENTAČNÚ cenu (€), ale NIKDY ve[ľl]koobchod (VO)
		expect(subject).toMatch(/Orientačná cena:.*€/);
		expect(subject).not.toMatch(/priceB2B|ve[ľl]koobchod/i);
		expect(doc.getKeywords() ?? '').not.toMatch(/priceB2B|ve[ľl]koobchod|bez cien/i);
	});

	it('názov súboru nesie id dopytu + dátum (interný re-download kontext)', async () => {
		const id = insertDopyt({
			konfiguracia: '{}',
			meno: 'X',
			email: 'x@y.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const out = await regeneratePonukaPdf(id);
		expect(out!.filename).toMatch(
			new RegExp(`^Montalu-ponuka-dopyt-${id}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`)
		);
	});

	it('neexistujúce id → null (volajúci → 404)', async () => {
		expect(await regeneratePonukaPdf(999999)).toBeNull();
	});
});
