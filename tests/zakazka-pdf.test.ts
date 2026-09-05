// #418: PDF rozpisu materiálu k zákazke. Metadáta (Title/Subject/Keywords) sú testovateľný kanál
// hodnôt — custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať (viď `dopyt-ponuka.md`).
// VŠETKY qty/kódy/ceny sú VYMYSLENÉ (repo je verejné).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import type { ZakazkaNote } from '../src/lib/server/odoo-zakazka';
import {
	generateZakazkaPdf,
	generateZakazkaPdfBase64,
	pocetPoloziek,
	zakazkaPdfFilename
} from '../src/lib/server/zakazka-pdf';

const NOW = new Date('2026-09-02T08:30:00Z');

const baseNote: ZakazkaNote = {
	zak: 'ZAK123',
	op: 'OP260439',
	zakaznik: 'Firma s.r.o.',
	scope: 'live',
	parkovanych: 0,
	bezPoloziek: 0,
	odpisovVScope: 2,
	sekcie: [
		{
			nadpis: 'Profily a komponenty',
			polozky: [
				{ kod: 'K1', nazov: 'Profil hliníkový 40×40', qty: 3, mj: 'm', cena: 12.5 },
				{ kod: 'K2', nazov: 'Rohovník', qty: 8, mj: 'ks', cena: null }
			]
		}
	],
	cenaSpolu: 37.5,
	cenaKompletna: false,
	cenaNakupSpolu: 20,
	nakupKompletna: true,
	odpad: []
};

describe('generateZakazkaPdf', () => {
	it('vyprodukuje platný PDF (%PDF hlavička), malý rozpis = 1 strana', async () => {
		const bytes = await generateZakazkaPdf(baseNote, NOW);
		expect(bytes.length).toBeGreaterThan(1000);
		expect(bytes.length).toBeLessThan(300_000);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
	});

	it('metadáta nesú zak/op/počet položiek/scope/cenu (testovateľný kanál)', async () => {
		const bytes = await generateZakazkaPdf(baseNote, NOW);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toContain('ZAK123');
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('Zákazka: ZAK123');
		expect(subject).toContain('Objednávka: OP260439');
		expect(subject).toContain('Zákazník: Firma s.r.o.');
		expect(subject).toContain('Položiek: 2');
		expect(subject).toContain('Scope: live');
		expect(subject).toContain('Cena (predaj VO): 37,50 €');
		const kw = doc.getKeywords() ?? '';
		expect(kw).toContain('ZAK123');
		expect(kw).toContain('OP260439');
		expect(kw).toContain('2 položiek');
		expect(kw).toContain('rezanie');
		// interná povaha priznaná aj v metadátach
		expect(kw).toContain('zákazník nevidí');
	});

	it('bez cien → subject prizná „Cena: nedostupná"', async () => {
		const n: ZakazkaNote = { ...baseNote, cenaSpolu: null, cenaNakupSpolu: null };
		const doc = await PDFDocument.load(await generateZakazkaPdf(n, NOW));
		expect(doc.getSubject() ?? '').toContain('Cena: nedostupná');
	});

	it('honesty stavy (test scope / parkované / bezPoloziek / prázdna sekcia) nezhodia generovanie', async () => {
		const n: ZakazkaNote = {
			...baseNote,
			scope: 'test',
			parkovanych: 2,
			bezPoloziek: 1,
			sekcie: [{ nadpis: 'Prázdna', polozky: [] }]
		};
		const bytes = await generateZakazkaPdf(n, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
		const doc = await PDFDocument.load(bytes);
		expect(doc.getSubject() ?? '').toContain('Položiek: 0');
	});

	it('veľa položiek → viacstranové PDF (page-break nezhodí)', async () => {
		const many = Array.from({ length: 120 }, (_, i) => ({
			kod: `K${i}`,
			nazov: `Položka číslo ${i} s dlhším názvom na test zalomenia riadku v bunke názov`,
			qty: i + 1,
			mj: 'ks',
			cena: i % 2 === 0 ? i * 1.1 : null
		}));
		const n: ZakazkaNote = { ...baseNote, sekcie: [{ nadpis: 'Veľa', polozky: many }] };
		const doc = await PDFDocument.load(await generateZakazkaPdf(n, NOW));
		expect(doc.getPageCount()).toBeGreaterThan(2);
		expect(doc.getPageCount()).toBeLessThan(12);
		expect(doc.getSubject() ?? '').toContain('Položiek: 120');
	});

	it('injekcia v názve položky nezhodí generovanie (pdf-lib len kreslí text)', async () => {
		const n: ZakazkaNote = {
			...baseNote,
			sekcie: [
				{
					nadpis: 'Profily a komponenty',
					polozky: [{ kod: 'K1', nazov: '<script>alert(1)</script>', qty: 1, mj: 'm', cena: null }]
				}
			]
		};
		const bytes = await generateZakazkaPdf(n, NOW);
		expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
	});
});

describe('generateZakazkaPdfBase64', () => {
	it('vráti platný base64, ktorý dekóduje na PDF', async () => {
		const b64 = await generateZakazkaPdfBase64(baseNote, NOW);
		expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
		const bytes = Buffer.from(b64, 'base64');
		expect(bytes.slice(0, 5).toString('latin1')).toBe('%PDF-');
	});
});

describe('zakazkaPdfFilename', () => {
	it('nesie ZAK aj sortovateľnú pečiatku (Europe/Bratislava)', () => {
		// NOW = 2026-09-02T08:30:00Z → CEST (UTC+2) → 10:30 → 20260902-1030
		expect(zakazkaPdfFilename(baseNote, NOW)).toBe('Rozpis-materialu-ZAK123-20260902-1030.pdf');
	});
	it('sanitizuje nebezpečné znaky v ZAK (pečiatka ostáva)', () => {
		const fn = zakazkaPdfFilename({ ...baseNote, zak: 'ZAK 12/34#x' }, NOW);
		expect(fn).toBe('Rozpis-materialu-ZAK_12_34_x-20260902-1030.pdf');
		// nebezpečné znaky len v ZAK časti (pomlčky v pečiatke sú v poriadku)
		expect(fn.slice('Rozpis-materialu-'.length, -'.pdf'.length)).not.toMatch(/[ /#]/);
	});
});

describe('pocetPoloziek', () => {
	it('sčíta položky naprieč sekciami', () => {
		const n: ZakazkaNote = {
			...baseNote,
			sekcie: [
				{ nadpis: 'A', polozky: [{ kod: 'a', nazov: 'a', qty: 1, mj: 'ks', cena: null }] },
				{
					nadpis: 'B',
					polozky: [
						{ kod: 'b', nazov: 'b', qty: 1, mj: 'ks', cena: null },
						{ kod: 'c', nazov: 'c', qty: 1, mj: 'ks', cena: null }
					]
				}
			]
		};
		expect(pocetPoloziek(n)).toBe(3);
	});
});

// ---- Money-neutralita — vlastný guard (auto-discovery `dopyt|ponuka` NEpokrýva `zakazka-pdf`) ----
describe('Money-neutralita (zakazka-pdf zdroj)', () => {
	const src = fs.readFileSync(new URL('../src/lib/server/zakazka-pdf.ts', import.meta.url), 'utf8');
	it('NEPÍŠE do /data, nevolá writeOdpis, nesiaha na MONEY_LIVE ani na fs zápis', () => {
		expect(src).not.toMatch(/\/data\//);
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open)/);
		expect(src).not.toMatch(/process\.env\.MONEY_LIVE|isLive\s*\(/);
	});
	it('nekreslí do PDF tela emoji, ktoré DejaVu subset nemá (⚠️/⏳ → tofu) — #418 review', () => {
		// custom-font glyfy sa z PDF tela nečítajú, takže tofu chytíme na úrovni ZDROJA: telo nesmie
		// niesť U+26A0 (⚠️) ani U+23F3 (⏳); honesty riadky používajú textovú predponu „POZOR:".
		expect(src).not.toMatch(/\u26A0|\u23F3/);
		expect(src).toContain('POZOR:');
	});
	it('z `money` neimportuje runtime hodnotu — `ZakazkaNote` je iba `import type`', () => {
		// runtime import z ./money by pridal money závislosť; povolený je LEN `import type`.
		expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"]\.\/money['"]/);
		expect(src).toMatch(/import\s+type\s+\{\s*ZakazkaNote\s*\}\s+from\s+['"]\.\/odoo-zakazka['"]/);
	});
});
