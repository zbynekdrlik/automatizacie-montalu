// #522: appková polovica kontraktu `montalu_narezak_upload` → `lines` (odoo-erp #6517/#6949).
// Mapuje `PlanRezovVysledok` (TEN ISTÝ vysledok, z ktorého ide PDF aj detail plánu — jeden
// zdroj pravdy) na `montalu.rozpis.line[]` pre výrobný tablet „Čo rezať".
//
// Money-NEUTRÁLNE: žiadny import z money, žiadne článkové kódy, žiadny db zápis, žiadna cena —
// čisté mapovanie. `kod` ostáva prázdny (plán rezov nemá Money kódy; identitu profilu nesie
// `nazov`, často s interným číslom profilu, napr. „18013 …"). Samostatný modul zámerne — je to
// domov aj pre `buildGlassOrder` (#521 glass_order) — payload shaping na jednom mieste.
import type { PlanRezovVysledok } from './plan-rezov';

/** Minimálny tvar profilu, ktorý builder potrebuje: názov + agregované rezy (dĺžka → počet).
 *  `MaterialRow` (zasklenia/sietka compute), `PlanRezovProfil.material` (#522) aj ad-hoc adaptéry
 *  backfillu (CAD/clip → tento tvar) ho spĺňajú → JEDEN zdroj pravdy pre `lines`, žiadna duplicita. */
export interface RozpisMaterial {
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
}

/** Jeden riadok rozpisu rezov = jedna kombinácia (profil × dĺžka rezu) → počet kusov.
 *  Zodpovedá elementu `lines[]` v `montalu_narezak_upload` (model `montalu.rozpis.line`). */
export interface RozpisLine {
	/** Money článkový kód profilu/tyče — v pláne rezov prázdny (Money-neutrálny). */
	kod: string;
	/** názov profilu (presne z CAD tabuľky) */
	nazov: string;
	/** počet kusov danej dĺžky (celé číslo) */
	mnozstvo: number;
	/** merná jednotka — rezané kusy = „ks" */
	mj: string;
	/** dĺžka jedného rezu v METROCH (kontrakt: príklad 4.5 = 4500 mm) */
	dlzka: number;
	/** poznámka (posuv/sekcia) — plán rezov ju nedrží (plochá CAD tabuľka) → prázdna */
	poznamka: string;
}

/** mm → m so zachovaním 0.1 mm presnosti (bez FP šumu): 4500 → 4.5, 2834.5 → 2.8345. */
function mmNaMetre(mm: number): number {
	return Math.round(mm * 10) / 10_000;
}

/**
 * JADRO mapovania profilov (názov + agregované rezy) → `montalu.rozpis.line[]`. Pre každý profil
 * vezme jeho AGREGOVANÉ rezy (`rezy` = dĺžka → počet kusov, tie isté, ktoré renderuje `RozpisRezov`
 * na detaile a PDF) a spraví z každej dvojice jeden riadok. Rezy dlhšie ako tyč sa v agregovaných
 * rezoch nenachádzajú (compute ich nezaradil do kusov), takže sa do `lines` prirodzene nedostanú —
 * nemieša sa nerealizovateľný rez do „čo rezať".
 *
 * `poznamka` (default '') sa pripíše KAŽDÉMU riadku — plán rezov (#522) posiela '', backfill (#524)
 * posiela „spätne dopočítané <dátum>" keď sa modul nedá bit-identicky znovu spočítať. `kod` ostáva
 * prázdny (Money-neutrálne, identitu nesie `nazov`) — kiosk je pre rezača bez interných kódov/cien.
 */
export function rozpisLinesFromMaterial(material: RozpisMaterial[], poznamka = ''): RozpisLine[] {
	const lines: RozpisLine[] = [];
	for (const mat of material) {
		for (const rez of mat.rezy) {
			if (!(rez.ks > 0)) continue;
			lines.push({
				kod: '',
				nazov: mat.nazov,
				mnozstvo: rez.ks,
				mj: 'ks',
				dlzka: mmNaMetre(rez.rozmer),
				poznamka
			});
		}
	}
	return lines;
}

/**
 * Postaví `lines` pre `montalu_narezak_upload` z výsledku plánu rezov (#522). Deleguje na
 * `rozpisLinesFromMaterial` — `vysledok.material` je `vysledok.profily.map(p => p.material)`
 * (plan-rezov.ts), takže výstup je BIT-IDENTICKÝ s pôvodnou per-profil iteráciou (žiadna regresia).
 */
export function buildRozpisLines(vysledok: PlanRezovVysledok): RozpisLine[] {
	return rozpisLinesFromMaterial(vysledok.material);
}

// ---- #521: glass_order payload (objednávka skla → Odoo IZOS oceňovanie) --------------------
//
// Kontrakt: odoo-erp `.claude/rules/montalu-narezak-upload.md` — `glass_order.items[]` s PLOCHÝMI
// voliteľnými spec kľúčmi (nie vnorený `spec`). Neznáme kľúče Odoo ignoruje; chýbajúce = predvolené
// z katalógového typu. Money-NEUTRÁLNE (objednávka u dodávateľa skla, žiadny Money odpis/kód/cena).

/** Priemer vŕtaného otvoru: `d30` = 4–30 mm, `d50` = 31–50 mm (kontrakt). */
export type HoleSize = 'd30' | 'd50';
/** Opracovanie hrany tabule (kontrakt: 4 hodnoty). */
export type EdgeFinish = 'none' | 'ksr' | 'trapez_brusena' | 'trapez_lestena';

/** Povolené hodnoty spec vstupu — JEDINÝ zdroj (validácia v `objednavka-skla.ts` + parse v podklade). */
export const HOLE_SIZES: readonly (HoleSize | '')[] = ['', 'd30', 'd50'];
export const EDGE_FINISHES: readonly EdgeFinish[] = [
	'none',
	'ksr',
	'trapez_brusena',
	'trapez_lestena'
];

/**
 * Spec kľúče, ktoré appka NEVIE z katalógu — zadáva ich obsluha na podklade objednávky skla
 * (default všetko vypnuté, takže existujúce toky sú byte-identické). Persistované so sklovou
 * položkou (stĺpce `spec_*` v `objednavka_skla`, migrácia v48).
 */
export interface GlassSpec {
	warmEdge: boolean;
	coloredFrame: boolean;
	muntinCrossQty: number;
	holesQty: number;
	/** '' keď holesQty=0; inak `d30`/`d50` (posiela sa vždy pri holesQty>0). */
	holeSize: HoleSize | '';
	cutoutSmallQty: number;
	cutoutLargeQty: number;
	edgeFinish: EdgeFinish;
	hst: boolean;
	temperingOwnGlass: boolean;
}

/** Predvolený (vypnutý) spec — nový riadok, kým obsluha nezadá „Ďalšie možnosti (zriedkavé)". */
export const GLASS_SPEC_OFF: GlassSpec = {
	warmEdge: false,
	coloredFrame: false,
	muntinCrossQty: 0,
	holesQty: 0,
	holeSize: '',
	cutoutSmallQty: 0,
	cutoutLargeQty: 0,
	edgeFinish: 'none',
	hst: false,
	temperingOwnGlass: false
};

/** Vstup buildera — minimálny tvar sklovej položky (splní ho `SkloPolozka` z objednavka-skla.ts). */
export interface GlassOrderItemInput {
	sirkaMm: number;
	vyskaMm: number | null;
	vLavoMm: number | null;
	vPravoMm: number | null;
	sikmy: boolean;
	pocet: number;
	typSkla: string;
	popis: string;
	/** #548: režim riadka (v2 kontrakt) — 'rozmery' | 'atyp'. Keď chýba, berie sa 'rozmery'. */
	mode?: 'rozmery' | 'atyp';
	/** #548: „iné sklo" — vlastný typ. Keď je zadaný (+ `cenaM2Manual`>0), pošle sa `glass_type_manual`
	 *  a `glass_type` sa VYNECHÁ (Odoo nepáruje katalóg, použije manuálnu cenu). */
	typSklaManual?: string | null;
	/** #548: „iné sklo" — cena EUR za m2 bez DPH (> 0), posiela sa ako `price_m2_manual`. */
	cenaM2Manual?: number | null;
	/** #548: už NAČÍTANÉ prílohy riadka (base64) — builder aplikuje strop veľkosti. Prázdne/nezadané =
	 *  žiadne prílohy (Money-neutrálne, číta ich `buildGlassOrderForZak`, nie tento čistý builder). */
	attachments?: GlassAttachment[];
	/** voliteľný — keď chýba, berie sa `GLASS_SPEC_OFF`. */
	spec?: GlassSpec;
}

/** #548: príloha riadka objednávky skla (base64) — kontrakt v2 `items[].attachments[]`. */
export interface GlassAttachment {
	name: string;
	mimetype: string;
	data_base64: string;
}

/** Element `glass_order.items[]` per kontrakt v2 — základné + voliteľné v2/spec kľúče. */
export interface GlassOrderItem {
	width_mm: number;
	height_mm: number;
	/** katalógový typ (`cennik_code`/`name`); VYNECHANÝ pri manuálnom skle (#548). */
	glass_type?: string;
	/** #548: „iné sklo" — vlastný typ (namiesto `glass_type`). */
	glass_type_manual?: string;
	/** #548: „iné sklo" — cena EUR za m2 bez DPH. */
	price_m2_manual?: number;
	qty: number;
	/** #548: voľný popis riadka („ATYP podľa výkresu", „FIX", …). */
	description?: string;
	/** #548: režim riadka — 'rozmery' | 'atyp'. */
	mode?: 'rozmery' | 'atyp';
	note?: string;
	/** #548: prílohy per riadok (base64). */
	attachments?: GlassAttachment[];
	// ---- voliteľná špecifikácia (len keď set / derivované) ----
	composition?: string;
	spacer_mm?: number;
	warm_edge?: boolean;
	colored_frame?: boolean;
	muntin_cross_qty?: number;
	holes_qty?: number;
	hole_size?: HoleSize;
	cutout_small_qty?: number;
	cutout_large_qty?: number;
	edge_finish?: EdgeFinish;
	hst?: boolean;
	tempering_own_glass?: boolean;
}

export interface GlassOrder {
	/** #548: kontrakt verzia — v2. */
	version: number;
	items: GlassOrderItem[];
}

/** #548: jedna zahodená príloha (strop veľkosti prekročený) — surfacuje do outcome + poznámky riadka. */
export interface DroppedAttachment {
	itemIndex: number;
	name: string;
	bytes: number;
}

/** #548: výsledok builderu — payload + zoznam príloh zahodených stropom veľkosti. */
export interface GlassOrderBuildResult {
	order: GlassOrder;
	droppedAttachments: DroppedAttachment[];
}

/** #548: strop base64 príloh na CELÚ objednávku (25 MB). Nad limitom sa zahadzujú najväčšie prílohy. */
export const GLASS_ORDER_ATTACH_MAX_BYTES = 25 * 1024 * 1024;

/**
 * #548: mimetype prílohy podľa PRÍPONY názvu (čistý helper, jediný zdroj mapy). Neznáme →
 * `application/octet-stream`. Zhoda s kontraktom v2: pdf/dxf/dwg/step/stp/igs/iges/xlsx.
 */
export function mimetypeZNazvu(nazov: string): string {
	const ext = ((nazov ?? '').split('.').pop() ?? '').toLowerCase();
	switch (ext) {
		case 'pdf':
			return 'application/pdf';
		case 'dxf':
			return 'application/dxf';
		case 'dwg':
			return 'application/acad';
		case 'step':
		case 'stp':
			return 'model/step';
		case 'igs':
		case 'iges':
			return 'model/iges';
		case 'xlsx':
			return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		default:
			return 'application/octet-stream';
	}
}

/**
 * KONZERVATÍVNA derivácia `composition` (+ `spacer_mm`) z voľnotextového názvu skla (`typ_skla`).
 * Radšej `composition` VYNECHÁ (Odoo defaultne z `glass_type` cez svoju tolerantnú mapu), než by
 * poslala nesprávne zloženie a mis-pricol. Poradie: IZO dvojsklo → VSG kód → jednosklo.
 *
 * - IZO `A/B/C` alebo `A.B.C` (aj s „esg" príponou tabule, napr. „5esg/14/5esg") so STREDOM `B>=6`
 *   (reálna medzera rámika) → `A-B-C` (+ ` ESG` ak názov obsahuje „esg"/„kalen"), `spacer_mm=B`.
 *   Guard `B>=6` odlíši IZO od VSG kódu („3.3.1" → B=3 < 6 → NIE IZO).
 * - VSG kód `dd.d` (44.2) alebo `d.d.d` (3.3.1 / 4.4.2) → ten kód (VSG pozná Odoo katalóg), bez spacer.
 * - jednosklo `N mm`/`Nmm` → `N` (alebo `N ESG` keď kalené/esg), bez spacer.
 * - „polykarbonát…" alebo nerozpoznané → `{}` (nie sklo / nech Odoo defaultne z `glass_type`).
 */
export function derivGlassComposition(typSkla: string): {
	composition?: string;
	spacer_mm?: number;
} {
	const raw = (typSkla ?? '').trim();
	if (!raw) return {};
	const t = raw.toLowerCase();
	if (t.includes('polykarbon') || t.includes('polycarbon')) return {};
	const esg = /esg|kalen/.test(t);

	// IZO dvojsklo: tri číselné tokeny oddelené /.- (medzi číslom a oddeľovačom môžu byť písmená,
	// napr. „5esg/14/5esg"). Stred = medzera rámika.
	const izo = t.match(/(\d{1,2})[a-z]*[/.-](\d{1,2})[a-z]*[/.-](\d{1,2})/);
	if (izo) {
		const a = Number(izo[1]);
		const b = Number(izo[2]);
		const c = Number(izo[3]);
		if (b >= 6) {
			return { composition: esg ? `${a}-${b}-${c} ESG` : `${a}-${b}-${c}`, spacer_mm: b };
		}
		// b < 6 → nie IZO (napr. VSG „3.3.1") → spadne nižšie na VSG vetvu
	}

	// VSG kód: 44.2 alebo 3.3.1 / 4.4.2
	const vsg = t.match(/\b(\d{2}\.\d|\d\.\d\.\d)\b/);
	if (vsg) return { composition: vsg[1] };

	// jednosklo N mm / Nmm
	const single = t.match(/(\d{1,2})\s*mm/);
	if (single) {
		const n = Number(single[1]);
		return { composition: esg ? `${n} ESG` : `${n}` };
	}

	return {};
}

/** Poznámka k tabuli: popis + (pri šikmom FIXe) info o šikmine (výška vľavo/vpravo). */
function buildGlassNote(inp: GlassOrderItemInput): string {
	const popis = (inp.popis ?? '').trim();
	if (inp.sikmy) {
		const l = Math.round(inp.vLavoMm ?? 0);
		const p = Math.round(inp.vPravoMm ?? 0);
		const s = `šikmé Ľ${l}/P${p} mm`;
		return popis ? `${popis} — ${s}` : s;
	}
	return popis;
}

/**
 * Postaví JEDEN `glass_order.items[]` element z sklovej položky. 5 základných kľúčov
 * (`width_mm/height_mm/glass_type/qty/note`) je BIT-IDENTICKÝCH keď žiadny spec sa nenastavil ani
 * nič sa nederivovalo; deriváty (`composition`/`spacer_mm`) + persistované spec kľúče sa pridajú
 * LEN keď majú non-default hodnotu. `hole_size` sa posiela VŽDY keď `holes_qty>0` (default `d30`
 * = 4–30 mm, aby Odoo nedefaultlo na `d50`/vyššiu sadzbu — r1 korekcia kontraktu).
 */
export function buildGlassOrderItem(inp: GlassOrderItemInput): GlassOrderItem {
	const height = inp.sikmy
		? Math.round(Math.max(inp.vLavoMm ?? 0, inp.vPravoMm ?? 0))
		: Math.round(inp.vyskaMm ?? 0);
	// #548: „iné sklo" = vlastný typ + cena (> 0). Vtedy sa `glass_type` VYNECHÁ a katalóg sa nederivuje.
	const manualTyp = (inp.typSklaManual ?? '').trim();
	const jeManual = manualTyp.length > 0 && (inp.cenaM2Manual ?? 0) > 0;
	const item: GlassOrderItem = {
		width_mm: Math.round(inp.sirkaMm),
		height_mm: height,
		qty: inp.pocet
	};
	if (jeManual) {
		item.glass_type_manual = manualTyp;
		item.price_m2_manual = inp.cenaM2Manual!;
	} else {
		item.glass_type = inp.typSkla;
	}
	// #548: v2 kľúče — voľný popis (keď je) + režim (vždy).
	const description = (inp.popis ?? '').trim();
	if (description) item.description = description;
	item.mode = inp.mode === 'atyp' ? 'atyp' : 'rozmery';

	const note = buildGlassNote(inp);
	if (note) item.note = note;

	// #548: prílohy per riadok (už načítané base64) — strop veľkosti rieši `buildGlassOrder`.
	if (inp.attachments && inp.attachments.length > 0) {
		item.attachments = inp.attachments.map((a) => ({ ...a }));
	}

	// composition/spacer sa derivujú LEN pre katalógové sklo (manuál = cena dodávateľa, žiadny katalóg).
	if (!jeManual) {
		const { composition, spacer_mm } = derivGlassComposition(inp.typSkla);
		if (composition) item.composition = composition;
		if (spacer_mm != null) item.spacer_mm = spacer_mm;
	}

	const s = inp.spec;
	if (s) {
		if (s.warmEdge) item.warm_edge = true;
		if (s.coloredFrame) item.colored_frame = true;
		if (s.muntinCrossQty > 0) item.muntin_cross_qty = s.muntinCrossQty;
		if (s.holesQty > 0) {
			item.holes_qty = s.holesQty;
			// posielaj VŽDY explicitne — default d30 (4–30 mm), nikdy nenechaj Odoo defaultnúť na d50
			item.hole_size = s.holeSize === 'd50' ? 'd50' : 'd30';
		}
		if (s.cutoutSmallQty > 0) item.cutout_small_qty = s.cutoutSmallQty;
		if (s.cutoutLargeQty > 0) item.cutout_large_qty = s.cutoutLargeQty;
		if (s.edgeFinish && s.edgeFinish !== 'none') item.edge_finish = s.edgeFinish;
		if (s.hst) item.hst = true;
		if (s.temperingOwnGlass) item.tempering_own_glass = true;
	}
	return item;
}

/** Súčet base64 dĺžok príloh jedného itemu (proxy „veľkosti" — kontrakt strop je na base64). */
function attachBytes(item: GlassOrderItem): number {
	return (item.attachments ?? []).reduce((sum, a) => sum + a.data_base64.length, 0);
}

/**
 * #548: strážca stropu príloh na CELÚ objednávku. Kým súčet base64 > `maxBytes`, zahodí NAJVÄČŠIU
 * jednotlivú prílohu (naprieč riadkami), pripíše poznámku na dotknutý riadok a zaznamená ju do
 * `DroppedAttachment[]`. Deterministické (najväčšia najprv → najmenej zahodených). Mutuje `items`.
 */
function enforceAttachmentCap(items: GlassOrderItem[], maxBytes: number): DroppedAttachment[] {
	const dropped: DroppedAttachment[] = [];
	const total = () => items.reduce((sum, it) => sum + attachBytes(it), 0);
	while (total() > maxBytes) {
		let bestI = -1;
		let bestJ = -1;
		let bestLen = -1;
		for (let i = 0; i < items.length; i++) {
			const atts = items[i]!.attachments;
			if (!atts) continue;
			for (let j = 0; j < atts.length; j++) {
				if (atts[j]!.data_base64.length > bestLen) {
					bestLen = atts[j]!.data_base64.length;
					bestI = i;
					bestJ = j;
				}
			}
		}
		if (bestI < 0) break; // žiadne prílohy, ale stále nad limitom (nemalo by nastať)
		const it = items[bestI]!;
		const [removed] = it.attachments!.splice(bestJ, 1);
		if (it.attachments!.length === 0) delete it.attachments;
		dropped.push({ itemIndex: bestI, name: removed!.name, bytes: removed!.data_base64.length });
		const poznamka = `príloha ${removed!.name} vynechaná — limit`;
		it.note = it.note ? `${it.note} — ${poznamka}` : poznamka;
	}
	return dropped;
}

/**
 * Postaví celý `glass_order` payload (v2) zo zoznamu sklových položiek (čistý, žiadny IO). Aplikuje
 * strop veľkosti príloh na celú objednávku a vráti aj zoznam zahodených príloh (#548).
 */
export function buildGlassOrder(
	items: GlassOrderItemInput[],
	opts: { attachMaxBytes?: number } = {}
): GlassOrderBuildResult {
	const built = items.map(buildGlassOrderItem);
	const maxBytes = opts.attachMaxBytes ?? GLASS_ORDER_ATTACH_MAX_BYTES;
	const droppedAttachments = enforceAttachmentCap(built, maxBytes);
	return { order: { version: 2, items: built }, droppedAttachments };
}
