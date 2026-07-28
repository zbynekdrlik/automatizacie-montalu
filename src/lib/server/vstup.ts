// Parsovanie a serverová validácia vstupu zasklenia formulára — jediný
// serverový strážca rozsahov (HTML5 min/max vie skriptovaný POST obísť).
import { KLIN_MAX_KS, KLIN_MAX_ROZMER, type Klin } from '$lib/klin';
import { STANDARD, zakladnyStyl } from '$lib/styl';
import { KOLAJNICA_MAX, KOLAJNICA_MIN, type KolajnicaRucne } from '$lib/kolajnica';

export const OTVARANIA = ['P - L', 'L - P', 'Opona'];

/** Štandard +: štýl je LEN počet krídel; „ IZO" (starý formulár / bookmark) sa
 *  zahodí — basic/IZO nárezák vyberá zvolené sklo (`sysStylPre`). */
function normalizujStyl(system: string, styl: string): string {
	return system === STANDARD ? zakladnyStyl(styl) : styl;
}

/** Kovanie krídla (kľučka) — LEN Robust (Patrik 2026-07-27). Display-only:
 *  vypíše sa do náhľadu posuvu a do detailu v histórii, do Money odpisu NEJDE.
 *  Prázdna hodnota = nezadané (v selecte „—"), vtedy sa nič nekreslí. */
export const KOVANIA = [
	'Jednostranná kľučka z vnútra bez FAB',
	'Obojstranná kľučka bez FAB',
	'Jednostranná kľučka z vnútra s FAB',
	'Obojstranná kľučka s FAB'
];

/** Kovanie je zatiaľ len robustové — pri inom systéme (a pri neznámej hodnote
 *  zo skriptovaného POST-u) ho zahoď, nech sa na plán nedostane nezmysel. */
export function sanitizeKovanie(system: string, raw: unknown): string {
	const v = String(raw ?? '').trim();
	return system === 'Robust' && KOVANIA.includes(v) ? v : '';
}

/** Surové polia klina — z plochého formulára aj z JSON riadku posuvu (multi).
 *  `on` je zapínač: '1' / true = klín je zapnutý. */
export interface KlinRaw {
	on: unknown;
	dlzka: unknown;
	sirka: unknown;
	v1: unknown;
	v2: unknown;
	ks: unknown;
}

/**
 * Klín (display-only prvok nad posuvom). Vypnutý zapínač → `null` a žiadna chyba
 * (klín je nepovinný). Zapnutý → rozmery MUSIA byť v rozsahu; strážime to tu,
 * pretože skriptovaný POST obíde HTML5 min/max. Aspoň jedna výška musí byť
 * kladná (0 → 0 nie je klín); druhá smie byť 0 = klín dobehnutý do ostra.
 */
export function parseKlin(raw: KlinRaw): { klin: Klin | null; error: string | null } {
	const on = raw.on === '1' || raw.on === true || raw.on === 'true';
	if (!on) return { klin: null, error: null };
	const n = (x: unknown) => {
		const f = parseFloat(String(x ?? '').replace(',', '.'));
		return Number.isFinite(f) ? f : 0;
	};
	const klin: Klin = {
		dlzka: n(raw.dlzka),
		sirka: n(raw.sirka),
		v1: n(raw.v1),
		v2: n(raw.v2),
		// nevyplnený počet = 1 kus (dielňa zadáva ks len keď ich je viac);
		// nezmyselná hodnota (0 po zaokrúhlení, záporná, > max) padne do validácie
		ks: Math.round(n(raw.ks)) || 1
	};
	const rozmerOk = (x: number) => x > 0 && x <= KLIN_MAX_ROZMER;
	const vyskaOk = (x: number) => x >= 0 && x <= KLIN_MAX_ROZMER;
	let error: string | null = null;
	if (!rozmerOk(klin.dlzka)) error = `Klín: dĺžka musí byť 1–${KLIN_MAX_ROZMER} mm.`;
	else if (!rozmerOk(klin.sirka)) error = `Klín: šírka musí byť 1–${KLIN_MAX_ROZMER} mm.`;
	else if (!vyskaOk(klin.v1) || !vyskaOk(klin.v2))
		error = `Klín: výšky musia byť 0–${KLIN_MAX_ROZMER} mm.`;
	else if (!(klin.v1 > 0 || klin.v2 > 0)) error = 'Klín: zadaj aspoň jednu výšku.';
	else if (!(klin.ks >= 1 && klin.ks <= KLIN_MAX_KS))
		error = `Klín: počet kusov musí byť 1–${KLIN_MAX_KS}.`;
	return { klin, error };
}

/**
 * Ručne zadaná dĺžka koľajníc (Patrik 2026-07-28). Prázdne pole = počítaj zo šírky
 * (pôvodné chovanie). MONEY-KRITICKÉ: zadaná dĺžka mení balenie na tyče → mení metre
 * v odpise, preto preklep musí padnúť tu (skriptovaný POST obíde HTML5 min/max).
 * Nulu / prázdno berieme ako „nezadané", nie ako chybu.
 */
export function parseKolajnica(
	horna: unknown,
	spodna: unknown
): { kolajnica: KolajnicaRucne | null; error: string | null } {
	const n = (x: unknown) => {
		const s = String(x ?? '').trim();
		if (!s) return 0;
		const f = parseFloat(s.replace(',', '.'));
		return Number.isFinite(f) ? f : NaN;
	};
	const h = n(horna),
		sp = n(spodna);
	const rozsah = (x: number, kto: string) =>
		Number.isNaN(x) || (x !== 0 && !(x >= KOLAJNICA_MIN && x <= KOLAJNICA_MAX))
			? `Koľajnica ${kto}: dĺžka musí byť ${KOLAJNICA_MIN}–${KOLAJNICA_MAX} mm (alebo prázdne = podľa šírky).`
			: null;
	const error = rozsah(h, 'horná') ?? rozsah(sp, 'spodná');
	if (error) return { kolajnica: null, error };
	if (!h && !sp) return { kolajnica: null, error: null };
	const kolajnica: KolajnicaRucne = {};
	if (h) kolajnica.horna = Math.round(h);
	if (sp) kolajnica.spodna = Math.round(sp);
	return { kolajnica, error: null };
}

export interface Vstup {
	zak: string;
	op: string;
	zakaznik: string;
	system: string;
	styl: string;
	s: number;
	v: number;
	sklo: string;
	/** voľné upresnenie zloženia skla (Stopsol, grey, dubová kôra…) — ide len
	 *  na plán, vzorec ostáva podľa základného skla `sklo` */
	skloPresne: string;
	otvaranie: string;
	/** kovanie ĽAVEJ strany posuvu (kľučka) — len Robust, len na plán/náhľad */
	kovanieL: string;
	/** kovanie PRAVEJ strany posuvu (kľučka) — len Robust, len na plán/náhľad */
	kovanieP: string;
	/** výška vŕtania zámku [mm od spodku skla] — len Deluxe (otvory D46 v náhľade),
	 *  default 1050; do budúcna aj do objednávky skla */
	vrtanieZamku: number;
	/** voľná VIACRIADKOVÁ poznámka — zobrazí sa vľavo v rámčeku na nárezovom pláne
	 *  (aj v tlači), riadky pod sebou (pre-wrap) */
	poznamka: string;
	/** RAL farba — samostatné pole, zobrazí sa VEĽKÝM písmom vpravo na pláne (aj
	 *  v tlači). Len na plán/tlač — do Money odpisu NEJDE. */
	ral: string;
	caka: boolean;
	/** prídavná koľajnica — spodná koľajnica o 1 väčšia (len Štandard +) */
	pridavnaKolajnica: boolean;
	/** klín nad posuvom (Patrik) — display-only, do Money odpisu NEJDE; null = žiadny */
	klin: Klin | null;
	/** ručne zadané dĺžky koľajníc — MENÍ Money odpis; null = počítaj zo šírky */
	kolajnica: KolajnicaRucne | null;
}

export function parseVstup(form: FormData): { vstup: Vstup; error: string | null } {
	const num = (k: string) => {
		const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
		return Number.isFinite(x) ? x : 0;
	};
	const vstup: Vstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		system: String(form.get('system') ?? '').trim(),
		// Štandard +: štýl nesie LEN počet krídel — prípona „ IZO" zo starého
		// formulára/bookmarku sa zahodí, basic/IZO nárezák vyberá SKLO ($lib/styl)
		styl: normalizujStyl(
			String(form.get('system') ?? '').trim(),
			String(form.get('styl') ?? '').trim()
		),
		s: num('s'),
		v: num('v'),
		sklo: String(form.get('sklo') ?? '').trim(),
		skloPresne: String(form.get('skloPresne') ?? '').trim().slice(0, 120),
		otvaranie: String(form.get('otvaranie') ?? '').trim(),
		kovanieL: sanitizeKovanie(String(form.get('system') ?? '').trim(), form.get('kovanieL')),
		kovanieP: sanitizeKovanie(String(form.get('system') ?? '').trim(), form.get('kovanieP')),
		// Deluxe zámok: kladná výška vŕtania, inak default 1050 (len na náhľad/tlač)
		vrtanieZamku: (() => {
			const x = num('vrtanieZamku');
			return x > 0 && x <= 20000 ? x : 1050;
		})(),
		poznamka: String(form.get('poznamka') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 300),
		ral: String(form.get('ral') ?? '').trim().slice(0, 40),
		caka: form.get('caka') === '1',
		pridavnaKolajnica: form.get('pridavnaKolajnica') === '1',
		klin: null,
		kolajnica: null
	};
	const kol = parseKolajnica(form.get('kolajnicaHorna'), form.get('kolajnicaSpodna'));
	vstup.kolajnica = kol.kolajnica;
	const k = parseKlin({
		on: form.get('klin'),
		dlzka: form.get('klinDlzka'),
		sirka: form.get('klinSirka'),
		v1: form.get('klinV1'),
		v2: form.get('klinV2'),
		ks: form.get('klinKs')
	});
	vstup.klin = k.klin;
	// 2x štýly sú vždy opona (otváranie od stredu) — vynúť aj serverovo, nech to
	// skriptovaný POST neobíde (otváranie je len na plán/náhľad, nemení výpočet)
	if (vstup.styl.startsWith('2x')) vstup.otvaranie = 'Opona';
	let error: string | null = null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else if (!(vstup.s >= 300 && vstup.s <= 20000)) error = 'Šírka musí byť 300–20000 mm.';
	else if (!(vstup.v >= 300 && vstup.v <= 20000)) error = 'Výška musí byť 300–20000 mm.';
	else if (!OTVARANIA.includes(vstup.otvaranie)) error = 'Vyber otváranie.';
	else if (kol.error) error = kol.error;
	else if (k.error) error = k.error;
	return { vstup, error };
}

// ---- Viac posuvov (zimná záhrada) ----

export interface PosuvVstup {
	system: string;
	styl: string;
	s: number;
	v: number;
	sklo: string;
	otvaranie: string;
	/** kovanie ľavej/pravej strany TOHOTO posuvu (Patrik: „pri každom posuve sólo") */
	kovanieL: string;
	kovanieP: string;
	/** klín nad TÝMTO posuvom — display-only, do Money odpisu NEJDE; null = žiadny */
	klin: Klin | null;
	/** ručné dĺžky koľajníc TOHOTO posuvu — MENÍ Money odpis; null = zo šírky */
	kolajnica: KolajnicaRucne | null;
}

export interface MultiVstup {
	zak: string;
	op: string;
	zakaznik: string;
	poznamka: string;
	/** RAL farba — samostatné pole, veľkým na pláne/tlači; do Money NEJDE */
	ral: string;
	caka: boolean;
	/** prídavná koľajnica — spodná koľajnica o 1 väčšia (len Štandard +) */
	pridavnaKolajnica: boolean;
	posuvy: PosuvVstup[];
}

/** Parsuje objednávku s VIAC posuvmi. Zdieľané polia (zak/op/zákazník/poznámka/
 *  čaká) sú ploché; posuvy prídu ako JSON pole v poli `posuvy`. Rovnaké rozsahové
 *  strážne kontroly ako parseVstup, per posuv. */
export function parseMultiVstup(form: FormData): { vstup: MultiVstup; error: string | null } {
	const base = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		poznamka: String(form.get('poznamka') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 300),
		ral: String(form.get('ral') ?? '').trim().slice(0, 40),
		caka: form.get('caka') === '1',
		pridavnaKolajnica: form.get('pridavnaKolajnica') === '1'
	};
	let posuvyRaw: unknown;
	try {
		posuvyRaw = JSON.parse(String(form.get('posuvy') ?? '[]'));
	} catch {
		posuvyRaw = null;
	}
	const posuvy: PosuvVstup[] = [];
	let error: string | null = null;
	if (!base.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!base.op) error = 'Chýba OP/OPDL číslo.';
	else if (!base.zakaznik) error = 'Chýba zákazník.';
	else if (!Array.isArray(posuvyRaw) || posuvyRaw.length < 1) error = 'Zadaj aspoň jeden posuv.';
	else if (posuvyRaw.length > 12) error = 'Priveľa posuvov (max 12).';
	else {
		for (let i = 0; i < posuvyRaw.length; i++) {
			const p = (posuvyRaw[i] ?? {}) as Record<string, unknown>;
			const s = parseFloat(String(p.s ?? '').replace(',', '.'));
			const v = parseFloat(String(p.v ?? '').replace(',', '.'));
			const k = parseKlin({
				on: p.klin,
				dlzka: p.klinDlzka,
				sirka: p.klinSirka,
				v1: p.klinV1,
				v2: p.klinV2,
				ks: p.klinKs
			});
			const kol = parseKolajnica(p.kolajnicaHorna, p.kolajnicaSpodna);
			const posuv: PosuvVstup = {
				system: String(p.system ?? '').trim(),
				styl: normalizujStyl(String(p.system ?? '').trim(), String(p.styl ?? '').trim()),
				s: Number.isFinite(s) ? s : 0,
				v: Number.isFinite(v) ? v : 0,
				sklo: String(p.sklo ?? '').trim(),
				otvaranie: String(p.otvaranie ?? '').trim(),
				kovanieL: sanitizeKovanie(String(p.system ?? '').trim(), p.kovanieL),
				kovanieP: sanitizeKovanie(String(p.system ?? '').trim(), p.kovanieP),
				klin: k.klin,
				kolajnica: kol.kolajnica
			};
			if (!posuv.system || !posuv.styl) {
				error = `Posuv ${i + 1}: vyber systém a štýl.`;
				break;
			}
			// 2x štýly sú vždy opona (serverové vynútenie, viď parseVstup)
			if (posuv.styl.startsWith('2x')) posuv.otvaranie = 'Opona';
			if (!(posuv.s >= 300 && posuv.s <= 20000)) {
				error = `Posuv ${i + 1}: šírka musí byť 300–20000 mm.`;
				break;
			}
			if (!(posuv.v >= 300 && posuv.v <= 20000)) {
				error = `Posuv ${i + 1}: výška musí byť 300–20000 mm.`;
				break;
			}
			if (!posuv.sklo) {
				error = `Posuv ${i + 1}: vyber sklo.`;
				break;
			}
			if (!OTVARANIA.includes(posuv.otvaranie)) {
				error = `Posuv ${i + 1}: vyber otváranie.`;
				break;
			}
			if (kol.error) {
				error = `Posuv ${i + 1}: ${kol.error.replace(/^Koľajnica /, 'koľajnica ')}`;
				break;
			}
			if (k.error) {
				error = `Posuv ${i + 1}: ${k.error.replace(/^Klín: /, 'klín — ')}`;
				break;
			}
			posuvy.push(posuv);
		}
	}
	return { vstup: { ...base, posuvy }, error };
}

// ---- Bazén ----

import type { BazenVstup } from './bazen';

export function parseBazenVstup(form: FormData): { vstup: BazenVstup; error: string | null } {
	const num = (k: string, max = 1000) => {
		const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
		if (!Number.isFinite(x)) return 0;
		return Math.min(Math.max(x, 0), max);
	};
	// počty sú CELÉ čísla — zlomok sekcie (0.5) by v BOM vzorcoch vyrobil
	// záporné množstvá, ktoré by prešli do Money (nález review)
	const cnt = (k: string, max = 100) => Math.round(num(k, max));
	const vstup: BazenVstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		model: String(form.get('model') ?? 'Premier / Exclusive').trim(),
		kolaj: String(form.get('kolaj') ?? 'Jednokolaj').trim(),
		pocetSekcii: cnt('pocetSekcii'),
		pocetPriecok: cnt('pocetPriecok'),
		dvere: form.get('dvere') === '1',
		vs4500: cnt('vs4500'),
		vs6000: cnt('vs6000'),
		ss4500: cnt('ss4500'),
		ss6000: cnt('ss6000'),
		ms4500: cnt('ms4500'),
		ms6000: cnt('ms6000'),
		dlzkaKolajnic: num('dlzkaKolajnic', 200000),
		prieckovy4300: cnt('prieckovy4300'),
		prieckovy6000: cnt('prieckovy6000'),
		vyklopneCelo: cnt('vyklopneCelo'),
		caka: form.get('caka') === '1'
	};
	let error: string | null = null;
	const rawDlzka = parseFloat(String(form.get('dlzkaKolajnic') ?? '0').replace(',', '.'));
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else if (!(vstup.pocetSekcii > 0)) error = 'Zadaj počet sekcií (väčší ako 0).';
	else if (Number.isFinite(rawDlzka) && rawDlzka > 200000)
		error = 'Dĺžka koľajníc mimo rozsahu (max 200 000 mm) — skontroluj zadanie.';
	return { vstup, error };
}
