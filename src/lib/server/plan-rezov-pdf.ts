// #511: server-side PDF *skutočného plánu rezov* — príloha (`ir.attachment`) pripínaná na kiosk
// „VÝROBA / Rezanie" cez `montalu_narezak_upload` (kind='narezak'). Vymieňa prílohu, ktorá tam
// chodila predtým (rozpis materiálu z `zakazka-pdf.ts`) — rezač na kiosku má vidieť SKUTOČNÝ plán
// rezov, NIE interné predajné/nákupné sumy.
//
// Nesie TIE ISTÉ dáta ako tlačová stránka `/plan-rezov/[id]` (#505) — je to tlačiteľná forma toho
// istého `PlanRezovVysledok` (FFD `ffdPack` výstup: per profil tyče s rezmi/počtami/odpadom). Číta
// LEN čistý `PlanRezovVysledok` + hlavičku, žiadny import z Money/price modulov, žiadne sumové polia
// (vlastný guard `tests/plan-rezov-pdf.test.ts`). Money-NEUTRÁLNE (žiadny `/data` zápis).
//
// Knižnica: pdf-lib (+ @pdf-lib/fontkit) s vendorovaným DejaVu Sans subsetom cez zdieľaný
// `pdf-common.ts` — vzor `zakazka-pdf.ts`/`ponuka-pdf.ts`, self-contained, žiadny runtime asset/network.
// Custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať (`dopyt-ponuka.md`), preto hodnoty sa
// vykreslia AJ zapíšu do metadát (Title/Subject/Keywords) — testovateľný kanál. BEZ varovných emoji
// (DejaVu subset nemá U+26A0 / U+23F3 → tofu); honesty/varovné riadky nesú textovú predponu „POZOR:".
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PlanRezovVysledok } from './plan-rezov';
import type { Tyc } from './compute';
import { A4_W, A4_H, MARGIN, CONTENT_W, wrapText, embedDejavu, stampSk } from './pdf-common';

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTED = rgb(0.39, 0.45, 0.55); // #64748b
const ACCENT = rgb(0.11, 0.31, 0.85); // #1d4ed8

const FS_TITLE = 15;
const FS_META = 9;
const FS_SEC = 11;
const FS_ROW = 9;
const LINE = 12; // riadkovanie

/** hlavička PDF plánu rezov — zdroj: uložený plán (`zak`) + odvodené z odpisu (`op`, `zakaznik`). */
export interface PlanRezovPdfHeader {
	zak: string;
	op: string;
	zakaznik: string;
	/** voliteľný názov uloženého plánu (#505) — do hlavičky, ak je. */
	nazov?: string;
}

/** číslo na 1 desatinné miesto so slovenskou čiarkou (rovnako ako `/plan-rezov/[id]`). */
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

interface Ctx {
	doc: PDFDocument;
	page: PDFPage;
	reg: PDFFont;
	bold: PDFFont;
	cursor: number;
}

function newPage(ctx: Ctx): void {
	ctx.page = ctx.doc.addPage([A4_W, A4_H]);
	ctx.cursor = A4_H - MARGIN;
}

/** Zabezpeč aspoň `need` pt priestoru pod kurzorom; inak nová strana. */
function ensureSpace(ctx: Ctx, need: number): void {
	if (ctx.cursor - need < MARGIN) newPage(ctx);
}

function drawParagraph(ctx: Ctx, text: string, size: number, font: PDFFont, color = INK): void {
	const lines = wrapText(font, text, size, CONTENT_W);
	for (const ln of lines.length > 0 ? lines : ['']) {
		ensureSpace(ctx, LINE);
		ctx.page.drawText(ln, { x: MARGIN, y: ctx.cursor - size, size, font, color });
		ctx.cursor -= LINE;
	}
}

/** Zoskup rezy jednej tyče podľa dĺžky (zostupne) na „N× dĺžka" tokeny — čitateľné pri píle. */
function rezyTyce(tyc: Tyc): string {
	const byDlzka = new Map<number, number>();
	for (const k of tyc.kusy) byDlzka.set(k.rozmer, (byDlzka.get(k.rozmer) ?? 0) + 1);
	const toks = [...byDlzka.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([rozmer, ks]) => `${ks}× ${fmt(rozmer)}`);
	return toks.join('  +  ');
}

/** Počet profilov s aspoň jednou tyčou (hlavičkový/metadátový údaj). */
export function pocetProfilov(v: PlanRezovVysledok): number {
	return v.material.filter((m) => m.tyce > 0).length;
}

/**
 * Vygeneruje PDF plánu rezov z `PlanRezovVysledok` + hlavičky. Hodnoty (zak/op/zákazník/profily/
 * tyče/odpad) sa vykreslia AJ zapíšu do metadát (Title/Subject/Keywords) — testovateľný kanál.
 * `now` je injektovateľné pre testy (deterministická „Dátum" pečiatka; Europe/Bratislava, UTC pasca).
 */
export async function generatePlanRezovPdf(
	header: PlanRezovPdfHeader,
	vysledok: PlanRezovVysledok,
	now: Date = new Date()
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const { reg, bold } = await embedDejavu(doc);
	const ctx: Ctx = { doc, page: doc.addPage([A4_W, A4_H]), reg, bold, cursor: A4_H - MARGIN };

	// hlavička
	ensureSpace(ctx, FS_TITLE + 6);
	ctx.page.drawText('Nárezový plán', {
		x: MARGIN,
		y: ctx.cursor - FS_TITLE,
		size: FS_TITLE,
		font: bold,
		color: ACCENT
	});
	ctx.cursor -= FS_TITLE + 8;
	drawParagraph(
		ctx,
		`Zákazka: ${header.zak}  ·  Objednávka: ${header.op}  ·  Zákazník: ${header.zakaznik}`,
		FS_META,
		reg,
		INK
	);
	if (header.nazov) drawParagraph(ctx, `Plán: ${header.nazov}`, FS_META, reg, INK);
	const stav = now.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
	drawParagraph(
		ctx,
		`Dátum: ${stav}  ·  nahrádza predchádzajúce  ·  zdroj: automatizácie Montalu (plán rezov).`,
		FS_META,
		reg,
		MUTED
	);

	// sumár
	const profilov = pocetProfilov(vysledok);
	drawParagraph(
		ctx,
		`Profilov: ${profilov}  ·  Tyčí spolu: ${vysledok.tyceSpolu}  ·  Odpad spolu: ${fmt(vysledok.odpadMm)} mm (${fmt(vysledok.odpadPct)} %)  ·  Dĺžka tyče: ${fmt(vysledok.dlzkaTyce)} mm  ·  Rezná medzera: ${fmt(vysledok.reznaMedzera)} mm`,
		FS_META,
		bold,
		INK
	);
	ctx.cursor -= 4;

	// varovania (bez emoji — textová predpona „POZOR:")
	for (const w of vysledok.varovania) drawParagraph(ctx, `POZOR: ${w}`, FS_META, reg, MUTED);
	if (vysledok.varovania.length > 0) ctx.cursor -= 4;

	// per profil: nadpis + tyče s rezmi
	for (const m of vysledok.material.filter((mm) => mm.tyce > 0)) {
		// rezervuj priestor na nadpis + stat + prvú tyč, inak by nadpis osirel
		ensureSpace(ctx, FS_SEC + 6 + LINE + LINE);
		ctx.page.drawText(m.nazov || '(bez názvu)', {
			x: MARGIN,
			y: ctx.cursor - FS_SEC,
			size: FS_SEC,
			font: bold,
			color: INK
		});
		ctx.cursor -= FS_SEC + 4;
		drawParagraph(
			ctx,
			`Tyčí: ${m.tyce}  ·  dĺžka tyče ${fmt(m.barLen)} mm  ·  odpad ${fmt(m.odpadMm)} mm (${fmt(m.odpadPct)} %)`,
			FS_ROW,
			reg,
			MUTED
		);
		m.bary.forEach((tyc, i) => {
			const odpad = tyc.zvysok > 1 ? `  ·  odpad ${fmt(tyc.zvysok)} mm` : '';
			drawParagraph(ctx, `/${i + 1}/  ${rezyTyce(tyc)}${odpad}`, FS_ROW, reg, INK);
		});
		ctx.cursor -= 8;
	}

	// metadáta = testovateľný kanál hodnôt (BEZ cien)
	doc.setTitle(`Nárezový plán — zákazka ${header.zak} — Montalu`);
	doc.setAuthor('Montalu');
	doc.setCreator('Montalu automatizácie');
	doc.setSubject(
		[
			`Zákazka: ${header.zak}`,
			`Objednávka: ${header.op}`,
			`Zákazník: ${header.zakaznik}`,
			`Profilov: ${profilov}`,
			`Tyčí: ${vysledok.tyceSpolu}`,
			`Odpad: ${fmt(vysledok.odpadMm)} mm`
		].join('; ')
	);
	doc.setKeywords([
		header.zak,
		header.op,
		`${profilov} profilov`,
		`${vysledok.tyceSpolu} tyčí`,
		'plán rezov',
		'rezanie',
		'nárezový plán'
	]);
	doc.setCreationDate(now);
	doc.setModificationDate(now);

	return doc.save();
}

/** Pohodlný wrapper — PDF ako base64 string (`ir.attachment.datas` je Binary = base64). */
export async function generatePlanRezovPdfBase64(
	header: PlanRezovPdfHeader,
	vysledok: PlanRezovVysledok,
	now?: Date
): Promise<string> {
	const bytes = await generatePlanRezovPdf(header, vysledok, now);
	return Buffer.from(bytes).toString('base64');
}

/** Názov PDF súboru pripnutého k zákazke — nesie ZAK aj sortovateľnú časovú pečiatku (odlíši verzie). */
export function planRezovPdfFilename(zak: string, now: Date = new Date()): string {
	const safe = (zak || 'zakazka').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
	return `Plan-rezov-${safe}-${stampSk(now)}.pdf`;
}
