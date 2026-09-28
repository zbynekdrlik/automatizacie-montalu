// #587 (Odoo úloha 1185 — „Výkres alebo DXF k sklu pôjde s objednávkou z appky"): PDF výkres
// tabule s vŕtaným zámkovým otvorom pre dodávateľa skla (IZOS). Generuje sa z polohy uloženej
// k riadku objednávky skla „— s otvorom" (#578) a ide ako príloha riadku do Odoo `glass_order`
// (`odoo-glass-order-upload.ts`) + na stiahnutie z podkladu (`/objednavka-skla/vykres-otvoru/[id]`).
//
// JEDEN zdroj polohy: `sklo-otvory.ts` (odsadenie od hrany, výška vŕtania, priemer) — ten istý, z
// ktorého kreslí náhľad nárezáku `Nahlad2D`. Tento súbor NEMÁ vlastné číselné konštanty polohy
// (strážený testom `tests/sklo-otvor-poloha-587.test.ts`).
//
// Money-NEUTRÁLNE: žiadne ceny, žiadny Money kód — len geometria tabule. Hodnoty sú aj v metadátach
// (Title/Subject/Keywords) = testovateľný kanál (custom-font glyfy sa z PDF tela čítať nedajú).
// DejaVu subset NEMÁ glyf „⌀" (U+2300) → v PDF TELE sa kreslí „Ø" (U+00D8); metadáta nesú „⌀".
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { A4_W, A4_H, MARGIN, CONTENT_W, embedDejavu, ellipsize, wrapText } from './pdf-common';
import { formatDatumCasSk } from '../datum';
import { popisPozicie } from '../objednavka-skla-pozicia';
import type { PolohaOtvoru } from '../sklo-otvory';
import type { SkloPolozka } from './objednavka-skla';

/** Vstup výkresu: jedna tabuľa (riadok objednávky skla) s polohou otvoru. */
export interface VykresOtvoruVstup {
	zak: string;
	op: string;
	/** pozícia riadku („Zasklenie 1 — s otvorom ⌀…") */
	popis: string;
	typSkla: string;
	sirkaMm: number;
	vyskaMm: number;
	pocet: number;
	otvor: PolohaOtvoru;
}

const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.35, 0.39, 0.45);
const GLASS = rgb(0.9, 0.95, 0.98);
const KOTA = rgb(0.2, 0.25, 0.33);

/** mm → text (celé bez desatín, inak 1 desatinné miesto s čiarkou). */
const fmtMm = (x: number): string =>
	Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10).replace('.', ',');

/** „⌀" nie je v DejaVu subsete → v tele PDF „Ø" (technická konvencia priemeru). */
const pdfText = (s: string): string => s.replace(/⌀/g, 'Ø');

/** ASCII slug pre názov súboru prílohy (Odoo aj prehliadač). */
function slug(s: string): string {
	return (
		s
			.normalize('NFD')
			.replace(/\p{M}/gu, '')
			.replace(/[^A-Za-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'x'
	);
}

/** Názov PDF prílohy: `Vykres-otvoru-<zakazka>-<pozicia>.pdf` (stabilný — nová verzia prepíše). */
export function vykresOtvoruFilename(v: { zak: string; popis: string }): string {
	return `Vykres-otvoru-${slug(v.zak)}-${slug(v.popis)}.pdf`;
}

/**
 * Riadok podkladu → vstup výkresu, alebo `null` (honest-null — výkres sa NEgeneruje): riadok bez
 * otvoru, bez uloženej polohy (spred #587), bez výšky (šikmý/atyp bez rozmerov) alebo bez šírky.
 */
export function vykresOtvoruZPolozky(p: SkloPolozka): VykresOtvoruVstup | null {
	if (!p.otvor || !(p.spec.holesQty > 0)) return null;
	if (p.sikmy || p.vyskaMm == null || !(p.vyskaMm > 0) || !(p.sirkaMm > 0)) return null;
	return {
		zak: p.zak,
		op: p.op,
		popis: popisPozicie(p.popis, p.modul),
		typSkla: p.typSklaManual || p.typSkla,
		sirkaMm: p.sirkaMm,
		vyskaMm: p.vyskaMm,
		pocet: p.pocet,
		otvor: p.otvor
	};
}

/** Kótovacia čiara s koncovými značkami a textom v strede (vodorovná alebo zvislá). */
function kota(
	page: PDFPage,
	font: PDFFont,
	a: { x: number; y: number },
	b: { x: number; y: number },
	text: string
): void {
	const size = 9;
	const tick = 4;
	page.drawLine({ start: a, end: b, thickness: 0.7, color: KOTA });
	const vodorovna = a.y === b.y;
	for (const p of [a, b]) {
		page.drawLine({
			start: vodorovna ? { x: p.x, y: p.y - tick } : { x: p.x - tick, y: p.y },
			end: vodorovna ? { x: p.x, y: p.y + tick } : { x: p.x + tick, y: p.y },
			thickness: 0.7,
			color: KOTA
		});
	}
	const w = font.widthOfTextAtSize(text, size);
	if (vodorovna) {
		page.drawText(text, { x: (a.x + b.x) / 2 - w / 2, y: a.y + 3, size, font, color: KOTA });
	} else {
		// zvislá kóta — text otočený, vľavo od čiary
		page.drawText(text, {
			x: a.x - 3,
			y: (a.y + b.y) / 2 - w / 2,
			size,
			font,
			color: KOTA,
			rotate: degrees(90)
		});
	}
}

/** Pomocná (vynášacia) čiara kóty — tenká, prerušovaná. */
function vynasacia(page: PDFPage, a: { x: number; y: number }, b: { x: number; y: number }) {
	page.drawLine({ start: a, end: b, thickness: 0.4, color: MUTED, dashArray: [2, 2] });
}

/**
 * Vygeneruje 1-stranový A4 PDF výkres tabule: obdĺžnik šírka × výška skla s kótami, otvor s kótou
 * od zvislej hrany a od spodku, poznámka o zrkadlení pre pravé krídlo. Kreslené pre ĽAVÉ krídlo
 * (otvor pri ľavej hrane — tak ho kreslí aj náhľad nárezáku).
 */
export async function generateVykresOtvoruPdf(
	v: VykresOtvoruVstup,
	now: Date = new Date()
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const { reg, bold } = await embedDejavu(doc);
	const page = doc.addPage([A4_W, A4_H]);
	const { odHranyMm, odSpodkuMm, priemerMm } = v.otvor;
	const pozicia = pdfText(v.popis);

	// ---- hlavička ----
	let y = A4_H - MARGIN;
	page.drawText('Výkres skla s otvorom', {
		x: MARGIN,
		y: y - 16,
		size: 16,
		font: bold,
		color: INK
	});
	y -= 36;
	const hlavicka = [
		`Zákazka: ${v.zak}${v.op ? ` · OP: ${v.op}` : ''}`,
		`Pozícia: ${pozicia}`,
		`Sklo: ${v.typSkla || '—'}`,
		`Rozmer: ${fmtMm(v.sirkaMm)} × ${fmtMm(v.vyskaMm)} mm · ${v.pocet} ks`
	];
	for (const riadok of hlavicka) {
		page.drawText(ellipsize(reg, riadok, 11, CONTENT_W), {
			x: MARGIN,
			y,
			size: 11,
			font: reg,
			color: INK
		});
		y -= 16;
	}

	// ---- kresba (mierka tak, aby sa sklo aj s kótami zmestilo do vyhradenej plochy) ----
	const PRIESTOR_KOTY = 36; // pt pre kóty vpravo a pod sklom
	const spodokPlochy = MARGIN + 120; // pod kresbou poznámky
	const vrchPlochy = y - 24;
	const dostupnaW = CONTENT_W - 2 * PRIESTOR_KOTY;
	const dostupnaH = vrchPlochy - spodokPlochy - PRIESTOR_KOTY;
	const mierka = Math.min(dostupnaW / v.sirkaMm, dostupnaH / v.vyskaMm);
	const w = v.sirkaMm * mierka;
	const h = v.vyskaMm * mierka;
	const gx = MARGIN + PRIESTOR_KOTY + (dostupnaW - w) / 2;
	const gy = spodokPlochy + PRIESTOR_KOTY;

	page.drawRectangle({
		x: gx,
		y: gy,
		width: w,
		height: h,
		color: GLASS,
		borderColor: INK,
		borderWidth: 1.2
	});

	// otvor (stred od ĽAVEJ hrany a od SPODKU skla) — minimálny kreslený polomer kvôli čitateľnosti
	const cx = gx + odHranyMm * mierka;
	const cy = gy + odSpodkuMm * mierka;
	const r = Math.max((priemerMm / 2) * mierka, 3);
	page.drawCircle({ x: cx, y: cy, size: r, borderColor: INK, borderWidth: 1 });
	page.drawLine({ start: { x: cx - r - 3, y: cy }, end: { x: cx + r + 3, y: cy }, thickness: 0.4 });
	page.drawLine({ start: { x: cx, y: cy - r - 3 }, end: { x: cx, y: cy + r + 3 }, thickness: 0.4 });
	page.drawText(`Ø${fmtMm(priemerMm)}`, {
		x: cx + r + 4,
		y: cy + r + 2,
		size: 10,
		font: bold,
		color: INK
	});

	// kóta šírky (pod sklom) a výšky (vpravo)
	kota(page, reg, { x: gx, y: gy - 22 }, { x: gx + w, y: gy - 22 }, `${fmtMm(v.sirkaMm)}`);
	kota(page, reg, { x: gx + w + 26, y: gy }, { x: gx + w + 26, y: gy + h }, `${fmtMm(v.vyskaMm)}`);
	vynasacia(page, { x: gx, y: gy }, { x: gx, y: gy - 26 });
	vynasacia(page, { x: gx + w, y: gy }, { x: gx + w, y: gy - 26 });
	vynasacia(page, { x: gx + w, y: gy }, { x: gx + w + 30, y: gy });
	vynasacia(page, { x: gx + w, y: gy + h }, { x: gx + w + 30, y: gy + h });

	// kóta stredu otvoru od zvislej hrany (nad otvorom) a od spodku skla (vpravo od otvoru)
	const yHrana = cy + r + 18;
	vynasacia(page, { x: cx, y: cy }, { x: cx, y: yHrana + 4 });
	kota(page, reg, { x: gx, y: yHrana }, { x: cx, y: yHrana }, `${fmtMm(odHranyMm)}`);
	const xSpodok = cx + r + 22;
	vynasacia(page, { x: cx, y: cy }, { x: xSpodok + 4, y: cy });
	kota(page, reg, { x: xSpodok, y: gy }, { x: xSpodok, y: cy }, `${fmtMm(odSpodkuMm)}`);

	// ---- poznámky ----
	const poznamky = [
		`Otvor Ø${fmtMm(priemerMm)} mm: stred ${fmtMm(odHranyMm)} mm od zvislej hrany skla, ` +
			`${fmtMm(odSpodkuMm)} mm od spodnej hrany skla.`,
		'Kreslené pre ľavé krídlo (otvor pri ľavej hrane). Pravé krídlo = zrkadlovo: tá istá ' +
			'tabuľa sa pri montáži otočí, otvor je potom pri pravej hrane. Všetky tabule tohto riadku ' +
			'vŕtať rovnako.',
		'Rozmery v mm.'
	];
	let py = spodokPlochy - 8;
	for (const p of poznamky) {
		for (const l of wrapText(reg, p, 10, CONTENT_W)) {
			page.drawText(l, { x: MARGIN, y: py, size: 10, font: reg, color: INK });
			py -= 14;
		}
		py -= 4;
	}
	page.drawText(`Vygenerované appkou Montalu ${formatDatumCasSk(now.toISOString())}`, {
		x: MARGIN,
		y: MARGIN - 20,
		size: 8,
		font: reg,
		color: MUTED
	});

	// ---- metadáta = testovateľný kanál (BEZ cien) ----
	doc.setTitle(`Výkres skla s otvorom — ${v.popis} — zákazka ${v.zak}`);
	doc.setAuthor('Montalu');
	doc.setCreator('Montalu automatizácie');
	doc.setSubject(
		`Sklo ${fmtMm(v.sirkaMm)} × ${fmtMm(v.vyskaMm)} mm · ${v.pocet} ks · otvor ⌀${fmtMm(priemerMm)} · ` +
			`stred ${fmtMm(odHranyMm)} mm od zvislej hrany · ${fmtMm(odSpodkuMm)} mm od spodku skla`
	);
	doc.setKeywords([
		`zak=${v.zak}`,
		`op=${v.op}`,
		`sirka_mm=${fmtMm(v.sirkaMm)}`,
		`vyska_mm=${fmtMm(v.vyskaMm)}`,
		`ks=${v.pocet}`,
		`priemer_mm=${fmtMm(priemerMm)}`,
		`od_hrany_mm=${fmtMm(odHranyMm)}`,
		`od_spodku_mm=${fmtMm(odSpodkuMm)}`
	]);
	doc.setCreationDate(now);
	doc.setModificationDate(now);
	return doc.save();
}
