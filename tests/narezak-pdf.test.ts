// #529: GRAFICKÝ nárezák PDF (`narezak-pdf.ts`) — príloha na kiosk. Custom-font glyfy sa z PDF tela
// nedajú spoľahlivo čítať (viď `dopyt-ponuka.md`), preto sa hodnoty overujú cez metadáta
// (Title/Subject/Keywords) — testovateľný kanál. Kľúčové: N tyčí + rezy + uhol + odpad sú v
// metadátach a PDF NENESIE žiadne ceny. Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	generateNarezakPdf,
	generateNarezakPdfBase64,
	narezakPdfFilename,
	pocetProfilov,
	type NarezakPdfHeader
} from '../src/lib/server/narezak-pdf';
import { spocitajPlanRezov } from '../src/lib/server/plan-rezov';
import type { MaterialRow } from '../src/lib/server/compute';

const NOW = new Date('2026-09-16T08:30:00Z'); // CEST → 10:30 → stamp 20260916-1030

const HEADER: NarezakPdfHeader = { zak: 'ZAK123', op: 'OP260439', zakaznik: 'Firma s.r.o.' };

// Reálny výpočet (pure) — 2 profily (rovný rez), viac tyčí, nenulový odpad.
const vysledok = spocitajPlanRezov({
	dlzkaTyce: 6000,
	reznaMedzera: 4,
	riadky: [
		{ nazov: 'STABILIZAČNÝ PROFIL 100X50', ks: 3, rezMm: 2000 },
		{ nazov: 'STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1500 },
		{ nazov: 'LAT 80x19', ks: 4, rezMm: 1865 }
	]
});

// Hand-built MaterialRow s reálnym kódom (má obrázok), 45° rezom a posuvmi (zimná záhrada).
const sikmyProfil: MaterialRow = {
	kod: 'ZASP00002',
	nazov: 'RÁMOVÝ PROFIL',
	rezy: [
		{ rozmer: 2500, ks: 2 },
		{ rozmer: 1800, ks: 1 }
	],
	tyce: 1,
	bary: [
		{
			kusy: [
				{ rozmer: 2500, dlzka: 2504, posuv: 1 },
				{ rozmer: 2500, dlzka: 2504, posuv: 2 },
				{ rozmer: 1800, dlzka: 1804, posuv: 1 }
			],
			zvysok: 688
		}
	],
	odpadMm: 688,
	odpadPct: 9.2,
	barLen: 7500,
	sikmyRez: true
};

describe('generateNarezakPdf', () => {
	it('vyprodukuje platný PDF (%PDF hlavička)', async () => {
		const bytes = await generateNarezakPdf(HEADER, vysledok.material, {}, NOW);
		expect(bytes.length).toBeGreaterThan(1000);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
	});

	it('metadáta nesú zak/op/zákazníka + POČET TYČÍ + POČET REZOV + odpad (testovateľný kanál)', async () => {
		const bytes = await generateNarezakPdf(HEADER, vysledok.material, { dlzkaTyce: 6000 }, NOW);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toContain('ZAK123');
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('Zákazka: ZAK123');
		expect(subject).toContain('Objednávka: OP260439');
		expect(subject).toContain('Zákazník: Firma s.r.o.');
		expect(subject).toContain(`Profilov: ${pocetProfilov(vysledok.material)}`);
		// N tyčí = súčet m.tyce; N rezov = súčet kusov na tyčiach
		const tyceSpolu = vysledok.material.reduce((s, m) => s + m.tyce, 0);
		const rezovSpolu = vysledok.material.reduce(
			(s, m) => s + m.bary.reduce((a, b) => a + b.kusy.length, 0),
			0
		);
		expect(subject).toContain(`Tyčí: ${tyceSpolu}`);
		expect(subject).toContain(`Rezov: ${rezovSpolu}`);
		expect(subject).toMatch(/Odpad: \d/);
	});

	it('Keywords nesú per-profil digest tyčí a distinct dĺžok rezov (segment labels kanál)', async () => {
		const bytes = await generateNarezakPdf(HEADER, vysledok.material, {}, NOW);
		const kw = (await PDFDocument.load(bytes)).getKeywords() ?? '';
		expect(kw).toContain('nárezový plán');
		expect(kw).toContain('rezanie');
		// dĺžky rezov sa objavia v digeste (2000, 1500, 1865 — SK čiarka nemení celé čísla)
		expect(kw).toContain('2000');
		expect(kw).toContain('1865');
	});

	it('uhol rezu: rovný profil → "rovný", 45° profil → "45°" v metadátach', async () => {
		const rovny = await PDFDocument.load(
			await generateNarezakPdf(HEADER, vysledok.material, {}, NOW)
		);
		expect(rovny.getSubject() ?? '').toContain('Uhol: rovný');

		const sikmy = await PDFDocument.load(await generateNarezakPdf(HEADER, [sikmyProfil], {}, NOW));
		expect(sikmy.getSubject() ?? '').toContain('Uhol: 45°');
	});

	it('embedne obrázok profilu s reálnym kódom (ZASP00002) bez pádu a s posuvmi (zimná záhrada)', async () => {
		const bytes = await generateNarezakPdf(HEADER, [sikmyProfil], { viacPosuvov: true }, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		const doc = await PDFDocument.load(bytes);
		// 1 tyč, 3 rezy
		expect(doc.getSubject() ?? '').toContain('Tyčí: 1');
		expect(doc.getSubject() ?? '').toContain('Rezov: 3');
		// PDF s embednutým obrázkom je citeľne väčší než bez neho
		const bezObrazka = await generateNarezakPdf(
			HEADER,
			[{ ...sikmyProfil, kod: 'NEEXISTUJE' }],
			{},
			NOW
		);
		expect(bytes.length).toBeGreaterThan(bezObrazka.length + 500);
	});

	it('PDF NENESIE žiadne ceny (Money-neutrálne) — sken metadát', async () => {
		const bytes = await generateNarezakPdf(HEADER, vysledok.material, {}, NOW);
		const doc = await PDFDocument.load(bytes);
		const all = [doc.getTitle(), doc.getSubject(), doc.getKeywords(), doc.getAuthor()]
			.filter(Boolean)
			.join(' | ');
		expect(all).not.toMatch(/cena|€|eur|n[áa]kup|price|ve[ľl]koobchod|maloobchod/i);
	});

	it('narezakPdfFilename nesie ZAK aj časovú pečiatku', () => {
		expect(narezakPdfFilename('ZAK123', NOW)).toBe('Narezak-ZAK123-20260916-1030.pdf');
		expect(narezakPdfFilename('', NOW)).toContain('zakazka');
	});

	it('base64 wrapper vráti dekódovateľné PDF', async () => {
		const b64 = await generateNarezakPdfBase64(HEADER, vysledok.material, {}, NOW);
		const bytes = Buffer.from(b64, 'base64');
		expect(bytes.slice(0, 5).toString('latin1')).toBe('%PDF-');
	});

	it('viac profilov (45° + rovný mix) + veľa tyčí → viac strán, hlavička s názvom, Uhol: 45°+rovný', async () => {
		// veľa tyčí u jedného profilu vynúti zlom strany; mix sikmy+rovny → Uhol „45°+rovný";
		// profil bez obrázka (prázdny kod) + barLen fallback (0 → 7500) sa tiež prejdú.
		const veaTyci: MaterialRow = {
			kod: '',
			nazov: 'DLHÝ PROFIL',
			rezy: [{ rozmer: 2000, ks: 40 }],
			tyce: 40,
			bary: Array.from({ length: 40 }, () => ({
				kusy: [{ rozmer: 2000, dlzka: 2004 }],
				zvysok: 5492
			})),
			odpadMm: 219680,
			odpadPct: 73.2,
			barLen: 0, // fallback → 7500
			sikmyRez: false
		};
		const material = [sikmyProfil, veaTyci];
		const header: NarezakPdfHeader = { ...HEADER, nazov: 'Zmiešaný plán' };
		const doc = await PDFDocument.load(
			await generateNarezakPdf(header, material, { viacPosuvov: true }, NOW)
		);
		expect(doc.getPageCount()).toBeGreaterThan(1); // zlom strany
		expect(doc.getSubject() ?? '').toContain('Uhol: 45°+rovný'); // mix
		expect(doc.getTitle()).toContain('ZAK123');
	});

	it('prázdny materiál (žiadny profil s tyčou) → platný PDF s Profilov: 0', async () => {
		const doc = await PDFDocument.load(await generateNarezakPdf(HEADER, [], {}, NOW));
		expect(doc.getSubject() ?? '').toContain('Profilov: 0');
		expect(doc.getSubject() ?? '').toContain('Tyčí: 0');
	});
});

// #528→#529: QR zákazky v hlavičke nárezáka. Feature #528 pridalo QR do kiosk PDF (vtedy
// `plan-rezov-pdf.ts`); #529 ten súbor nahradilo grafickým `narezak-pdf.ts`, tak QR kontrakt
// (present iff OP) migruje sem. QR = holé sale.order.name; kreslí sa LEN keď je OP zadané. QR sa
// v PDF tele nedá prečítať (vektorové obdĺžniky, žiaden font) — testujeme cez rozdiel veľkosti PDF
// (s OP > bez OP o stovky obdĺžnikov QR); samotné kreslenie kryje `tests/pdf-qr.test.ts`.
describe('generateNarezakPdf — QR zákazky (#528)', () => {
	it('PDF s OP je väčší než bez OP (QR sa nakreslil)', async () => {
		const withOp = await generateNarezakPdf(HEADER, vysledok.material, {}, NOW);
		const withoutOp = await generateNarezakPdf({ ...HEADER, op: '' }, vysledok.material, {}, NOW);
		expect(withOp.length).toBeGreaterThan(withoutOp.length + 500);
	});
	it('bez OP → žiaden QR (PDF ostáva platný)', async () => {
		const bytes = await generateNarezakPdf({ ...HEADER, op: '' }, vysledok.material, {}, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
	});
	it('veľmi dlhé meno zákazníka + OP → PDF sa vykreslí (hlavička sa zalomí vedľa QR, nie pod ním)', async () => {
		const dlheMeno = {
			...HEADER,
			zakaznik: 'Veľmi Dlhý Názov Zákazníckej Firmy s Ručením Obmedzeným a Pobočkami s.r.o.'
		};
		const bytes = await generateNarezakPdf(dlheMeno, vysledok.material, {}, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
	});
});
