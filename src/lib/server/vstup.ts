// Parsovanie a serverová validácia vstupu zasklenia formulára — jediný
// serverový strážca rozsahov (HTML5 min/max vie skriptovaný POST obísť).
export const OTVARANIA = ['P - L', 'L - P', 'Opona'];

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
		styl: String(form.get('styl') ?? '').trim(),
		s: num('s'),
		v: num('v'),
		sklo: String(form.get('sklo') ?? '').trim(),
		skloPresne: String(form.get('skloPresne') ?? '').trim().slice(0, 120),
		otvaranie: String(form.get('otvaranie') ?? '').trim(),
		// Deluxe zámok: kladná výška vŕtania, inak default 1050 (len na náhľad/tlač)
		vrtanieZamku: (() => {
			const x = num('vrtanieZamku');
			return x > 0 && x <= 20000 ? x : 1050;
		})(),
		poznamka: String(form.get('poznamka') ?? '').trim().slice(0, 300),
		ral: String(form.get('ral') ?? '').trim().slice(0, 40),
		caka: form.get('caka') === '1',
		pridavnaKolajnica: form.get('pridavnaKolajnica') === '1'
	};
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
		poznamka: String(form.get('poznamka') ?? '').trim().slice(0, 300),
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
			const posuv: PosuvVstup = {
				system: String(p.system ?? '').trim(),
				styl: String(p.styl ?? '').trim(),
				s: Number.isFinite(s) ? s : 0,
				v: Number.isFinite(v) ? v : 0,
				sklo: String(p.sklo ?? '').trim(),
				otvaranie: String(p.otvaranie ?? '').trim()
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
