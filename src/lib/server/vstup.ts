// Parsovanie a serverová validácia vstupu zasklenia formulára — jediný
// serverový strážca rozsahov (HTML5 min/max vie skriptovaný POST obísť).
import { KLIN_MAX_KS, KLIN_MAX_ROZMER, type Klin } from '$lib/klin';
import { STANDARD, zakladnyStyl } from '$lib/styl';
import { KOLAJNICA_MAX, KOLAJNICA_MIN, type KolajnicaRucne } from '$lib/kolajnica';
// Rozmerové medze — jediný zdroj pravdy (#216); floor 100 mm pre malé vetracie okienka.
import { S_MIN, S_MAX, V_MIN, V_MAX } from '$lib/zasklenia-navrh';
import { jeSietkaUchyt, maSietkaSystem, maSietkaSystemVyber, type Sietka } from '$lib/sietka';
import type { Farba } from '$lib/komponenty';

export const OTVARANIA = ['P - L', 'L - P', 'Opona'];

/** Zvolená RAL farba kovania z formulára — null = nezvolená (fail-loud v engine).
 *  R9006 pridané #354 (Deluxe krytky). */
export function parseFarba(raw: FormDataEntryValue | null): Farba | null {
	const v = String(raw ?? '').trim();
	return v === 'R9005' || v === 'R9006' || v === 'R7016' ? v : null;
}

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

/** Kľučka NAVYŠE na stredovom krídle — len opona (2x štýly), len Robust.
 *  Patrik 2026-07-31: „pri opone 2x2, 2x3, 2x4 sú na pravej a ľavej strane +
 *  je navyše aj na jednom krídle v strede, kde sa stretávajú." Money sa tým
 *  NEMENÍ — uzávery (a teda kľučky) majú opony v tabuľke 3 ks už dávno; toto je
 *  informácia pre dielňu, ktorá kľučka a na ktorom stredovom okne. */
export function sanitizeKovanieStred(system: string, styl: string, raw: unknown): string {
	return styl.startsWith('2x') ? sanitizeKovanie(system, raw) : '';
}

/** Ktoré z dvoch stredových krídel kľučku nesie: 'L' (ľavé) alebo 'P' (pravé). */
export function sanitizeStredOkno(raw: unknown): 'L' | 'P' {
	return String(raw ?? '')
		.trim()
		.toUpperCase() === 'P'
		? 'P'
		: 'L';
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

/** Surové polia sieťky — z plochého formulára aj z JSON riadku posuvu (multi).
 *  `on` je zapínač: '1' / true = „so sieťkou" je zapnuté. `system` = voľba systému
 *  sieťky (#110), zmysluplná LEN pri Štandard/Štandard + posuve. */
export interface SietkaRaw {
	on: unknown;
	uchyt: unknown;
	system?: unknown;
}

/**
 * Sieťka (#86–#90, KOREKCIA 2026-08-02, #110 systém sieťky). Vypnutý zapínač →
 * `null` a žiadna chyba (sieťka je nepovinná). Zapnutá → úchyt (rozmer sa
 * NEZADÁVA — je to ĎALŠIE krídlo posuvu, appka jeho rozmer odvodí sama) + voliteľný
 * systém sieťky. Úchyt sa sanitizuje na jednu zo 4 hodnôt, nezmyselná/chýbajúca
 * hodnota = „bez ničoho". Systém sa NEUKLADÁ, keď je nezmyselný alebo zhodný s
 * posuvom (default = rovnaký ako posuv) — `system` sa dosanitizuje podľa systému
 * POSUVU v `sanitizeSietka` (tu ho ešte nepoznáme).
 */
export function parseSietka(raw: SietkaRaw): { sietka: Sietka | null; error: string | null } {
	const on = raw.on === '1' || raw.on === true || raw.on === 'true';
	if (!on) return { sietka: null, error: null };
	const uchytRaw = raw.uchyt;
	const sietka: Sietka = { uchyt: jeSietkaUchyt(uchytRaw) ? uchytRaw : 'ziadny' };
	if (typeof raw.system === 'string' && raw.system) sietka.system = raw.system;
	return { sietka, error: null };
}

/** Sieťka je len tam, kde ju appka ponúka (Robust/Slide/Štandard/Štandard +) —
 *  pri inom systéme (aj zo skriptovaného POST-u) sa zahodí, nech sa na plán
 *  nedostane nezmysel (rovnaký vzor ako `sanitizeKovanie`). Pole `system` (#110)
 *  sa ponechá LEN keď posuv má výber (`maSietkaSystemVyber`) A zvolená hodnota je
 *  jedna z dvoch platných (Štandard/Štandard +) A líši sa od posuvu (rovnaký kód
 *  ako keby sa nezadal vôbec — default = rovnaký systém). */
export function sanitizeSietka(system: string, sietka: Sietka | null): Sietka | null {
	if (!maSietkaSystem(system) || !sietka) return null;
	// `system` pole má zmysel len pri výbere (Štandard/Štandard +), a len keď je
	// platnou (inou) hodnotou z tej istej dvojice — inak sa zahodí (default =
	// rovnaký systém ako posuv), presne ako keby sa vôbec nezadalo.
	const platnyVyber =
		maSietkaSystemVyber(system) &&
		!!sietka.system &&
		sietka.system !== system &&
		maSietkaSystemVyber(sietka.system);
	if (platnyVyber) return sietka;
	if (sietka.system === undefined) return sietka;
	const { uchyt } = sietka;
	return { uchyt };
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

/**
 * Riadok posuvu chodí na server v DVOCH tvaroch a oba musia prejsť rovnako:
 * z formulára ploché polia (`klin: '1'`, `klinDlzka: '2509'`, `kolajnicaHorna`),
 * z náhľadu (skryté pole `posuvy`) JSON toho, čo server vrátil — teda už
 * SPARSOVANÝ tvar (`klin: {dlzka,…}`, `kolajnica: {horna,…}`). Kým sa čítali len
 * ploché názvy, druhý parse (Odoslať / Späť a upraviť) klín aj ručnú dĺžku
 * koľajnice tichor zahodil — klín zmizol z plánu a koľajnica menila Money odpis
 * (šéf 2026-07-30). Vnorený tvar tu vždy znamená „zapnuté": zapínač už padol
 * pri prvom parse, tak sa nulou v `on` nesmie prepnúť naspäť.
 */
function klinRaw(p: Record<string, unknown>): KlinRaw {
	const k = p.klin;
	if (k && typeof k === 'object') {
		const o = k as Record<string, unknown>;
		return { on: '1', dlzka: o.dlzka, sirka: o.sirka, v1: o.v1, v2: o.v2, ks: o.ks };
	}
	return {
		on: k,
		dlzka: p.klinDlzka,
		sirka: p.klinSirka,
		v1: p.klinV1,
		v2: p.klinV2,
		ks: p.klinKs
	};
}

/** Sieťka z posuvu — vnorený `{uchyt,system}` aj ploché polia (viď `klinRaw`).
 *  `system` (#110) musí prežiť round-trip rovnako ako `uchyt` — inak sa výber
 *  systému sieťky stratí pri „Späť a upraviť" presne ako sa stratil klín/ručná
 *  koľajnica pred opravou #81/#108. */
function sietkaRaw(p: Record<string, unknown>): SietkaRaw {
	const k = p.sietka;
	if (k && typeof k === 'object') {
		const o = k as Record<string, unknown>;
		return { on: '1', uchyt: o.uchyt, system: o.system };
	}
	return { on: k, uchyt: p.sietkaUchyt, system: p.sietkaSystem };
}

/** Ručná koľajnica z posuvu — vnorený `{horna,spodna}` aj ploché polia (viď `klinRaw`). */
function kolajnicaRaw(p: Record<string, unknown>): [unknown, unknown] {
	const k = p.kolajnica;
	if (k && typeof k === 'object') {
		const o = k as Record<string, unknown>;
		return [o.horna, o.spodna];
	}
	return [p.kolajnicaHorna, p.kolajnicaSpodna];
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
	/** kľučka navyše na STREDOVOM krídle — len opona; prázdne = žiadna */
	kovanieStred: string;
	/** ktoré stredové krídlo ju nesie: 'L' ľavé, 'P' pravé */
	kovanieStredOkno: 'L' | 'P';
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
	/** jednostranná FAB — výnimka (Dominik: „chodí jeden zo 100"). MENÍ Money odpis:
	 *  kľučka a krytka vložky idú 1 ks namiesto 2 ks na uzáver. */
	jednostrannaFab: boolean;
	/** RAL farba kovania (R9005/R7016) — vyberá farebný variant kovania do Money
	 *  odpisu (kľučka/krytka vložky, Štandard zámok). null = nezvolená → engine
	 *  vyhlási chybu, keď systém má farebnú položku (#338). */
	farbaKovania: Farba | null;
	/** klín nad posuvom (Patrik) — display-only, do Money odpisu NEJDE; null = žiadny */
	klin: Klin | null;
	/** ručne zadané dĺžky koľajníc — MENÍ Money odpis; null = počítaj zo šírky */
	kolajnica: KolajnicaRucne | null;
	/** sieťka na posuve (#86–#90) — display-only, do Money odpisu NEJDE; null = žiadna */
	sietka: Sietka | null;
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
		skloPresne: String(form.get('skloPresne') ?? '')
			.trim()
			.slice(0, 120),
		otvaranie: String(form.get('otvaranie') ?? '').trim(),
		kovanieL: sanitizeKovanie(String(form.get('system') ?? '').trim(), form.get('kovanieL')),
		kovanieP: sanitizeKovanie(String(form.get('system') ?? '').trim(), form.get('kovanieP')),
		kovanieStred: '',
		kovanieStredOkno: sanitizeStredOkno(form.get('kovanieStredOkno')),
		// Deluxe zámok: kladná výška vŕtania, inak default 1050 (len na náhľad/tlač)
		vrtanieZamku: (() => {
			const x = num('vrtanieZamku');
			return x > 0 && x <= 20000 ? x : 1050;
		})(),
		poznamka: String(form.get('poznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300),
		ral: String(form.get('ral') ?? '')
			.trim()
			.slice(0, 40),
		caka: form.get('caka') === '1',
		pridavnaKolajnica: form.get('pridavnaKolajnica') === '1',
		jednostrannaFab: form.get('jednostrannaFab') === '1',
		farbaKovania: parseFarba(form.get('farbaKovania')),
		klin: null,
		kolajnica: null,
		sietka: null
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
	const sk = parseSietka({
		on: form.get('sietka'),
		uchyt: form.get('sietkaUchyt'),
		system: form.get('sietkaSystem')
	});
	// 2x štýly sú vždy opona (otváranie od stredu) — vynúť aj serverovo, nech to
	// skriptovaný POST neobíde (otváranie je len na plán/náhľad, nemení výpočet)
	if (vstup.styl.startsWith('2x')) vstup.otvaranie = 'Opona';
	// až TU, keď je systém aj štýl normalizovaný — mimo opony sa stredová kľučka
	// zahadzuje a sieťka sa ponúka len na systémoch, ktoré ju majú (Robust/Slide)
	vstup.kovanieStred = sanitizeKovanieStred(vstup.system, vstup.styl, form.get('kovanieStred'));
	vstup.sietka = sanitizeSietka(vstup.system, sk.sietka);
	let error: string | null = null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else if (!(vstup.s >= S_MIN && vstup.s <= S_MAX)) error = `Šírka musí byť ${S_MIN}–${S_MAX} mm.`;
	else if (!(vstup.v >= V_MIN && vstup.v <= V_MAX)) error = `Výška musí byť ${V_MIN}–${V_MAX} mm.`;
	else if (!OTVARANIA.includes(vstup.otvaranie)) error = 'Vyber otváranie.';
	else if (kol.error) error = kol.error;
	else if (k.error) error = k.error;
	else if (maSietkaSystem(vstup.system) && sk.error) error = sk.error;
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
	/** kľučka navyše na stredovom krídle TOHOTO posuvu — len opona */
	kovanieStred: string;
	/** ktoré stredové krídlo ju nesie: 'L' ľavé, 'P' pravé */
	kovanieStredOkno: 'L' | 'P';
	/** klín nad TÝMTO posuvom — display-only, do Money odpisu NEJDE; null = žiadny */
	klin: Klin | null;
	/** ručné dĺžky koľajníc TOHOTO posuvu — MENÍ Money odpis; null = zo šírky */
	kolajnica: KolajnicaRucne | null;
	/** sieťka TOHOTO posuvu (#86–#90) — display-only, do Money odpisu NEJDE; null = žiadna */
	sietka: Sietka | null;
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
	/** jednostranná FAB — výnimka, MENÍ Money odpis (kľučka/krytka vložky 1 ks) */
	jednostrannaFab: boolean;
	/** RAL farba kovania (R9005/R7016) — spoločná pre celú objednávku (#338) */
	farbaKovania: Farba | null;
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
		poznamka: String(form.get('poznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300),
		ral: String(form.get('ral') ?? '')
			.trim()
			.slice(0, 40),
		caka: form.get('caka') === '1',
		pridavnaKolajnica: form.get('pridavnaKolajnica') === '1',
		jednostrannaFab: form.get('jednostrannaFab') === '1',
		farbaKovania: parseFarba(form.get('farbaKovania'))
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
			const k = parseKlin(klinRaw(p));
			const kol = parseKolajnica(...kolajnicaRaw(p));
			const sk = parseSietka(sietkaRaw(p));
			const posuvSystem = String(p.system ?? '').trim();
			const posuv: PosuvVstup = {
				system: posuvSystem,
				styl: normalizujStyl(posuvSystem, String(p.styl ?? '').trim()),
				s: Number.isFinite(s) ? s : 0,
				v: Number.isFinite(v) ? v : 0,
				sklo: String(p.sklo ?? '').trim(),
				otvaranie: String(p.otvaranie ?? '').trim(),
				kovanieL: sanitizeKovanie(posuvSystem, p.kovanieL),
				kovanieP: sanitizeKovanie(posuvSystem, p.kovanieP),
				kovanieStred: '',
				kovanieStredOkno: sanitizeStredOkno(p.kovanieStredOkno),
				klin: k.klin,
				kolajnica: kol.kolajnica,
				sietka: sanitizeSietka(posuvSystem, sk.sietka)
			};
			if (!posuv.system || !posuv.styl) {
				error = `Posuv ${i + 1}: vyber systém a štýl.`;
				break;
			}
			// 2x štýly sú vždy opona (serverové vynútenie, viď parseVstup)
			if (posuv.styl.startsWith('2x')) posuv.otvaranie = 'Opona';
			posuv.kovanieStred = sanitizeKovanieStred(posuv.system, posuv.styl, p.kovanieStred);
			if (!(posuv.s >= S_MIN && posuv.s <= S_MAX)) {
				error = `Posuv ${i + 1}: šírka musí byť ${S_MIN}–${S_MAX} mm.`;
				break;
			}
			if (!(posuv.v >= V_MIN && posuv.v <= V_MAX)) {
				error = `Posuv ${i + 1}: výška musí byť ${V_MIN}–${V_MAX} mm.`;
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
			if (maSietkaSystem(posuv.system) && sk.error) {
				error = `Posuv ${i + 1}: ${sk.error.replace(/^Sieťka: /, 'sieťka — ')}`;
				break;
			}
			posuvy.push(posuv);
		}
	}
	return { vstup: { ...base, posuvy }, error };
}

// ---- Bazén ----

import type { BazenVstup } from './bazen';

/** Whitelist modelu bazéna — len 'Premier'|'Exclusive'|'Star'; čokoľvek iné
 *  (vrátane legacy 'Premier / Exclusive') → 'Premier' (bezpečný smer #355). */
function normModel(raw: string): string {
	return raw === 'Star' ? 'Star' : raw === 'Exclusive' ? 'Exclusive' : 'Premier';
}

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
		// model whitelist (#355): legacy zlúčené 'Premier / Exclusive' (stará karta
		// v prehliadači, historický vstup_raw) → 'Premier' — bezpečný smer (NEodpíše
		// EXCLUSIVE spojku M8). Iba explicitné 'Exclusive'/'Star' menia správanie.
		model: normModel(String(form.get('model') ?? 'Premier').trim()),
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
		caka: form.get('caka') === '1',
		// --- #355 nové voľby (whitelistované — neznáma hodnota padne na default) ----
		aretaciaTyp: form.get('aretaciaTyp') === 'automaticka' ? 'automaticka' : 'manualna',
		aretaciaStrana: form.get('aretaciaStrana') === 'L' ? 'L' : 'P',
		uzamykatelna: form.get('uzamykatelna') === '1',
		ralKrytiek: form.get('ralKrytiek') === 'R7016' ? 'R7016' : 'R9006',
		pantFarba: form.get('pantFarba') === '9005' ? '9005' : 'ELOX',
		vetraciaKlapka: form.get('vetraciaKlapka') === '1'
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
