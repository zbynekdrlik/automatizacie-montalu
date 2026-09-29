// #587 (Odoo úloha 1185 — „Výkres alebo DXF k sklu pôjde s objednávkou z appky"): PDF výkres
// tabule s vŕtaným zámkovým otvorom pre dodávateľa skla (IZOS). Generuje sa z polohy uloženej
// k riadku objednávky skla „— s otvorom" (#578) a ide ako príloha riadku do Odoo `glass_order`
// (`odoo-glass-order-upload.ts`) + na stiahnutie z podkladu (`/objednavka-skla/vykres-otvoru/[id]`).
//
// JEDEN zdroj polohy: `sklo-otvory.ts` (odsadenie od hrany, výška vŕtania, priemer, krídla) — ten
// istý, z ktorého kreslí náhľad nárezáku `Nahlad2D`. Tento súbor NEMÁ vlastné číselné konštanty
// polohy (strážený testom `tests/sklo-otvor-poloha-587.test.ts`).
//
// Money-NEUTRÁLNE: žiadne ceny, žiadny Money kód — len geometria tabule. Hodnoty sú aj v metadátach
// (Title/Subject/Keywords) = testovateľný kanál (custom-font glyfy sa z PDF tela čítať nedajú).
// DejaVu subset NEMÁ glyf „⌀" (U+2300) → v PDF TELE sa kreslí „Ø" (U+00D8); metadáta nesú „⌀".
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { A4_W, A4_H, MARGIN, CONTENT_W, embedDejavu, ellipsize, wrapText } from './pdf-common';
import { formatDatumCasSk, sqliteUtcToIso } from '../datum';
import { popisPozicie } from '../objednavka-skla-pozicia';
import { fmtMmOtvoru as fmtMm, stranyOtvorov, type PolohaOtvoru } from '../sklo-otvory';
import type { SkloPolozka } from './objednavka-skla';

/** Vstup výkresu: jeden riadok objednávky skla (tabule s otvorom) s polohou otvoru. */
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
	/** `created_at` riadku (SQLite UTC) — JEDINÝ dátum výkresu (telo aj metadáta), nikdy „teraz". */
	vytvoreneAt: string;
}

/**
 * Dátum výkresu = vytvorenie riadku objednávky skla. Výkres MUSÍ byť pre ten istý riadok BAJTOVO
 * rovnaký: Odoo (2.370.0, odoo-erp 8536) pri re-odoslaní porovnáva prílohy riadku podľa názvu +
 * SHA-1 a pri zmene zmaže riadky a vráti objednávku do Konceptu — a objednávka sa znova posiela pri
 * každom uložení plánu rezov. Preto žiadny wall-clock. Nečitateľný `created_at` → pevný epoch
 * (radšej stabilný než „teraz"; pdf-lib RNG je seedovaný, iný zdroj náhody PDF nemá).
 */
export function datumVykresu(vytvoreneAt: string): Date {
	const d = new Date(sqliteUtcToIso(vytvoreneAt));
	return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.35, 0.39, 0.45);
const GLASS = rgb(0.9, 0.95, 0.98);
const KOTA = rgb(0.2, 0.25, 0.33);

type Bod = { x: number; y: number };

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

/** Názov PDF prílohy: `Vykres-otvoru-<zakazka>-<pozicia>.pdf` (deterministický z riadku). */
export function vykresOtvoruFilename(v: { zak: string; popis: string }): string {
	return `Vykres-otvoru-${slug(v.zak)}-${slug(v.popis)}.pdf`;
}

/**
 * Riadok podkladu → vstup výkresu, alebo `null` (honest-null — výkres sa NEgeneruje): riadok bez
 * otvoru / bez platnej polohy (spred #587, spec zmenená obsluhou), atyp (obsluha dodáva VLASTNÝ
 * výkres — dva výkresy by si mohli odporovať), šikmý, bez výšky alebo bez šírky.
 */
export function vykresOtvoruZPolozky(p: SkloPolozka): VykresOtvoruVstup | null {
	if (!p.otvor || !(p.spec.holesQty > 0) || p.rezim === 'atyp') return null;
	if (p.sikmy || p.vyskaMm == null || !(p.vyskaMm > 0) || !(p.sirkaMm > 0)) return null;
	return {
		zak: p.zak,
		op: p.op,
		popis: popisPozicie(p.popis, p.modul),
		typSkla: p.typSklaManual || p.typSkla,
		sirkaMm: p.sirkaMm,
		vyskaMm: p.vyskaMm,
		pocet: p.pocet,
		otvor: p.otvor,
		vytvoreneAt: p.createdAt
	};
}

/** Kótovacia čiara s koncovými značkami a textom v strede (vodorovná alebo zvislá). */
function kota(page: PDFPage, font: PDFFont, a: Bod, b: Bod, text: string): void {
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
function vynasacia(page: PDFPage, a: Bod, b: Bod) {
	page.drawLine({ start: a, end: b, thickness: 0.4, color: MUTED, dashArray: [2, 2] });
}

/** Jedna tabuľa (krídlo) v kresbe: obdĺžnik, otvor pri ĽAVEJ alebo PRAVEJ hrane, kóty, nadpis. */
function tabula(
	page: PDFPage,
	f: { reg: PDFFont; bold: PDFFont },
	v: VykresOtvoruVstup,
	g: { gx: number; gy: number; mierka: number },
	strana: { vpravo: boolean; nadpis: string }
): void {
	const { reg, bold } = f;
	const { gx, gy, mierka } = g;
	const { odHranyMm, odSpodkuMm, priemerMm } = v.otvor;
	const w = v.sirkaMm * mierka;
	const h = v.vyskaMm * mierka;
	page.drawText(ellipsize(bold, strana.nadpis, 11, Math.max(w, 120)), {
		x: gx,
		y: gy + h + 10,
		size: 11,
		font: bold,
		color: INK
	});
	page.drawRectangle({
		x: gx,
		y: gy,
		width: w,
		height: h,
		color: GLASS,
		borderColor: INK,
		borderWidth: 1.2
	});

	// otvor: stred od zvislej hrany (ľavej / pravej = zrkadlovo) a od spodku skla
	const hranaX = strana.vpravo ? gx + w : gx;
	const smer = strana.vpravo ? -1 : 1;
	const cx = hranaX + smer * odHranyMm * mierka;
	const cy = gy + odSpodkuMm * mierka;
	const r = Math.max((priemerMm / 2) * mierka, 3); // minimálny kreslený polomer kvôli čitateľnosti
	page.drawCircle({ x: cx, y: cy, size: r, borderColor: INK, borderWidth: 1 });
	page.drawLine({ start: { x: cx - r - 3, y: cy }, end: { x: cx + r + 3, y: cy }, thickness: 0.4 });
	page.drawLine({ start: { x: cx, y: cy - r - 3 }, end: { x: cx, y: cy + r + 3 }, thickness: 0.4 });
	const znacka = `Ø${fmtMm(priemerMm)}`;
	const znackaW = bold.widthOfTextAtSize(znacka, 10);
	page.drawText(znacka, {
		x: strana.vpravo ? cx - r - 4 - znackaW : cx + r + 4,
		y: cy + r + 2,
		size: 10,
		font: bold,
		color: INK
	});

	// kóta šírky (pod sklom) a výšky (vonkajšia strana od otvoru)
	kota(page, reg, { x: gx, y: gy - 22 }, { x: gx + w, y: gy - 22 }, fmtMm(v.sirkaMm));
	vynasacia(page, { x: gx, y: gy }, { x: gx, y: gy - 26 });
	vynasacia(page, { x: gx + w, y: gy }, { x: gx + w, y: gy - 26 });
	const vonku = strana.vpravo ? gx - 26 : gx + w + 26;
	const hranaVonku = strana.vpravo ? gx : gx + w;
	kota(page, reg, { x: vonku, y: gy }, { x: vonku, y: gy + h }, fmtMm(v.vyskaMm));
	vynasacia(page, { x: hranaVonku, y: gy }, { x: vonku + smer * 4, y: gy });
	vynasacia(page, { x: hranaVonku, y: gy + h }, { x: vonku + smer * 4, y: gy + h });

	// kóta stredu otvoru od zvislej hrany (nad otvorom) a od spodku skla (dovnútra od otvoru)
	const yHrana = cy + r + 18;
	vynasacia(page, { x: cx, y: cy }, { x: cx, y: yHrana + 4 });
	kota(
		page,
		reg,
		{ x: Math.min(hranaX, cx), y: yHrana },
		{ x: Math.max(hranaX, cx), y: yHrana },
		fmtMm(odHranyMm)
	);
	const xSpodok = cx + smer * (r + 22);
	vynasacia(page, { x: cx, y: cy }, { x: xSpodok + smer * 4, y: cy });
	kota(page, reg, { x: xSpodok, y: gy }, { x: xSpodok, y: cy }, fmtMm(odSpodkuMm));
}

/**
 * Vygeneruje 1-stranový A4 PDF výkres riadku: ľavé krídlo (otvor pri ľavej hrane) a — keď riadok
 * nesie aj pravé krídlo — pravé (otvor ZRKADLOVO pri pravej hrane), každé s kótami skla a otvoru.
 * Žiadne „otoč tabuľu" (vrstvené / pokovované / matné sklo má stranu). Čelný pohľad ako náhľad.
 */
export async function generateVykresOtvoruPdf(v: VykresOtvoruVstup): Promise<Uint8Array> {
	const datum = datumVykresu(v.vytvoreneAt);
	const doc = await PDFDocument.create();
	const fonty = await embedDejavu(doc);
	const { reg, bold } = fonty;
	const page = doc.addPage([A4_W, A4_H]);
	const { odHranyMm, odSpodkuMm, priemerMm } = v.otvor;
	const { vlavo, vpravo } = stranyOtvorov(v.pocet);

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
		`Pozícia: ${pdfText(v.popis)}`,
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

	// ---- kresba: 1 alebo 2 krídla vedľa seba, spoločná mierka (sklo aj s kótami sa zmestí) ----
	const kridla = [
		...(vlavo > 0 ? [{ vpravo: false, nadpis: `Ľavé krídlo — ${vlavo} ks` }] : []),
		...(vpravo > 0 ? [{ vpravo: true, nadpis: `Pravé krídlo — ${vpravo} ks (zrkadlovo)` }] : [])
	];
	const PRIESTOR_KOTY = 36; // pt pre kóty okolo skla
	const spodokPlochy = MARGIN + 120; // pod kresbou poznámky
	const vrchPlochy = y - 40; // nad sklom nadpis krídla
	const stlpec = CONTENT_W / kridla.length;
	const dostupnaW = stlpec - 2 * PRIESTOR_KOTY;
	const dostupnaH = vrchPlochy - spodokPlochy - PRIESTOR_KOTY;
	const mierka = Math.min(dostupnaW / v.sirkaMm, dostupnaH / v.vyskaMm);
	const w = v.sirkaMm * mierka;
	kridla.forEach((k, i) => {
		const gx = MARGIN + i * stlpec + PRIESTOR_KOTY + (dostupnaW - w) / 2;
		tabula(page, fonty, v, { gx, gy: spodokPlochy + PRIESTOR_KOTY, mierka }, k);
	});

	// ---- poznámky ----
	const poznamky = [
		`Otvor Ø${fmtMm(priemerMm)} mm: stred ${fmtMm(odHranyMm)} mm od zvislej hrany skla ` +
			`(ľavé krídlo od ľavej, pravé od pravej), ${fmtMm(odSpodkuMm)} mm od spodnej hrany skla.`,
		'Čelný pohľad ako v náhľade nárezáka. Pravé krídlo má otvor zrkadlovo — vŕtať podľa výkresu ' +
			'krídla, tabuľu neotáčať.',
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
	page.drawText(`Z appky Montalu · riadok zadaný ${formatDatumCasSk(datum.toISOString())}`, {
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
		`Sklo ${fmtMm(v.sirkaMm)} × ${fmtMm(v.vyskaMm)} mm · ${v.pocet} ks ` +
			`(ľavé ${vlavo}, pravé ${vpravo}) · otvor ⌀${fmtMm(priemerMm)} · ` +
			`stred ${fmtMm(odHranyMm)} mm od zvislej hrany · ${fmtMm(odSpodkuMm)} mm od spodku skla`
	);
	doc.setKeywords([
		`zak=${v.zak}`,
		`op=${v.op}`,
		`sirka_mm=${fmtMm(v.sirkaMm)}`,
		`vyska_mm=${fmtMm(v.vyskaMm)}`,
		`ks=${v.pocet}`,
		`ks_lave=${vlavo}`,
		`ks_prave=${vpravo}`,
		`priemer_mm=${fmtMm(priemerMm)}`,
		`od_hrany_mm=${fmtMm(odHranyMm)}`,
		`od_spodku_mm=${fmtMm(odSpodkuMm)}`
	]);
	doc.setProducer('Montalu automatizácie');
	doc.setCreationDate(datum);
	doc.setModificationDate(datum);
	return doc.save();
}
