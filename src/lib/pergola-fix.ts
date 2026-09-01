// „Pergola s FIXom" (#378) — bočné pevné zasklenie (FIX) k pergole. Táto vrstva
// LEN odvodí rozmery FIXu z pergoly a spočíta geometriu cez existujúce `$lib/fix`
// (`pocitajFix`, read-only) — je DISPLAY-ONLY a Money-NEUTRÁLNA. FIX materiály
// (profily Cortizo COR-60 CE + sklo) nemajú Money karty (overené read-only SQL
// 2026-07-27, viď `fix.ts`; pergola CODE_MAP má len hliníkové profily 18004–18104),
// takže FIX sa NIKDY nepridáva do Money odpisu — presne vzor `spocitajTesnenia`
// (#339) / strešné sklo (#223). Preto tento modul NEIMPORTUJE
// `server/money`/`server/pergola`/`server/db` (money-safety guard
// `tests/pergola-narez-money-safety.test.ts`, zoznam `CISTY_ENGINE`).
import {
	pocitajFix,
	rovnomernePolia,
	chybaFixVstupu,
	jeFixTvar,
	FIX_MAX_POLI,
	type FixVykres,
	type FixTvar
} from '$lib/fix';

/** Rozmery pergoly, z ktorých sa odvodí bočný FIX (šikmý fix do boku pergoly). */
export interface PergolaFixVstup {
	/** hĺbka pergoly [mm] — šírka bočného FIXu (FIX prekrýva hĺbku) */
	hlbka: number;
	/** predná svetlosť [mm] — výška FIXu vpredu */
	prednaSvetlost: number;
	/** zadná výška ZV [mm] — výška FIXu pri stene */
	vyskaZadna: number;
}

/** Odvodené rozmery FIXu (pred rozdelením na polia). */
export interface FixOdvodenie {
	/** šírka FIXu [mm] = hĺbka pergoly */
	s: number;
	/** výška vpredu [mm] = predná svetlosť */
	v1: number;
	/** výška pri stene [mm] = zadná výška ZV */
	v2: number;
	/** tvar — `sikmy` keď sa výšky líšia (strecha má sklon), inak `rovny` */
	tvar: FixTvar;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Odvodí rozmery bočného FIXu z rozmerov pergoly (ROZHODNUTÉ #378, variant 1):
 * šikmý FIX naprieč HĹBKOU pergoly, výšky = predná svetlosť (vpredu) / zadná výška
 * ZV (pri stene). Operátor môže KAŽDÝ rozmer prepísať (override) — toto je len
 * auto-predvyplnenie. Delenie na polia je samostatná voľba (default 1 pole).
 */
export function odvodFixZPergoly(v: PergolaFixVstup): FixOdvodenie {
	const s = R1(v.hlbka);
	const v1 = R1(v.prednaSvetlost);
	const v2 = R1(v.vyskaZadna);
	return { s, v1, v2, tvar: v1 === v2 ? 'rovny' : 'sikmy' };
}

/** Kompletný vstup FIXu k pergole (round-trip cez formulár, echo v každej akcii). */
export interface FixZPergola {
	/** je „pergola s FIXom" zapnutá (checkbox) */
	zapnuty: boolean;
	/** rozmery odvodiť automaticky z pergoly (default); false = ručný override */
	auto: boolean;
	s: number;
	v1: number;
	v2: number;
	tvar: FixTvar;
	/** šírky polí [mm]; súčet = `s` (kontroluje `chybaFixVstupu`) */
	polia: number[];
	/** zrkadlový kus (druhá strana pergoly) */
	zrkadlo: boolean;
	/** sklo (voľný text na výkres) */
	sklo: string;
	/** poznámka (na výkres) */
	poznamka: string;
}

/** Prázdny/vypnutý FIX (default). */
export function prazdnyFix(): FixZPergola {
	return {
		zapnuty: false,
		auto: true,
		s: 0,
		v1: 0,
		v2: 0,
		tvar: 'sikmy',
		polia: [],
		zrkadlo: false,
		sklo: '',
		poznamka: ''
	};
}

/**
 * Efektívny FIX: keď `auto`, prepíše rozmery (s/v1/v2/tvar) odvodením z pergoly a
 * polia rovnomerne rozdelí na aktuálny počet (súčet vždy = s); pri override vráti
 * FIX nezmenený. Server je autorita — pri `auto` NEDÔVERUJE klientovým rozmerom,
 * odvodí ich znova z rozmerov pergoly (rovnaká disciplína ako Money engine).
 */
export function efektivnyFix(fix: FixZPergola, pergola: PergolaFixVstup): FixZPergola {
	if (!fix.zapnuty || !fix.auto) return fix;
	const o = odvodFixZPergoly(pergola);
	const pocet = Math.min(FIX_MAX_POLI, Math.max(1, fix.polia.length || 1));
	return { ...fix, s: o.s, v1: o.v1, v2: o.v2, tvar: o.tvar, polia: rovnomernePolia(o.s, pocet) };
}

/**
 * Geometria FIXu na zobrazenie/výkres (cez existujúce `pocitajFix`). Vráti výkres
 * alebo chybu vstupu (rovnaká serverová kontrola ako `/fix`). Money sa NEROBÍ.
 */
export function spocitajFixZPergoly(fix: FixZPergola): {
	vykres: FixVykres | null;
	error: string | null;
} {
	if (!fix.zapnuty) return { vykres: null, error: null };
	const error = chybaFixVstupu(fix.s, fix.v1, fix.v2, fix.polia, fix.tvar);
	if (error) return { vykres: null, error };
	return { vykres: pocitajFix(fix.s, fix.v1, fix.v2, fix.polia), error: null };
}

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

/**
 * Parsuje FIX z formulára (round-trip: server prepočíta znova, nedôveruje klientu).
 * `fixPolia` je JSON pole šírok; prázdne = jedno pole cez celú šírku. Chýbajúci
 * `fixAuto` = auto (starý/skriptovaný POST bez poľa ostáva na auto-odvodení).
 */
export function parseFixZPergoly(form: FormData): FixZPergola {
	const zapnuty = form.get('pergolaSFixom') === '1';
	const auto = form.get('fixAuto') !== '0';
	const tvarRaw = String(form.get('fixTvar') ?? 'sikmy');
	const tvar: FixTvar = jeFixTvar(tvarRaw) ? tvarRaw : 'sikmy';
	const s = num(form, 'fixSirka');
	const v1 = num(form, 'fixV1');
	// rovný fix má obe výšky rovnaké (formulár posiela jednu; poistka pre POST)
	const v2 = tvar === 'rovny' ? v1 : num(form, 'fixV2');
	let polia: number[] = [];
	try {
		const raw: unknown = JSON.parse(String(form.get('fixPolia') ?? '[]'));
		if (Array.isArray(raw))
			polia = raw.slice(0, FIX_MAX_POLI + 1).map((x) => {
				const n = parseFloat(String(x).replace(',', '.'));
				return Number.isFinite(n) ? n : 0;
			});
	} catch {
		polia = [];
	}
	if (!polia.length && s > 0) polia = [s];
	return {
		zapnuty,
		auto,
		s,
		v1,
		v2,
		tvar,
		polia,
		zrkadlo: form.get('fixZrkadlo') === '1',
		sklo: String(form.get('fixSklo') ?? '')
			.trim()
			.slice(0, 120),
		poznamka: String(form.get('fixPoznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300)
	};
}
