// #419 extended scope: PDF expedičného zoznamu. Metadáta (Title/Subject/Keywords) sú
// testovateľný kanál hodnôt — custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať
// (viď dopyt-ponuka.md). VŠETKY qty/kódy/rozmery sú VYMYSLENÉ (repo je verejné).
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	generateExpediciaPdf,
	generateExpediciaPdfBase64,
	expediciaPdfFilename
} from '../src/lib/server/expedicia-pdf';
import type { ExpedicnyZoznam } from '../src/lib/pergola-expedicia';

const NOW = new Date('2026-09-05T10:30:00Z');

const baseZoznam: ExpedicnyZoznam = {
	polozky: [
		{
			skupina: 'profil',
			poz: 1,
			kod: '18017',
			nazov: 'Predná noha 140×140',
			pocetKs: 4,
			dlzkaRezuMm: 2215,
			rozmerInfo: null
		},
		{
			skupina: 'profil',
			poz: 2,
			kod: '18021',
			nazov: 'Žľabový profil',
			pocetKs: 1,
			dlzkaRezuMm: 5760,
			rozmerInfo: null
		},
		{
			skupina: 'komponent',
			poz: null,
			kod: '24007',
			nazov: 'Spojka U',
			pocetKs: null,
			dlzkaRezuMm: null,
			rozmerInfo: null
		},
		{
			skupina: 'stresne-sklo',
			poz: null,
			kod: null,
			nazov: 'Strešné sklo — Float kalené 6 mm',
			pocetKs: 7,
			dlzkaRezuMm: null,
			rozmerInfo: '705,4 × 3259,76 mm'
		},
		{
			skupina: 'fix-vypln',
			poz: null,
			kod: null,
			nazov: 'FIX výplň pole 1',
			pocetKs: 1,
			dlzkaRezuMm: null,
			rozmerInfo: '3500 × 2200/2900 mm'
		},
		{
			skupina: 'tesnenie',
			poz: null,
			kod: null,
			nazov: 'Tesnenie žľabu',
			pocetKs: null,
			dlzkaRezuMm: 5760,
			rozmerInfo: null
		},
		{
			skupina: 'drobny-material',
			poz: null,
			kod: null,
			nazov: 'Spojovací a drobný materiál',
			pocetKs: null,
			dlzkaRezuMm: null,
			rozmerInfo: null
		}
	],
	pocetProfilov: 2,
	pocetKomponentov: 1,
	pocetSkiel: 1,
	pocetFixov: 1,
	pocetTesneni: 1,
	spoluKusov: 13,
	honestNullSkupiny: ['komponenty', 'drobný materiál']
};

const IDENT = { zak: 'ZAK2026500', op: 'OP260500', zakaznik: 'Test Zákazník s.r.o.' };

describe('generateExpediciaPdf (#419)', () => {
	it('vyprodukuje platný PDF (%PDF hlavička), malý zoznam = 1 strana', async () => {
		const bytes = await generateExpediciaPdf(baseZoznam, IDENT, NOW);
		expect(bytes.length).toBeGreaterThan(1000);
		expect(bytes.length).toBeLessThan(300_000);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
	});

	it('metadáta nesú zak/op/zákazníka/počet položiek (testovateľný kanál)', async () => {
		const bytes = await generateExpediciaPdf(baseZoznam, IDENT, NOW);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toContain('ZAK2026500');
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('Zákazka: ZAK2026500');
		expect(subject).toContain('Objednávka: OP260500');
		expect(subject).toContain('Zákazník: Test Zákazník s.r.o.');
		expect(subject).toContain('Položiek: 7');
		expect(subject).toContain('Spolu ks: 13');
		const kw = doc.getKeywords() ?? '';
		expect(kw).toContain('ZAK2026500');
		expect(kw).toContain('OP260500');
		expect(kw).toContain('expedičný zoznam');
	});

	it('prázdny zoznam nevyhodí chybu', async () => {
		const prazdny: ExpedicnyZoznam = {
			polozky: [],
			pocetProfilov: 0,
			pocetKomponentov: 0,
			pocetSkiel: 0,
			pocetFixov: 0,
			pocetTesneni: 0,
			spoluKusov: 0,
			honestNullSkupiny: []
		};
		const bytes = await generateExpediciaPdf(prazdny, IDENT, NOW);
		expect(bytes.length).toBeGreaterThan(1000);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject()).toContain('Položiek: 0');
	});

	it('metadáta NEOBSAHUJÚ Money kódy ani ceny (Money-neutrálne)', async () => {
		const bytes = await generateExpediciaPdf(baseZoznam, IDENT, NOW);
		const doc = await PDFDocument.load(bytes);
		const all = [
			doc.getTitle() ?? '',
			doc.getSubject() ?? '',
			doc.getKeywords() ?? '',
			doc.getAuthor() ?? ''
		].join(' ');
		// žiadna cenová informácia — expedícia je bez cien
		expect(all).not.toMatch(/€|EUR|cena|price/i);
		// žiadne Money-only referencie
		expect(all).not.toMatch(/priceB2B|ve[ľl]koobchod/i);
	});
});

describe('generateExpediciaPdfBase64', () => {
	it('vráti platný base64 string', async () => {
		const b64 = await generateExpediciaPdfBase64(baseZoznam, IDENT, NOW);
		expect(typeof b64).toBe('string');
		const bytes = Buffer.from(b64, 'base64');
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
	});
});

describe('expediciaPdfFilename', () => {
	it('obsahuje ZAK a časovú pečiatku', () => {
		const name = expediciaPdfFilename('ZAK2026500', NOW);
		expect(name).toContain('ZAK2026500');
		expect(name).toMatch(/20260905/);
		expect(name).toMatch(/\.pdf$/);
	});

	it('sanitizuje špeciálne znaky v ZAK', () => {
		const name = expediciaPdfFilename('ZAK/special <chars>', NOW);
		expect(name).not.toMatch(/[<>/]/);
		expect(name).toMatch(/\.pdf$/);
	});
});
