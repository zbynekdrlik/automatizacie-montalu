// #529: server-side GRAFICKÝ nárezák PDF — príloha (`ir.attachment`, kind='narezak') pripínaná na
// kiosk „VÝROBA / Rezanie" cez `montalu_narezak_upload`. Rezač na tablete má vidieť TO ISTÉ, čo je
// na výtlačku z appky (`RozpisRezov.svelte`): tyče kreslené proporčne s očíslovanými rezmi (mm),
// uhlom rezu (45° zošikmenie / rovný 90°), odpadom per tyč aj spolu, súčtami za profil, obrázkom
// rezu profilu a kódom profilu. ŽIADNE ceny (Money-neutrálne).
//
// Nahrádza textový `plan-rezov-pdf.ts` (#511) — ten kreslil tyče len ako reťazce. Číta čistý
// `MaterialRow[]` (FFD `ffdPack` výstup: per profil `bary: Tyc[]` s kusmi + zvyškom, `sikmyRez`,
// `barLen`, `kod`, agregované `rezy`) + hlavičku. Žiadny import z Money/price modulov, žiadne
// sumové/cenové polia (guard `tests/narezak-pdf.test.ts`).
//
// Knižnica: pdf-lib (+ @pdf-lib/fontkit) s DejaVu subsetom cez zdieľaný `pdf-common.ts` — vzor
// `ponuka-pdf.ts`/`plan-rezov-pdf.ts`, self-contained. Obrázky profilov = server-only base64 PNG
// (`profil-png.ts`, generované z webp cez dwebp) — pdf-lib nevie webp; žiadna runtime image
// závislosť. Custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať (`dopyt-ponuka.md`), preto
// sa hodnoty (tyče/rezy/uhol/odpad) vykreslia AJ zapíšu do metadát (Title/Subject/Keywords) —
// testovateľný kanál. BEZ varovných emoji (DejaVu subset nemá U+26A0 → tofu); honesty riadky nesú
// textovú predponu „POZOR:".
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import type { MaterialRow, Tyc } from './compute';
import { KOTUC } from './compute';
import { sumaOdpad } from '$lib/odpad';
import { profilPngB64 } from './profil-png';
import {
	A4_W,
	A4_H,
	MARGIN,
	CONTENT_W,
	wrapText,
	ellipsize,
	embedDejavu,
	stampSk
} from './pdf-common';

const INK = rgb(0.06, 0.09, 0.16); // #0f172a
const MUTED = rgb(0.39, 0.45, 0.55); // #64748b
const ACCENT = rgb(0.11, 0.31, 0.85); // #1d4ed8
const BAR_BG = rgb(0.973, 0.98, 0.988); // #f8fafc
const CUT_FILL = rgb(0.96, 0.93, 0.886); // #f5ede2 (drevo)
const ODPAD_FILL = rgb(0.945, 0.96, 0.976); // #f1f5f9
const STROKE = rgb(0.28, 0.33, 0.4); // #475569

const FS_TITLE = 15;
const FS_META = 9;
const FS_SEC = 11;
const FS_ROW = 9;
const FS_SEG = 7; // popisky rezov na tyči
const LINE = 12;

const NUMCOL = 22; // šírka stĺpca čísla tyče „/1/"
const BAR_H = 24; // výška nakreslenej tyče (pt)
const BAR_GAP = 6; // medzera medzi tyčami
const IMG_BOX = 40; // hrana boxu obrázka profilu

/** hlavička nárezák PDF — zdroj: uložený plán (`zak`) + odvodené z odpisu (`op`, `zakaznik`). */
export interface NarezakPdfHeader {
	zak: string;
	op: string;
	zakaznik: string;
	/** voliteľný názov uloženého plánu (#505) — do hlavičky, ak je. */
	nazov?: string;
}

/** voliteľné parametre nákresu (summary hlavička + zimná záhrada značky posuvov). */
export interface NarezakPdfOpts {
	/** dĺžka tyče do súhrnnej hlavičky (mm) — per-profil sa berie `m.barLen`. Default: prvý profil. */
	dlzkaTyce?: number;
	/** rezná medzera (mm) do súhrnu. Default KOTUC (4). */
	reznaMedzera?: number;
	/** zvýrazniť z ktorého posuvu je kus (zimná záhrada) — značka „Z1/Z2" pri reze. */
	viacPosuvov?: boolean;
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

/** Vyplní polygón (absolútne PDF body) cez `drawSvgPath` — pdf-lib 1.17 nemá `drawPolygon`.
 *  SVG origin je (0, A4_H) a y ide DOLE, takže PDF bod (px,py) → svg (px, A4_H − py). */
function fillPoly(
	page: PDFPage,
	pts: { x: number; y: number }[],
	fill: ReturnType<typeof rgb>,
	stroke: ReturnType<typeof rgb>
): void {
	const d =
		pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(A4_H - p.y).toFixed(2)}`)
			.join(' ') + ' Z';
	page.drawSvgPath(d, { x: 0, y: A4_H, color: fill, borderColor: stroke, borderWidth: 0.7 });
}

/** Text vycentrovaný na `cx` (v pt), orezaný na `maxW`. */
function drawCentered(
	ctx: Ctx,
	text: string,
	cx: number,
	y: number,
	size: number,
	font: PDFFont,
	color: ReturnType<typeof rgb>,
	maxW: number
): void {
	const t = ellipsize(font, text, size, maxW);
	const w = font.widthOfTextAtSize(t, size);
	ctx.page.drawText(t, { x: cx - w / 2, y, size, font, color });
}

/** Počet profilov s aspoň jednou tyčou. */
export function pocetProfilov(material: MaterialRow[]): number {
	return material.filter((m) => m.tyce > 0).length;
}

/** Distinct dĺžky rezov jedného profilu (zostupne) — do metadát ako „segment labels" kanál. */
function distinctRezy(m: MaterialRow): number[] {
	return [...new Set(m.rezy.filter((r) => r.ks > 0).map((r) => r.rozmer))].sort((a, b) => b - a);
}

/**
 * Nakreslí jednu tyč: podklad + segmenty rezov (lichobežník pri 45°, obdĺžnik pri rovnom) + odpad
 * (hatch) + mm popisky. Geometria zrkadlí `RozpisRezov.segmenty` (uhly idú DO VNÚTRA hornej hrany).
 * Kreslí od `ctx.cursor` nadol; vráti výšku bloku tyče (pt).
 */
function drawBar(
	ctx: Ctx,
	tyc: Tyc,
	index: number,
	barLen: number,
	sikmy: boolean,
	viacPosuvov: boolean
): void {
	const barX = MARGIN + NUMCOL;
	const barW = CONTENT_W - NUMCOL;
	const topY = ctx.cursor;
	const botY = ctx.cursor - BAR_H;
	const scale = barW / Math.max(1, barLen); // pt na mm
	// 45° skew hornej hrany — zrkadlí S=250 mm z RozpisRezov, prevedené na pt.
	const sBase = sikmy ? 250 * scale : 0;

	// číslo tyče
	ctx.page.drawText(`/${index + 1}/`, {
		x: MARGIN,
		y: (topY + botY) / 2 - FS_SEG / 2,
		size: FS_SEG,
		font: ctx.reg,
		color: MUTED
	});
	// podklad tyče
	ctx.page.drawRectangle({
		x: barX,
		y: botY,
		width: barW,
		height: BAR_H,
		color: BAR_BG,
		borderColor: STROKE,
		borderWidth: 0.7
	});

	let xMm = 0;
	for (const k of tyc.kusy) {
		const x0 = barX + xMm * scale;
		const x1 = barX + (xMm + k.dlzka) * scale;
		const segW = x1 - x0;
		const s = Math.min(sBase, Math.max(0, segW / 2 - 0.5));
		// lichobežník: dolná hrana [x0,x1], horná zúžená o s z oboch strán
		fillPoly(
			ctx.page,
			[
				{ x: x0 + s, y: topY },
				{ x: x1 - s, y: topY },
				{ x: x1, y: botY },
				{ x: x0, y: botY }
			],
			CUT_FILL,
			STROKE
		);
		// mm popisok — skry pri úzkom segmente (<5 % tyče), zrkadlí skryLabel
		if ((k.dlzka / barLen) * 100 >= 5) {
			const badge = viacPosuvov && k.posuv ? `Z${k.posuv} ` : '';
			drawCentered(
				ctx,
				`${badge}${fmt(k.rozmer)}`,
				(x0 + x1) / 2,
				(topY + botY) / 2 - FS_SEG / 2,
				FS_SEG,
				ctx.bold,
				INK,
				segW - 2
			);
		}
		xMm += k.dlzka;
	}

	// odpad na konci
	if (tyc.zvysok > 1) {
		const x0 = barX + xMm * scale;
		const s = Math.min(sBase, Math.max(0, (barX + barW - x0) / 2 - 0.5));
		fillPoly(
			ctx.page,
			[
				{ x: x0 - s, y: topY },
				{ x: barX + barW, y: topY },
				{ x: barX + barW, y: botY },
				{ x: x0, y: botY }
			],
			ODPAD_FILL,
			STROKE
		);
		// odpad je odlíšený svetlejšou výplňou + popiskom (pdf-lib nemá hatch pattern; RozpisRezov
		// používa SVG pattern, tu stačí farba + „odpad NNN" text — jasne čitateľné pri píle).
		const boxW = barX + barW - x0;
		if ((tyc.zvysok / barLen) * 100 >= 12) {
			drawCentered(
				ctx,
				`odpad ${fmt(tyc.zvysok)}`,
				(x0 + barX + barW) / 2,
				(topY + botY) / 2 - FS_SEG / 2,
				FS_SEG,
				ctx.reg,
				MUTED,
				boxW - 2
			);
		}
	}

	ctx.cursor -= BAR_H + BAR_GAP;
}

/** Embed base64 PNG obrázka profilu (server-only asset). `undefined` keď obrázok nemáme. */
async function embedProfil(doc: PDFDocument, kod: string): Promise<PDFImage | undefined> {
	const b64 = kod ? profilPngB64(kod) : undefined;
	if (!b64) return undefined;
	try {
		return await doc.embedPng(Buffer.from(b64, 'base64'));
	} catch {
		return undefined; // poškodený asset → bez obrázka (graceful, ako UI maObrazok)
	}
}

/**
 * Vygeneruje GRAFICKÝ nárezák PDF z `MaterialRow[]` + hlavičky. Hodnoty (zak/op/zákazník/profily/
 * tyče/rezy/uhol/odpad) sa vykreslia AJ zapíšu do metadát (testovateľný kanál, BEZ cien).
 * `now` je injektovateľné (deterministická „Dátum" pečiatka; Europe/Bratislava).
 */
export async function generateNarezakPdf(
	header: NarezakPdfHeader,
	material: MaterialRow[],
	opts: NarezakPdfOpts = {},
	now: Date = new Date()
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const { reg, bold } = await embedDejavu(doc);
	const ctx: Ctx = { doc, page: doc.addPage([A4_W, A4_H]), reg, bold, cursor: A4_H - MARGIN };

	const pouzite = material.filter((m) => m.tyce > 0);
	const profilov = pouzite.length;
	const tyceSpolu = pouzite.reduce((s, m) => s + m.tyce, 0);
	const spolu = sumaOdpad(material);
	const reznaMedzera = opts.reznaMedzera ?? KOTUC;
	const dlzkaTyce = opts.dlzkaTyce ?? pouzite[0]?.barLen ?? 0;
	const viacPosuvov = opts.viacPosuvov ?? false;

	// hlavička
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
		`Dátum: ${stav}  ·  nahrádza predchádzajúce  ·  zdroj: automatizácie Montalu (nárezový plán).`,
		FS_META,
		reg,
		MUTED
	);
	drawParagraph(
		ctx,
		`Profilov: ${profilov}  ·  Tyčí spolu: ${tyceSpolu}  ·  Odpad spolu: ${fmt(spolu.odpadMm)} mm (${fmt(spolu.odpadPct)} %)  ·  Dĺžka tyče: ${fmt(dlzkaTyce)} mm  ·  Rezná medzera: ${fmt(reznaMedzera)} mm`,
		FS_META,
		bold,
		INK
	);
	ctx.cursor -= 6;

	// per profil
	let rezovSpolu = 0;
	let mameSikmy = false;
	let mameRovny = false;
	for (const m of pouzite) {
		const sikmy = m.sikmyRez ?? true;
		if (sikmy) mameSikmy = true;
		else mameRovny = true;
		const barLen = m.barLen || dlzkaTyce || 7500;
		rezovSpolu += m.bary.reduce((s, b) => s + b.kusy.length, 0);

		// rezervuj priestor na hlavičku profilu + obrázok + 1 tyč
		ensureSpace(ctx, IMG_BOX + FS_SEC + LINE + BAR_H + BAR_GAP + 8);

		const img = await embedProfil(doc, m.kod);
		const headTop = ctx.cursor;
		let textX = MARGIN;
		if (img) {
			const sc = Math.min(IMG_BOX / img.width, IMG_BOX / img.height);
			const w = img.width * sc;
			const h = img.height * sc;
			ctx.page.drawImage(img, { x: MARGIN, y: headTop - h, width: w, height: h });
			ctx.page.drawRectangle({
				x: MARGIN - 1,
				y: headTop - IMG_BOX,
				width: IMG_BOX + 2,
				height: IMG_BOX,
				borderColor: rgb(0.89, 0.91, 0.94),
				borderWidth: 0.6
			});
			textX = MARGIN + IMG_BOX + 10;
		}
		// nadpis: kod · nazov
		const titul = m.kod ? `${m.kod}${m.nazov ? ' · ' + m.nazov : ''}` : m.nazov || '(bez názvu)';
		ctx.page.drawText(ellipsize(bold, titul, FS_SEC, CONTENT_W - (textX - MARGIN)), {
			x: textX,
			y: headTop - FS_SEC,
			size: FS_SEC,
			font: bold,
			color: INK
		});
		// stat riadok
		const stat =
			`Počet tyčí: ${m.tyce}  ·  dĺžka tyče ${fmt(barLen)} mm  ·  kotúč ${fmt(reznaMedzera)} mm  ·  ` +
			`odpad ${fmt(m.odpadMm)} mm (${fmt(m.odpadPct)} %)  ·  rez ${sikmy ? '45°' : 'rovný'}`;
		ctx.page.drawText(ellipsize(reg, stat, FS_ROW, CONTENT_W - (textX - MARGIN)), {
			x: textX,
			y: headTop - FS_SEC - LINE,
			size: FS_ROW,
			font: reg,
			color: MUTED
		});
		// posun kurzor pod vyšší z (obrázok / text)
		ctx.cursor = headTop - Math.max(img ? IMG_BOX : 0, FS_SEC + LINE + 4) - 6;

		// tyče
		m.bary.forEach((tyc, ti) => {
			ensureSpace(ctx, BAR_H + BAR_GAP);
			drawBar(ctx, tyc, ti, barLen, sikmy, viacPosuvov);
		});

		// tabuľka rezov (Dĺžka / Kusov / Rez)
		ctx.cursor -= 2;
		ensureSpace(ctx, LINE + LINE);
		const colD = MARGIN;
		const colK = MARGIN + 90;
		const colR = MARGIN + 150;
		ctx.page.drawText('Dĺžka (mm)', {
			x: colD,
			y: ctx.cursor - FS_ROW,
			size: 8,
			font: bold,
			color: MUTED
		});
		ctx.page.drawText('Kusov', {
			x: colK,
			y: ctx.cursor - FS_ROW,
			size: 8,
			font: bold,
			color: MUTED
		});
		ctx.page.drawText('Rez', {
			x: colR,
			y: ctx.cursor - FS_ROW,
			size: 8,
			font: bold,
			color: MUTED
		});
		ctx.cursor -= LINE;
		for (const r of m.rezy.filter((x) => x.ks > 0)) {
			ensureSpace(ctx, LINE);
			ctx.page.drawText(fmt(r.rozmer), {
				x: colD,
				y: ctx.cursor - FS_ROW,
				size: FS_ROW,
				font: reg,
				color: INK
			});
			ctx.page.drawText(String(r.ks), {
				x: colK,
				y: ctx.cursor - FS_ROW,
				size: FS_ROW,
				font: reg,
				color: INK
			});
			ctx.page.drawText(sikmy ? '45° / 45°' : 'rovný', {
				x: colR,
				y: ctx.cursor - FS_ROW,
				size: FS_ROW,
				font: reg,
				color: INK
			});
			ctx.cursor -= LINE;
		}
		ctx.cursor -= 10;
	}

	// odpad spolu (≥2 profily)
	if (spolu.profily > 1) {
		ensureSpace(ctx, LINE + 4);
		drawParagraph(
			ctx,
			`Odpad spolu (naprieč ${spolu.profily} profilmi): ${fmt(spolu.odpadMm)} mm (${fmt(spolu.odpadPct)} %)`,
			FS_META,
			reg,
			MUTED
		);
	}

	// metadáta = testovateľný kanál hodnôt (BEZ cien)
	const uhol = mameSikmy && mameRovny ? '45°+rovný' : mameSikmy ? '45°' : 'rovný';
	doc.setTitle(`Nárezový plán — zákazka ${header.zak} — Montalu`);
	doc.setAuthor('Montalu');
	doc.setCreator('Montalu automatizácie');
	doc.setSubject(
		[
			`Zákazka: ${header.zak}`,
			`Objednávka: ${header.op}`,
			`Zákazník: ${header.zakaznik}`,
			`Profilov: ${profilov}`,
			`Tyčí: ${tyceSpolu}`,
			`Rezov: ${rezovSpolu}`,
			`Uhol: ${uhol}`,
			`Odpad: ${fmt(spolu.odpadMm)} mm`
		].join('; ')
	);
	// Keywords: per-profil digest tyčí + distinct dĺžky rezov (segment labels kanál).
	const digest = pouzite
		.map((m) => `${m.kod || m.nazov}[${m.tyce}t;${distinctRezy(m).map(fmt).join('/')}]`)
		.join(' ');
	doc.setKeywords([
		header.zak,
		header.op,
		`${profilov} profilov`,
		`${tyceSpolu} tyčí`,
		`${rezovSpolu} rezov`,
		uhol,
		'nárezový plán',
		'rezanie',
		digest
	]);
	doc.setCreationDate(now);
	doc.setModificationDate(now);

	return doc.save();
}

/** Pohodlný wrapper — PDF ako base64 string (`ir.attachment.datas` je Binary = base64). */
export async function generateNarezakPdfBase64(
	header: NarezakPdfHeader,
	material: MaterialRow[],
	opts?: NarezakPdfOpts,
	now?: Date
): Promise<string> {
	const bytes = await generateNarezakPdf(header, material, opts, now);
	return Buffer.from(bytes).toString('base64');
}

/** Názov PDF súboru pripnutého k zákazke — nesie ZAK aj sortovateľnú časovú pečiatku (odlíši verzie). */
export function narezakPdfFilename(zak: string, now: Date = new Date()): string {
	const safe = (zak || 'zakazka').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
	return `Narezak-${safe}-${stampSk(now)}.pdf`;
}
