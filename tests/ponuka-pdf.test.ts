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
	typStrechy: 'bioklimatická lamelová',
	sirka: 3000,
	hlbka: 4000,
	vyskaVpredu: 2500,
	vyskaPriStene: 2800,
	pocetPoli: 3,
	farba: 'RAL 7016',
	sklo: 'Deluxe Float'
};

const PRICE_RE = /€|EUR|\bcena\b|\bprice\b|\d+[,.]\d{2}\s*(?:€|eur)/i;

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
	it('vytvorí platný A4 PDF s konfiguráciou v metadátach (reálne hodnoty) a bez cien', async () => {
		const bytes = await generatePonukaPdf(FULL, { datum: '23.08.2026' });
		expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
		const m = await meta(bytes);
		expect(m.pages).toBe(1);
		expect(m.title).toMatch(/Špecifikácia/);
		// reálne hodnoty konfigurácie sú v subjecte
		expect(m.subject).toContain('Robust');
		expect(m.subject).toContain('3000 × 4000 mm');
		expect(m.subject).toContain('RAL 7016');
		expect(m.subject).toContain('Deluxe Float');
		// keywords nesú jednotlivé hodnoty
		expect(m.keywords).toContain('Robust');
		// INVARIANT: nikde žiadna cena
		expect(m.subject).not.toMatch(PRICE_RE);
		expect(m.keywords).not.toMatch(PRICE_RE);
		expect(m.title).not.toMatch(PRICE_RE);
		// pozitívny marker, že ide o špecifikáciu bez cien
		expect(m.keywords).toMatch(/bez cien/i);
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
