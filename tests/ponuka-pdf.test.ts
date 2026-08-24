// #277 — PDF generátor. Custom-font glyfy sa z PDF textu nedajú spoľahlivo prečítať, preto
// overujeme REÁLNE hodnoty cez metadáta (ktoré pdf-lib vie načítať späť) + invariant NULA
// cien. Aj že PDF je platný (%PDF, loadovateľný pdf-libom) a že PNG slot funguje.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';
import type { PonukaConfig } from '../src/lib/ponuka';

// 1×1 transparentný PNG (validný) pre slot embed test.
const PNG_1x1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

const FULL: PonukaConfig = {
	system: 'Robust',
	model: 'ROBUST',
	typStrechy: 'bioklimatická lamelová',
	sirka: 3000,
	hlbka: 4000,
	vyskaVpredu: 2500,
	vyskaPriStene: 2800,
	pocetPoli: 3,
	farba: 'RAL 7016',
	sklo: 'Deluxe Float'
};

async function meta(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	return {
		title: doc.getTitle() ?? '',
		subject: doc.getSubject() ?? '',
		keywords: doc.getKeywords() ?? '',
		producer: doc.getProducer() ?? '',
		pages: doc.getPageCount()
	};
}

describe('generatePonukaPdf', () => {
	// #279 Fáza C — leak-guard REDEFINÍCIA (owner ROZHODNUTÉ issuecomment-5396941067): PDF ponuka
	// TERAZ nesie ORIENTAČNÚ predajnú cenu. Zmenené z „INVARIANT: nikde žiadna cena" na „cena JE,
	// ale žiadna VEĽKOOBCHODNÁ (VO) cena / Money kód".
	it('vytvorí platný A4 PDF s konfiguráciou + orientačnou cenou v metadátach (#279 Fáza C)', async () => {
		const bytes = await generatePonukaPdf(FULL, { datum: '23.08.2026' });
		expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
		const m = await meta(bytes);
		expect(m.pages).toBe(1);
		expect(m.title).toMatch(/Špecifikácia/);
		// reálne hodnoty konfigurácie sú v subjecte
		expect(m.subject).toContain('Robust');
		expect(m.subject).toContain('Model: ROBUST');
		expect(m.subject).toContain('3000 × 4000 mm');
		expect(m.subject).toContain('RAL 7016');
		expect(m.subject).toContain('Deluxe Float');
		// keywords nesú jednotlivé hodnoty
		expect(m.keywords).toContain('Robust');
		// POZITÍVNE: orientačná cena JE v metadátach (€ + marker)
		expect(m.subject).toMatch(/Orientačná cena:.*€/);
		expect(m.keywords).toMatch(/orientačná cena/i);
		// NEGATÍVNE: žiadna veľkoobchodná (VO) cena ani Money kód/marker „bez cien"
		expect(m.subject).not.toMatch(/priceB2B|veľkoobchod|VO cena/i);
		expect(m.keywords).not.toMatch(/priceB2B|veľkoobchod/i);
		expect(m.keywords).not.toMatch(/bez cien/i);
	});

	it('embedne validný PNG render (bez pádu) a ostane platné PDF', async () => {
		const bytes = await generatePonukaPdf(FULL, { renderPng: new Uint8Array(PNG_1x1) });
		expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
	});

	it('nevalidný PNG → placeholder, nespadne', async () => {
		const bytes = await generatePonukaPdf(FULL, { renderPng: new Uint8Array([1, 2, 3, 4, 5]) });
		expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
	});

	it('prázdna konfigurácia → platné PDF, subject "Prázdna konfigurácia"', async () => {
		const bytes = await generatePonukaPdf({});
		const m = await meta(bytes);
		expect(m.subject).toBe('Prázdna konfigurácia');
	});

	it('len jeden rozmer + dlhá hodnota (zalomenie) → platné PDF', async () => {
		const bytes = await generatePonukaPdf({
			sirka: 3000,
			vyskaVpredu: 2500,
			popis:
				'Veľmi dlhý popis konfigurácie, ktorý sa musí zalomiť na viac riadkov v PDF súhrne, aby sme overili wrap logiku a viacriadkový posun kurzora.'
		});
		expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
	});
});
