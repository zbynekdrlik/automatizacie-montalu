// #532: `cut_plan` payload builder — kontrakt appka↔Odoo #7431 (tablet pri píle kreslí tyč
// rozdelenú na kusy s uhlami). Nahrádza #529 v2 groundwork (`narezak-lines-v2.ts`, `narezak_v2` za
// flagom) — `cut_plan` ide VŽDY (bez flagu), keď nárezák má tyče s Money kódom.
//
// JEDEN zdroj pravdy s grafickým PDF (`narezak-pdf.ts` bars): číta ten istý `MaterialRow[]` (FFD
// `ffdPack` výstup: per profil `bary: Tyc[]` s kusmi + zvyškom, `sikmyRez`, `barLen`, `kod`).
// Money-NEUTRÁLNE: žiadna cena, žiadny import z Money/price modulov (guard `tests/narezak-cut-plan`).
//
// Kontrakt (odoo-erp #7431): jeden `bars[]` = jedna fyzická tyč zo skladu. `profile_kod` = Money
// kód profilu a NIKDY nesmie byť prázdny — tyč BEZ kódu (CAD planner /plan-rezov, pergola/fix/clip
// cez `materialRowsFromRozpis`) sa VYNECHÁ (a zaloguje volajúci). Uhly nesie nárezák na úrovni
// PROFILU (`sikmyRez` → 45/45, inak 90/90); per-kus uhly (pergola krov #161) štruktúra `Kus`/
// `MaterialRow` nemá, takže sa nevymýšľajú. `render_svg` = base64 SVG per tyč, ROVNAKÁ geometria ako
// `narezak-pdf.ts drawBar` (proporčné segmenty, dĺžky, odpad; žiadne ceny).
import { KOTUC, type MaterialRow, type Tyc } from './compute';
import { profilPngB64 } from './profil-png';
import { narezakSummary, type NarezakSummary } from '$lib/odpad';

/** Jeden kus (rez) na tyči — v poradí rezu (`seq` 1-based). */
export interface CutPlanPiece {
	seq: number;
	/** finálna dĺžka rezu (mm, s prerezom) — presne ako popisok na kresbe (`Kus.rozmer`). */
	length_mm: number;
	/** uhol ľavého/pravého rezu (° — 90 = kolmý, 45 = šikmý). Per-profil, oba konce rovnaké. */
	angle_left_deg: number;
	angle_right_deg: number;
	/**
	 * typ rezu (#535, 1:1 s papierom „rez rovný/uhol"): `"uhol"` keď ktorýkoľvek koniec ≠ 90°,
	 * inak `"rovny"`. Odvodené z uhlov (kiosk si to vie dopočítať, papier to píše explicitne).
	 */
	cut_type: 'rovny' | 'uhol';
	/** posuv/sekcia + dĺžka (napr. „Z1 3810"); bez posuvu len dĺžka. */
	label: string;
	/** vždy 1 (jeden záznam = jeden fyzický rez, 1:1 s kresbou). */
	qty: number;
}

/** Jedna fyzická tyč zo skladu s jej kusmi v poradí rezu. */
export interface CutPlanBar {
	/** globálne 1-based „B1"/„B2"… naprieč vydanými tyčami (poradie profilov ako PDF). */
	bar_id: string;
	/** Money kód profilu — NIKDY prázdny (tyče bez kódu sa do plánu nedostanú). */
	profile_kod: string;
	profile_name: string;
	/** dĺžka tyče profilu (mm). */
	stock_length_mm: number;
	/** rezná medzera / kotúč (mm, #535) — engine `KOTUC`, rovnaká hodnota ako papier „kotúč N mm". */
	kerf_mm: number;
	pieces: CutPlanPiece[];
	/** koncový odpad tyče (mm). */
	waste_mm: number;
	/** poznámka — zatiaľ vždy prázdna. */
	note: string;
	/** base64 SVG per tyč (vizuálny fallback; Odoo kreslí primárne z dát). */
	render_svg: string;
	/**
	 * base64 PNG prierezu profilu (#535, `static/profil/<kod>.webp` → `profil-png.ts`). Meno kľúča
	 * je kontraktové (`profile_icon_svg`), obsah je PNG base64. Posiela sa RAZ per `profile_kod`
	 * (na PRVEJ tyči s tým kódom; Odoo cachuje podľa kódu). Keď obrázok pre kód nemáme, kľúč sa
	 * VYNECHÁ (nikdy prázdny reťazec) — preto voliteľný.
	 */
	profile_icon_svg?: string;
}

export interface CutPlan {
	version: 1;
	bars: CutPlanBar[];
	/** sumár nárezáku (#535) — tie isté čísla ako PDF hlavička (papier = dáta). */
	summary: NarezakSummary;
}

/** číslo na 1 desatinné miesto so slovenskou čiarkou (rovnako ako `narezak-pdf.ts` / RozpisRezov). */
const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

/** popisok kusu: posuv/sekcia + dĺžka. „Z1 3810" pri posuve, inak len dĺžka. */
function pieceLabel(k: { rozmer: number; posuv?: number }): string {
	return (k.posuv != null ? `Z${k.posuv} ` : '') + fmt(k.rozmer);
}

/**
 * Typ rezu z uhlov konieckov (#535): `"uhol"` keď ktorýkoľvek koniec ≠ 90°, inak `"rovny"`.
 * 1:1 s papierovým nárezákom („rez rovný"); pure, testovateľné aj pre zmiešané uhly.
 */
export function cutTypeFor(angleLeftDeg: number, angleRightDeg: number): 'rovny' | 'uhol' {
	return angleLeftDeg !== 90 || angleRightDeg !== 90 ? 'uhol' : 'rovny';
}

// --- SVG geometria (zrkadlí `narezak-pdf.ts drawBar`; SVG y ide DOLE, PDF y HORE) --------------- //
const SVG_W = 600; // šírka kresby (jednotky) — proporčné segmenty vnútri
const BAR_H = 28; // výška tyče
const TOP = 1;
const BOT = TOP + BAR_H;
const SKEW_MM = 250; // 45° zošikmenie hornej hrany (mm), ako v PDF

/** zaokrúhli na 2 des. miesta (kompaktné SVG súradnice). */
const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * Nakreslí jednu tyč do samostatného SVG: podklad + segmenty rezov (lichobežník pri 45°, obdĺžnik
 * pri rovnom) + koncový odpad + mm popisky. Vracia SVG reťazec (začína `<svg`, každý rez
 * `class="rez"`, odpad `class="odpad"`). Money-neutrálne (žiadne ceny).
 */
export function renderBarSvg(tyc: Tyc, barLen: number, sikmy: boolean): string {
	const scale = SVG_W / Math.max(1, barLen); // jednotka na mm
	const sBase = sikmy ? SKEW_MM * scale : 0;
	const parts: string[] = [
		`<rect x="0" y="${TOP}" width="${SVG_W}" height="${BAR_H}" fill="#f8fafc" stroke="#475569" stroke-width="0.7"/>`
	];

	let xMm = 0;
	for (const k of tyc.kusy) {
		const x0 = xMm * scale;
		const x1 = (xMm + k.dlzka) * scale;
		const segW = x1 - x0;
		const s = Math.min(sBase, Math.max(0, segW / 2 - 0.5));
		parts.push(
			`<polygon class="rez" points="${n2(x0 + s)},${TOP} ${n2(x1 - s)},${TOP} ${n2(x1)},${BOT} ${n2(x0)},${BOT}" fill="#f5ede2" stroke="#475569" stroke-width="0.7"/>`
		);
		// mm popisok — skry pri úzkom segmente (<5 % tyče), zrkadlí PDF skryLabel
		if ((k.dlzka / barLen) * 100 >= 5) {
			parts.push(
				`<text x="${n2((x0 + x1) / 2)}" y="18" text-anchor="middle" font-size="8" font-family="'DejaVu Sans',sans-serif" fill="#0f172a">${pieceLabel(k)}</text>`
			);
		}
		xMm += k.dlzka;
	}

	// koncový odpad
	if (tyc.zvysok > 1) {
		const x0 = xMm * scale;
		const s = Math.min(sBase, Math.max(0, (SVG_W - x0) / 2 - 0.5));
		parts.push(
			`<polygon class="odpad" points="${n2(x0 - s)},${TOP} ${SVG_W},${TOP} ${SVG_W},${BOT} ${n2(x0)},${BOT}" fill="#f1f5f9" stroke="#475569" stroke-width="0.7"/>`
		);
		if ((tyc.zvysok / barLen) * 100 >= 12) {
			parts.push(
				`<text x="${n2((x0 + SVG_W) / 2)}" y="18" text-anchor="middle" font-size="8" font-family="'DejaVu Sans',sans-serif" fill="#64748b">odpad ${fmt(tyc.zvysok)}</text>`
			);
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${BOT + TOP}" width="${SVG_W}" height="${BOT + TOP}">` +
		parts.join('') +
		`</svg>`
	);
}

/** base64 SVG per tyč (`ir.attachment`/`montalu.rozpis.bar.render_svg` je Binary = base64). */
function renderBarSvgBase64(tyc: Tyc, barLen: number, sikmy: boolean): string {
	return Buffer.from(renderBarSvg(tyc, barLen, sikmy), 'utf8').toString('base64');
}

/**
 * Postaví `cut_plan` z `MaterialRow[]` (FFD výstup s tyčami). Jeden `bars[]` per FYZICKÁ tyč, v
 * poradí profilov ako grafický PDF. VYNECHÁVA profily bez Money kódu (`profile_kod` nesmie byť
 * prázdny — kontrakt #7431) aj profily bez tyčí; volajúci zaloguje, koľko sa vynechalo. Vracia
 * `undefined` keď žiadna tyč nemá kód → kľúč `cut_plan` sa vynechá úplne (žiadne prázdne objekty).
 */
export function buildCutPlan(material: MaterialRow[]): CutPlan | undefined {
	const bars: CutPlanBar[] = [];
	// ikonu profilu posielame RAZ per Money kód (na prvej tyči s tým kódom) — Odoo cachuje podľa kódu
	const seenKody = new Set<string>();
	for (const m of material) {
		if (!(m.tyce > 0)) continue; // len profily s aspoň jednou tyčou
		if (!m.kod) continue; // Money kód povinný — tyče bez kódu vynechaj
		const sikmy = m.sikmyRez ?? true; // obranný default 45° (ako RozpisRezov `?? true`)
		const angle = sikmy ? 45 : 90;
		const stockLen = Math.round(m.barLen);
		for (const tyc of m.bary) {
			const bar: CutPlanBar = {
				bar_id: `B${bars.length + 1}`,
				profile_kod: m.kod,
				profile_name: m.nazov,
				stock_length_mm: stockLen,
				kerf_mm: KOTUC, // engine kotúč — ten istý zdroj ako PDF „kotúč N mm"
				pieces: tyc.kusy.map((k, i) => ({
					seq: i + 1,
					length_mm: k.rozmer,
					angle_left_deg: angle,
					angle_right_deg: angle,
					cut_type: cutTypeFor(angle, angle),
					label: pieceLabel(k),
					qty: 1
				})),
				waste_mm: Math.round(tyc.zvysok),
				note: '',
				render_svg: renderBarSvgBase64(tyc, m.barLen, sikmy)
			};
			// ikona LEN na prvej tyči kódu; keď obrázok nemáme, kľúč vynecháme (nikdy prázdny reťazec)
			if (!seenKody.has(m.kod)) {
				seenKody.add(m.kod);
				const icon = profilPngB64(m.kod);
				if (icon) bar.profile_icon_svg = icon;
			}
			bars.push(bar);
		}
	}
	if (bars.length === 0) return undefined;
	// sumár = tie isté čísla ako PDF hlavička (papier = dáta); nad CELÝM nárezákom (aj profily bez
	// kódu), preto summary.bars_total môže byť > bars.length v OP s nekódovanými profilmi (#535).
	return { version: 1, bars, summary: narezakSummary(material) };
}

/** Počet profilov s tyčami, ktoré sa VYNECHAJÚ z cut_plan pre chýbajúci Money kód (na log). */
export function pocetVynechanychBezKodu(material: MaterialRow[]): number {
	return material.filter((m) => m.tyce > 0 && !m.kod).length;
}
