// Zdieľané PDF pomôcky pre server-side generátory (`ponuka-pdf.ts`, `zakazka-pdf.ts`). Extrahované
// (#418 review), aby druhý konzument neduplikoval A4 rozmery, `wrapText` a embed DejaVu fontov —
// rovnaká disciplína ako `odoo-rpc.ts` vyextrahovaný z `odoo-lead.ts` (#340). Hodnoty sú byte-identické
// s pôvodnými v `ponuka-pdf.ts` → jeho PDF výstup ostáva nezmenený.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejavu';
import { buildQrMatrix } from '$lib/qr-zakazka';

// A4 na body (pt) + jednotný okraj.
export const A4_W = 595.28;
export const A4_H = 841.89;
export const MARGIN = 48;
export const CONTENT_W = A4_W - 2 * MARGIN;

/** Zalom text na riadky, ktoré sa zmestia do `maxWidth` pri danom fonte/veľkosti. Prázdny vstup → `[]`
 *  (volajúci si výšku riadka ošetrí sám); dlhé jedno slovo sa NEZALOMÍ vnútri (volajúci ho oreže). */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
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

/** Ak `s` presahuje `maxWidth`, orež ju a doplň „…" tak, aby sa výsledok zmestil (bezpečné pre stĺpce). */
export function ellipsize(font: PDFFont, s: string, size: number, maxWidth: number): string {
	if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
	const ell = '…';
	let out = s;
	while (out.length > 0 && font.widthOfTextAtSize(out + ell, size) > maxWidth) {
		out = out.slice(0, -1);
	}
	return out.length > 0 ? out + ell : ell;
}

/** YYYYMMDD-HHMM v Europe/Bratislava — sortovateľná pečiatka do názvu prílohy (odlíši viac verzií).
 *  Zdieľané `zakazka-pdf.ts` (Rozpis-…) aj `plan-rezov-pdf.ts` (Plan-rezov-…) — jeden zdroj pravdy
 *  pre časovú pečiatku názvu súboru (UTC pasca: Intl s explicitným `timeZone`, nie `toISOString`). */
export function stampSk(now: Date): string {
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

/**
 * #528: Nakreslí QR zákazky (payload = holé `sale.order.name`) do PDF stránky obdĺžnikmi (vektorovo,
 * ostré pri každom DPI). QR obsadí štvorec `size×size` bodov s ľavým-dolným rohom v `(x, y)`, vrátane
 * 4-modulovej quiet zóny a bieleho pozadia (čitateľné aj keď pod ním prebehne text hlavičky).
 * Prázdny payload → nekreslí nič a vráti `false` (výstup PDF ostáva byte-identický s dneškom).
 */
export function drawQrZakazkaPdf(
	page: PDFPage,
	payload: string,
	x: number,
	y: number,
	size: number
): boolean {
	const m = buildQrMatrix(payload);
	if (!m) return false;
	const QUIET = 4; // moduly quiet zóny na každej strane (QR štandard)
	const cell = size / (m.count + 2 * QUIET);
	// biele pozadie celého štvorca (quiet zóna + istota čitateľnosti nad prípadným textom)
	page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
	const black = rgb(0, 0, 0);
	for (let r = 0; r < m.count; r++) {
		for (let c = 0; c < m.count; c++) {
			if (!m.isDark(r, c)) continue;
			// riadok 0 je HORE; pdf-lib má počiatok vľavo-dole, y rastie nahor
			page.drawRectangle({
				x: x + (c + QUIET) * cell,
				y: y + size - (r + QUIET + 1) * cell,
				width: cell,
				height: cell,
				color: black
			});
		}
	}
	return true;
}

// #528: QR zákazky v hlavičke — jeden zdroj geometrie pre plán rezov aj expedičný zoznam.
export const QR_ZAKAZKA_SIZE = 68; // ~24 mm @ 72dpi
const QR_ZAKAZKA_TEXT_GAP = 12; // medzera medzi textom hlavičky a QR (pt)

/** Ľavý-dolný roh QR štvorca v pravom hornom rohu stránky (pre `drawQrZakazkaPdf`). */
export function qrZakazkaHeaderXY(): { x: number; y: number; size: number } {
	return {
		x: A4_W - MARGIN - QR_ZAKAZKA_SIZE,
		y: A4_H - MARGIN - QR_ZAKAZKA_SIZE,
		size: QR_ZAKAZKA_SIZE
	};
}

/**
 * Max šírka textu hlavičky. Keď je QR prítomný, text hlavičky sa zalomí tak, aby jeho pravý okraj
 * ostal VĽAVO od QR (o `QR_ZAKAZKA_TEXT_GAP`) — inak by dlhé meno zákazníka pretlačilo QR moduly
 * (QR biele pozadie sa kreslí PRED textom hlavičky). Bez QR = plná `CONTENT_W` (výstup nezmenený).
 */
export function qrHeaderTextWidth(hasQr: boolean): number {
	if (!hasQr) return CONTENT_W;
	return qrZakazkaHeaderXY().x - QR_ZAKAZKA_TEXT_GAP - MARGIN;
}

/** Spodná hranica QR pásma (y, pt) — riadky hlavičky s baseline nad ňou sa musia zalomiť užšie. */
export function qrHeaderBandBottom(): number {
	return qrZakazkaHeaderXY().y;
}

/** Zaregistruj fontkit a embedni vendorovaný DejaVu Sans subset (regular + bold) do dokumentu. */
export async function embedDejavu(doc: PDFDocument): Promise<{ reg: PDFFont; bold: PDFFont }> {
	doc.registerFontkit(fontkit);
	const reg = await doc.embedFont(Buffer.from(DEJAVU_SANS_REGULAR_B64, 'base64'), { subset: true });
	const bold = await doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, 'base64'), { subset: true });
	return { reg, bold };
}
