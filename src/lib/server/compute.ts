// Zasklenia — výpočet nárezového plánu a odpisu do Money.
// Port 1:1 z n8n verzie (n8n/zasklenia/zasklenia_node_body_v2.js), overenej proti
// pôvodným odpisovým Excelom (robust_slide.xlsm). Čísla sa NESMÚ zmeniť bez
// zmeny testovacích vektorov v tests/compute.test.ts.
import { jeSikmyRez, systemRovnyRez } from '$lib/cut';
import type { Klin } from '$lib/klin';
import { rolaKolajnice, type KolajnicaRucne } from '$lib/kolajnica';
import type { ZakladPoctov } from '$lib/komponenty';
import {
	maSietkaSystem,
	maSietkaSystemVyber,
	potrebuje3KKolajnicu,
	type Sietka
} from '$lib/sietka';

export interface SysRow {
	sysStyl: string;
	N: number;
	skloOffset: number;
}

export interface RezRow {
	sysStyl: string;
	poradie: number;
	typ: 'profil' | 'sklo';
	kod: string;
	nazov: string;
	dim: 'S' | 'V';
	koef: number;
	offset: number;
	delitN: 0 | 1;
	kerf: number;
	pocetKs: number;
	sklozavisle: 0 | 1;
	/** dĺžka tyče (mm) tohto profilu — určuje balenie AJ odpis do Money. Chýba/0
	 *  ⇒ default BAR (7500). Deluxe má profily s inou dĺžkou (kladka/klzný 3600,
	 *  5K horná koľajnica 6000) — Robust/Slide ostávajú na 7500. */
	dlzkaTyce?: number;
	/** hrúbka skla (mm), pre ktorú tento riadok platí: 0 = vždy; 6/10 = len keď je
	 *  zvolené 6mm/10mm sklo. Deluxe: kladka/klzný má dva riadky (6mm ZASP202416/424,
	 *  10mm ZASP202417/425) a sklo vyberá ten správny. Robust/Slide = 0 (vždy). */
	skloHrubka?: number;
}

export interface CfgGroup {
	N: number;
	skloOffset: number;
	rez: RezRow[];
	sklo: { s?: RezRow; v?: RezRow };
}

export type Cfg = Record<string, CfgGroup>;

export interface Kus {
	/** finálna dĺžka rezu (zobrazená robotníkovi, s prerezom) */
	rozmer: number;
	/** dĺžka spotrebovaná na tyči (bez prerezu — podľa nej sa balí) */
	dlzka: number;
	/** z ktorého posuvu kus pochádza (1-based) — len pri viac-posuvovom pláne */
	posuv?: number;
}

export interface Tyc {
	kusy: Kus[];
	/** odpad na konci tejto tyče (mm) */
	zvysok: number;
}

export interface MaterialRow {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	tyce: number;
	/** rozloženie kusov na jednotlivé tyče (pre grafický rozpis rezov) */
	bary: Tyc[];
	/** celkový odpad (mm) a % z použitých tyčí */
	odpadMm: number;
	odpadPct: number;
	/** dĺžka tyče tohto profilu (mm) — pre grafický rozpis (mierka, hlavička) */
	barLen: number;
	/** true = rez 45° (šikmý), false = rovný 90°. Deluxe + Štandard + = všetko 90°
	 *  (Zbynek / Dominik+Marek); Robust/Slide = 90° len nosový/oponový, zvyšok 45°
	 *  (podľa názvu profilu). Uhol je len na nákrese — Money odpis nemení. */
	sikmyRez: boolean;
}

export interface OdpisRow {
	kod: string;
	nazov: string;
	metre: number;
}

export interface ComputeResult {
	system: string;
	styl: string;
	S: number;
	V: number;
	N: number;
	m2: number;
	material: MaterialRow[];
	odpis: OdpisRow[];
	sklo: { sirka: number; vyska: number; pocet: number };
}

export const BAR = 7500;
/** hrúbka rezu pílového kotúča — každý rez na tyči odoberie tento materiál */
export const KOTUC = 4;
// pravidlo uhla rezu (nosový/oponový = rovný 90°) žije v client-safe $lib/cut.ts,
// aby ho mohol importovať aj klientský komponent RozpisRezov (server modul nesmie do klienta)

const R = (x: number) => Math.round(x * 1000) / 1000;

export function buildCFG(sysRows: SysRow[], rezRows: RezRow[]): Cfg {
	const cfg: Cfg = {};
	for (const s of sysRows) {
		if (!s || !s.sysStyl) continue;
		cfg[s.sysStyl] = { N: Number(s.N), skloOffset: Number(s.skloOffset), rez: [], sklo: {} };
	}
	for (const r of rezRows) {
		if (!r || !r.sysStyl) continue;
		const g = cfg[r.sysStyl];
		if (!g) continue;
		if (r.typ === 'sklo') g.sklo[r.dim === 'S' ? 's' : 'v'] = r;
		else g.rez.push(r);
	}
	for (const k in cfg) cfg[k].rez.sort((a, b) => Number(a.poradie) - Number(b.poradie));
	return cfg;
}

function val(row: RezRow, S: number, V: number, N: number, useKerf: boolean): number {
	const DIM = row.dim === 'S' ? S : V;
	let x = Number(row.koef) * DIM + Number(row.offset) - (useKerf ? Number(row.kerf) : 0);
	if (Number(row.delitN)) x /= N;
	return x;
}

/**
 * Reálne balenie kusov do tyčí — First-Fit-Decreasing. Mieša rôzne dĺžky
 * rezov toho istého profilu na jednu tyč (napr. 2530+2530+2000 z jednej 7500),
 * ako sa reálne reže. Nahrádza pôvodný súčet-po-dĺžkach, ktorý každú dĺžku
 * počítal na samostatnú tyč a preto nadhodnocoval počet tyčí (a odpis do Money).
 */
/** FFD balenie so sledovaním, ktorý kus je na ktorej tyči (pre grafický rozpis).
 *  Každý kus rezervuje svoju dĺžku + hrúbku kotúča (KOTUC) — reálny rez odoberie
 *  4 mm. zvysok = skutočný odpad (offcut) po odrátaní kusov aj rezov. */
function ffdPack(kusy: Kus[], barLen: number = BAR): Tyc[] {
	const bary: Tyc[] = [];
	const rem: number[] = [];
	for (const k of [...kusy].sort((a, b) => b.dlzka - a.dlzka)) {
		const need = k.dlzka + KOTUC;
		let i = 0;
		for (; i < rem.length; i++) if (rem[i] >= need) break;
		if (i === rem.length) {
			bary.push({ kusy: [k], zvysok: barLen - need });
			rem.push(barLen - need);
		} else {
			bary[i].kusy.push(k);
			rem[i] -= need;
			bary[i].zvysok = rem[i];
		}
	}
	// v každej tyči zoraď kusy od najdlhšieho (ako v optimalizačnom výstupe)
	for (const b of bary) b.kusy.sort((a, c) => c.dlzka - a.dlzka);
	return bary;
}

/** Rezy jedného profilu (naprieč rez-riadkami S aj V) pre jeden posuv — BEZ
 *  balenia. `posuv` (1-based) sa vloží do každého kusu, aby ho vedel rozpis
 *  označiť pri viac-posuvovom pláne. Zdieľané computeFlat aj computeMulti. */
interface ProfilCuts {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	kusy: Kus[];
	/** dĺžka tyče tohto profilu (mm) — z RezRow.dlzkaTyce, default BAR */
	barLen: number;
}

// ---- Sieťka (moskytiéra) — Money korekcia 2026-08-02 (#86 komentár, Patrik Odoo 207) ----
//
// Sieťka = ĎALŠIE krídlo toho istého posuvu, „úplne rovnaký rozmer ako každé iné okno
// v tom posuve" (Patrik). Namiesto vymýšľania novej dĺžky rezu preto len ZVÝŠIME počet
// kusov (`pocetKs`) existujúceho rámového/nosového RezRow — dĺžka rezu ostáva presne
// tá istá hodnota, akú `val()` už počíta pre bežné krídlo toho istého sysStyl (S/V/N sa
// nemenia). Patrikovo číslo priamo (msg #1614827, 2026-08-02): „(robust) 2 a 2 rám a
// 1x nos" — 3K bez sieťky rám „6 a 6" → so sieťkou „8 a 8". Nos je PEVNÝCH +1 (nie +2,
// hoci všeobecný vzorec 2×(N−1) by pre N→N+1 dal +2) — Patrik to zopakoval dvakrát
// explicitne, fyzicky to sedí s jeho poznámkou, že Slide má na strane sieťky úplne INÝ
// profil miesto zužovacieho (teda tá strana škáry nepoužíva rovnaký zosilnený nosový
// profil ako škára medzi dvoma sklenými krídlami — #90, riešené nižšie `sietkaSlideExtra`).
const JE_RAMOVY_PROFIL = /^R[áa]mov/i;
const JE_NOSOVY_PROFIL = /^Nosov/i;

/** Sieťka mení Money odpis na Robust/Slide/Štandard/Štandard + a len na JEDNOM
 *  súvislom behu krídel (nie oponové 2x* štýly — Patrikov popis aj
 *  `sietkaStrana('Opona')===null` platia len pre jeden riadok krídel). Opona ostáva
 *  presne v stave PR #104 (display-only). */
export function jeSietkaMoneyRelevant(
	system: string,
	styl: string,
	sietka: Sietka | null | undefined
): boolean {
	return !!sietka && maSietkaSystem(system) && !styl.startsWith('2x');
}

/** +2 rámové rezy (S aj V), +1 nosový rez (V) — PEVNÁ delta na jednu sieťku, nezávislá
 *  od N (viď komentár vyššie prečo nie odvodený všeobecný vzorec). LEN Robust/Slide —
 *  Štandard/Štandard + majú VLASTNÝ mechanizmus (`sietkaStandardExtra` nižšie), lebo
 *  tento generický regex na predponu mena by na Štandarde kolidoval („Rámový profil"
 *  krajová vs „Rámový profil stredový" nos — rovnaká predpona, INÁ delta) a nevie
 *  pridať riadok s cudzím kódom (cross-systémová sieťka, #110). */
function sietkaExtraPocetKs(system: string, r: RezRow, sietkaOn: boolean): number {
	if (!sietkaOn) return 0;
	if (system !== 'Robust' && system !== 'Slide') return 0;
	if (JE_RAMOVY_PROFIL.test(r.nazov)) return 2;
	if (JE_NOSOVY_PROFIL.test(r.nazov)) return 1;
	return 0;
}

// ---- Sieťka: Štandard / Štandard + (#110) a Slide redukcia (#90) — 2026-08-03 ----
//
// Štandard/Štandard+ NEVEDIA zdieľať `sietkaExtraPocetKs` s Robust/Slide (dôvod v
// komentári vyššie). Preto explicitná tabuľka rolí, jeden riadok na rolu — overené
// proti VŠETKÝM štýlom oboch systémov (2K–6K + IZO, cfg_seed.json), žiadna kolízia.
// „Rozširujúci profil" (IZO rozšírenie rámu, len pri „…IZO" štýloch) do tabuľky
// VEDOME nepatrí — Patrik (#1616281): „Len ak pôjde IZO sklo tak sieťka ide bez
// rozširujúceho profilu". Keďže žiadna rola sem nesedí, IZO sieťka ho automaticky
// nedostane — bez extra vetvy, „zadarmo" z presnosti regexov.
const STANDARD_ROLY: Record<
	string,
	{ sirka: RegExp; krajova: RegExp; nos: RegExp; doraz: RegExp }
> = {
	Štandard: {
		sirka: /^Kladkový profil/i,
		krajova: /^Rámový profil(?! stredový)/i,
		nos: /^Rámový profil stredový/i,
		doraz: /^Dorazový profil/i
	},
	'Štandard +': {
		sirka: /^Kladkový profil/i,
		krajova: /^Koncový profil \(PLUS\)/i,
		nos: /^Rámový profil stredový/i,
		doraz: /^Dorazová lišta/i
	}
};

/** Jeden riadok profilu navyše (kus so svojou dĺžkou) — vstup pre `mergeExtraCuts`. */
export interface ExtraRez {
	kod: string;
	nazov: string;
	barLen: number;
	rozmer: number;
	dlzka: number;
	ks: number;
}

function najdiRolu(g: CfgGroup, re: RegExp): RezRow | undefined {
	return g.rez.find((r) => r.typ === 'profil' && re.test(r.nazov));
}

/**
 * Sieťka na Štandarde/Štandard+ (#110) — 4 riadky navyše (šírka prírezov ×2,
 * krajová ×1, nos ×1, dorazová ×1), ALEBO chyba, keď zvolená kombinácia systém
 * posuvu × systém sieťky × štýl nemá potrebné riadky (starý Štandard existuje
 * len do 4K, Štandard + má aj 5K/6K — #110 nešpecifikuje, appka to nehádže,
 * vráti presnú chybu).
 *
 * Krajová/dorazová/nos sa čerpajú zo SYSTÉMU SIEŤKY (jeho VLASTNÝ kód — to je
 * celý zmysel výberu #110, napr. starý „Rámový profil"/„Dorazový profil" na
 * plus posuve). Šírka prírezov sa číta z POSUVU (kód ZASP202415 je zdieľaný
 * oboma systémami) a keď je sieťka INÉHO systému než posuv, pripočíta sa
 * Patrikova PEVNÁ konštanta ±16,5 mm (#1616282/#1616285) — jeho DOSLOVNÉ číslo,
 * nie prepočet vzorcom cudzieho systému (ten by dal iné číslo — overené ručne:
 * (3000−143)/3 = 952,33 mm, nie 942,5+16,5 = 959 mm, ktoré uviedol on).
 * Smer „starý sieťka na plus posuve" (+16,5) je doslovne potvrdený; opačný smer
 * „plus sieťka na starom posuve" (−16,5) je SYMETRICKÝ, zatiaľ NEPOTVRDENÝ
 * (pozri #110 „Otvorené" — treba dať Patrikovi potvrdiť pred reálnou zákazkou).
 */
export function sietkaStandardExtra(
	cfg: Cfg,
	posuvSystem: string,
	styl: string,
	sietka: Sietka | null | undefined,
	S: number,
	V: number,
	N: number
): { rezy: ExtraRez[]; err: string | null } {
	if (!maSietkaSystemVyber(posuvSystem) || !sietka) return { rezy: [], err: null };
	const sietkaSystem = sietka.system && sietka.system !== posuvSystem ? sietka.system : posuvSystem;
	const roly = STANDARD_ROLY[sietkaSystem];
	if (!roly) return { rezy: [], err: `Neznámy systém sieťky „${sietkaSystem}".` };
	const posuvGroup = cfg[`${posuvSystem}|${styl}`];
	const sietkaGroup = cfg[`${sietkaSystem}|${styl}`];
	if (!posuvGroup) return { rezy: [], err: 'Konfigurácia posuvu chýba.' };
	if (!sietkaGroup)
		return {
			rezy: [],
			err: `Sieťka systému „${sietkaSystem}" nie je pre štýl ${styl} k dispozícii (tento systém tento štýl nemá).`
		};
	const sirkaRow = najdiRolu(posuvGroup, STANDARD_ROLY[posuvSystem].sirka);
	const krajovaRow = najdiRolu(sietkaGroup, roly.krajova);
	const nosRow = najdiRolu(sietkaGroup, roly.nos);
	const dorazRow = najdiRolu(sietkaGroup, roly.doraz);
	if (!sirkaRow || !krajovaRow || !nosRow || !dorazRow)
		return {
			rezy: [],
			err: 'Konfigurácia sieťky nemá všetky potrebné profily (šírka/krajová/nos/dorazová).'
		};
	const sirkaDelta = sietkaSystem === posuvSystem ? 0 : sietkaSystem === 'Štandard' ? 16.5 : -16.5;
	// delta sa pripočíta PRED zaokrúhlením (nie na už zaokrúhlené číslo) — inak by
	// 942,5 + 16,5 dalo 943 + 16,5 = 959,5 namiesto Patrikovho doslovného 959
	// (#1616282/#1616285: 942,5 + 16,5 = 959).
	const kus = (r: RezRow, ks: number, delta = 0): ExtraRez => ({
		kod: r.kod,
		nazov: r.nazov,
		barLen: Number(r.dlzkaTyce) || BAR,
		rozmer: Math.round(val(r, S, V, N, true) + delta),
		dlzka: val(r, S, V, N, false) + delta,
		ks
	});
	return {
		rezy: [kus(sirkaRow, 2, sirkaDelta), kus(krajovaRow, 1), kus(nosRow, 1), kus(dorazRow, 1)],
		err: null
	};
}

/**
 * Sieťka na Slide (#90) — vlastný redukčný profil MIESTO zužovacieho pri 6mm skle
 * (Patrik #1614827: „sa vkladá ten sieťkový profil miesto zúžovacieho"). Kód
 * potvrdil priamo (#1614895 „Redukcia pre sieťku Surový 7500 mm - ZASP20252"),
 * overené aj v Money SQL (Sklady_Zasoba, read-only, 2026-08-03) — karta existuje,
 * nezmazaná.
 *
 * Počet kusov/dĺžka NIE sú Patrikovým doslovným číslom — ODVODENÉ z existujúceho
 * „Redukcia 6mm" riadku (ZASP00091, ten istý štýl): jedno okno navyše = rovnaký
 * vzorec ako každé bežné okno (2 ks S-smer + 2 ks V-smer), len s novým kódom.
 * NEZÁVISLE od `redukciaZero` (vlastnosť ZVOLENÉHO SKLA — sieťovina nie je sklo,
 * ide vždy, keď je sieťka na Slide zapnutá, nech je hrúbka skla akákoľvek). Ak sa
 * toto odvodenie ukáže nesprávne, treba ho opraviť PRED prvou reálnou objednávkou
 * (pozri komentár na #90).
 */
const SLIDE_SIETKA_REDUKCIA = { kod: 'ZASP20252', nazov: 'Redukcia pre sieťku Surový 7500 mm' };
export function sietkaSlideExtra(
	cfg: Cfg,
	styl: string,
	S: number,
	V: number,
	N: number
): { rezy: ExtraRez[]; err: string | null } {
	const g = cfg[`Slide|${styl}`];
	if (!g) return { rezy: [], err: 'Konfigurácia Slide chýba.' };
	const redukcia = g.rez.filter((r) => r.typ === 'profil' && /^Redukcia 6mm/i.test(r.nazov));
	const sRow = redukcia.find((r) => r.dim === 'S');
	const vRow = redukcia.find((r) => r.dim === 'V');
	if (!sRow || !vRow)
		return {
			rezy: [],
			err: 'Slide nemá pre tento štýl vzorec redukcie na odvodenie sieťkovej redukcie.'
		};
	const kus = (r: RezRow, ks: number): ExtraRez => ({
		kod: SLIDE_SIETKA_REDUKCIA.kod,
		nazov: SLIDE_SIETKA_REDUKCIA.nazov,
		barLen: Number(r.dlzkaTyce) || BAR,
		rozmer: Math.round(val(r, S, V, N, true)),
		dlzka: val(r, S, V, N, false),
		ks
	});
	return { rezy: [kus(sRow, 2), kus(vRow, 2)], err: null };
}

/** Kus z riadku navyše dlhší než jeho tyč — ten istý guard ako `oversizeCut`, ale
 *  pre `ExtraRez[]` (sieťková delta). Väčšina extra kusov má IDENTICKÚ dĺžku ako
 *  existujúci riadok toho istého systému, ktorý `oversizeCut` už overil — GAP je
 *  cross-systémová šírka prírezov (#110), kde sa k základnej dĺžke pripočíta
 *  Patrikova ±16,5 mm konštanta a mohla by (tesne pri hranici tyče) preklopiť
 *  kus, ktorý bez delty ešte sedel, na kus, ktorý sa už nezmestí. */
function extraOversizeErr(extra: ExtraRez[]): string | null {
	for (const e of extra) {
		if (e.dlzka + KOTUC > e.barLen)
			return `Rez ${Math.round(e.rozmer)} mm (${e.nazov}) je dlhší než tyč ${e.barLen} mm — tento rozmer sa z daného profilu nedá vyrobiť. Zmenši rozmer alebo zvoľ iný systém.`;
	}
	return null;
}

/** Predbežná validácia sieťkovej delty (#110/#90) — rovnaká vrstva ako
 *  `missingHrubkaProfile`/`oversizeCut`: nech `safeCompute`/`safeComputeMulti`
 *  vráti PRESNÚ chybu namiesto všeobecného „výpočet zlyhal", keď zvolená
 *  kombinácia sieťky nie je k dispozícii (napr. sieťka „Štandard" na 5K/6K
 *  Štandard + posuve — starý Štandard existuje len do 4K) ALEBO by dala kus
 *  dlhší než jeho tyč. */
export function sietkaChyba(
	cfg: Cfg,
	system: string,
	styl: string,
	sietka: Sietka | null | undefined,
	S: number,
	V: number,
	N: number
): string | null {
	if (!jeSietkaMoneyRelevant(system, styl, sietka)) return null;
	if (system === 'Slide') {
		const { rezy, err } = sietkaSlideExtra(cfg, styl, S, V, N);
		return err ?? extraOversizeErr(rezy);
	}
	if (maSietkaSystemVyber(system)) {
		const { rezy, err } = sietkaStandardExtra(cfg, system, styl, sietka, S, V, N);
		return err ?? extraOversizeErr(rezy);
	}
	return null;
}

/** Zlúči zoznam riadkov navyše (`ExtraRez`) do existujúceho `ProfilCuts[]` PRED
 *  balením (`ffdPack`) — spoločné miesto pre `computeFlat` aj `computeMulti`, aby
 *  oba dali identický odpis. Rovnaký kód → pripočíta sa do existujúceho riadku
 *  (rovnaký `rozmer` → zlúči sa do JEDNÉHO `rezy` riadku — presne ako Patrikov
 *  nárezák ukazuje „8 ks", nie „6 ks" + „2 ks" osobitne; iný `rozmer`, napr.
 *  cross-systémová šírka prírezov s ±16,5 mm, ostáva vlastný riadok). Cudzí kód
 *  (cross-systémová sieťka #110) → pridá sa nový riadok. Vracia NOVÝ zoznam,
 *  pôvodný nemutuje. */
function mergeExtraCuts(cuts: ProfilCuts[], extra: ExtraRez[], posuv?: number): ProfilCuts[] {
	if (!extra.length) return cuts;
	const byKod = new Map<string, ProfilCuts>();
	const order: string[] = [];
	for (const c of cuts) {
		byKod.set(c.kod, { ...c, rezy: [...c.rezy], kusy: [...c.kusy] });
		order.push(c.kod);
	}
	for (const e of extra) {
		if (!byKod.has(e.kod)) {
			byKod.set(e.kod, { kod: e.kod, nazov: e.nazov, rezy: [], kusy: [], barLen: e.barLen });
			order.push(e.kod);
		}
		const c = byKod.get(e.kod)!;
		const existujuci = c.rezy.find((rz) => rz.rozmer === e.rozmer);
		if (existujuci) existujuci.ks += e.ks;
		else c.rezy.push({ rozmer: e.rozmer, ks: e.ks });
		for (let i = 0; i < e.ks; i++)
			c.kusy.push(
				posuv ? { dlzka: e.dlzka, rozmer: e.rozmer, posuv } : { dlzka: e.dlzka, rozmer: e.rozmer }
			);
	}
	return order.map((k) => byKod.get(k)!);
}

/**
 * 2K posuv so sieťkou nemá voľnú koľaj pre 4. krídlo — „musí sa meniť celý rám čiže
 * spodná horná a prava ľava koľajnica" (Patrik #1614827 bod 5) na 3K variant. Robust aj
 * Slide majú JEDNU obvodovú koľajnicu (`rolaKolajnice` vráti `null` — žiadne rozdelenie
 * horná/spodná), takže „celý rám" = jeden Money kód. 2K aj 3K koľajnica majú TOTOŽNÝ
 * vzorec dĺžky (koef=1, offset=0, delitN=0 — over v cfg_seed.json), takže sa mení LEN
 * kód/názov karty — dĺžka rezu ostáva rovnaká (rovnaký vzor ako `railUpsize` vyššie, pre
 * iný profil a iný gate). 3K kód/názov sa berie ŽIVO z `cfg`, nikdy natvrdo.
 */
export function sietkaKolajnicaSwap(
	cfg: Cfg,
	system: string,
	styl: string,
	sietkaOn: boolean,
	kod: string,
	nazov: string
): { kod: string; nazov: string } {
	if (!sietkaOn || styl !== '2K') return { kod, nazov };
	if (!/^Koľajnica\b/i.test(nazov) || rolaKolajnice(nazov)) return { kod, nazov };
	const g3k = cfg[`${system}|3K`];
	const row = g3k?.rez.find(
		(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov) && !rolaKolajnice(r.nazov)
	);
	return row ? { kod: row.kod, nazov: row.nazov } : { kod, nazov };
}

export interface SietkaSamostatnaMaterialRow {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	tyce: number;
}

export interface SietkaSamostatnaOdpis {
	system: string;
	styl: string;
	N: number;
	/** rozmer skla bežného krídla toho posuvu — sieťka má rovnaký rozmer (Patrik) */
	sklo: { sirka: number; vyska: number };
	/** rozmer SIEŤOVINY (látky) na objednávku u iného dodávateľa — do Money nejde,
	 *  len na tlač (Patrik: sklo +2mm šírka / +1mm výška, foto z nárezáka #1614828) */
	rozmerSietoviny: { sirka: number; vyska: number };
	material: SietkaSamostatnaMaterialRow[];
	odpis: OdpisRow[];
	potrebuje3K: boolean;
}

/**
 * Dodatočná sieťka BEZ posuvu (#89, „90 % prípadov" — Patrik 2026-08-02): zadá sa
 * rozmer POSUVU (systém+štýl+S+V), appka vypočíta krídlo TEJ ISTEJ veľkosti ako
 * ostatné krídla toho posuvu (rovnaké `val()` vzorce ako `profilCuts`) a odpíše
 * presne Patrikovu deltu — +2 rámové rezy (S aj V) + 1 nosový rez, a pri 2K aj
 * 3K koľajnicu (2 ks + 2 ks, borrow zo `cfg[system+'|3K']`, rovnaký princíp ako
 * `sietkaKolajnicaSwap`).
 *
 * ZÁMERNE NIE diff dvoch `computeFlat` volaní (s sieťkou / bez nej): dodatočná
 * sieťka je SAMOSTATNÁ objednávka, ktorú dielňa reže týždne po pôvodnom posuve —
 * nezdieľa tyče s materiálom, ktorý už bol narezaný a odpísaný pri pôvodnej
 * objednávke (ten je dávno preč zo skladu). Kusy sa preto balia SAMOSTATNE, ako
 * vlastná čerstvá dodávka — diff by v prípadoch, keď sa extra kus „zmestí" do
 * hypotetického zdieľaného zvyšku, PODHODNOTIL odpis (reálne sa kupuje celá nová
 * tyč, nie zlomok zdieľaného zvyšku, ktorý fyzicky neexistuje).
 */
export function sietkaSamostatnaVypocet(
	cfg: Cfg,
	system: string,
	styl: string,
	S: number,
	V: number
): { r: SietkaSamostatnaOdpis | null; err: string | null } {
	// opona (2x*) — rovnaký gate ako `jeSietkaMoneyRelevant` pre in-posuv sieťku:
	// Patrikov popis aj strana sieťky (`sietkaStrana('Opona')===null`) platia len
	// pre jeden súvislý beh krídel. Bez tohto gate by appka napísala Money odpis
	// pre scenár (ktorá strana opony?), ktorý Patrik nikdy nepotvrdil.
	if (styl.startsWith('2x'))
		return { r: null, err: 'Sieťka pre oponové (2x) štýly zatiaľ nie je podporovaná.' };
	const sysStyl = `${system}|${styl}`;
	if (!validSys(cfg, sysStyl)) return { r: null, err: 'Neznámy systém/štýl.' };
	const boundErr = inBounds(cfg, sysStyl);
	if (boundErr) return { r: null, err: 'Konfigurácia mimo povolených rozsahov: ' + boundErr };
	const overErr = oversizeCut(cfg, sysStyl, S, V, false, 0);
	if (overErr) return { r: null, err: overErr };
	const g = cfg[sysStyl];
	const N = g.N;
	const ram = g.rez.filter((r) => r.typ === 'profil' && JE_RAMOVY_PROFIL.test(r.nazov));
	const nos = g.rez.filter((r) => r.typ === 'profil' && JE_NOSOVY_PROFIL.test(r.nazov));
	if (!ram.length || !nos.length)
		return { r: null, err: 'Konfigurácia nemá rámový/nosový profil pre sieťku.' };
	const kus = (r: RezRow, ks: number) => ({
		kod: r.kod,
		nazov: r.nazov,
		barLen: Number(r.dlzkaTyce) || BAR,
		rozmer: Math.round(val(r, S, V, N, true)),
		dlzka: val(r, S, V, N, false),
		ks
	});
	const kusy = [...ram.map((r) => kus(r, 2)), ...nos.map((r) => kus(r, 1))];
	const potrebuje3K = potrebuje3KKolajnicu(styl);
	if (potrebuje3K) {
		const g3k = cfg[`${system}|3K`];
		const kolaj3k = (g3k?.rez ?? []).filter(
			(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov) && !rolaKolajnice(r.nazov)
		);
		kusy.push(...kolaj3k.map((r) => kus(r, 2)));
	}
	// zoskup podľa kódu, zabaľ KAŽDÝ kód SAMOSTATNE (vlastné čerstvé tyče — pozri
	// komentár funkcie prečo nie diff/spoločné balenie s pôvodnou objednávkou)
	const byKod = new Map<
		string,
		{ nazov: string; rezy: { rozmer: number; ks: number }[]; pack: Kus[]; barLen: number }
	>();
	for (const k of kusy) {
		if (!byKod.has(k.kod))
			byKod.set(k.kod, { nazov: k.nazov, rezy: [], pack: [], barLen: k.barLen });
		const e = byKod.get(k.kod)!;
		e.rezy.push({ rozmer: k.rozmer, ks: k.ks });
		for (let i = 0; i < k.ks; i++) e.pack.push({ dlzka: k.dlzka, rozmer: k.rozmer });
	}
	const material: SietkaSamostatnaMaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const [kod, e] of byKod) {
		const bary = ffdPack(e.pack, e.barLen);
		material.push({ kod, nazov: e.nazov, rezy: e.rezy, tyce: bary.length });
		odpis.push({ kod, nazov: e.nazov, metre: R((bary.length * e.barLen) / 1000) });
	}
	const ss = g.sklo.s,
		sv = g.sklo.v;
	if (!ss || !sv) return { r: null, err: 'Konfigurácia nemá sklo pre tento nárezák.' };
	const sklo = {
		sirka: Math.round(val(ss, S, V, N, true) - g.skloOffset),
		vyska: Math.round(val(sv, S, V, N, true) - g.skloOffset)
	};
	return {
		r: {
			system,
			styl,
			N,
			sklo,
			rozmerSietoviny: { sirka: sklo.sirka + 2, vyska: sklo.vyska + 1 },
			material,
			odpis,
			potrebuje3K
		},
		err: null
	};
}

function profilCuts(
	g: CfgGroup,
	S: number,
	V: number,
	N: number,
	redukciaZero: boolean,
	skloHrubka: number,
	posuv?: number,
	rucnaKolajnica?: KolajnicaRucne,
	sietkaOn = false,
	system = ''
): ProfilCuts[] {
	const order: string[] = [];
	const byKod: Record<string, RezRow[]> = {};
	const sh = Number(skloHrubka) || 0; // normalizuj (SQLite INTEGER, ale buď odolný voči '6')
	for (const r of g.rez) {
		// hrúbka-závislý riadok (Deluxe kladka/klzný pre 6mm alebo 10mm sklo) sa
		// zahrnie LEN keď sedí zvolená hrúbka skla; 0 = platí vždy (Robust/Slide)
		const rh = Number(r.skloHrubka) || 0;
		if (rh !== 0 && rh !== sh) continue;
		if (!byKod[r.kod]) {
			byKod[r.kod] = [];
			order.push(r.kod);
		}
		byKod[r.kod].push(r);
	}
	return order.map((kod) => {
		const rows = byKod[kod];
		const rezy: { rozmer: number; ks: number }[] = [];
		// dĺžka pre balenie je bez prerezu; zobrazený rozmer je s prerezom
		const kusy: Kus[] = [];
		// ručne zadaná dĺžka koľajnice (Patrik): nahradí vypočítanú dĺžku pre TÚTO
		// rolu (horná / spodná). Koľajnice majú kerf 0, takže rezaná = balená dĺžka.
		const rola = rolaKolajnice(rows[0].nazov);
		const rucne = rola ? Number(rucnaKolajnica?.[rola]) || 0 : 0;
		for (const r of rows) {
			const t =
				(Number(r.sklozavisle) && redukciaZero ? 0 : Number(r.pocetKs)) +
				sietkaExtraPocetKs(system, r, sietkaOn);
			const q = rucne > 0 ? rucne : val(r, S, V, N, false);
			const rozmer = rucne > 0 ? rucne : Math.round(val(r, S, V, N, true));
			for (let i = 0; i < t; i++)
				if (q > 0) kusy.push(posuv ? { dlzka: q, rozmer, posuv } : { dlzka: q, rozmer });
			rezy.push({ rozmer, ks: t });
		}
		// dĺžka tyče je vlastnosť profilu (Money článku) — všetky rez-riadky toho
		// istého kódu ju majú rovnakú; ber ju z prvého riadku, default BAR
		const barLen = Number(rows[0].dlzkaTyce) || BAR;
		return { kod, nazov: rows[0].nazov, rezy, kusy, barLen };
	});
}

/**
 * Kus dlhší než jeho tyč sa fyzicky NEDÁ vyrobiť (napr. 6500 mm rez z 6000 mm
 * 5K hornej koľajnice). FFD by taký kus „zabalil" na jednu tyč so záporným
 * odpadom → tyce=1 → odpis do Money PODHODNOTENÝ na polovicu. Preto to zachytíme
 * a výpočet zlyhá s konkrétnou chybou (namiesto tichého zlého odpisu). Vráti
 * správu pre prvý taký profil, inak null. Volá sa v safeCompute PRED zápisom.
 */
export function oversizeCut(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka: number,
	rucnaKolajnica?: KolajnicaRucne
): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	for (const c of profilCuts(g, S, V, g.N, redukciaZero, skloHrubka, undefined, rucnaKolajnica)) {
		for (const k of c.kusy) {
			if (k.dlzka + KOTUC > c.barLen)
				return `Rez ${Math.round(k.rozmer)} mm (${c.nazov}) je dlhší než tyč ${c.barLen} mm — tento rozmer sa z daného profilu nedá vyrobiť. Zmenši rozmer alebo zvoľ iný systém.`;
		}
	}
	return null;
}

/**
 * Fail-loud guard: ak systém MÁ hrúbko-závislé profily (Deluxe kladka/klzný pre
 * 6/10 mm), ale pre zvolenú hrúbku skla ani jeden nesedí, `profilCuts` by ticho
 * VYNECHAL kladku aj klzný → odpis do Money podhodnotený o ~40 %. Namiesto tichého
 * fallbacku (bar codebase: „chyba sa hlási nahlas") to zachytíme a výpočet zlyhá.
 * Dnes nedosiahnuteľné cez UI (glassTypesForSystem púšťa pre Deluxe len sklá s
 * hrúbkou 6/10), ale bráni tichej regresii, ak by tá záruka niekedy padla.
 */
export function missingHrubkaProfile(cfg: Cfg, sysStyl: string, skloHrubka: number): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	const sh = Number(skloHrubka) || 0;
	const hrubkaRows = g.rez.filter((r) => (Number(r.skloHrubka) || 0) !== 0);
	if (!hrubkaRows.length) return null; // žiadne hrúbko-závislé profily (Robust/Slide) → OK
	if (hrubkaRows.some((r) => (Number(r.skloHrubka) || 0) === sh)) return null;
	return `Pre zvolenú hrúbku skla (${sh} mm) tento systém nemá kladka/klzný profil — vyber platné sklo (6 alebo 10 mm).`;
}

/**
 * Vypočíta nárezový plán. `redukciaZero` = true keď zvolené sklo nuluje
 * sklo-závislé profily (Redukcia 6mm pri Slide). Ktoré sklá to sú, určuje
 * tabuľka glass_types (stĺpec redukcia_zero) — nie natvrdo zadaný reťazec.
 */
// „Prídavná koľajnica" (Dominik 2026-07-15): checkbox → spodná koľajnica o 1 veľkosť
// vyššia. LEN Štandard + (tieto kódy zdieľa s Deluxe, preto sa swap GEJTUJE na systém).
// Dĺžka tyče je rovnaká (7500 mm) → metre v odpise ostávajú, mení sa len KÓD + názov.
// NEZÁVISLÉ od typu skla (IZO aj obyčajné — Dominik: „to že je IZO nie je podmienka").
export const RAIL_UPSIZE: Record<string, { kod: string; nazov: string }> = {
	ZASP00104: { kod: 'ZASP00030', nazov: 'Koľajnica spodná 3K Surový 7500 mm' },
	ZASP00030: { kod: 'ZASP00033', nazov: 'Koľajnica spodná 4K Surový 7500 mm' },
	ZASP00033: { kod: 'ZASP202432', nazov: 'Koľajnica spodná 5K Surový 7500 mm' },
	ZASP202432: { kod: 'ZASP202437', nazov: 'Koľajnica spodná 6K Surový 7500 mm' }
	// 6K (ZASP202437) nemá +1 — 7K koľajnica neexistuje.
};
export function railUpsize(
	system: string,
	pridavna: boolean,
	kod: string,
	nazov: string
): { kod: string; nazov: string } {
	if (pridavna && system === 'Štandard +' && RAIL_UPSIZE[kod]) return RAIL_UPSIZE[kod];
	return { kod, nazov };
}

/**
 * Systémy, kde sa dá koľajnica zadať RUČNE — tie, ktoré majú v konfigurácii
 * ODDELENÚ hornú a spodnú koľajnicu (Deluxe, Štandard +, Štandard). Robust a Slide
 * majú jednu obvodovú koľajnicu, takže „iná horná / iná spodná" tam nemá zmysel
 * (Patrik: „Robust a slide sa to stať nemôže max ešte delux"). Zoznam sa NEZADÁVA
 * natvrdo — vyplýva z názvov profilov v cfg, takže nový systém ho zdedí sám.
 */
export function systemyRucnaKolajnica(cfg: Cfg): string[] {
	const roly: Record<string, Set<string>> = {};
	for (const sysStyl in cfg) {
		const system = sysStyl.split('|')[0];
		for (const r of cfg[sysStyl].rez) {
			const rola = rolaKolajnice(r.nazov);
			if (!rola) continue;
			(roly[system] ??= new Set()).add(rola);
		}
	}
	return Object.keys(roly).filter((s) => roly[s].has('horna') && roly[s].has('spodna'));
}

export function computeFlat(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka = 0,
	pridavnaKolajnica = false,
	rucnaKolajnica?: KolajnicaRucne,
	sietka?: Sietka | null
): ComputeResult | null {
	const g = cfg[sysStyl];
	if (!g || !g.rez.length) return null;
	const N = g.N;
	const system = sysStyl.split('|')[0];
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
		// prídavná koľajnica: spodná koľajnica o 1 väčšia (len Štandard +)
		const up = railUpsize(system, pridavnaKolajnica, c.kod, c.nazov);
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
		system: sysStyl.split('|')[0],
		styl: sysStyl.split('|')[1],
		S,
		V,
		N,
		m2: R((S * V) / 1e6),
		material,
		odpis,
		sklo: {
			// sklo sa objednáva na CELÉ milimetre (Dominik: 904,578 → 905) — zaokrúhli
			// na najbližší mm. Sklo NIE je v Money odpise, takže je to len rozmer na plán/objednávku.
			sirka: Math.round(val(ss, S, V, N, true) - g.skloOffset),
			vyska: Math.round(val(sv, S, V, N, true) - g.skloOffset),
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
		dlzkaOponovehoMm: dlzka(/opon/i)
	};
}

const isFin = (x: unknown): boolean =>
	x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

/** Kontrola, že konfigurácia systému je kompletná a numericky platná. */
export function validSys(cfg: Cfg, ss: string): boolean {
	const g = cfg[ss];
	if (!g || !isFin(g.N) || Number(g.N) <= 0 || !isFin(g.skloOffset)) return false;
	const prof = g.rez.filter((r) => r.typ === 'profil' && r.kod);
	if (!prof.length) return false;
	if (!g.sklo.s || !g.sklo.v) return false;
	for (const r of g.rez) {
		if (![r.koef, r.offset, r.pocetKs, r.kerf].every(isFin)) return false;
	}
	if (
		!isFin(g.sklo.s.offset) ||
		!isFin(g.sklo.v.offset) ||
		!isFin(g.sklo.s.koef) ||
		!isFin(g.sklo.v.koef)
	)
		return false;
	return true;
}

/**
 * Rozsahové limity editovateľných hodnôt — druhá vrstva ochrany Money odpisu
 * (prvá je validSys). Preklep mimo rozsahu sa odmietne pri ukladaní v editore
 * AJ pri výpočte.
 */
export const BOUNDS = {
	offset: { min: -500, max: 500 },
	skloOffset: { min: 0, max: 500 },
	koef: { min: 0.1, max: 10 },
	kerf: { min: 0, max: 50 },
	pocetKs: { min: 0, max: 100 },
	N: { min: 1, max: 12 },
	// dĺžka tyče násobí odpis do Money (metre = tyče × dĺžka/1000) — preklep (600
	// namiesto 6000, 75000 namiesto 7500) sa musí odmietnuť. Reálne: 3600/6000/7500.
	dlzkaTyce: { min: 1000, max: 8000 }
};

export function inBounds(cfg: Cfg, ss: string): string | null {
	const g = cfg[ss];
	if (!g) return 'Neznámy systém/štýl.';
	if (g.N < BOUNDS.N.min || g.N > BOUNDS.N.max) return `Počet polí (N=${g.N}) mimo rozsahu.`;
	if (g.skloOffset < BOUNDS.skloOffset.min || g.skloOffset > BOUNDS.skloOffset.max)
		return `Sklo odsadenie (${g.skloOffset}) mimo rozsahu ${BOUNDS.skloOffset.min}–${BOUNDS.skloOffset.max}.`;
	const all = [...g.rez, g.sklo.s, g.sklo.v].filter(Boolean) as RezRow[];
	for (const r of all) {
		if (r.offset < BOUNDS.offset.min || r.offset > BOUNDS.offset.max)
			return `Odsadenie ${r.offset} (${r.nazov || r.kod}) mimo rozsahu ±${BOUNDS.offset.max}.`;
		if (r.koef < BOUNDS.koef.min || r.koef > BOUNDS.koef.max)
			return `Koeficient ${r.koef} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (r.kerf < BOUNDS.kerf.min || r.kerf > BOUNDS.kerf.max)
			return `Prerez ${r.kerf} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (r.pocetKs < BOUNDS.pocetKs.min || r.pocetKs > BOUNDS.pocetKs.max)
			return `Počet ks ${r.pocetKs} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (
			r.dlzkaTyce !== undefined &&
			(r.dlzkaTyce < BOUNDS.dlzkaTyce.min || r.dlzkaTyce > BOUNDS.dlzkaTyce.max)
		)
			return `Dĺžka tyče ${r.dlzkaTyce} (${r.nazov || r.kod}) mimo rozsahu ${BOUNDS.dlzkaTyce.min}–${BOUNDS.dlzkaTyce.max} mm.`;
	}
	return null;
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
	sietka?: Sietka | null
): { r: ComputeResult | null; err: string | null } {
	if (!validSys(cfg, sysStyl))
		return { r: null, err: 'Konfigurácia systému je neúplná alebo chybná.' };
	const boundErr = inBounds(cfg, sysStyl);
	if (boundErr) return { r: null, err: 'Konfigurácia mimo povolených rozsahov: ' + boundErr };
	const hrubkaErr = missingHrubkaProfile(cfg, sysStyl, skloHrubka);
	if (hrubkaErr) return { r: null, err: hrubkaErr };
	const overErr = oversizeCut(cfg, sysStyl, S, V, redukciaZero, skloHrubka, rucnaKolajnica);
	if (overErr) return { r: null, err: overErr };
	const g = cfg[sysStyl];
	const sietkaErr = g
		? sietkaChyba(cfg, sysStyl.split('|')[0], sysStyl.split('|')[1] ?? '', sietka, S, V, g.N)
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
		sietka
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
	/** prídavná koľajnica — spodná koľajnica o 1 väčšia (len Štandard +) */
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
	/** klín nad posuvom — len na plán/náhľad, do Money odpisu NEJDE */
	klin?: Klin | null;
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
	klin?: Klin | null;
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
	for (let i = 0; i < posuvy.length; i++) {
		const p = posuvy[i];
		const g = cfg[p.sysStyl];
		if (!g || !g.rez.length || !g.sklo.s || !g.sklo.v) return null;
		const N = g.N;
		const system = p.sysStyl.split('|')[0];
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
			// prídavná koľajnica: spodná koľajnica o 1 väčšia (len Štandard +) — swap
			// PRED poolovaním, aby sa metre pooli pod správnym (väčším) kódom.
			const up = railUpsize(system, p.pridavnaKolajnica ?? false, c.kod, c.nazov);
			// sieťka na 2K: celá koľajnica sa mení na 3K variant (#87) — swap PRED
			// poolovaním z rovnakého dôvodu ako railUpsize vyššie.
			const sk = sietkaKolajnicaSwap(cfg, system, styl, sietkaOn, up.kod, up.nazov);
			if (!pool[sk.kod]) {
				pool[sk.kod] = {
					nazov: sk.nazov,
					rezy: [],
					kusy: [],
					barLen: c.barLen,
					sikmyRez: !systemRovnyRez(system) && jeSikmyRez(c.nazov)
				};
				order.push(sk.kod);
			}
			pool[sk.kod].kusy.push(...c.kusy);
			for (const rz of c.rezy) {
				const ex = pool[sk.kod].rezy.find((x) => x.rozmer === rz.rozmer);
				if (ex) ex.ks += rz.ks;
				else pool[sk.kod].rezy.push({ ...rz });
			}
		}
		const ss = g.sklo.s,
			sv = g.sklo.v;
		infos.push({
			system: p.sysStyl.split('|')[0],
			styl: p.sysStyl.split('|')[1],
			S: p.S,
			V: p.V,
			N,
			m2: R((p.S * p.V) / 1e6),
			sklo: {
				sirka: Math.round(val(ss, p.S, p.V, N, true) - g.skloOffset),
				vyska: Math.round(val(sv, p.S, p.V, N, true) - g.skloOffset),
				pocet: N
			},
			otvaranie: p.otvaranie,
			skloNazov: p.sklo,
			kovanieL: p.kovanieL,
			kovanieP: p.kovanieP,
			kovanieStred: p.kovanieStred,
			kovanieStredOkno: p.kovanieStredOkno,
			klin: p.klin ?? null,
			kolajnica: p.kolajnica ?? null,
			sietka: p.sietka ?? null
		});
	}
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const kod of order) {
		const pk = pool[kod];
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
	for (let i = 0; i < posuvy.length; i++) {
		const p = posuvy[i];
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
		const g = cfg[p.sysStyl];
		const sietkaErr = g
			? sietkaChyba(
					cfg,
					p.sysStyl.split('|')[0],
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
