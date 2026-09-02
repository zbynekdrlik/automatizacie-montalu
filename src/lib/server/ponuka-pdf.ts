// Server-side PDF generátor pre ponuku (#277, #279 Fáza C, #318). Špecifikácia + PREDAJNÁ cena.
// #318: cena môže byť MO (verejný/interný dopyt, default) ALEBO VO (opečiatkovaná pri podaní od
// prihláseného veľkoobchodného účtu — `opts.cena.hladina === 'VO'`, nadpis „Veľkoobchodná cena").
// NULA Money kódov, NULA nárezu (test `ponuka-pdf.test.ts` + Money-safety guard to strážia). Cena
// sa počíta/pečiatkuje SERVER-SIDE (klientom dodaná cena sa NEDÔVERuje — `PonukaConfig` ju ani nemá).
//
// Knižnica: pdf-lib (+ @pdf-lib/fontkit) s vendorovaným DejaVu Sans subsetom (slovenské
// mäkčene, viď `fonts/dejavu.ts`). Self-contained, žiadny network/asset za behu — dizajn
// komentár na #277. Layout je ručný (štruktúrovaný spec-sheet): hlavička so značkou
// MontAlu, súhrn konfigurácie, slot pre 3D render (#276 dodá PNG neskôr), firma, disclaimer.
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejavu';
import {
	DISCLAIMER,
	DISCLAIMER_BEZ_CENY,
	FIRMA,
	firmaRiadky,
	formatEur,
	zhrnutieRiadky,
	type PonukaConfig
} from '$lib/ponuka';
import { cenaZCfgProdukt } from './dopyt-cena-stamp';
import { produktPdfNadpis, maCenovyZdroj } from '$lib/konfigurator-produkty';
import { cislaCiarka } from '$lib/konfigurator-jednotky';
import { formatDatumSk } from '$lib/datum';
// PREDAJNÁ cena. Neopečiatkovaný fallback (`cenaZCfg`, MO default) žije v `dopyt-cena-stamp.ts` —
// zdieľané so stampovaním (#309); oba server-only, do klienta sa nedostanú. Opečiatkovanú cenu
// (regen / submit, MO alebo VO podľa `opts.cena.hladina`, #318) preferuje `opts.cena` nižšie.
import type { VerejnaCena } from '$lib/konfigurator';

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

const mPlain = cislaCiarka;

/** #385: podnadpis/pätička/placeholder produkt-aware — bazén (bez ceny) NESMIE tvrdiť „pergola" ani
 *  „s orientačnou cenou". Pergola / NULL produkt ostáva byte-identický. */
function jePergola(produkt: string | null | undefined): boolean {
	return produkt == null || produkt === 'pergola';
}

/** Nadpis cenovej sekcie podľa hladiny (#318): veľkoobchod (VO) → „Veľkoobchodná cena",
 *  inak maloobchod → „Orientačná cena" (nezmenené pre verejný/MO výstup). */
function cenaNadpis(cena: VerejnaCena): string {
	return cena.hladina === 'VO' ? 'Veľkoobchodná cena' : 'Orientačná cena';
}

/** Textové riadky cenovej sekcie (zdieľané medzi PDF telom a metadátami). Ak sa katalógový
 *  rozmer (mriežka), na ktorý sa cena určila, líši od zadaného, čestne to doplní (#279 Fáza C
 *  review 🟡 — inak by cena „nesedela" so zadanými rozmermi). */
function cenaRiadky(cena: VerejnaCena, cfg: PonukaConfig): { hlavny: string; podriadok: string } {
	if (cena.druh === 'cena') {
		// #404: grid-note porovnaj LEN keď je príslušný cfg rozmer prítomný. Pergola nesie `sirka`+
		// `hlbka` → správanie byte-identické; bazén nemá `hlbka` (má `dlzka`) a rozmery sú už na mriežke
		// → note sa nevykreslí (žiadny zavádzajúci pergolový „š × h" label pre bazén).
		const liseSa =
			(cfg.sirka !== undefined && Math.round(cena.sirkaGridM * 1000) !== cfg.sirka) ||
			(cfg.hlbka !== undefined && Math.round(cena.hlbkaGridM * 1000) !== cfg.hlbka);
		const grid = liseSa
			? ` · katalógový rozmer ${mPlain(cena.sirkaGridM)} × ${mPlain(cena.hlbkaGridM)} m`
			: '';
		return {
			hlavny: `${formatEur(cena.sDph)} s DPH`,
			podriadok: `${formatEur(cena.bezDph)} bez DPH · model ${cena.model}${grid}`
		};
	}
	return {
		hlavny: 'Cena na vyžiadanie',
		podriadok: `Individuálna ponuka · model ${cena.model}`
	};
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

function drawHeader(
	ctx: Ctx,
	cursorTop: number,
	nadpis: string,
	maCena: boolean,
	produkt: string | null | undefined
): number {
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
	// #385: značková podpiska produkt-aware (pergola byte-identická „pergoly na mieru").
	ctx.page.drawText(jePergola(produkt) ? 'pergoly na mieru' : 'hliníkové výrobky na mieru', {
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
	// nadpis dokumentu — #384: produkt-aware („Špecifikácia pergoly" / „… bazénového zastrešenia" …)
	ctx.page.drawText(nadpis, {
		x: MARGIN,
		y: ruleY - 26,
		size: 18,
		font: ctx.bold,
		color: INK
	});
	// #385: podnadpis tvrdí „s orientačnou cenou" LEN keď PDF cenu naozaj nesie (honest-null).
	ctx.page.drawText(
		maCena ? 'Nezáväzná špecifikácia s orientačnou cenou' : 'Nezáväzná špecifikácia',
		{
			x: MARGIN,
			y: ruleY - 42,
			size: 10,
			font: ctx.reg,
			color: MUTED
		}
	);
	return ruleY - 66;
}

/** Sekcia s cenou. Nadpis `cenaNadpis(cena)` — MO „Orientačná cena", VO „Veľkoobchodná cena"
 *  (#318). Vykreslí sa len keď je cena známa. */
function drawCena(ctx: Ctx, cena: VerejnaCena, cfg: PonukaConfig, cursorTop: number): number {
	let y = cursorTop;
	ctx.page.drawText(cenaNadpis(cena), { x: MARGIN, y, size: 12, font: ctx.bold, color: ACCENT });
	y -= 8;
	ctx.page.drawLine({
		start: { x: MARGIN, y },
		end: { x: A4_W - MARGIN, y },
		thickness: 0.75,
		color: BORDER
	});
	y -= 22;
	const { hlavny, podriadok } = cenaRiadky(cena, cfg);
	ctx.page.drawText(hlavny, { x: MARGIN, y, size: 17, font: ctx.bold, color: INK });
	y -= 15;
	ctx.page.drawText(podriadok, { x: MARGIN, y, size: 10, font: ctx.reg, color: MUTED });
	return y - 14;
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
	cursorTop: number,
	produkt: string | null | undefined
): Promise<number> {
	// #279 Fáza C review 🔵: pridané Model + cenové riadky posúvajú kurzor nižšie. Zmenši slot,
	// aby firma/disclaimer (~150 pt) ostali nad pätičkou aj pri plnej konfigurácii + max popise
	// (inak by drawText kreslil mimo stránky). Rezerva 180 pt pod vrchom slotu; slot 100–210 pt.
	const slotH = Math.max(100, Math.min(210, cursorTop - MARGIN - 180));
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
			drawSlotPlaceholder(ctx, y, slotH, produkt);
		}
	} else {
		drawSlotPlaceholder(ctx, y, slotH, produkt);
	}
	return y - 20;
}

function drawSlotPlaceholder(
	ctx: Ctx,
	y: number,
	slotH: number,
	produkt: string | null | undefined
): void {
	// #385: bazén placeholder nesmie tvrdiť „pergoly" (pergola/NULL byte-identická).
	const txt = jePergola(produkt) ? '3D náhľad pergoly — doplní sa' : '3D náhľad — doplní sa';
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

function drawFirmaADisclaimer(ctx: Ctx, cursorTop: number, maCena: boolean): void {
	let y = cursorTop;
	// firma
	ctx.page.drawText(FIRMA.nazov, { x: MARGIN, y, size: 11, font: ctx.bold, color: INK });
	y -= 14;
	for (const line of firmaRiadky()) {
		ctx.page.drawText(line, { x: MARGIN, y, size: 9.5, font: ctx.reg, color: MUTED });
		y -= 12;
	}
	y -= 10;
	// #385: disclaimer bez ceny pre honest-null produkt (nesmie tvrdiť „uvedená cena je orientačná").
	for (const ln of wrapText(ctx.reg, maCena ? DISCLAIMER : DISCLAIMER_BEZ_CENY, 9.5, CONTENT_W)) {
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
	/** #309/#318: OPEČIATKOVANÁ cena (MO alebo VO podľa `.hladina`). Ak je zadaná, PDF ju použije
	 *  NAMIESTO prepočtu zo živej matice — tak re-download reprodukuje cenu (a hladinu) platnú pri
	 *  podaní. `undefined` → prepočet z cfg (`cenaZCfg`, MO) pre neopečiatkované (staré) riadky. */
	cena?: VerejnaCena;
	/** #384: produktový rad (kód katalógu) — robí nadpis špecifikácie produkt-aware. Neznámy/NULL
	 *  → 'Špecifikácia pergoly' (byte-identické so správaním pred #384 pre pergolu a staré riadky). */
	produkt?: string | null;
}

/**
 * Vygeneruje PDF špecifikáciu z konfigurácie. Súhrn hodnôt (vrátane ceny — MO alebo VO podľa
 * `opts.cena.hladina`, #318) sa vykreslí a SÚČASNE zapíše do metadát (Title/Subject/Keywords) —
 * to je testovateľný kanál (custom-font glyfy sa z PDF textu nedajú spoľahlivo prečítať, metadáta
 * áno). VO cesta je LEN pre opečiatkovanú VO cenu od prihláseného b2b (nikdy pre verejný dopyt).
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

	// Europe/Bratislava — prod kontajner beží v UTC, `toLocaleDateString` bez zóny by blízko
	// polnoci ukázal nesprávny deň (timestamps.md / #114). `opts.datum` je test-inject.
	const datum = opts.datum ?? formatDatumSk(new Date().toISOString());
	// PREDAJNÁ cena. #309/#318: OPEČIATKOVANÁ cena (`opts.cena`, MO alebo VO) má prednosť pred
	// prepočtom zo živej matice — tak re-download reprodukuje cenu (a hladinu) platnú pri podaní. Bez
	// stampu (staré/neopečiatkované) → prepočet z cfg (`null` keď rozmery chýbajú, honest-degrade).
	// #385: honest-degrade prepočet je LEN pre produkt s cenovým zdrojom (pergola; NULL/neznámy produkt
	// = starý pergolový riadok = má zdroj). Bazén/ostatné → cena null (žiadny prepočet pergolovej ceny
	// z rozmerov zastrešenia), takže re-download bazén dopytu neukáže vymyslenú cenu.
	// #404: produkt-aware prepočet (pergola → pergolová matica, bazen → bazénová; ostatné honest-null).
	const cena =
		opts.cena ?? (maCenovyZdroj(opts.produkt) ? cenaZCfgProdukt(cfg, opts.produkt) : null);
	// #384: nadpis dokumentu podľa produktu (fallback 'Špecifikácia pergoly' pre NULL/neznámy).
	const nadpis = produktPdfNadpis(opts.produkt);
	const maCena = cena !== null;
	let cursor = A4_H - MARGIN;
	cursor = drawHeader(ctx, cursor, nadpis, maCena, opts.produkt);
	cursor = drawKonfiguracia(ctx, cfg, cursor);
	if (cena) cursor = drawCena(ctx, cena, cfg, cursor);
	cursor = await drawRenderSlot(doc, ctx, opts.renderPng, cursor, opts.produkt);
	drawFirmaADisclaimer(ctx, cursor, maCena);
	drawFooter(ctx, datum);

	// metadáta = testovateľný kanál hodnôt + korektné vlastnosti dokumentu
	const rows = zhrnutieRiadky(cfg);
	const cenaMeta = cena ? cenaRiadky(cena, cfg) : null;
	doc.setTitle(`${nadpis} — Montalu`);
	doc.setAuthor(FIRMA.nazov);
	doc.setCreator(FIRMA.nazov);
	doc.setProducer('Montalu automatizácie — nezáväzná špecifikácia s orientačnou cenou');
	doc.setSubject(
		[
			...rows.map((r) => `${r.label}: ${r.value}`),
			// podriadok (bez DPH · model · príp. katalógový rozmer) ide do subjectu tiež — je to
			// testovateľný kanál (custom-font glyfy sa z PDF tela nedajú spoľahlivo prečítať).
			// #318: nadpis podľa hladiny — VO → „Veľkoobchodná cena:", MO → „Orientačná cena:".
			...(cena && cenaMeta
				? [`${cenaNadpis(cena)}: ${cenaMeta.hlavny} (${cenaMeta.podriadok})`]
				: [])
		].join('; ') || 'Prázdna konfigurácia'
	);
	// cena do keywords (Producer pdf-lib pri save() prepisuje svojím podpisom). #318 review 🔵:
	// keyword hladiny podľa cena.hladina — VO PDF nesie „veľkoobchodná cena", MO „orientačná cena"
	// (inak by VO dokument mal v metadátach protirečivý „orientačná cena" marker).
	doc.setKeywords([
		...rows.map((r) => r.value),
		...(cenaMeta ? [cenaMeta.hlavny] : []),
		// #385: cenový keyword LEN keď PDF cenu nesie (honest-null bazén nemá žiadny cenový marker).
		...(cena ? [cena.hladina === 'VO' ? 'veľkoobchodná cena' : 'orientačná cena'] : []),
		'nezáväzná špecifikácia'
	]);
	doc.setCreationDate(new Date());
	doc.setModificationDate(new Date());

	return doc.save();
}
