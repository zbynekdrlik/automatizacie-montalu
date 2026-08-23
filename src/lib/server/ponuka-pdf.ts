// Server-side PDF generátor pre verejnú ponuku (#277). ŠPECIFIKÁCIA, NIE cenník —
// NULA cien, NULA Money kódov (test `ponuka-pdf.test.ts` + Money-safety guard to strážia).
//
// Knižnica: pdf-lib (+ @pdf-lib/fontkit) s vendorovaným DejaVu Sans subsetom (slovenské
// mäkčene, viď `fonts/dejavu.ts`). Self-contained, žiadny network/asset za behu — dizajn
// komentár na #277. Layout je ručný (štruktúrovaný spec-sheet): hlavička so značkou
// MontAlu, súhrn konfigurácie, slot pre 3D render (#276 dodá PNG neskôr), firma, disclaimer.
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejavu';
import { DISCLAIMER, FIRMA, firmaRiadky, zhrnutieRiadky, type PonukaConfig } from '$lib/ponuka';

// A4 na body (pt) + jednotný okraj.
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const CONTENT_W = A4_W - 2 * MARGIN;

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTED = rgb(0.39, 0.45, 0.55); // #64748b
const ACCENT = rgb(0.11, 0.31, 0.85); // #1d4ed8
const BORDER = rgb(0.8, 0.84, 0.88);
const SLOT_BG = rgb(0.95, 0.96, 0.98);

/** Zalom text na riadky, ktoré sa zmestia do `maxWidth` pri danom fonte/veľkosti. */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
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

interface Ctx {
	page: PDFPage;
	reg: PDFFont;
	bold: PDFFont;
}

/** Značka MontAlu (tri stupňovité trojuholníky) — inline vektor, žiadny asset (#137 vzor). */
function drawMark(ctx: Ctx, x: number, topY: number, scale: number, color: RGB): void {
	// SVG súradnice (y-dole) z MontAluLogo.svelte, viewBox 0..24; drawSvgPath berie `y` ako
	// horný okraj a interpretuje path v y-dole konvencii.
	const path = 'M1 22 L7 22 L7 15 Z M9 22 L15 22 L15 8 Z M17 22 L23 22 L23 1 Z';
	ctx.page.drawSvgPath(path, { x, y: topY, scale, color });
}

function drawHeader(ctx: Ctx, cursorTop: number): number {
	const markScale = 1.5; // 24*1.5 = 36 pt vysoká značka
	drawMark(ctx, MARGIN, cursorTop, markScale, INK);
	const wordX = MARGIN + 24 * markScale + 10;
	ctx.page.drawText('MONTALU', {
		x: wordX,
		y: cursorTop - 22,
		size: 22,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('pergoly na mieru', {
		x: wordX,
		y: cursorTop - 36,
		size: 9,
		font: ctx.reg,
		color: MUTED
	});
	// akcentová linka pod hlavičkou
	const ruleY = cursorTop - 48;
	ctx.page.drawLine({
		start: { x: MARGIN, y: ruleY },
		end: { x: A4_W - MARGIN, y: ruleY },
		thickness: 2,
		color: ACCENT
	});
	// nadpis dokumentu
	ctx.page.drawText('Špecifikácia pergoly', {
		x: MARGIN,
		y: ruleY - 26,
		size: 18,
		font: ctx.bold,
		color: INK
	});
	ctx.page.drawText('Nezáväzná špecifikácia produktu — bez cien', {
		x: MARGIN,
		y: ruleY - 42,
		size: 10,
		font: ctx.reg,
		color: MUTED
	});
	return ruleY - 66;
}

function drawKonfiguracia(ctx: Ctx, cfg: PonukaConfig, cursorTop: number): number {
	let y = cursorTop;
	ctx.page.drawText('Konfigurácia', { x: MARGIN, y, size: 12, font: ctx.bold, color: ACCENT });
	y -= 8;
	ctx.page.drawLine({
		start: { x: MARGIN, y },
		end: { x: A4_W - MARGIN, y },
		thickness: 0.75,
		color: BORDER
	});
	y -= 18;
	const rows = zhrnutieRiadky(cfg);
	if (rows.length === 0) {
		ctx.page.drawText('Konfigurácia nebola zadaná.', {
			x: MARGIN,
			y,
			size: 10,
			font: ctx.reg,
			color: MUTED
		});
		return y - 16;
	}
	const labelX = MARGIN;
	const valueX = MARGIN + 150;
	const valueW = A4_W - MARGIN - valueX;
	const size = 10.5;
	for (const r of rows) {
		ctx.page.drawText(`${r.label}`, { x: labelX, y, size, font: ctx.bold, color: MUTED });
		const valueLines = wrapText(ctx.reg, r.value, size, valueW);
		for (const [i, ln] of valueLines.entries()) {
			ctx.page.drawText(ln, { x: valueX, y: y - i * 13, size, font: ctx.reg, color: INK });
		}
		y -= 13 * Math.max(1, valueLines.length) + 6;
	}
	return y - 6;
}

async function drawRenderSlot(
	doc: PDFDocument,
	ctx: Ctx,
	renderPng: Uint8Array | undefined,
	cursorTop: number
): Promise<number> {
	const slotH = 210;
	const y = cursorTop - slotH;
	ctx.page.drawRectangle({
		x: MARGIN,
		y,
		width: CONTENT_W,
		height: slotH,
		color: SLOT_BG,
		borderColor: BORDER,
		borderWidth: 0.75
	});
	if (renderPng && renderPng.length > 0) {
		try {
			const img = await doc.embedPng(renderPng);
			const pad = 10;
			const maxW = CONTENT_W - 2 * pad;
			const maxH = slotH - 2 * pad;
			const scaled = img.scaleToFit(maxW, maxH);
			ctx.page.drawImage(img, {
				x: MARGIN + (CONTENT_W - scaled.width) / 2,
				y: y + (slotH - scaled.height) / 2,
				width: scaled.width,
				height: scaled.height
			});
		} catch {
			// nevalidný PNG → nespadni, ukáž placeholder text
			drawSlotPlaceholder(ctx, y, slotH);
		}
	} else {
		drawSlotPlaceholder(ctx, y, slotH);
	}
	return y - 20;
}

function drawSlotPlaceholder(ctx: Ctx, y: number, slotH: number): void {
	const txt = '3D náhľad pergoly — doplní sa';
	const size = 11;
	const w = ctx.reg.widthOfTextAtSize(txt, size);
	ctx.page.drawText(txt, {
		x: MARGIN + (CONTENT_W - w) / 2,
		y: y + slotH / 2 - 4,
		size,
		font: ctx.reg,
		color: MUTED
	});
}

function drawFirmaADisclaimer(ctx: Ctx, cursorTop: number): void {
	let y = cursorTop;
	// firma
	ctx.page.drawText(FIRMA.nazov, { x: MARGIN, y, size: 11, font: ctx.bold, color: INK });
	y -= 14;
	for (const line of firmaRiadky()) {
		ctx.page.drawText(line, { x: MARGIN, y, size: 9.5, font: ctx.reg, color: MUTED });
		y -= 12;
	}
	y -= 10;
	// disclaimer (zalomený)
	for (const ln of wrapText(ctx.reg, DISCLAIMER, 9.5, CONTENT_W)) {
		ctx.page.drawText(ln, { x: MARGIN, y, size: 9.5, font: ctx.reg, color: MUTED });
		y -= 13;
	}
}

function drawFooter(ctx: Ctx, datum: string): void {
	ctx.page.drawLine({
		start: { x: MARGIN, y: MARGIN + 14 },
		end: { x: A4_W - MARGIN, y: MARGIN + 14 },
		thickness: 0.5,
		color: BORDER
	});
	ctx.page.drawText(`Vygenerované ${datum} · ${FIRMA.web}`, {
		x: MARGIN,
		y: MARGIN,
		size: 8,
		font: ctx.reg,
		color: MUTED
	});
}

export interface PonukaPdfOpts {
	/** PNG bajty 3D renderu (#276 dodá neskôr) — voliteľné; bez neho sa vykreslí placeholder. */
	renderPng?: Uint8Array;
	/** dátum na pätičke (test-injectable); default = dnešný v sk formáte. */
	datum?: string;
}

/**
 * Vygeneruje PDF špecifikáciu z konfigurácie. Súhrn hodnôt sa vykreslí a SÚČASNE zapíše do
 * metadát (Title/Subject/Keywords) — to je testovateľný kanál (custom-font glyfy sa z PDF
 * textu nedajú spoľahlivo prečítať, metadáta áno). Nikde žiadna cena.
 */
export async function generatePonukaPdf(
	cfg: PonukaConfig,
	opts: PonukaPdfOpts = {}
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);
	const reg = await doc.embedFont(Buffer.from(DEJAVU_SANS_REGULAR_B64, 'base64'), { subset: true });
	const bold = await doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, 'base64'), { subset: true });
	const page = doc.addPage([A4_W, A4_H]);
	const ctx: Ctx = { page, reg, bold };

	const datum = opts.datum ?? new Date().toLocaleDateString('sk-SK');
	let cursor = A4_H - MARGIN;
	cursor = drawHeader(ctx, cursor);
	cursor = drawKonfiguracia(ctx, cfg, cursor);
	cursor = await drawRenderSlot(doc, ctx, opts.renderPng, cursor);
	drawFirmaADisclaimer(ctx, cursor);
	drawFooter(ctx, datum);

	// metadáta = testovateľný kanál hodnôt + korektné vlastnosti dokumentu
	const rows = zhrnutieRiadky(cfg);
	doc.setTitle('Špecifikácia pergoly — Montalu');
	doc.setAuthor(FIRMA.nazov);
	doc.setCreator(FIRMA.nazov);
	doc.setProducer('Montalu automatizácie — nezáväzná špecifikácia (bez cien)');
	doc.setSubject(rows.map((r) => `${r.label}: ${r.value}`).join('; ') || 'Prázdna konfigurácia');
	// „bez cien" marker do keywords (Producer pdf-lib pri save() prepisuje svojím podpisom)
	doc.setKeywords([...rows.map((r) => r.value), 'bez cien', 'nezáväzná špecifikácia']);
	doc.setCreationDate(new Date());
	doc.setModificationDate(new Date());

	return doc.save();
}
