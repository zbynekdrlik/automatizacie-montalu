// Zdieľané PDF pomôcky pre server-side generátory (`ponuka-pdf.ts`, `zakazka-pdf.ts`). Extrahované
// (#418 review), aby druhý konzument neduplikoval A4 rozmery, `wrapText` a embed DejaVu fontov —
// rovnaká disciplína ako `odoo-rpc.ts` vyextrahovaný z `odoo-lead.ts` (#340). Hodnoty sú byte-identické
// s pôvodnými v `ponuka-pdf.ts` → jeho PDF výstup ostáva nezmenený.
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejavu';

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

/** Zaregistruj fontkit a embedni vendorovaný DejaVu Sans subset (regular + bold) do dokumentu. */
export async function embedDejavu(doc: PDFDocument): Promise<{ reg: PDFFont; bold: PDFFont }> {
	doc.registerFontkit(fontkit);
	const reg = await doc.embedFont(Buffer.from(DEJAVU_SANS_REGULAR_B64, 'base64'), { subset: true });
	const bold = await doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, 'base64'), { subset: true });
	return { reg, bold };
}
