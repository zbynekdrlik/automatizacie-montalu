// #511: PDF *skutočného plánu rezov* pripínaný na kiosk (miesto rozpisu materiálu s cenami).
// Metadáta (Title/Subject/Keywords) sú testovateľný kanál hodnôt — custom-font glyfy sa z PDF
// tela nedajú spoľahlivo prečítať (viď `dopyt-ponuka.md` / `zakazka-pdf.test.ts`). Kľúčová
// požiadavka ticketu: PDF NESMIE niesť ceny (`Cena` / `Nákup`). Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { spocitajPlanRezov, type PlanRezovVysledok } from '../src/lib/server/plan-rezov';
import {
	generatePlanRezovPdf,
	generatePlanRezovPdfBase64,
	planRezovPdfFilename,
	type PlanRezovPdfHeader
} from '../src/lib/server/plan-rezov-pdf';

const NOW = new Date('2026-09-02T08:30:00Z'); // CEST (UTC+2) → 10:30 → stamp 20260902-1030

const HEADER: PlanRezovPdfHeader = {
	zak: 'ZAK123',
	op: 'OP260439',
	zakaznik: 'Firma s.r.o.'
};

// Reálny výpočet (pure) — 2 profily, viac tyčí, nenulový odpad.
const vysledok: PlanRezovVysledok = spocitajPlanRezov({
	dlzkaTyce: 6000,
	reznaMedzera: 4,
	riadky: [
		{ nazov: 'STABILIZAČNÝ PROFIL 100X50', ks: 3, rezMm: 2000 },
		{ nazov: 'STABILIZAČNÝ PROFIL 100X50', ks: 2, rezMm: 1500 },
		{ nazov: 'LAT 80x19', ks: 4, rezMm: 1865 }
	]
});

describe('generatePlanRezovPdf', () => {
	it('vyprodukuje platný PDF (%PDF hlavička), malý plán = 1 strana', async () => {
		const bytes = await generatePlanRezovPdf(HEADER, vysledok, NOW);
		expect(bytes.length).toBeGreaterThan(1000);
		expect(bytes.length).toBeLessThan(300_000);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
	});

	it('metadáta nesú zak/op/zákazníka/profily/tyče/odpad (testovateľný kanál)', async () => {
		const bytes = await generatePlanRezovPdf(HEADER, vysledok, NOW);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toContain('ZAK123');
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('Zákazka: ZAK123');
		expect(subject).toContain('Objednávka: OP260439');
		expect(subject).toContain('Zákazník: Firma s.r.o.');
		expect(subject).toContain('Profilov: 2');
		expect(subject).toMatch(/Tyčí: \d+/);
		expect(subject).toMatch(/Odpad: \d/);
		const kw = doc.getKeywords() ?? '';
		expect(kw).toContain('ZAK123');
		expect(kw).toContain('OP260439');
		expect(kw).toContain('plán rezov');
		expect(kw).toContain('rezanie');
	});

	it('NEOBSAHUJE ceny — žiadne `Cena` ani `Nákup` v žiadnom metadátovom kanáli', async () => {
		const doc = await PDFDocument.load(await generatePlanRezovPdf(HEADER, vysledok, NOW));
		const channels = [doc.getTitle() ?? '', doc.getSubject() ?? '', doc.getKeywords() ?? ''];
		for (const ch of channels) {
			expect(ch).not.toMatch(/Cena/i);
			expect(ch).not.toMatch(/Nákup/i);
			expect(ch).not.toMatch(/€/);
			expect(ch).not.toMatch(/predaj VO|cenník/i);
		}
	});

	it('varovania / prázdny výsledok nezhodia generovanie', async () => {
		const prazdny = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky: [] });
		const bytes = await generatePlanRezovPdf(HEADER, prazdny, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Profilov: 0');
	});

	it('príliš dlhý rez (tooLong) + veľa profilov → viacstranové PDF nezhodí page-break', async () => {
		const riadky = Array.from({ length: 40 }, (_, i) => ({
			nazov: `PROFIL ${i} s dlhším názvom na test zalomenia`,
			ks: 3,
			rezMm: 1500 + i
		}));
		riadky.push({ nazov: 'PRIDLHY', ks: 1, rezMm: 99999 }); // > tyč → tooLong varovanie
		const many = spocitajPlanRezov({ dlzkaTyce: 6000, reznaMedzera: 4, riadky });
		const doc = await PDFDocument.load(await generatePlanRezovPdf(HEADER, many, NOW));
		expect(doc.getPageCount()).toBeGreaterThan(1);
		expect(doc.getPageCount()).toBeLessThan(20);
	});

	it('injekcia v názve profilu nezhodí generovanie (pdf-lib len kreslí text)', async () => {
		const inj = spocitajPlanRezov({
			dlzkaTyce: 6000,
			reznaMedzera: 4,
			riadky: [{ nazov: '<script>alert(1)</script>', ks: 1, rezMm: 1000 }]
		});
		const bytes = await generatePlanRezovPdf(HEADER, inj, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
	});
});

describe('generatePlanRezovPdfBase64', () => {
	it('vráti platný base64, ktorý dekóduje na PDF', async () => {
		const b64 = await generatePlanRezovPdfBase64(HEADER, vysledok, NOW);
		expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(Buffer.from(b64, 'base64').slice(0, 5).toString('latin1')).toBe('%PDF-');
	});
});

describe('planRezovPdfFilename', () => {
	it('nesie ZAK aj sortovateľnú pečiatku (Europe/Bratislava)', () => {
		expect(planRezovPdfFilename('ZAK123', NOW)).toBe('Plan-rezov-ZAK123-20260902-1030.pdf');
	});
	it('sanitizuje nebezpečné znaky v ZAK (pečiatka ostáva)', () => {
		const fn = planRezovPdfFilename('ZAK 12/34#x', NOW);
		expect(fn).toBe('Plan-rezov-ZAK_12_34_x-20260902-1030.pdf');
		expect(fn.slice('Plan-rezov-'.length, -'.pdf'.length)).not.toMatch(/[ /#]/);
	});
});

// ---- Money-neutralita — vlastný guard (vzor zakazka-pdf.test.ts) ----
describe('Money-neutralita (plan-rezov-pdf zdroj)', () => {
	const src = fs.readFileSync(new URL('../src/lib/server/plan-rezov-pdf.ts', import.meta.url), 'utf8');
	it('NEPÍŠE do /data, nevolá writeOdpis, nesiaha na MONEY_LIVE ani na fs zápis', () => {
		expect(src).not.toMatch(/\/data\//);
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open)/);
		expect(src).not.toMatch(/process\.env\.MONEY_LIVE|isLive\s*\(/);
	});
	it('nekreslí do PDF tela emoji, ktoré DejaVu subset nemá (⚠️/⏳ → tofu)', () => {
		expect(src).not.toMatch(/⚠|⏳/);
	});
	it('nereferencuje cenové polia (žiadny leak cien do plánu rezov)', () => {
		expect(src).not.toMatch(/cena|nakup|predajVo|cennik/i);
	});
});
