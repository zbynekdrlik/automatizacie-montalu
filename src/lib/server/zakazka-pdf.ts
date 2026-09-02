// #418: server-side PDF *rozpisu* materiálu/rezacích položiek k zákazke. Príloha (`ir.attachment`)
// sa pripína na INTERNÚ `mt_note` správu na `sale.order` (viď `odoo-zakazka.ts`) — dielňa si rozpis
// vytlačí; ZÁKAZNÍK ho NIKDY nevidí (dedí neúnikovú garanciu #340 cez internú správu).
//
// Nesie TIE ISTÉ dáta ako textová note (`ZakazkaNote`) — je to tlačiteľná forma toho istého snapshotu.
// Money-NEUTRÁLNE: číta LEN `ZakazkaNote` (čistý typ), NEPÍŠE do `/data`, NEDOTÝKA sa Money/MONEY_LIVE
// (vlastný guard `tests/zakazka-pdf.test.ts`). `import type` z `odoo-zakazka` je erasnutý na drôte →
// žiadna runtime závislosť na `money`.
//
// Knižnica: pdf-lib (+ @pdf-lib/fontkit) s vendorovaným DejaVu Sans subsetom (slovenské mäkčene,
// `fonts/dejavu.ts`) — presne vzor `ponuka-pdf.ts`, self-contained, žiadny runtime asset/network.
// Hodnoty sa vykreslia AJ zapíšu do metadát (Title/Subject/Keywords) — testovateľný kanál (custom-font
// glyfy sa z PDF tela nedajú spoľahlivo prečítať, viď `dopyt-ponuka.md`).
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejavu';
import type { ZakazkaNote } from './odoo-zakazka';

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const CONTENT_W = A4_W - 2 * MARGIN;

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTED = rgb(0.39, 0.45, 0.55); // #64748b
const ACCENT = rgb(0.11, 0.31, 0.85); // #1d4ed8
const BORDER = rgb(0.8, 0.84, 0.88);
const HEAD_BG = rgb(0.95, 0.96, 0.98);

const FS_TITLE = 15;
const FS_META = 9;
const FS_SEC = 11;
const FS_ROW = 9;
const LINE = 12; // riadkovanie v bunke
const ROW_PAD = 4;

// Stĺpce tabuľky (x zľava; qty/cena zarovnané doprava k svojmu pravému okraju).
const COL_KOD = MARGIN; // 48
const COL_NAZOV = MARGIN + 66; // 114
const COL_QTY_R = MARGIN + 372; // pravý okraj množstva
const COL_MJ = MARGIN + 380;
const COL_CENA_R = MARGIN + CONTENT_W; // pravý okraj ceny (547.28)
const NAZOV_W = COL_QTY_R - COL_NAZOV - 44; // šírka názvu (necháva medzeru pred qty)

/** eur formát so slovenskou desatinnou čiarkou (rozpis je interný, pre šéfa/dielňu). */
const fmtEur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

interface Ctx {
	doc: PDFDocument;
	page: PDFPage;
	reg: PDFFont;
	bold: PDFFont;
	cursor: number;
}

/** Zalom text na riadky, ktoré sa zmestia do `maxWidth` pri danom fonte/veľkosti (vzor `ponuka-pdf`). */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [''];
	const lines: string[] = [];
	let cur = '';
	for (const w of words) {
		const candidate = cur ? `${cur} ${w}` : w;
		if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !cur) {
			cur = candidate;
		} else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur) lines.push(cur);
	return lines;
}

function newPage(ctx: Ctx): void {
	ctx.page = ctx.doc.addPage([A4_W, A4_H]);
	ctx.cursor = A4_H - MARGIN;
}

/** Zabezpeč aspoň `need` pt priestoru pod kurzorom; inak nová strana. */
function ensureSpace(ctx: Ctx, need: number): void {
	if (ctx.cursor - need < MARGIN) newPage(ctx);
}

function textRight(
	ctx: Ctx,
	s: string,
	xRight: number,
	y: number,
	size: number,
	font: PDFFont
): void {
	const w = font.widthOfTextAtSize(s, size);
	ctx.page.drawText(s, { x: xRight - w, y, size, font, color: INK });
}

function drawTableHeader(ctx: Ctx): void {
	ensureSpace(ctx, LINE + ROW_PAD * 2);
	const top = ctx.cursor;
	ctx.page.drawRectangle({
		x: MARGIN,
		y: top - (LINE + ROW_PAD),
		width: CONTENT_W,
		height: LINE + ROW_PAD,
		color: HEAD_BG
	});
	const y = top - LINE;
	ctx.page.drawText('Kód', { x: COL_KOD + 2, y, size: FS_ROW, font: ctx.bold, color: INK });
	ctx.page.drawText('Názov', { x: COL_NAZOV, y, size: FS_ROW, font: ctx.bold, color: INK });
	textRight(ctx, 'Množstvo', COL_QTY_R, y, FS_ROW, ctx.bold);
	ctx.page.drawText('MJ', { x: COL_MJ, y, size: FS_ROW, font: ctx.bold, color: INK });
	textRight(ctx, 'Cena (predaj VO)', COL_CENA_R, y, FS_ROW, ctx.bold);
	ctx.cursor = top - (LINE + ROW_PAD);
	ctx.page.drawLine({
		start: { x: MARGIN, y: ctx.cursor },
		end: { x: MARGIN + CONTENT_W, y: ctx.cursor },
		thickness: 0.5,
		color: BORDER
	});
}

function drawRow(
	ctx: Ctx,
	kod: string,
	nazovLines: string[],
	qty: string,
	mj: string,
	cena: string
): void {
	const rowH = Math.max(1, nazovLines.length) * LINE + ROW_PAD;
	// nová strana PRED riadkom, keď sa nezmestí → zopakuj hlavičku tabuľky
	if (ctx.cursor - rowH < MARGIN) {
		newPage(ctx);
		drawTableHeader(ctx);
	}
	const top = ctx.cursor;
	const yFirst = top - LINE + 2;
	ctx.page.drawText(kod, { x: COL_KOD + 2, y: yFirst, size: FS_ROW, font: ctx.reg, color: INK });
	nazovLines.forEach((ln, i) => {
		ctx.page.drawText(ln, {
			x: COL_NAZOV,
			y: yFirst - i * LINE,
			size: FS_ROW,
			font: ctx.reg,
			color: INK
		});
	});
	textRight(ctx, qty, COL_QTY_R, yFirst, FS_ROW, ctx.reg);
	ctx.page.drawText(mj, { x: COL_MJ, y: yFirst, size: FS_ROW, font: ctx.reg, color: INK });
	textRight(ctx, cena, COL_CENA_R, yFirst, FS_ROW, ctx.reg);
	ctx.cursor = top - rowH;
	ctx.page.drawLine({
		start: { x: MARGIN, y: ctx.cursor },
		end: { x: MARGIN + CONTENT_W, y: ctx.cursor },
		thickness: 0.3,
		color: BORDER
	});
}

function drawParagraph(ctx: Ctx, text: string, size: number, font: PDFFont, color = INK): void {
	for (const ln of wrapText(font, text, size, CONTENT_W)) {
		ensureSpace(ctx, LINE);
		ctx.page.drawText(ln, { x: MARGIN, y: ctx.cursor - size, size, font, color });
		ctx.cursor -= LINE;
	}
}

/** Počet položiek naprieč všetkými sekciami (metadátový/hlavičkový údaj). */
export function pocetPoloziek(note: ZakazkaNote): number {
	return note.sekcie.reduce((n, s) => n + s.polozky.length, 0);
}

/**
 * Vygeneruje PDF rozpisu materiálu zákazky z `ZakazkaNote`. Súhrn (zak/op/počet položiek/cena) sa
 * vykreslí AJ zapíše do metadát (Title/Subject/Keywords) — to je testovateľný kanál. `now` je
 * injektovateľné pre testy (deterministická „Stav k …" pečiatka; Europe/Bratislava kvôli UTC pasci).
 */
export async function generateZakazkaPdf(
	note: ZakazkaNote,
	now: Date = new Date()
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);
	const reg = await doc.embedFont(Buffer.from(DEJAVU_SANS_REGULAR_B64, 'base64'), { subset: true });
	const bold = await doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, 'base64'), { subset: true });
	const ctx: Ctx = { doc, page: doc.addPage([A4_W, A4_H]), reg, bold, cursor: A4_H - MARGIN };

	// hlavička
	ensureSpace(ctx, FS_TITLE + 6);
	ctx.page.drawText('Interný rozpis materiálu k zákazke', {
		x: MARGIN,
		y: ctx.cursor - FS_TITLE,
		size: FS_TITLE,
		font: bold,
		color: ACCENT
	});
	ctx.cursor -= FS_TITLE + 8;
	drawParagraph(
		ctx,
		`Zákazka: ${note.zak}  ·  Objednávka: ${note.op}  ·  Zákazník: ${note.zakaznik}`,
		FS_META,
		reg,
		INK
	);
	const stav = now.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
	drawParagraph(
		ctx,
		`Stav k ${stav}  ·  nahrádza predchádzajúce  ·  interné (zákazník toto nevidí)  ·  zdroj: automatizácie Montalu.`,
		FS_META,
		reg,
		MUTED
	);
	if (note.scope === 'test')
		drawParagraph(
			ctx,
			'⚠️ Sumár z TEST odpisov (zákazka nemá žiadny ostrý odpis).',
			FS_META,
			bold,
			INK
		);
	ctx.cursor -= 6;

	// sekcie s tabuľkami
	for (const sekcia of note.sekcie) {
		ensureSpace(ctx, FS_SEC + LINE + ROW_PAD * 2);
		ctx.page.drawText(sekcia.nadpis, {
			x: MARGIN,
			y: ctx.cursor - FS_SEC,
			size: FS_SEC,
			font: bold,
			color: INK
		});
		ctx.cursor -= FS_SEC + 6;
		if (sekcia.polozky.length === 0) {
			drawParagraph(ctx, '(žiadne položky)', FS_ROW, reg, MUTED);
			ctx.cursor -= 4;
			continue;
		}
		drawTableHeader(ctx);
		for (const p of sekcia.polozky) {
			const nazovLines = wrapText(reg, p.nazov, FS_ROW, NAZOV_W);
			drawRow(ctx, p.kod, nazovLines, String(p.qty), p.mj, p.cena !== null ? fmtEur(p.cena) : '—');
		}
		ctx.cursor -= 8;
	}

	// súčty + honesty riadky
	if (note.cenaSpolu !== null) {
		const nekompl = note.cenaKompletna ? '' : ' (NEÚPLNÁ — niektoré položky bez ceny)';
		drawParagraph(
			ctx,
			`Celková cena (predaj VO): ${fmtEur(note.cenaSpolu)}${nekompl}`,
			FS_ROW,
			bold
		);
	} else {
		drawParagraph(ctx, 'Celková cena: nie je k dispozícii (položky bez cien)', FS_ROW, bold);
	}
	if (note.cenaNakupSpolu !== null) {
		const nekompl = note.nakupKompletna ? '' : ' (neúplná)';
		drawParagraph(
			ctx,
			`Nákup (cenník): ${fmtEur(note.cenaNakupSpolu)}${nekompl}`,
			FS_ROW,
			reg,
			MUTED
		);
	}
	if (note.parkovanych > 0)
		drawParagraph(
			ctx,
			`Vrátane ${note.parkovanych} parkovaných odpisov (čakajú na ručný presun).`,
			FS_META,
			reg,
			MUTED
		);
	if (note.bezPoloziek > 0)
		drawParagraph(
			ctx,
			`⚠️ ${note.bezPoloziek} odpisov bez uložených položiek (spred fázy 1) — ich materiál v zozname CHÝBA.`,
			FS_META,
			reg,
			MUTED
		);

	// metadáta = testovateľný kanál hodnôt
	const count = pocetPoloziek(note);
	doc.setTitle(`Interný rozpis materiálu — zákazka ${note.zak} — Montalu`);
	doc.setAuthor('Montalu');
	doc.setCreator('Montalu automatizácie');
	doc.setSubject(
		[
			`Zákazka: ${note.zak}`,
			`Objednávka: ${note.op}`,
			`Zákazník: ${note.zakaznik}`,
			`Položiek: ${count}`,
			`Scope: ${note.scope}`,
			note.cenaSpolu !== null ? `Cena (predaj VO): ${fmtEur(note.cenaSpolu)}` : 'Cena: nedostupná'
		].join('; ')
	);
	doc.setKeywords([
		note.zak,
		note.op,
		`${count} položiek`,
		'interný rozpis materiálu',
		'rezanie',
		'zákazník nevidí'
	]);
	doc.setCreationDate(now);
	doc.setModificationDate(now);

	return doc.save();
}

/** Pohodlný wrapper — PDF ako base64 string (`ir.attachment.datas` je Binary = base64). */
export async function generateZakazkaPdfBase64(note: ZakazkaNote, now?: Date): Promise<string> {
	const bytes = await generateZakazkaPdf(note, now);
	return Buffer.from(bytes).toString('base64');
}

/** Názov PDF súboru pripnutého k zákazke (deterministický, bezpečný pre Odoo). */
export function zakazkaPdfFilename(note: ZakazkaNote): string {
	const safe = (note.zak || 'zakazka').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
	return `Rozpis-materialu-${safe}.pdf`;
}
