// Hlavný výpočet nárezového plánu a mapovanie na Money odpis — jeden posuv
// (computeFlat/safeCompute) aj viac posuvov (computeMulti/safeComputeMulti) +
// PosuvSpec. Rozdelené z compute.ts (#249). Importuj cez `$lib/server/compute`.
import { jeSikmyRez, systemRovnyRez } from '$lib/cut';
import type { Klin } from '$lib/klin';
import type { KolajnicaRucne } from '$lib/kolajnica';
import type { ZakladPoctov } from '$lib/komponenty';
import { maSietkaSystemVyber, type Sietka } from '$lib/sietka';
import {
	jeSietkaMoneyRelevant,
	mergeExtraCuts,
	sietkaChyba,
	sietkaKolajnicaSwap,
	sietkaSlideExtra,
	sietkaStandardExtra
} from './compute-sietka';
import {
	missingHrubkaProfile,
	oversizeCut,
	profilCuts,
	railUpsize,
	undersizeCut
} from './compute-profily';
import {
	ffdPack,
	inBounds,
	R,
	val,
	validSys,
	type Cfg,
	type ComputeResult,
	type Kus,
	type MaterialRow,
	type OdpisRow
} from './compute-model';

/**
 * Vypočíta nárezový plán. `redukciaZero` = true keď zvolené sklo nuluje
 * sklo-závislé profily (Redukcia 6mm pri Slide). Ktoré sklá to sú, určuje
 * tabuľka glass_types (stĺpec redukcia_zero) — nie natvrdo zadaný reťazec.
 */
export function computeFlat(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka = 0,
	pridavnaKolajnica = false,
	rucnaKolajnica?: KolajnicaRucne,
	sietka?: Sietka | null,
	// #440: per-sklo ABSOLÚTNY override korekcie rozmeru skla; NULL = systémový `g.skloOffset`
	// (bit-identické doterajšie správanie). PRIPOJENÝ NA KONIEC, aby sa nepohli pozičné volania.
	skloKorekcia: number | null = null
): ComputeResult | null {
	const g = cfg[sysStyl];
	if (!g || !g.rez.length) return null;
	const N = g.N;
	const system = sysStyl.split('|')[0] ?? '';
	const styl = sysStyl.split('|')[1] ?? '';
	const sietkaOn = jeSietkaMoneyRelevant(system, styl, sietka);
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	// sieťka Štandard/Štandard+ (#110) a Slide (#90) — riadky navyše, zlúčené PRED
	// balením; `sietkaChyba` (v `safeCompute`) validuje kombináciu VOPRED, takže tu
	// chyba znamená priame volanie mimo safeCompute — bezpečný default je nič nepridať.
	const extra = sietkaOn
		? system === 'Slide'
			? sietkaSlideExtra(cfg, styl, S, V, N)
			: maSietkaSystemVyber(system)
				? sietkaStandardExtra(cfg, system, styl, sietka, S, V, N)
				: { rezy: [], err: null }
		: { rezy: [], err: null };
	const cuts = mergeExtraCuts(
		profilCuts(g, S, V, N, redukciaZero, skloHrubka, undefined, rucnaKolajnica, sietkaOn, system),
		extra.err ? [] : extra.rezy
	);
	for (const c of cuts) {
		const bary = ffdPack(c.kusy, c.barLen);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * c.barLen)) * 1000) / 10 : 0;
		// Deluxe + Štandard + = všetko rovný 90°; inak podľa názvu profilu (nosový/oponový 90°)
		const sikmyRez = !systemRovnyRez(system) && jeSikmyRez(c.nazov);
		// prídavná koľajnica: koľajnica o 1 väčšia (#456: Štandard+/Deluxe/Slide/Robust)
		const up = railUpsize(system, styl, pridavnaKolajnica, c.kod, c.nazov);
		// sieťka na 2K: celá koľajnica sa mení na 3K variant (#87)
		const sk = sietkaKolajnicaSwap(cfg, system, styl, sietkaOn, up.kod, up.nazov);
		material.push({
			kod: sk.kod,
			nazov: sk.nazov,
			rezy: c.rezy,
			tyce,
			bary,
			odpadMm,
			odpadPct,
			barLen: c.barLen,
			sikmyRez
		});
		odpis.push({ kod: sk.kod, nazov: sk.nazov, metre: R((tyce * c.barLen) / 1000) });
	}
	const ss = g.sklo.s,
		sv = g.sklo.v;
	if (!ss || !sv) return null;
	return {
		system,
		styl,
		S,
		V,
		N,
		m2: R((S * V) / 1e6),
		material,
		odpis,
		sklo: {
			// sklo sa objednáva na CELÉ milimetre (Dominik: 904,578 → 905) — zaokrúhli
			// na najbližší mm. Sklo NIE je v Money odpise, takže je to len rozmer na plán/objednávku.
			// #440: per-sklo override korekcie (NULL → systémový skloOffset).
			sirka: Math.round(val(ss, S, V, N, true) - (skloKorekcia ?? g.skloOffset)),
			vyska: Math.round(val(sv, S, V, N, true) - (skloKorekcia ?? g.skloOffset)),
			pocet: N
		}
	};
}

/**
 * Podklad na výpočet kovania ({@link ZakladPoctov}) z už spočítaného plánu JEDNÉHO
 * posuvu. Nič sa nehádá: počet krídel je `N` štýlu, počty a dĺžky profilov sú tie
 * isté čísla, podľa ktorých dielňa reže. Roly sa poznajú z NÁZVU profilu — rovnaká
 * konvencia, akú už používa `jeSikmyRez` (nosový/oponový = rovný rez).
 *
 * POZOR: pri multi-posuve to volaj PER POSUV a výsledky zlúč (`zlucKomponenty`) —
 * `computeMulti` materiál pooluje po kóde, takže z jeho `material` by sa počty
 * jednotlivých posuvov už nedali oddeliť.
 */
export function zakladPoctov(r: ComputeResult): ZakladPoctov {
	const dlzka = (re: RegExp) =>
		r.material
			.filter((m) => re.test(m.nazov))
			.reduce((s, m) => s + m.rezy.reduce((a, x) => a + x.rozmer * x.ks, 0), 0);
	const nosoveProfily = r.material
		.filter((m) => /nos[oó]v/i.test(m.nazov))
		.reduce((s, m) => s + m.rezy.reduce((a, x) => a + x.ks, 0), 0);
	return {
		kridla: r.N,
		nosoveProfily,
		dlzkaRamovehoMm: dlzka(/r[áa]mov/i),
		dlzkaNosovehoMm: dlzka(/nos[oó]v/i),
		dlzkaOponovehoMm: dlzka(/opon/i),
		// Kladkový/klzný profil (#354) — rovnaká name-regex technika, žiadne prekrytie
		// s existujúcimi rolami (kladkový/klzný sa nikdy nevolá rámový/nosový/oponový).
		// POZOR: „kladkový" NIE je exkluzívne Deluxe — Štandard má vlastný „Kladkový
		// profil" (ZASP202415), takže `dlzkaKladkovehoMm` je nenulové aj tam (dnes ho
		// žiadny Štandard komponent nepoužíva). „klzný" je overené (`cfg_seed.json`)
		// výhradne Deluxe.
		dlzkaKladkovehoMm: dlzka(/klad/i),
		dlzkaKlznehoMm: dlzka(/klzn/i)
	};
}

/**
 * Bezpečný výpočet: config musí prejsť validSys + inBounds a výsledok musí byť
 * konečný a nezáporný — inak vráti null a volajúci zobrazí chybu. Žiadny tichý
 * fallback (na rozdiel od n8n verzie): DB je zdroj pravdy, chyba sa hlási nahlas.
 */
export function safeCompute(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka = 0,
	pridavnaKolajnica = false,
	rucnaKolajnica?: KolajnicaRucne,
	sietka?: Sietka | null,
	// #440: per-sklo override korekcie rozmeru skla (NULL → systémový skloOffset). Prevlečie sa
	// do `undersizeCut` (sklo-guard konzistentný s computeFlat) aj do `computeFlat`.
	skloKorekcia: number | null = null
): { r: ComputeResult | null; err: string | null } {
	if (!validSys(cfg, sysStyl))
		return { r: null, err: 'Konfigurácia systému je neúplná alebo chybná.' };
	const boundErr = inBounds(cfg, sysStyl);
	if (boundErr) return { r: null, err: 'Konfigurácia mimo povolených rozsahov: ' + boundErr };
	const hrubkaErr = missingHrubkaProfile(cfg, sysStyl, skloHrubka);
	if (hrubkaErr) return { r: null, err: hrubkaErr };
	const overErr = oversizeCut(cfg, sysStyl, S, V, redukciaZero, skloHrubka, rucnaKolajnica);
	if (overErr) return { r: null, err: overErr };
	const underErr = undersizeCut(
		cfg,
		sysStyl,
		S,
		V,
		redukciaZero,
		skloHrubka,
		rucnaKolajnica,
		!!sietka,
		skloKorekcia
	);
	if (underErr) return { r: null, err: underErr };
	const g = cfg[sysStyl];
	const sietkaErr = g
		? sietkaChyba(cfg, sysStyl.split('|')[0] ?? '', sysStyl.split('|')[1] ?? '', sietka, S, V, g.N)
		: null;
	if (sietkaErr) return { r: null, err: sietkaErr };
	const r = computeFlat(
		cfg,
		sysStyl,
		S,
		V,
		redukciaZero,
		skloHrubka,
		pridavnaKolajnica,
		rucnaKolajnica,
		sietka,
		skloKorekcia
	);
	if (!r || !r.odpis.length || !r.odpis.every((o) => Number.isFinite(o.metre) && o.metre >= 0))
		return { r: null, err: 'Výpočet zlyhal — skontroluj konfiguráciu vzorcov.' };
	return { r, err: null };
}

// ---- Viac posuvov v jednej zákazke (zimná záhrada) ----

/** jeden posuv v rámci objednávky */
export interface PosuvSpec {
	sysStyl: string;
	S: number;
	V: number;
	redukciaZero: boolean;
	/** hrúbka zvoleného skla (mm) — vyberá Deluxe kladka/klzný profil (6/10); 0 = n/a */
	skloHrubka?: number;
	/** #440: per-sklo ABSOLÚTNY override korekcie rozmeru skla (NULL/undefined = systémový
	 *  `cfg_sys.sklo_offset`). Umožňuje solo korekciu 16 mm vs 6 mm skla v Slide. */
	skloKorekcia?: number | null;
	/** prídavná koľajnica — koľajnica o 1 väčšia (#456: Štandard+/Deluxe/Slide/Robust) */
	pridavnaKolajnica?: boolean;
	/** ručne zadaná dĺžka hornej / spodnej koľajnice — MENÍ odpis (Patrik 2026-07-28) */
	kolajnica?: KolajnicaRucne;
	/** len na plán/detail (nemení výpočet) */
	otvaranie?: string;
	sklo?: string;
	/** kovanie ľavej/pravej strany (kľučka) — len na plán/náhľad, len Robust */
	kovanieL?: string;
	kovanieP?: string;
	/** kľučka navyše na stredovom krídle (opona) — len na plán/náhľad */
	kovanieStred?: string;
	/** ktoré stredové krídlo ju nesie: 'L' ľavé, 'P' pravé */
	kovanieStredOkno?: 'L' | 'P';
	/** klíny nad posuvom (#472 viac RÔZNYCH naraz) — len na plán/náhľad, do Money
	 *  odpisu NEJDE */
	kliny?: Klin[];
	/** sieťka na posuve (#86–#90) — len na plán/náhľad, do Money odpisu NEJDE */
	sietka?: Sietka | null;
}

/** Kľúče `PosuvSpec`, ktoré sú tam POVINNÉ (bez `?`). */
type PosuvSpecRequiredKeys = {
	[K in keyof PosuvSpec]-?: Record<string, never> extends Pick<PosuvSpec, K> ? never : K;
}[keyof PosuvSpec];

/** Kľúče `PosuvSpec`, ktoré sú tam VOLITEĽNÉ (`?`). */
type PosuvSpecOptionalKeys = Exclude<keyof PosuvSpec, PosuvSpecRequiredKeys>;

/**
 * Vstup pre `buildPosuvSpec` — ODVODENÝ z `PosuvSpec` cez mapované typy (nie ručne
 * prepísaný zoznam polí), takže je štruktúrne NEMOŽNÉ, aby sa `PosuvSpecInput`
 * rozišiel s `PosuvSpec` pridaním poľa na jednom mieste a zabudnutím na druhom.
 * Polia povinné v `PosuvSpec` (`sysStyl`, `S`, `V`, `redukciaZero`) ostávajú
 * povinné a bez `undefined`; polia voliteľné v `PosuvSpec` (`?`) sú tu POVINNÉ
 * KĽÚČOM (žiadne `?`), ale hodnota smie byť `undefined`/`null`.
 *
 * Toto je celý mechanizmus, ktorý #109 rieši: keď niekto pridá nové pole do
 * `PosuvSpec`, `PosuvSpecInput` ho automaticky ZDEDÍ (mapovaný typ nad `keyof
 * PosuvSpec`, nič sa nekopíruje ručne) a TypeScript odmietne skompilovať OBIDVA
 * volajúce miesta (`compute()` aj `computeMultiFrom()` v +page.server.ts) naraz,
 * kým pole nedostanú OBE — nie len jedno, ako sa stalo so `sietka` (PR #108: 2 z 9
 * e2e testov padali, kým sa nedoplnilo).
 *
 * Prvá verzia tohto typu (code review #109) bola ručne písaná zrkadlová definícia
 * (rovnaké polia ako `PosuvSpec`, prepísané druhýkrát). Nezávislý review izolovaným
 * `tsc --strict` repro dokázal, že táto verzia mala rovnaký únik o úroveň vyššie:
 * pridané pole do `PosuvSpec` bez ručného doplnenia do ručne písaného
 * `PosuvSpecInput` by ticho skompilovalo (`{...input}` je stále priraditeľné, lebo
 * nové pole je v `PosuvSpec` voliteľné). Mapovaný typ nižšie toto zatvára
 * ŠTRUKTÚRNE (žiadny ručný zoznam polí na údržbu), nie disciplínou autora.
 *
 * Vedome NIE je `extra?: {...}` voliteľný druhý parameter — to by dovolilo jednému
 * volajúcemu ho celý vynechať a ticho skompilovať, čo je presne ten istý únik.
 */
export type PosuvSpecInput = { [K in PosuvSpecRequiredKeys]: PosuvSpec[K] } & {
	[K in PosuvSpecOptionalKeys]-?: PosuvSpec[K] | undefined;
};

/**
 * JEDINÝ zdroj pravdy pre skladanie `PosuvSpec` — volaný z `compute()` AJ
 * `computeMultiFrom()` (viď #109). Sám osebe je triviálny (`{...input}`); hodnota
 * je v type-checku `PosuvSpecInput` (pozri komentár tam), nie v tele funkcie.
 */
export function buildPosuvSpec(input: PosuvSpecInput): PosuvSpec {
	return { ...input };
}

export interface PosuvInfo {
	system: string;
	styl: string;
	S: number;
	V: number;
	N: number;
	m2: number;
	sklo: { sirka: number; vyska: number; pocet: number };
	otvaranie?: string;
	skloNazov?: string;
	kovanieL?: string;
	kovanieP?: string;
	kovanieStred?: string;
	kovanieStredOkno?: 'L' | 'P';
	/** klíny nad posuvom (#472 viac RÔZNYCH naraz) */
	kliny?: Klin[];
	/** ručne zadané dĺžky koľajníc tohto posuvu — na plán/tlač (výpočet ich už použil) */
	kolajnica?: KolajnicaRucne | null;
	/** sieťka tohto posuvu (#86–#90) — na plán/tlač, do Money odpisu NEJDE */
	sietka?: Sietka | null;
}

export interface MultiResult {
	posuvy: PosuvInfo[];
	/** materiál ZLÚČENÝ naprieč posuvmi (zdieľané tyče) — kusy nesú `posuv` */
	material: MaterialRow[];
	odpis: OdpisRow[];
	/** súčet plôch všetkých posuvov */
	m2: number;
}

/**
 * Nárezový plán pre VIAC posuvov naraz. Rezy toho istého profilu (podľa kódu) sa
 * spoja naprieč VŠETKÝMI posuvmi do jedného FFD balenia → zdieľané tyče → menej
 * odpadu a menší odpis do Money než keby sa každý posuv balil samostatne. Každý
 * kus si nesie svoje číslo posuvu (pre rozpis). Sklo sa počíta per-posuv.
 * Pre jeden posuv dáva IDENTICKÝ odpis/tyče ako computeFlat (overené testom).
 */
export function computeMulti(cfg: Cfg, posuvy: PosuvSpec[]): MultiResult | null {
	if (!posuvy.length) return null;
	const infos: PosuvInfo[] = [];
	const order: string[] = [];
	const pool: Record<
		string,
		{
			nazov: string;
			rezy: { rozmer: number; ks: number }[];
			kusy: Kus[];
			barLen: number;
			sikmyRez: boolean;
		}
	> = {};
	for (const [i, p] of posuvy.entries()) {
		const g = cfg[p.sysStyl];
		if (!g || !g.rez.length || !g.sklo.s || !g.sklo.v) return null;
		const N = g.N;
		const system = p.sysStyl.split('|')[0] ?? '';
		const styl = p.sysStyl.split('|')[1] ?? '';
		const sietkaOn = jeSietkaMoneyRelevant(system, styl, p.sietka);
		// INVARIANT: spájanie profilov po kóde na jednu tyč je bezpečné len ak KAŽDÝ
		// výskyt daného kódu (aj naprieč systémami) používa ROVNAKÚ dĺžku tyče.
		// Štandard + zdieľa 5 spodných koľajníc s Deluxe (ZASP00104/00030/00033/
		// 202432/202437), vždy s rovnakou barLen (7500), takže odpis ostáva správny.
		// Ak by konfigurácia niekedy dala ten istý kód dvom systémom s INOU dĺžkou
		// tyče, toto treba prehodnotiť. Pozn.: príznak sikmyRez pooled riadku sa
		// preberá z PRVÉHO posuvu — pri zmiešanej Deluxe+Štandard+ zákazke to môže
		// zle označiť uhol rezu iba v KRESBE (odpis nie je dotknutý).
		// sieťka Štandard/Štandard+ (#110) a Slide (#90) — rovnaká delta ako
		// computeFlat (`sietkaChyba` v `safeComputeMulti` validuje VOPRED).
		const extra = sietkaOn
			? system === 'Slide'
				? sietkaSlideExtra(cfg, styl, p.S, p.V, N)
				: maSietkaSystemVyber(system)
					? sietkaStandardExtra(cfg, system, styl, p.sietka, p.S, p.V, N)
					: { rezy: [], err: null }
			: { rezy: [], err: null };
		const cuts = mergeExtraCuts(
			profilCuts(
				g,
				p.S,
				p.V,
				N,
				p.redukciaZero,
				p.skloHrubka ?? 0,
				i + 1,
				p.kolajnica,
				sietkaOn,
				system
			),
			extra.err ? [] : extra.rezy,
			i + 1
		);
		for (const c of cuts) {
			// prídavná koľajnica: koľajnica o 1 väčšia (#456) — swap
			// PRED poolovaním, aby sa metre pooli pod správnym (väčším) kódom.
			const up = railUpsize(system, styl, p.pridavnaKolajnica ?? false, c.kod, c.nazov);
			// sieťka na 2K: celá koľajnica sa mení na 3K variant (#87) — swap PRED
			// poolovaním z rovnakého dôvodu ako railUpsize vyššie.
			const sk = sietkaKolajnicaSwap(cfg, system, styl, sietkaOn, up.kod, up.nazov);
			let bucket = pool[sk.kod];
			if (!bucket) {
				bucket = {
					nazov: sk.nazov,
					rezy: [],
					kusy: [],
					barLen: c.barLen,
					sikmyRez: !systemRovnyRez(system) && jeSikmyRez(c.nazov)
				};
				pool[sk.kod] = bucket;
				order.push(sk.kod);
			}
			bucket.kusy.push(...c.kusy);
			for (const rz of c.rezy) {
				const ex = bucket.rezy.find((x) => x.rozmer === rz.rozmer);
				if (ex) ex.ks += rz.ks;
				else bucket.rezy.push({ ...rz });
			}
		}
		const ss = g.sklo.s,
			sv = g.sklo.v;
		infos.push({
			system,
			styl,
			S: p.S,
			V: p.V,
			N,
			m2: R((p.S * p.V) / 1e6),
			sklo: {
				// #440: per-sklo override korekcie (NULL/undefined → systémový skloOffset).
				sirka: Math.round(val(ss, p.S, p.V, N, true) - (p.skloKorekcia ?? g.skloOffset)),
				vyska: Math.round(val(sv, p.S, p.V, N, true) - (p.skloKorekcia ?? g.skloOffset)),
				pocet: N
			},
			otvaranie: p.otvaranie,
			skloNazov: p.sklo,
			kovanieL: p.kovanieL,
			kovanieP: p.kovanieP,
			kovanieStred: p.kovanieStred,
			kovanieStredOkno: p.kovanieStredOkno,
			kliny: p.kliny ?? [],
			kolajnica: p.kolajnica ?? null,
			sietka: p.sietka ?? null
		});
	}
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const kod of order) {
		// INVARIANT: `order` obsahuje len kódy vložené SPOLU s `pool[kod]` vyššie
		// (order.push(sk.kod) je hneď po pool[sk.kod] = bucket), a nič sa z pool nemaže.
		const pk = pool[kod]!;
		const bary = ffdPack(pk.kusy, pk.barLen);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * pk.barLen)) * 1000) / 10 : 0;
		pk.rezy.sort((a, b) => b.rozmer - a.rozmer);
		material.push({
			kod,
			nazov: pk.nazov,
			rezy: pk.rezy,
			tyce,
			bary,
			odpadMm,
			odpadPct,
			barLen: pk.barLen,
			sikmyRez: pk.sikmyRez
		});
		odpis.push({ kod, nazov: pk.nazov, metre: R((tyce * pk.barLen) / 1000) });
	}
	return { posuvy: infos, material, odpis, m2: R(infos.reduce((s, x) => s + x.m2, 0)) };
}

export function safeComputeMulti(
	cfg: Cfg,
	posuvy: PosuvSpec[]
): { r: MultiResult | null; err: string | null } {
	if (!posuvy.length) return { r: null, err: 'Zadaj aspoň jeden posuv.' };
	for (const [i, p] of posuvy.entries()) {
		if (!validSys(cfg, p.sysStyl))
			return { r: null, err: `Posuv ${i + 1}: konfigurácia systému je neúplná alebo chybná.` };
		const boundErr = inBounds(cfg, p.sysStyl);
		if (boundErr)
			return { r: null, err: `Posuv ${i + 1}: konfigurácia mimo rozsahov — ${boundErr}` };
		const hrubkaErr = missingHrubkaProfile(cfg, p.sysStyl, p.skloHrubka ?? 0);
		if (hrubkaErr) return { r: null, err: `Posuv ${i + 1}: ${hrubkaErr}` };
		const overErr = oversizeCut(
			cfg,
			p.sysStyl,
			p.S,
			p.V,
			p.redukciaZero,
			p.skloHrubka ?? 0,
			p.kolajnica
		);
		if (overErr) return { r: null, err: `Posuv ${i + 1}: ${overErr}` };
		const underErr = undersizeCut(
			cfg,
			p.sysStyl,
			p.S,
			p.V,
			p.redukciaZero,
			p.skloHrubka ?? 0,
			p.kolajnica,
			!!p.sietka,
			p.skloKorekcia ?? null
		);
		if (underErr) return { r: null, err: `Posuv ${i + 1}: ${underErr}` };
		const g = cfg[p.sysStyl];
		const sietkaErr = g
			? sietkaChyba(
					cfg,
					p.sysStyl.split('|')[0] ?? '',
					p.sysStyl.split('|')[1] ?? '',
					p.sietka,
					p.S,
					p.V,
					g.N
				)
			: null;
		if (sietkaErr) return { r: null, err: `Posuv ${i + 1}: ${sietkaErr}` };
	}
	const r = computeMulti(cfg, posuvy);
	if (!r || !r.odpis.length || !r.odpis.every((o) => Number.isFinite(o.metre) && o.metre >= 0))
		return { r: null, err: 'Výpočet zlyhal — skontroluj konfiguráciu vzorcov.' };
	return { r, err: null };
}
