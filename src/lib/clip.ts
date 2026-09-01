// CLIP zábradlie — client-safe čistý compute + data-driven katalóg (#372).
//
// Zdroj: Patrik Javorský, kanál 207 (Výroba automatizácia), 1.9.2026, dve nárezové
// šablóny „FIX - klasika.xlsx" (výplň 3.3.1 číre) a „FIX - IZO.xlsx" (4-8-4 IZO),
// každá 4 hárky Clip varianta B0–B3 (variant = počet výplní 1–4). Plná extrakcia
// vzorcov: `~/.claude/work-products/ch207-att-2026-09-01/clip-vektory.md`.
//
// ROZSAH (čistá časť, #372 ostáva OTVORENÝ): implementuje sa IZO B0–B3 + klasika
// B0/B1 — ich Money kódy (ZASP*) sú ŽIVO overené (existencia, Deleted=false,
// skladová karta, Model_UserData='Pevné zasklenie Clip' — design komentár + STEP 0).
// VYLÚČENÉ (čakajú na Patrikove odpovede — data-driven whitelist `dostupneVarianty`):
//   - klasika B2/B3 — šablóna používa kódy `KM12 Z516`/`KM12Z518`/`K-M12Z517`, ktoré
//     v Money NEEXISTUJÚ (copy-paste zo staršej šablóny). `dostupneVarianty('klasika')`
//     = [1,2]. Po potvrdení kódov: doplniť do katalógu + rozšíriť whitelist na [1..4]
//     + kontraktné vektory pre 2 nové hárky. ŽIADNA zmena compute/route.
//   - 4 drobné položky (vnút./vonk. tesnenie, spojovník priečky, kolík 6x12) — ich
//     kódy (`K120518`/`K120540`/`K12518`/`K80376015`) v Money NEEXISTUJÚ, preto majú
//     `kod: null`: v kontrole sa ZOBRAZIA s množstvom a štítkom „neodpisuje sa", do
//     Money odpisu NEVSTUPUJÚ (honest-null disciplína z `bazen-komponenty.ts`). Po
//     doplnení kódu do katalógu (null → skutočný kód) začnú vstupovať automaticky.
//
// Jednotný parametrický vzorec (šablóny sú JEDNA rodina, nie 8 nezávislých hárkov):
//   šírka výplne (B10) = (B6 − (19 + 29·N)) / N − 8   (N = počet výplní)
//   výška výplne (C10) = C6 − 56
// Počet tyčí per riadok = ROUNDUP(počet_ks / ROUNDDOWN(7500 / rozmer)) — PRESNE ako
// šablóna (nie bin-packing — kontrakt je 1:1 parita s Patrikovým Excelom, ktorý si
// vie výroba overiť; odpis = súčet tyčí per Money kód). appka NIKDY nečíta variant
// z popisku `G2` (v šablóne chybne skopírovaný) — počet výplní je `N`.
//
// Client-safe: NEIMPORTUJE nič zo `$lib/server/*` (testovateľné bez DB/env,
// zobraziteľné v náhľade). Odpisová jednotka profilov = `ks` (Money artikle sú
// 7500 mm tyče: „Rámový profil Surový 7500 mm").

export type ClipTyp = 'klasika' | 'izo';

/** Vstupy pre výpočet CLIP zábradlia (odvodené zo šablón — rozhodnuté v design komentári). */
export interface ClipVstup {
	zak: string;
	op: string;
	zakaznik: string;
	caka: boolean;
	/** `klasika` (3.3.1 číre) alebo `izo` (4-8-4 IZO) — určuje zasklievací kód + whitelist */
	typ: ClipTyp;
	/** počet výplní N ∈ 1..4 (šablónové B0–B3, B<n> = n+1 výplní) */
	variant: number;
	/** šírka zábradlia B6 [mm] */
	sirka: number;
	/** výška zábradlia C6 [mm] */
	vyska: number;
	/** RAL farba — voľný text z hlavičky šablóny, čisto informačný (do odpisu NEJDE) */
	ral: string;
}

/** Jeden riadok Money odpisu (súčet tyčí per kód). Profily = kusové (7500 mm tyče). */
export interface ClipPolozka {
	kod: string;
	nazov: string;
	qty: number;
	mj: 'ks';
}

/** Jeden riadok materiálovej tabuľky (nárez) — 1:1 so šablónou. */
export interface ClipRiadok {
	oznacenie: string;
	/** Money kód profilu, alebo `null` pre drobnú položku (kód v Money nepotvrdený) */
	kod: string | null;
	/** dĺžka rezu [mm]; `null` pre spojovník/kolík (pevný počet ks, bez rezu) */
	rozmer: number | null;
	/** F — počet kusov/rezov */
	pocetKs: number;
	/** ROUNDDOWN(7500 / rozmer) — koľko rezov z jednej tyče; `null` pre drobné */
	zaokruhlene: number | null;
	/** ROUNDUP(pocetKs / zaokruhlene) — do odpisu; `null` pre drobné */
	pocetTyci: number | null;
	/** zobrazené množstvo v jednotke `mj` (profil: pocetTyci; tesnenie: bm; spojovník/kolík: ks) */
	mnozstvo: number;
	mj: 'ks' | 'm';
	/** vysvetlivka (drobné položky: prečo nevstupujú do odpisu) */
	poznamka?: string;
}

export interface ClipVypocet {
	/** B10 [mm] */
	sirkaVyplne: number;
	/** C10 [mm] */
	vyskaVyplne: number;
	/** D6 [m²] */
	m2: number;
	/** popis výplne pre hlavičku/tlač */
	vyplnPopis: string;
	/** N — počet výplní */
	pocetVyplni: number;
	/** pozície priečok od ľavého kraja [mm] (len N≥2) — replikované 1:1 zo šablóny */
	pozicieePriecok: number[];
	/** celá materiálová tabuľka (nárez) — profily + 4 drobné položky */
	riadky: ClipRiadok[];
	/** Money odpis: súčet tyčí per kód (mj 'ks'), poradie rám → priečka → zasklievací */
	polozky: ClipPolozka[];
}

// --- KONŠTANTY (HTML min/max sa BINDUJE na tieto — nikdy literál; fix-module.md #85) ---
/** dĺžka tyče [mm] — napevno pre všetky CLIP profily (šablóna). Katalógový údaj:
 *  iná dĺžka je neskôr len ďalší dátový záznam, nie konštanta v kóde. */
export const CLIP_DLZKA_TYCE = 7500;
export const CLIP_MIN_SIRKA = 200;
/** < 7500, aby rozmer hlavného profilu (= šírka) nikdy nedal ROUNDDOWN(7500/rozmer)=0
 *  (šablónový IFERROR by vrátil 0 tyčí — tichý podhodnotený odpis). */
export const CLIP_MAX_SIRKA = 7000;
export const CLIP_MIN_VYSKA = 100;
export const CLIP_MAX_VYSKA = 3000;
/** minimálna šírka JEDNEJ výplne [mm] — pri veľkom N je zábradlie príliš úzke */
export const CLIP_MIN_VYPLNE = 50;

// --- Money katalóg (kódy + názvy ŽIVO overené v Money — STEP 0) ------------------
const KOD_RAM = { kod: 'ZASP00116', nazov: 'Rámový profil Surový 7500 mm' };
const KOD_PRIECKA = { kod: 'ZASP00125', nazov: 'Priečkový profil Surový 7500 mm' };
const KOD_ZASKLIEVACI: Record<ClipTyp, { kod: string; nazov: string }> = {
	klasika: { kod: 'ZASP202413', nazov: 'Zasklievací profil 36 mm Surový 7500 mm' },
	izo: { kod: 'ZASP00119', nazov: 'Zasklievací profil 28 mm Surový 7500 mm' }
};

const R1 = (x: number) => Math.round(x * 10) / 10;
const R3 = (x: number) => Math.round(x * 1000) / 1000;

/** Je hodnota z formulára platný typ výplne? (skriptovaný POST môže poslať čokoľvek) */
export function jeClipTyp(x: unknown): x is ClipTyp {
	return x === 'klasika' || x === 'izo';
}

/**
 * Data-driven whitelist dostupných variantov (počet výplní N) pre daný typ.
 * izo → 1..4 (všetky kódy overené); klasika → 1..2 (B2/B3 čakajú na Patrikove
 * kódy — pozri hlavičku). Rozšírenie po odpovedi = zmena TOHTO poľa + katalógu,
 * NIE compute/route.
 */
export function dostupneVarianty(typ: ClipTyp): number[] {
	return typ === 'izo' ? [1, 2, 3, 4] : [1, 2];
}

/** Popis výplne pre hlavičku/tlač (informačný). */
export function popisTyp(typ: ClipTyp): string {
	return typ === 'izo' ? '4-8-4 IZO číre' : '3.3.1 číre';
}

/** ROUNDDOWN(7500/rozmer) — koľko celých rezov `rozmer` z jednej 7500 mm tyče. */
function rezovZTyce(rozmer: number): number {
	return rozmer > 0 ? Math.floor(CLIP_DLZKA_TYCE / rozmer) : 0;
}

/**
 * Serverová kontrola vstupu (HTML5 min/max obíde skriptovaný POST). Vracia text
 * chyby alebo null. Okrem rozsahov overuje ODVODENÚ šírku výplne (pri veľkom N
 * môže platná šírka zábradlia dať zápornú/malú výplň — computed-vs-min pasca).
 */
export function chybaClipVstupu(vstup: ClipVstup): string | null {
	const { typ, variant: N, sirka, vyska } = vstup;
	if (!jeClipTyp(typ)) return 'Neplatný typ výplne.';
	if (!Number.isInteger(N) || !dostupneVarianty(typ).includes(N))
		return typ === 'klasika'
			? 'Pre klasiku sú zatiaľ dostupné len B0 a B1 (1–2 výplne) — B2/B3 čakajú na potvrdenie kódov od Patrika.'
			: `Neplatný počet výplní (${N}) — povolené 1–4.`;
	if (!(sirka >= CLIP_MIN_SIRKA && sirka <= CLIP_MAX_SIRKA))
		return `Šírka zábradlia musí byť ${CLIP_MIN_SIRKA}–${CLIP_MAX_SIRKA} mm.`;
	if (!(vyska >= CLIP_MIN_VYSKA && vyska <= CLIP_MAX_VYSKA))
		return `Výška zábradlia musí byť ${CLIP_MIN_VYSKA}–${CLIP_MAX_VYSKA} mm.`;
	const sirkaVyplne = (sirka - (19 + 29 * N)) / N - 8;
	if (!(sirkaVyplne >= CLIP_MIN_VYPLNE))
		return `Pri ${N} výplniach je šírka zábradlia príliš malá — šírka jednej výplne by vyšla ${Math.round(sirkaVyplne)} mm (min ${CLIP_MIN_VYPLNE} mm).`;
	return null;
}

/** Pozície priečok od ľavého kraja [mm] (len N≥2) — replikované 1:1 zo šablóny,
 *  vrátane šablónových offsetov (parita, nie „oprava"). Display-only. */
function pozicieePriecok(N: number, B6: number): number[] {
	if (N === 2) return [B6 / 2];
	if (N === 3) {
		const p1 = (B6 - 108) / 3 + 39;
		const p2 = p1 + (B6 - 108) / 3 + 30;
		return [p1, p2];
	}
	if (N === 4) {
		const p1 = (B6 - 135) / 4 + 39;
		const p2 = p1 + (B6 - 135) / 4 + 29;
		const p3 = p2 + (B6 - 135) / 4 + 29;
		return [p1, p2, p3];
	}
	return [];
}

/**
 * Spočíta CLIP zábradlie (materiálová tabuľka + Money odpis). Predpokladá PLATNÝ
 * vstup — volajúci najprv volá `chybaClipVstupu`. Odpis = súčet počtu tyčí per
 * Money kód (čelo+výška profilu zdieľajú kód). ROUNDDOWN/ROUNDUP na SUROVÝCH
 * (nezaokrúhlených) rozmeroch — presne ako Excel; `rozmer` sa zaokrúhľuje LEN na
 * zobrazenie.
 */
export function computeClip(vstup: ClipVstup): ClipVypocet {
	const N = vstup.variant;
	const B6 = vstup.sirka;
	const C6 = vstup.vyska;
	const B10 = (B6 - (19 + 29 * N)) / N - 8; // šírka výplne
	const C10 = C6 - 56; // výška výplne
	const zask = KOD_ZASKLIEVACI[vstup.typ];

	const profil = (oznacenie: string, kod: string, rozmer: number, pocetKs: number): ClipRiadok => {
		const zaokruhlene = rezovZTyce(rozmer); // ROUNDDOWN(7500/rozmer) zo SUROVÉHO rozmeru
		const pocetTyci = zaokruhlene === 0 ? 0 : Math.ceil(pocetKs / zaokruhlene); // ROUNDUP(ks/S)
		return {
			oznacenie,
			kod,
			rozmer: R1(rozmer),
			pocetKs,
			zaokruhlene,
			pocetTyci,
			mnozstvo: pocetTyci,
			mj: 'ks'
		};
	};

	const profilRiadky: ClipRiadok[] = [
		profil('hlavný profil – čelo', KOD_RAM.kod, B6, 2),
		profil('hlavný profil – výška', KOD_RAM.kod, C6 - 48, 2),
		...(N >= 2 ? [profil('priečka', KOD_PRIECKA.kod, C6 - 48, N - 1)] : []),
		profil('zasklievací profil – čelo', zask.kod, B10 + 8, 2 * N),
		profil('zasklievací profil – výška', zask.kod, C10 - 24, 2 * N)
	];

	// 4 drobné položky (kod: null — kódy v Money nepotvrdené, do odpisu NEVSTUPUJÚ)
	const tesnenieBm = ((B10 + C10) * 2 * N) / 1000;
	const NOTE = 'kód v Money nepotvrdený — neodpisuje sa';
	const drobne: ClipRiadok[] = [
		drobna('vnútorné tesnenie', R3(tesnenieBm), 'm', NOTE),
		drobna('vonkajšie tesnenie', R3(tesnenieBm), 'm', NOTE),
		// pevné konštanty na variant (nie vzorec): spojovník 4/6/8/10 = 2N+2, kolík 4/8/12/16 = 4N
		drobna('spojovník priečky', 2 * N + 2, 'ks', NOTE),
		drobna('kolík 6x12', 4 * N, 'ks', NOTE)
	];

	// odpis: súčet tyčí per Money kód (poradie prvého výskytu: rám → priečka → zasklievací)
	const polozky = odpisZProfilov(profilRiadky);

	return {
		sirkaVyplne: R1(B10),
		vyskaVyplne: R1(C10),
		m2: R3((B6 * C6) / 1_000_000),
		vyplnPopis: popisTyp(vstup.typ),
		pocetVyplni: N,
		pozicieePriecok: pozicieePriecok(N, B6).map(R1),
		riadky: [...profilRiadky, ...drobne],
		polozky
	};
}

/** Drobná položka (kod: null) — zobrazí sa s množstvom, do odpisu NEVSTUPUJE. */
function drobna(oznacenie: string, mnozstvo: number, mj: 'ks' | 'm', poznamka: string): ClipRiadok {
	return {
		oznacenie,
		kod: null,
		rozmer: null,
		pocetKs: 1,
		zaokruhlene: null,
		pocetTyci: null,
		mnozstvo,
		mj,
		poznamka
	};
}

/** Zoskupí počet tyčí profilov per Money kód (poradie prvého výskytu). Názov z katalógu. */
function odpisZProfilov(riadky: ClipRiadok[]): ClipPolozka[] {
	const nazovPre = (kod: string): string => {
		if (kod === KOD_RAM.kod) return KOD_RAM.nazov;
		if (kod === KOD_PRIECKA.kod) return KOD_PRIECKA.nazov;
		if (kod === KOD_ZASKLIEVACI.klasika.kod) return KOD_ZASKLIEVACI.klasika.nazov;
		return KOD_ZASKLIEVACI.izo.nazov;
	};
	const out: ClipPolozka[] = [];
	for (const r of riadky) {
		if (r.kod === null || r.pocetTyci === null) continue;
		const exist = out.find((o) => o.kod === r.kod);
		if (exist) exist.qty += r.pocetTyci;
		else out.push({ kod: r.kod, nazov: nazovPre(r.kod), qty: r.pocetTyci, mj: 'ks' });
	}
	return out;
}
