// #524: BACKFILL nárezákov (ostrých odpisov) za posledný mesiac → Odoo `lines` (rozpis rezov).
//
// Historické odpisy (`odpis_log`) nikdy nevyprodukovali `montalu.rozpis.line` — tie vznikajú len z
// uloženia plánu rezov (#522). Tento nástroj pre posledných ~N dní `odpis_log` (`live=1`) znovu
// dopočíta rozpis rezov TÝM ISTÝM enginom modulu z uloženého `detail`, namapuje na `lines` cez
// zdieľaný #522 builder (`rozpisLinesFromMaterial` — JEDEN zdroj pravdy) a pošle cez existujúcu
// `montalu_narezak_upload` cestu.
//
// KĽÚČOVÉ (Odoo kontrakt `montalu-narezak-upload.md`): `lines` upload NAHRADÍ VŠETKY
// `montalu.rozpis.line` na objednávke (doc_id verziuje len PDF). Preto sa grupuje PER OP a lines
// všetkých modulov OP sa skombinujú do JEDNÉHO uploadu (nie per-modul — to by sa moduly navzájom
// prepísali). Idempotencia = ADDITIVE: OP, ktorý už riadky má, sa preskočí (chráni živé #522 riadky,
// opätovný beh je no-op).
//
// Money-NEUTRÁLNE: žiadny zápis do Money ani `odpis_log`; iba READ (`detail`/`odpis_polozky`) a
// upload `lines` na Odoo. Rekomputa je čistá (pure engine z `detail.vstupRaw`/CAD). `content_hash`
// / uložené `odpis_polozky` slúžia len na detekciu driftu vzorcov („spätne dopočítané").
//
// DI (dependency injection): orchestrácia dostáva READ/UPLOAD funkcie zvonka (`BackfillDeps`), takže
// unit testy dodajú fake transport + fake rows bez native DB / bez PROD Odoo (vzor #522
// `setJson2Transport`). CLI (`src/scripts/backfill-narezaky.ts`) zapojí reálne `callJson2` + SELECT.
import { rozpisLinesFromMaterial, type RozpisLine, type RozpisMaterial } from './odoo-rozpis-lines';
import type { Cfg, Kus, MaterialRow } from './compute';
import {
	ffdPack,
	BAR,
	KOTUC,
	sietkaSamostatnaVypocet,
	sietkaSamostatnaMultiVypocet,
	type SietkaSamostatnaKus,
	type SietkaSamostatnaMaterialRow
} from './compute';
import { recomputeVstup, recomputeMultiVstup } from './zasklenia-sklo';
import { computeClip, computeClipMulti, type ClipVstup, type ClipRiadok } from '$lib/clip';
import { parseCad } from './pergola';
import { CAD_DETAIL_MAX } from './cad-odpis';
import { normOp, normZak, type Polozka } from './money';
import type { Vstup, MultiVstup } from './vstup';
import { generateNarezakPdfBase64, narezakPdfFilename, type NarezakPdfHeader } from './narezak-pdf';
import { buildCutPlan, pocetVynechanychBezKodu, type CutPlan } from './narezak-cut-plan';

/** Surový riadok `odpis_log` potrebný pre backfill (vlastný SELECT — `listOdpisy` nevracia
 *  `content_hash`; `detail` je surový JSON string, parsuje sa tu). */
export interface OdpisBackfillRow {
	id: number;
	modul: string;
	zak: string;
	op: string;
	zakaznik: string;
	live: number;
	content_hash: string;
	detail: string;
	created_at: string;
}

/** Výsledok namapovania JEDNÉHO odpisu na `lines` (+ `material` na GRAFICKÝ nárezák PDF, #529). */
export type OdpisMapResult =
	| { status: 'lines'; lines: RozpisLine[]; material: MaterialRow[]; drift: boolean }
	| { status: 'skip'; reason: BackfillSkipReason };

export type BackfillSkipReason =
	| 'pergola-rezervacia' // rezervačná cesta — `detail` je lossy, nedá sa znovu spočítať
	| 'unreconstructable' // neznámy tvar `detail` / chýbajúce vstupy
	| 'cad-truncated' // `detail.cad` dosiahol CAD_DETAIL_MAX → neúplný zdroj, neposielaj kusý rozpis
	| 'recompute-failed' // engine vrátil chybu/null
	| 'no-cut-list' // rekomputa prebehla, ale žiadne narezateľné rezy (napr. bazén)
	| 'out-of-scope'; // modul mimo záberu backfillu

/** Moduly so skutočným rozpisom rezov. `bazen` je mimo (Money počty, žiadne dĺžky rezov). */
export const BACKFILL_MODULY = new Set(['zasklenia', 'pergola', 'clip', 'fix']);

/** mm zaokrúhlenie na 3 des. miesta pre porovnanie metráže (rovnaká presnosť ako Money `R`). */
const q3 = (x: number): number => Math.round(x * 1000);

/**
 * Detekcia driftu vzorcov: znovu-dopočítaná Money metráž `{kod→qty}` vs uložená `odpis_polozky`.
 * Ak sa KTORÝKOĽVEK znovu-dopočítaný (profilový) kód nezhoduje s uloženým množstvom (alebo v
 * uloženom chýba) → vzorce/katalóg sa od odpisu zmenili (alebo bola ručná úprava). Kovanie a iné
 * uložené kódy, ktoré rekomputa neprodukuje, sa IGNORUJÚ (porovnávame len znovu-dopočítané kódy).
 */
export function driftVsStored(
	recomputed: { kod: string; qty: number }[],
	stored: Polozka[]
): boolean {
	const storedByKod = new Map<string, number>();
	for (const p of stored) storedByKod.set(p.kod, p.qty);
	for (const o of recomputed) {
		const s = storedByKod.get(o.kod);
		if (s === undefined || q3(s) !== q3(o.qty)) return true;
	}
	return false;
}

const spatneNote = (createdAt: string): string => `spätne dopočítané ${createdAt.slice(0, 10)}`;

/**
 * #529: RozpisMaterial (nazov + agregované rezy) → `MaterialRow[]` s tyčami (FFD `ffdPack`) pre
 * GRAFICKÝ nárezák PDF. Zrkadlí per-profil packing v `spocitajPlanRezov` (ffdPack + odpad +
 * agregované rezy). Použité pre moduly BEZ vlastného MaterialRow s tyčami (sietka/clip/CAD);
 * zasklenia posiela svoj plný `MaterialRow[]` priamo. `kod` sa zachová keď je (sietka), inak ''
 * (bez obrázka). `barLen = BAR` (7500) — CAD/clip/sietka nemajú per-profil dĺžku tyče; rezy sú
 * presné, dĺžka tyče orientačná. `sikmyRez=false` (uhly nesie len zasklenia MaterialRow).
 */
export function materialRowsFromRozpis(
	material: { nazov: string; kod?: string; rezy: { rozmer: number; ks: number }[] }[],
	barLen: number = BAR,
	kerf: number = KOTUC
): MaterialRow[] {
	return material.map((m) => {
		const kusy: Kus[] = [];
		for (const r of m.rezy) {
			if (!(r.ks > 0) || r.rozmer + kerf > barLen) continue;
			for (let i = 0; i < r.ks; i++) kusy.push({ rozmer: r.rozmer, dlzka: r.rozmer });
		}
		const bary = ffdPack(kusy, barLen, kerf);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * barLen)) * 1000) / 10 : 0;
		return {
			kod: m.kod ?? '',
			nazov: m.nazov,
			// rezy tabuľka konzistentná s nakreslenými tyčami — rez dlhší ako tyč (degenerát) sa
			// nezmestí do žiadnej tyče, takže ho ani do tabuľky neuvádzame (na reálnych dátach nikdy).
			rezy: m.rezy.filter((r) => r.ks > 0 && r.rozmer + kerf <= barLen),
			tyce,
			bary,
			odpadMm,
			odpadPct,
			barLen,
			sikmyRez: false
		};
	});
}

/**
 * Postaví `lines` z materiálu + (voliteľného) drift-tagu; prázdny materiál → skip 'no-cut-list'.
 * `barMaterial` = `MaterialRow[]` s tyčami pre grafický PDF (zasklenia posiela svoj plný, ostatné
 * synthesizované cez `materialRowsFromRozpis` volajúcim).
 */
function linesFrom(
	material: RozpisMaterial[],
	barMaterial: MaterialRow[],
	drift: boolean,
	createdAt: string
): OdpisMapResult {
	const lines = rozpisLinesFromMaterial(material, drift ? spatneNote(createdAt) : '');
	if (lines.length === 0) return { status: 'skip', reason: 'no-cut-list' };
	return { status: 'lines', lines, material: barMaterial, drift };
}

/** #555: jokle sieťky sú honest-null (`kod:null`) — do Odoo nárezák lines NEVSTUPUJÚ
 *  (nemajú Money kód; výroba ich reže z karty sieťky, rovnako ako sa CLIP drobné položky
 *  s `kod:null` do rozpisu nedostanú). Odfiltruj ich pred mapovaním, aby Odoo line-sync
 *  ostal byte-identický ako pred #555. Keď výroba založí Money kartu, odfilter odpadne
 *  automaticky (kod prestane byť null). */
function bezJoklov(
	material: SietkaSamostatnaMaterialRow[]
): { nazov: string; kod?: string; rezy: { rozmer: number; ks: number }[] }[] {
	return material
		.filter((m) => m.kod !== null)
		.map((m) => ({ nazov: m.nazov, kod: m.kod ?? undefined, rezy: m.rezy }));
}

/** clip `ClipRiadok[]` → materiál (len narezateľné riadky: rozmer + počet kusov). */
function clipRiadkyToMaterial(riadky: ClipRiadok[]): RozpisMaterial[] {
	const out: RozpisMaterial[] = [];
	for (const r of riadky) {
		if (r.rozmer == null || r.pocetKs == null || r.pocetKs <= 0) continue;
		out.push({ nazov: r.oznacenie, rezy: [{ rozmer: r.rozmer, ks: r.pocetKs }] });
	}
	return out;
}

/**
 * Namapuje JEDEN uložený odpis na `lines` (rozpis rezov). Dispatch per modul + marker v `detail`.
 * `cfg` je predané (raz načítané volajúcim). Čisté — žiadny DB/Money zápis.
 */
export function mapOdpisToLines(
	row: OdpisBackfillRow,
	polozky: Polozka[],
	cfg: Cfg
): OdpisMapResult {
	let detail: Record<string, unknown>;
	try {
		detail = JSON.parse(row.detail || '{}') as Record<string, unknown>;
	} catch {
		return { status: 'skip', reason: 'unreconstructable' };
	}
	const createdAt = row.created_at;

	try {
		switch (row.modul) {
			case 'zasklenia': {
				// samostatná sieťka (schová sa pod modul='zasklenia')
				if (detail.sietkaSamostatna === true) {
					const { r } = sietkaSamostatnaVypocet(
						cfg,
						String(detail.system ?? ''),
						String(detail.styl ?? ''),
						Number(detail.otvorS),
						Number(detail.otvorV)
					);
					if (!r) return { status: 'skip', reason: 'recompute-failed' };
					const drift = driftVsStored(
						r.odpis.map((o) => ({ kod: o.kod, qty: o.metre })),
						polozky
					);
					// sietka MaterialRow nemá tyče → synthesizuj (kod sa zachová pre obrázok);
					// jokle (kod:null) sa do Odoo lines nedostanú (#555, `bezJoklov`)
					const mat = bezJoklov(r.material);
					return linesFrom(mat, materialRowsFromRozpis(mat), drift, createdAt);
				}
				if (detail.sietkaSamostatnaMulti === true) {
					const kusy = (detail.kusy as SietkaSamostatnaKus[] | undefined) ?? [];
					const { r } = sietkaSamostatnaMultiVypocet(cfg, kusy);
					if (!r) return { status: 'skip', reason: 'recompute-failed' };
					const drift = driftVsStored(
						r.odpis.map((o) => ({ kod: o.kod, qty: o.metre })),
						polozky
					);
					const mat = bezJoklov(r.kusy.flatMap((k) => k.material));
					return linesFrom(mat, materialRowsFromRozpis(mat), drift, createdAt);
				}
				// zimná záhrada (viac posuvov) — plný MaterialRow[] s tyčami/uhlami/kódmi priamo
				if (detail.multiZasklenie === true || detail.zimnaZahrada === true) {
					const vstup = detail.vstupRaw as MultiVstup | undefined;
					if (!vstup) return { status: 'skip', reason: 'unreconstructable' };
					const { r } = recomputeMultiVstup(vstup, cfg);
					if (!r) return { status: 'skip', reason: 'recompute-failed' };
					const drift = driftVsStored(
						r.odpis.map((o) => ({ kod: o.kod, qty: o.metre })),
						polozky
					);
					return linesFrom(r.material, r.material, drift, createdAt);
				}
				// bežné jednoposuvové zasklenie — plný MaterialRow[] s tyčami/uhlami/kódmi priamo
				const vstup = detail.vstupRaw as Vstup | undefined;
				if (!vstup) return { status: 'skip', reason: 'unreconstructable' };
				const { r } = recomputeVstup(vstup, cfg);
				if (!r) return { status: 'skip', reason: 'recompute-failed' };
				const drift = driftVsStored(
					r.odpis.map((o) => ({ kod: o.kod, qty: o.metre })),
					polozky
				);
				return linesFrom(r.material, r.material, drift, createdAt);
			}

			case 'clip': {
				if (detail.multiClip === true) {
					const kusy = (detail.kusy as Partial<ClipVstup>[] | undefined) ?? [];
					const vstupy = kusy.map(clipVstupFrom);
					const v = computeClipMulti(vstupy);
					const drift = driftVsStored(
						v.polozky.map((p) => ({ kod: p.kod, qty: p.qty })),
						polozky
					);
					const mat = clipRiadkyToMaterial(v.kusy.flatMap((k) => k.riadky));
					return linesFrom(mat, materialRowsFromRozpis(mat), drift, createdAt);
				}
				const raw = detail.vstupRaw as Partial<ClipVstup> | undefined;
				if (!raw) return { status: 'skip', reason: 'unreconstructable' };
				const v = computeClip(clipVstupFrom(raw));
				const drift = driftVsStored(
					v.polozky.map((p) => ({ kod: p.kod, qty: p.qty })),
					polozky
				);
				const mat = clipRiadkyToMaterial(v.riadky);
				return linesFrom(mat, materialRowsFromRozpis(mat), drift, createdAt);
			}

			case 'pergola':
			case 'fix': {
				// pergola rezervačná cesta: `detail` je lossy (chýba plný PergolaNarezVstup) → nedá sa
				// znovu spočítať. FIX píše odpis len z CAD, pergola z CAD ALEBO z rezervácie.
				if (detail.rezervacia === true) return { status: 'skip', reason: 'pergola-rezervacia' };
				const cad = detail.cad;
				if (typeof cad !== 'string' || !cad.trim())
					return { status: 'skip', reason: 'unreconstructable' };
				// #524 review 🟡: `detail.cad` je uložený ORezaný na CAD_DETAIL_MAX (`cad-odpis.ts`),
				// zatiaľ čo pôvodný Money odpis vznikol z PLNÉHO `vstup.cad`. Pri (zriedkavom) dosiahnutí
				// stropu by rekomputa vrátila NEÚPLNÝ zoznam rezov bez varovania → radšej PRESKOČ, než
				// poslať kusý „čo rezať" na tablet. Reálne zoznamy sú ~1–2 KB, takže to takmer nenastane.
				if (cad.length >= CAD_DETAIL_MAX) return { status: 'skip', reason: 'cad-truncated' };
				// rozpis rezov = SUROVÝ CAD text (operátorom zadané dĺžky) → žiadny vzorec sa nemení,
				// takže žiadny drift-tag (poznamka ostáva prázdna). Rezné dĺžky sú z CAD priamo,
				// nezávisia od CODE_MAP (ten mapuje len Money kódy), takže parse-divergencia rez nemení.
				const material: RozpisMaterial[] = parseCad(cad).rows.map((r) => ({
					nazov: r.name,
					rezy: [{ rozmer: r.cut_mm, ks: r.qty }]
				}));
				return linesFrom(material, materialRowsFromRozpis(material), false, createdAt);
			}

			default:
				return { status: 'skip', reason: 'out-of-scope' };
		}
	} catch {
		return { status: 'skip', reason: 'recompute-failed' };
	}
}

/** Doplní `ClipVstup` povinné (ale pre engine irelevantné) hlavičkové polia — `computeClip` číta
 *  len typ/variant/sirka/vyska (ral je informačné). */
function clipVstupFrom(raw: Partial<ClipVstup>): ClipVstup {
	return {
		zak: '',
		op: '',
		zakaznik: '',
		caka: false,
		typ: (raw.typ as ClipVstup['typ']) ?? 'klasika',
		variant: Number(raw.variant ?? 1),
		sirka: Number(raw.sirka ?? 0),
		vyska: Number(raw.vyska ?? 0),
		ral: String(raw.ral ?? '')
	};
}

/** Stabilný per-OP doc_id `backfill-narezak-<opSlug≤12>` (≤40, charset [a-z0-9-] — Odoo regex). */
export function backfillDocId(op: string): string {
	const slug =
		normOp(op)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '')
			.slice(0, 12) || 'x';
	return `backfill-narezak-${slug}`.slice(0, 40);
}

export interface BackfillDeps {
	cfg: Cfg;
	loadPolozky: (odpisLogId: number) => Polozka[];
	orderExists: (orderNumber: string) => Promise<boolean>;
	orderHasLines: (orderNumber: string) => Promise<boolean>;
	/** #529: `pdfBase64`/`filename` = GRAFICKÝ nárezák PDF (voliteľné — keď generovanie zlyhalo,
	 *  pošlú sa len `lines`, upload endpoint PDF nevyžaduje). #532: `cutPlan` = `cut_plan` payload
	 *  (voliteľné — undefined keď žiadna tyč nemá Money kód; CAD moduly pergola/fix/clip). */
	uploadLines: (
		orderNumber: string,
		docId: string,
		lines: RozpisLine[],
		pdfBase64?: string,
		filename?: string,
		cutPlan?: CutPlan
	) => Promise<{ cutPlanRejected?: boolean } | void>;
	log?: (level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>) => void;
	sleep?: (ms: number) => Promise<void>;
}

export interface BackfillOptions {
	dryRun: boolean;
	/** rozostup medzi ostrými uploadmi (ms). Default 300. */
	delayMs?: number;
	/** obmedz na tieto zákazky (normZak); prázdne/undefined = všetky. */
	zakFilter?: string[];
}

export type OpAkcia =
	| 'uploaded'
	| 'dry-run'
	| 'dry-run-neoverena' // #524 R2: dry-run „poslal by", ale existenciu sa nepodarilo overiť (Odoo read 403)
	| 'skip-no-order'
	| 'skip-has-lines'
	| 'skip-no-lines'
	| 'error';

export interface BackfillOpSummary {
	op: string;
	zak: string;
	moduly: { modul: string; riadkov: number; drift: boolean }[];
	riadkovSpolu: number;
	akcia: OpAkcia;
	docId?: string;
	error?: string;
}

export interface BackfillSummary {
	odpisov: number;
	objednavok: number;
	nahranych: number;
	riadkovSpolu: number;
	skipNoOrder: number;
	skipHasLines: number;
	skipNoLines: number;
	skipPergolaRezervacia: number;
	skipUnreconstructable: number;
	/** #524 R2: OP, ktorých existenciu sa nepodarilo overiť (Odoo read 403/AccessError), a napriek
	 *  tomu boli spracované (dry-run: „poslal by"; live: upload/no-order podľa odpovede endpointu). */
	existenciaNeoverena: number;
	driftOp: number;
	chyb: number;
	/** #532 R2: OP, kde PROD Odoo odmietol `cut_plan` 422 „Neznámy parameter" a upload prebehol BEZ
	 *  neho (lines+PDF doručené). Nie chyba — kým odoo-erp#7431 nepristane na PROD. */
	cutPlanOdmietnutych: number;
	ops: BackfillOpSummary[];
}

/**
 * #532 R2: stabilný token skutočnej neexistencie objednávky z intake (odoo-erp
 * `sale_order_narezak.py`: `UserError("montalu_order_not_found: objednávka „%s" nie je v Odoo …")`).
 * LEN táto správa → `no-order`; každá iná upload chyba (4xx/5xx) → `error` (nikdy tichý no-order).
 */
const ORDER_NOT_FOUND_RE = /montalu_order_not_found/i;

/** najnovší odpis vyhráva: vyššie `created_at` (string YYYY-MM-DD HH:MM:SS je lexikograficky
 *  monotónny), tie-break vyššie `id`. */
function novsi(a: OdpisBackfillRow, b: OdpisBackfillRow): OdpisBackfillRow {
	if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
	return a.id > b.id ? a : b;
}

// ---------------------------------------------------------------------------------------------
// #570: ZDIEĽANÉ JADRO per OP — volá ho backfill (`runBackfill`) AJ živý upload pri ostrom odpise
// (`odoo-narezak-odpis.ts`, `setOdpisWrittenHook`). Jeden zdroj pravdy: grupovanie per OP (posledný
// odpis per modul) → rekomputa + kombinácia lines všetkých modulov OP → grafický PDF + `cut_plan` →
// `uploadLines` s klasifikáciou výsledku. `lines` upload NAHRÁDZA všetky riadky objednávky, preto sa
// VŽDY posiela kombinácia všetkých modulov OP (nikdy len modul práve zapísaného odpisu).
// ---------------------------------------------------------------------------------------------

/** Odpisy jednej OP: posledný odpis per modul (v zábere `BACKFILL_MODULY`). */
export interface OpOdpisy {
	zak: string;
	zakaznik: string;
	byModul: Map<string, OdpisBackfillRow>;
}

export type NarezakLog = NonNullable<BackfillDeps['log']>;

/**
 * Zgrupuje `odpis_log` riadky per `normOp(op)` — len moduly v zábere (`BACKFILL_MODULY`), v rámci OP
 * posledný odpis per `modul` (novší `created_at`, tie-break `id`). Riadky bez OP sa preskočia.
 */
export function groupOdpisyPerOp(rows: OdpisBackfillRow[]): Map<string, OpOdpisy> {
	const perOp = new Map<string, OpOdpisy>();
	for (const r of rows) {
		if (!BACKFILL_MODULY.has(r.modul)) continue;
		const op = normOp(r.op);
		if (!op) continue;
		let g = perOp.get(op);
		if (!g) {
			g = { zak: r.zak, zakaznik: r.zakaznik, byModul: new Map() };
			perOp.set(op, g);
		}
		const prev = g.byModul.get(r.modul);
		g.byModul.set(r.modul, prev ? novsi(prev, r) : r);
	}
	return perOp;
}

export interface OpLinesResult {
	/** skombinované `lines` všetkých modulov OP (prázdne = nič narezateľné). */
	lines: RozpisLine[];
	/** skombinovaný `MaterialRow[]` (tyče) pre grafický PDF + `cut_plan`. */
	material: MaterialRow[];
	moduly: { modul: string; riadkov: number; drift: boolean }[];
	drift: boolean;
	skipy: { modul: string; reason: BackfillSkipReason }[];
}

/**
 * Znovu-dopočíta rozpis rezov všetkých modulov JEDNEJ OP a skombinuje ich `lines` + materiál.
 * Preskočený modul (napr. pergola rezervačná cesta — lossy `detail`) sa zaloguje a vráti v `skipy`.
 * Čisté voči Money (len READ `odpis_polozky` cez `loadPolozky`).
 */
export function linesPreOp(
	op: string,
	g: OpOdpisy,
	cfg: Cfg,
	loadPolozky: (odpisLogId: number) => Polozka[],
	log: NarezakLog
): OpLinesResult {
	const out: OpLinesResult = { lines: [], material: [], moduly: [], drift: false, skipy: [] };
	for (const [modul, r] of g.byModul) {
		const res = mapOdpisToLines(r, loadPolozky(r.id), cfg);
		if (res.status === 'skip') {
			out.skipy.push({ modul, reason: res.reason });
			log('info', 'nárezák: modul preskočený', { op, modul, reason: res.reason });
			continue;
		}
		out.lines.push(...res.lines);
		out.material.push(...res.material);
		out.moduly.push({ modul, riadkov: res.lines.length, drift: res.drift });
		if (res.drift) out.drift = true;
	}
	return out;
}

export interface NarezakUploadOutcome {
	akcia: 'uploaded' | 'skip-no-order' | 'error';
	docId: string;
	pdf: boolean;
	cutPlanRejected: boolean;
	error?: string;
}

/**
 * Pošle skombinované `lines` OP na Odoo (`montalu_narezak_upload` cez `uploadLines`) spolu s GRAFICKÝM
 * nárezák PDF (#529, best-effort) a `cut_plan` (#532/#535/#542 — v1/v2/v3 vrátane `render_html`;
 * 422 fallback + kill switch rieši `uploadNarezak` v transporte). doc_id per OP (`backfillDocId`).
 * NIKDY nehádže — výsledok klasifikuje: `montalu_order_not_found` → `skip-no-order`, iná chyba → `error`.
 * `logCtx` sa pridá do log riadkov (napr. backfill `neoverena`).
 */
export async function odoslatNarezakPreOp(
	op: string,
	g: OpOdpisy,
	lines: RozpisLine[],
	material: MaterialRow[],
	uploadLines: BackfillDeps['uploadLines'],
	log: NarezakLog,
	logCtx: Record<string, unknown> = {},
	now: Date = new Date()
): Promise<NarezakUploadOutcome> {
	const docId = backfillDocId(op);

	// #529: GRAFICKÝ nárezák PDF z rekomputovaného materiálu (best-effort — keď zlyhá, pošlú sa
	// len `lines`, endpoint PDF nevyžaduje).
	let pdfBase64: string | undefined;
	let filename: string | undefined;
	try {
		const header: NarezakPdfHeader = { zak: g.zak || op, op, zakaznik: g.zakaznik };
		const viacPosuvov = material.some((m) =>
			m.bary.some((b) => b.kusy.some((k) => k.posuv != null))
		);
		pdfBase64 = await generateNarezakPdfBase64(header, material, { viacPosuvov });
		filename = narezakPdfFilename(g.zak || op, now);
	} catch (e) {
		log('warn', 'nárezák: generovanie PDF zlyhalo — pošlem len lines', {
			op,
			err: e instanceof Error ? e.message : String(e)
		});
	}

	// #532: `cut_plan` z toho istého skombinovaného materiálu (bez flagu — ide vždy keď má tyče
	// s Money kódom). CAD moduly (pergola/fix/clip) idú cez `materialRowsFromRozpis` s `kod:''`,
	// takže sa vynechajú — zasklenia (recompute) nesú Money kódy, tie plán naplnia.
	// #542: meta pre `cut_plan.render_html` — tá istá hlavička ako PDF (zak/op/zákazník),
	// aby tablet zobrazil nárezák 1:1 s papierom. Default kerf.
	const cutPlan = buildCutPlan(material, undefined, {
		zak: g.zak || op,
		op,
		zakaznik: g.zakaznik,
		now
	});
	const bezKodu = pocetVynechanychBezKodu(material);
	// zaloguj VŽDY keď sa nejaké tyče vynechali pre chýbajúci Money kód — aj v mixovanej OP
	// (zasklenia s kódmi + pergola/fix/clip bez kódov), kde `cutPlan` je pravdivý, ale bez-kódu
	// tyče sa tichým dropom nedostanú do plánu (kontrakt: „a zaloguj").
	if (bezKodu > 0) {
		log('info', 'nárezák: tyče bez Money kódu vynechané z cut_plan', {
			op,
			bezKodu,
			planSent: !!cutPlan
		});
	}

	try {
		const up = await uploadLines(op, docId, lines, pdfBase64, filename, cutPlan);
		const cutPlanRejected = !!(up && up.cutPlanRejected);
		log('info', 'nárezák: nahrané riadky', {
			op,
			docId,
			riadkov: lines.length,
			pdf: pdfBase64 != null,
			cutPlanRejected,
			...logCtx
		});
		return { akcia: 'uploaded', docId, pdf: pdfBase64 != null, cutPlanRejected };
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : String(e);
		// #532 R2 KLASIFIKÁCIA: LEN skutočný token neexistencie objednávky (`montalu_order_not_found`)
		// → no-order; každá iná 4xx/5xx → error (nikdy tichý no-order).
		if (ORDER_NOT_FOUND_RE.test(errMsg)) {
			log('warn', 'nárezák: upload → objednávka neexistuje (montalu_order_not_found)', {
				op,
				docId,
				err: errMsg
			});
			return {
				akcia: 'skip-no-order',
				docId,
				pdf: pdfBase64 != null,
				cutPlanRejected: false,
				error: errMsg
			};
		}
		log('error', 'nárezák: upload zlyhal', { op, docId, err: errMsg });
		return { akcia: 'error', docId, pdf: pdfBase64 != null, cutPlanRejected: false, error: errMsg };
	}
}

/**
 * Spustí backfill nad danými `odpis_log` riadkami (už filtrované na `live=1` + časové okno volajúcim).
 * Grupuje per `normOp(op)`, v rámci OP berie POSLEDNÝ odpis per `modul`, znovu dopočíta rozpis rezov,
 * skombinuje lines všetkých modulov OP a pošle JEDNÝM uploadom (additive: OP, ktorý už riadky má, sa
 * preskočí). `dryRun` NEODOSIELA nič (read-only existenčné kontroly bežia aj tak — dávajú presné počty).
 */
export async function runBackfill(
	rows: OdpisBackfillRow[],
	deps: BackfillDeps,
	opts: BackfillOptions
): Promise<BackfillSummary> {
	const log = deps.log ?? (() => {});
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const delayMs = opts.delayMs ?? 300;
	const zakFilter =
		opts.zakFilter && opts.zakFilter.length ? new Set(opts.zakFilter.map(normZak)) : null;

	// filtruj na moduly v zábere + (voliteľne) zákazky
	const scoped = rows.filter(
		(r) => BACKFILL_MODULY.has(r.modul) && (!zakFilter || zakFilter.has(normZak(r.zak)))
	);

	// grupuj per OP → per modul: posledný odpis vyhráva (#570: zdieľané jadro)
	const perOp = groupOdpisyPerOp(scoped);

	const summary: BackfillSummary = {
		odpisov: scoped.length,
		objednavok: perOp.size,
		nahranych: 0,
		riadkovSpolu: 0,
		skipNoOrder: 0,
		skipHasLines: 0,
		skipNoLines: 0,
		skipPergolaRezervacia: 0,
		skipUnreconstructable: 0,
		existenciaNeoverena: 0,
		driftOp: 0,
		chyb: 0,
		cutPlanOdmietnutych: 0,
		ops: []
	};

	// stabilné poradie (podľa OP) pre reprodukovateľný dry-run výpis
	const orderNumbers = [...perOp.keys()].sort();

	// #524 R2: Odoo READ (existencia/has-lines) môže byť zamietnutý 403/AccessError (uid 524 nemá
	// read na sale.order). DÔVOD zaloguj RAZ za beh (nie 48× rovnaký warn), potom pokračuj tolerantne
	// — read zlyhanie NIE je chyba, existencia sa berie ako NEZNÁMA a endpoint rozhodne pri uploade.
	let readBlockLogged = false;
	const noteReadBlocked = (phase: string, op: string, err: string): void => {
		if (readBlockLogged) return;
		readBlockLogged = true;
		log(
			'warn',
			'backfill: Odoo čítanie zamietnuté — existencia neoverená, pokračujem (endpoint rozhodne)',
			{ phase, op, reason: err }
		);
	};

	for (const op of orderNumbers) {
		const g = perOp.get(op)!;
		const opSum: BackfillOpSummary = {
			op,
			zak: g.zak,
			moduly: [],
			riadkovSpolu: 0,
			akcia: 'dry-run'
		};

		// read-only existenčné kontroly (bežia aj v dry-rune). #524 R2: keď READ zlyhá (403/
		// AccessError, alebo akékoľvek zlyhanie čítania) → existencia NEZNÁMA, NIE chyba —
		// pokračuj a nechaj rozhodnúť endpoint pri uploade (dry-run: „poslal by"; live: no-order).
		let precheckUnverified = false;

		let exists = true; // default keď neznáme: pokračuj (nedávaj skip-no-order)
		try {
			exists = await deps.orderExists(op);
		} catch (e) {
			precheckUnverified = true;
			noteReadBlocked('orderExists', op, e instanceof Error ? e.message : String(e));
		}
		if (!precheckUnverified && !exists) {
			opSum.akcia = 'skip-no-order';
			summary.skipNoOrder++;
			log('info', 'backfill skip: objednávka v Odoo neexistuje', { op });
			summary.ops.push(opSum);
			continue;
		}

		// has-lines číta LEN keď existencia bola overená — pri neznámej existencii by to isté
		// read-právo (order_id.name → sale.order) 403-lo znova; ber has-lines tiež ako neznáme.
		let hasLines = false;
		if (!precheckUnverified) {
			try {
				hasLines = await deps.orderHasLines(op);
			} catch (e) {
				precheckUnverified = true;
				noteReadBlocked('orderHasLines', op, e instanceof Error ? e.message : String(e));
			}
		}
		if (!precheckUnverified && hasLines) {
			opSum.akcia = 'skip-has-lines';
			summary.skipHasLines++;
			log('info', 'backfill skip: objednávka už má riadky (additive)', { op });
			summary.ops.push(opSum);
			continue;
		}

		// znovu-dopočítaj lines všetkých modulov OP a skombinuj (#570: zdieľané jadro)
		const res = linesPreOp(op, g, deps.cfg, deps.loadPolozky, log);
		for (const sk of res.skipy) {
			if (sk.reason === 'pergola-rezervacia') summary.skipPergolaRezervacia++;
			else if (
				sk.reason === 'unreconstructable' ||
				sk.reason === 'recompute-failed' ||
				sk.reason === 'cad-truncated'
			)
				summary.skipUnreconstructable++;
		}
		opSum.moduly = res.moduly;

		opSum.riadkovSpolu = res.lines.length;
		if (res.lines.length === 0) {
			opSum.akcia = 'skip-no-lines';
			summary.skipNoLines++;
			log('info', 'backfill skip: žiadne narezateľné riadky', { op });
			summary.ops.push(opSum);
			continue;
		}
		if (res.drift) summary.driftOp++;

		const docId = backfillDocId(op);
		opSum.docId = docId;

		if (opts.dryRun) {
			// #524 R2: keď existenciu nemožno overiť (read 403), OP je stále would-send, ale pod
			// vlastnou akciou/počítadlom „existencia neoverená". Dry-run NEGENERUJE PDF a nič neposiela.
			opSum.akcia = precheckUnverified ? 'dry-run-neoverena' : 'dry-run';
			if (precheckUnverified) summary.existenciaNeoverena++;
			summary.nahranych++;
			summary.riadkovSpolu += res.lines.length;
			log('info', 'backfill DRY-RUN: poslal by riadky', {
				op,
				docId,
				riadkov: res.lines.length,
				neoverena: precheckUnverified,
				moduly: opSum.moduly
			});
			summary.ops.push(opSum);
			continue;
		}

		// PDF + cut_plan + upload + klasifikácia výsledku (#570: zdieľané s živým uploadom pri odpise)
		const up = await odoslatNarezakPreOp(op, g, res.lines, res.material, deps.uploadLines, log, {
			neoverena: precheckUnverified
		});
		if (up.akcia === 'uploaded') {
			opSum.akcia = 'uploaded';
			summary.nahranych++;
			summary.riadkovSpolu += res.lines.length;
			if (precheckUnverified) summary.existenciaNeoverena++; // upload existenciu potvrdil
			// #532 R2: transport helper musel odstrániť cut_plan (PROD Odoo 422 „Neznámy parameter") —
			// upload prebehol bez neho (lines+PDF doručené). Počítaj oddelene, NIE ako chybu.
			if (up.cutPlanRejected) summary.cutPlanOdmietnutych++;
		} else if (up.akcia === 'skip-no-order') {
			opSum.akcia = 'skip-no-order';
			summary.skipNoOrder++;
			if (precheckUnverified) summary.existenciaNeoverena++;
		} else {
			opSum.akcia = 'error';
			opSum.error = up.error;
			summary.chyb++;
		}
		summary.ops.push(opSum);
		if (delayMs > 0) await sleep(delayMs);
	}

	log('info', 'backfill dokončený', {
		dryRun: opts.dryRun,
		objednavok: summary.objednavok,
		nahranych: summary.nahranych,
		riadkovSpolu: summary.riadkovSpolu,
		skipNoOrder: summary.skipNoOrder,
		skipHasLines: summary.skipHasLines,
		skipNoLines: summary.skipNoLines,
		skipPergolaRezervacia: summary.skipPergolaRezervacia,
		skipUnreconstructable: summary.skipUnreconstructable,
		existenciaNeoverena: summary.existenciaNeoverena,
		driftOp: summary.driftOp,
		chyb: summary.chyb,
		cutPlanOdmietnutych: summary.cutPlanOdmietnutych
	});
	return summary;
}
