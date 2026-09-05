// #419 extended scope: server-side PDF expedičného zoznamu. Príloha (`ir.attachment`) sa
// pripína na INTERNÚ `mt_note` správu na `sale.order` (viď `expedicia-odoo.ts`) — dielňa si
// zoznam vytlačí; ZÁKAZNÍK ho NIKDY nevidí (dedí neúnikovú garanciu cez internú správu).
//
// Vzor: `zakazka-pdf.ts` (#418). Knižnica: pdf-lib (+ @pdf-lib/fontkit) s vendorovaným
// DejaVu Sans subsetom (slovenské mäkčene, `fonts/dejavu.ts` cez zdieľaný `pdf-common.ts`).
// Self-contained, žiadny runtime asset/network.
//
// DejaVu subset NEOBSAHUJE varovné emoji (U+26A0, U+23F3, U+2611 „ballot box with check") →
// v tele PDF sa NEPOUŽÍVAJÚ (kreslili by sa ako „tofu" prázdne štvorčeky); honesty riadky
// nesú textovú predponu „POZOR:".
//
// Hodnoty sa vykreslia AJ zapíšu do metadát (Title/Subject/Keywords) — testovateľný kanál
// (custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať, rovnaká disciplína ako
// `zakazka-pdf.ts` / `dopyt-ponuka.md`).
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ExpedicnyZoznam, ExpedicnaPolozka } from '$lib/pergola-expedicia';
import { A4_W, A4_H, MARGIN, CONTENT_W, wrapText, ellipsize, embedDejavu } from './pdf-common';

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTED = rgb(0.39, 0.45, 0.55); // #64748b
const ACCENT = rgb(0.11, 0.31, 0.85); // #1d4ed8
const BORDER = rgb(0.8, 0.84, 0.88);
const HEAD_BG = rgb(0.95, 0.96, 0.98);

const FS_TITLE = 15;
const FS_META = 9;
const FS_SEC = 11;
const FS_ROW = 9;
const LINE = 12;
const ROW_PAD = 4;

// Stĺpce tabuľky expedičného zoznamu
const COL_CHECK = MARGIN;
const COL_POZ = MARGIN + 32;
const COL_SKUPINA = MARGIN + 56;
const COL_KOD = MARGIN + 128;
const COL_NAZOV = MARGIN + 192;
const COL_ROZMER = MARGIN + 352;
const COL_POCET_R = MARGIN + CONTENT_W; // pravý okraj počtu

const NAZOV_W = COL_ROZMER - COL_NAZOV - 6;
const SKUPINA_W = COL_KOD - COL_SKUPINA - 4;
const ROZMER_W = COL_POCET_R - COL_ROZMER - 40;
const KOD_W = COL_NAZOV - COL_KOD - 4;

/** YYYYMMDD-HHMM v Europe/Bratislava — sortovateľná pečiatka do názvu prílohy. */
function stampSk(now: Date): string {
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bratislava',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(now);
	const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
	return `${g('year')}${g('month')}${g('day')}-${g('hour')}${g('minute')}`;
}

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
	ctx.page.drawText('[ ]', {
		x: COL_CHECK + 2,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Poz.', {
		x: COL_POZ + 2,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Skupina', {
		x: COL_SKUPINA,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Kód', {
		x: COL_KOD,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Názov', {
		x: COL_NAZOV,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Rozmer/Dĺžka', {
		x: COL_ROZMER,
		y,
		size: FS_ROW,
		font: ctx.bold,
		color: INK
	});
	textRight(ctx, 'Počet ks', COL_POCET_R, y, FS_ROW, ctx.bold);
	ctx.cursor = top - (LINE + ROW_PAD);
	ctx.page.drawLine({
		start: { x: MARGIN, y: ctx.cursor },
		end: { x: MARGIN + CONTENT_W, y: ctx.cursor },
		thickness: 0.5,
		color: BORDER
	});
}

/** Slovenský mm formát desatinná čiarka. */
const mm = (n: number | null): string => (n === null ? '—' : `${String(n).replace('.', ',')} mm`);

/** Zobrazenie skupiny v PDF. */
function skupinaLabel(s: ExpedicnaPolozka['skupina']): string {
	switch (s) {
		case 'profil':
			return 'Profil';
		case 'komponent':
			return 'Komponent';
		case 'stresne-sklo':
			return 'Strešné sklo';
		case 'fix-vypln':
			return 'FIX výplň';
		case 'tesnenie':
			return 'Tesnenie';
		case 'drobny-material':
			return 'Drobný mat.';
	}
}

/** Rozmer/dĺžka stĺpec: rozmerInfo alebo dĺžka rezu podľa skupiny. */
function rozmerText(p: ExpedicnaPolozka): string {
	if (p.rozmerInfo) return p.rozmerInfo;
	if (p.skupina === 'profil') return mm(p.dlzkaRezuMm);
	if (p.skupina === 'tesnenie') return mm(p.dlzkaRezuMm);
	return '—';
}

function drawRow(ctx: Ctx, p: ExpedicnaPolozka): void {
	const nazovLines = wrapText(ctx.reg, p.nazov, FS_ROW, NAZOV_W);
	const rowH = Math.max(1, nazovLines.length) * LINE + ROW_PAD;

	if (ctx.cursor - rowH < MARGIN) {
		newPage(ctx);
		drawTableHeader(ctx);
	}

	const top = ctx.cursor;
	const yFirst = top - LINE + 2;

	// checkbox
	ctx.page.drawText('[ ]', {
		x: COL_CHECK + 4,
		y: yFirst,
		size: FS_ROW,
		font: ctx.reg,
		color: MUTED
	});
	// poz
	ctx.page.drawText(p.poz != null ? String(p.poz) : '—', {
		x: COL_POZ + 2,
		y: yFirst,
		size: FS_ROW,
		font: ctx.reg,
		color: INK
	});
	// skupina
	ctx.page.drawText(ellipsize(ctx.reg, skupinaLabel(p.skupina), FS_ROW, SKUPINA_W), {
		x: COL_SKUPINA,
		y: yFirst,
		size: FS_ROW,
		font: ctx.reg,
		color: INK
	});
	// kod
	ctx.page.drawText(ellipsize(ctx.reg, p.kod ?? '—', FS_ROW, KOD_W), {
		x: COL_KOD,
		y: yFirst,
		size: FS_ROW,
		font: ctx.reg,
		color: INK
	});
	// nazov (multi-line)
	const effLines = nazovLines.length > 0 ? nazovLines : [''];
	effLines.forEach((ln, i) => {
		ctx.page.drawText(ln, {
			x: COL_NAZOV,
			y: yFirst - i * LINE,
			size: FS_ROW,
			font: ctx.reg,
			color: INK
		});
	});
	// rozmer/dlzka
	const rText = rozmerText(p);
	ctx.page.drawText(ellipsize(ctx.reg, rText, FS_ROW, ROZMER_W), {
		x: COL_ROZMER,
		y: yFirst,
		size: FS_ROW,
		font: ctx.reg,
		color: INK
	});
	// pocet ks
	textRight(ctx, p.pocetKs != null ? String(p.pocetKs) : '—', COL_POCET_R, yFirst, FS_ROW, ctx.reg);

	ctx.cursor = top - rowH;
	ctx.page.drawLine({
		start: { x: MARGIN, y: ctx.cursor },
		end: { x: MARGIN + CONTENT_W, y: ctx.cursor },
		thickness: 0.3,
		color: BORDER
	});
}

function drawParagraph(ctx: Ctx, text: string, size: number, font: PDFFont, color = INK): void {
	const lines = wrapText(font, text, size, CONTENT_W);
	for (const ln of lines.length > 0 ? lines : ['']) {
		ensureSpace(ctx, LINE);
		ctx.page.drawText(ln, {
			x: MARGIN,
			y: ctx.cursor - size,
			size,
			font,
			color
		});
		ctx.cursor -= LINE;
	}
}

/**
 * Vygeneruje PDF expedičného zoznamu. Súhrn sa vykreslí AJ zapíše do metadát
 * (Title/Subject/Keywords) — testovateľný kanál. `now` je injektovateľné pre testy.
 */
export async function generateExpediciaPdf(
	zoznam: ExpedicnyZoznam,
	ident: { zak: string; op: string; zakaznik: string },
	now: Date = new Date()
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const { reg, bold } = await embedDejavu(doc);
	const ctx: Ctx = {
		doc,
		page: doc.addPage([A4_W, A4_H]),
		reg,
		bold,
		cursor: A4_H - MARGIN
	};

	// hlavicka
	ensureSpace(ctx, FS_TITLE + 6);
	ctx.page.drawText('Expedičný zoznam', {
		x: MARGIN,
		y: ctx.cursor - FS_TITLE,
		size: FS_TITLE,
		font: bold,
		color: ACCENT
	});
	ctx.cursor -= FS_TITLE + 8;
	drawParagraph(
		ctx,
		`Zákazka: ${ident.zak}  ·  Objednávka: ${ident.op}  ·  Zákazník: ${ident.zakaznik}`,
		FS_META,
		reg,
		INK
	);
	const stav = now.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
	drawParagraph(
		ctx,
		`Stav k ${stav}  ·  interné (zákazník toto nevidí)  ·  zdroj: automatizácie Montalu.`,
		FS_META,
		reg,
		MUTED
	);
	ctx.cursor -= 4;

	// sucty
	drawParagraph(
		ctx,
		`Spolu: ${zoznam.spoluKusov} ks  ·  ` +
			`${zoznam.pocetProfilov} profilov  ·  ` +
			`${zoznam.pocetKomponentov} komponentov  ·  ` +
			`${zoznam.pocetSkiel} skiel  ·  ` +
			`${zoznam.pocetFixov} FIX  ·  ` +
			`${zoznam.pocetTesneni} tesnení`,
		FS_SEC,
		bold
	);
	ctx.cursor -= 4;

	// tabulka
	if (zoznam.polozky.length === 0) {
		drawParagraph(ctx, '(žiadne položky na expedíciu)', FS_ROW, reg, MUTED);
	} else {
		drawTableHeader(ctx);
		for (const p of zoznam.polozky) {
			drawRow(ctx, p);
		}
	}

	ctx.cursor -= 6;

	// honest-null poznamky
	if (zoznam.honestNullSkupiny.length > 0) {
		drawParagraph(
			ctx,
			'POZOR: Skupiny s neurčitými údajmi (—): ' +
				zoznam.honestNullSkupiny.join(', ') +
				'. Doplnia sa až po potvrdení od Dominika.',
			FS_META,
			reg,
			MUTED
		);
	}

	drawParagraph(
		ctx,
		'Vysvetlivky: "[ ]" odškrtni pri nakládke  ·  ' + '"—" = údaj zatiaľ neznámy (nevymýšľa sa).',
		FS_META,
		reg,
		MUTED
	);

	// metadata = testovatelny kanal
	doc.setTitle(`Expedičný zoznam — zákazka ${ident.zak} — Montalu`);
	doc.setAuthor('Montalu');
	doc.setCreator('Montalu automatizácie');
	doc.setSubject(
		[
			`Zákazka: ${ident.zak}`,
			`Objednávka: ${ident.op}`,
			`Zákazník: ${ident.zakaznik}`,
			`Položiek: ${zoznam.polozky.length}`,
			`Spolu ks: ${zoznam.spoluKusov}`
		].join('; ')
	);
	doc.setKeywords([
		ident.zak,
		ident.op,
		`${zoznam.polozky.length} položiek`,
		'expedičný zoznam',
		'zákazník nevidí'
	]);
	doc.setCreationDate(now);
	doc.setModificationDate(now);

	const bytes = await doc.save();
	return new Uint8Array(bytes);
}

/** Pohodlný wrapper — PDF ako base64 string (`ir.attachment.datas` je Binary = base64). */
export async function generateExpediciaPdfBase64(
	zoznam: ExpedicnyZoznam,
	ident: { zak: string; op: string; zakaznik: string },
	now?: Date
): Promise<string> {
	const bytes = await generateExpediciaPdf(zoznam, ident, now);
	return Buffer.from(bytes).toString('base64');
}

/** Názov PDF súboru — nesie ZAK aj sortovateľnú časovú pečiatku (odlíši verzie). */
export function expediciaPdfFilename(zak: string, now: Date = new Date()): string {
	const safe = (zak || 'zakazka').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
	return `Expedicny-zoznam-${safe}-${stampSk(now)}.pdf`;
}
