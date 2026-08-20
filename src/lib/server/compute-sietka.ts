// Sieťka (moskytiéra) — Money korekcia #86–#110 + samostatná sieťka (#89).
// Rozdelené z compute.ts (#249). Importuj verejné cez fasádu `$lib/server/compute`.
import { rolaKolajnice } from '$lib/kolajnica';
import {
	maSietkaSystem,
	maSietkaSystemVyber,
	potrebuje3KKolajnicu,
	type Sietka
} from '$lib/sietka';
import { zakladnyStyl } from '$lib/styl';
import { oversizeCut, type ProfilCuts } from './compute-profily';
import {
	BAR,
	ffdPack,
	inBounds,
	JE_NOSOVY_PROFIL,
	JE_RAMOVY_PROFIL,
	KOTUC,
	R,
	val,
	validSys,
	type Cfg,
	type CfgGroup,
	type Kus,
	type OdpisRow,
	type RezRow
} from './compute-model';

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
	// `posuvSystem` prešiel `maSietkaSystemVyber` vyššie → je 'Štandard'/'Štandard +',
	// čo sú PRESNE jediné dva kľúče STANDARD_ROLY → prístup je vždy definovaný.
	const sirkaRow = najdiRolu(posuvGroup, STANDARD_ROLY[posuvSystem]!.sirka);
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
	// #91 nález 5: koľajnicový vzorcový mismatch platí pre KAŽDÝ systém s 2K/3K
	// výmenou (aj Robust/Slide, nielen Slide/maSietkaSystemVyber vetvy nižšie) —
	// over PRED nimi, nech jedna chyba nezakryje druhú.
	const kolajnicaErr = sietkaKolajnicaVzorecChyba(cfg, system, styl);
	if (kolajnicaErr) return kolajnicaErr;
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
export function mergeExtraCuts(
	cuts: ProfilCuts[],
	extra: ExtraRez[],
	posuv?: number
): ProfilCuts[] {
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
 * horná/spodná), takže „celý rám" = jeden Money kód. Štandard/Štandard + majú DELENÚ
 * hornú a spodnú (`rolaKolajnice` vráti `'horna'`/`'spodna'`, #91) — pre ne treba
 * vymeniť KAŽDÚ zvlášť za jej 3K náprotivok S ROVNAKOU rolou (horná→horná,
 * spodná→spodná), nie jeden spoločný kód. Funkcia sa volá per riadok (raz na hornú,
 * raz na spodnú), takže stačí hľadať zhodu podľa role namiesto vzdania sa pri
 * akejkoľvek role — mechanizmus tak funguje pre KAŽDÝ systém s delenou koľajnicou bez
 * ďalšieho per-systém vetvenia. 2K aj 3K koľajnica majú TOTOŽNÝ vzorec dĺžky (koef=1,
 * offset=0, delitN=0 — over v cfg_seed.json, a od #91 nálezu 5 aj FAIL-LOUD vynútené,
 * pozri `sietkaKolajnicaVzorecChyba`), takže sa mení LEN kód/názov karty — dĺžka rezu
 * ostáva rovnaká (rovnaký vzor ako `railUpsize` vyššie, pre iný profil a iný gate). 3K
 * kód/názov sa berie ŽIVO z `cfg`, nikdy natvrdo.
 *
 * OPRAVA #91 nález 1 (adversariálna revízia PR #122): gate bol `styl !== '2K'` — na
 * Štandarde/Štandard + ale o IZO/basic nárezáku rozhoduje ZVOLENÉ SKLO, nie štýl
 * (`sysStylPre`), takže sem prišiel `styl = '2K IZO'` a prísna rovnosť sa vzdala hneď
 * na prvom riadku (nulová výmena, hláška aj tak klamala). Gate je teraz na ZÁKLADNOM
 * štýle (`zakladnyStyl`) a náprotivok sa hľadá v skupine s tou istou IZO príponou
 * (`2K IZO` → `3K IZO`), nie natvrdo v `|3K` — mechanizmus, nie per-systém `if`, takže
 * funguje pre KAŽDÚ existujúcu IZO skupinu bez ďalšieho dopĺňania.
 */
export function sietkaKolajnicaSwap(
	cfg: Cfg,
	system: string,
	styl: string,
	sietkaOn: boolean,
	kod: string,
	nazov: string
): { kod: string; nazov: string } {
	if (!sietkaOn || zakladnyStyl(styl) !== '2K') return { kod, nazov };
	if (!/^Koľajnica\b/i.test(nazov)) return { kod, nazov };
	const rola = rolaKolajnice(nazov);
	const g3k = cfg[`${system}|${styl.replace(/^2K/, '3K')}`];
	const row = g3k?.rez.find(
		(r) => r.typ === 'profil' && /^Koľajnica\b/i.test(r.nazov) && rolaKolajnice(r.nazov) === rola
	);
	return row ? { kod: row.kod, nazov: row.nazov } : { kod, nazov };
}

/**
 * Fail-loud guard (#91 nález 5, adversariálna revízia PR #122): `sietkaKolajnicaSwap`
 * kopíruje len `{kod, nazov}` z 3K náprotivku a drží dĺžkový vzorec (`dim`/`koef`/
 * `offset`/`delitN`/`dlzkaTyce`) PÔVODNÉHO 2K riadku — v tichom predpoklade, že 2K aj
 * 3K koľajnica majú TOTOŽNÝ vzorec (dnes naozaj majú, pozri `cfg_seed.json`). `offset`
 * je pritom ŽIVO editovateľný v `/zasklenia/nastavenia` (per riadok, per `poradie`) —
 * kto ho zmení len na jednej strane (2K alebo 3K), appka by so sieťkou ticho napísala
 * do Money článok 3K s dĺžkou rezu 2K (alebo naopak) — nárezák, podľa ktorého dielňa
 * reže, by bol zle OKAMŽITE. Namiesto tichého zlého odpisu (rovnaká disciplína ako
 * `missingHrubkaProfile`) výpočet zlyhá nahlas skôr, než sa čokoľvek zapíše.
 *
 * OPRAVA #124 (deep-review nález po PR #122): pôvodne `if (!g2k || !g3k) return null;`
 * — keď 3K(-variant) skupina VÔBEC NEEXISTUJE, funkcia sa vzdala ticho a
 * `sietkaKolajnicaSwap` ticho nechal pôvodný 2K kód v odpise (rovnaká trieda chyby
 * ako #91, len iná príčina). Teraz: chýbajúca `g3k` skupina je FAIL-LOUD (menuje
 * systém aj hľadaný kľúč skupiny), rovnako ako chýbajúci KONKRÉTNY riadok v rámci
 * existujúcej skupiny (predtým `if (!r3) continue;` — pozri komentár nižšie prečo to
 * bol nesprávny predpoklad, nie legitímny skip).
 */
export function sietkaKolajnicaVzorecChyba(cfg: Cfg, system: string, styl: string): string | null {
	if (zakladnyStyl(styl) !== '2K') return null;
	const g2k = cfg[`${system}|${styl}`];
	if (!g2k) return null; // neznámy systém/štýl — mimo scope (validSys to rieši pred volaním)
	const g3kStyl = styl.replace(/^2K/, '3K');
	const g3k = cfg[`${system}|${g3kStyl}`];
	for (const r2 of g2k.rez) {
		if (r2.typ !== 'profil' || !/^Koľajnica\b/i.test(r2.nazov)) continue;
		if (!g3k) {
			return (
				`Systém „${system}" (${styl}) potrebuje pri zapnutej sieťke 3K koľajnicu, ale ` +
				`konfigurácia nemá skupinu „${system}|${g3kStyl}" vôbec definovanú — sieťková ` +
				`výmena kódu by nemala čo dosadiť. Skontroluj nastavenia (${system}).`
			);
		}
		const rola = rolaKolajnice(r2.nazov);
		// Robust/Slide majú JEDNU obvodovú koľajnicu, ale DVA riadky (rola=null) — po
		// S aj po V dimenzii, s TÝM ISTÝM kódom (`sietkaKolajnicaSwap` to nerozlišuje,
		// lebo cieľová skupina má rovnaký kód na oboch). Tento guard porovnáva VZOREC,
		// takže musí párovať aj podľa `dim`, inak by V-riadok omylom porovnal proti
		// S-riadkovému náprotivku a nahlásil falošnú nezhodu.
		const r3 = g3k.rez.find(
			(r) =>
				r.typ === 'profil' &&
				/^Koľajnica\b/i.test(r.nazov) &&
				rolaKolajnice(r.nazov) === rola &&
				r.dim === r2.dim
		);
		// #124 bod 2: PREDTÝM `continue` s komentárom „sietkaKolajnicaSwap sám o sebe
		// nič nezmení — nemá čo pokaziť". To bolo nepresné: `sietkaKolajnicaSwap`
		// hľadá náprotivok LEN podľa `rola` (žiadna `dim` podmienka, pozri jej vlastný
		// docblock vyššie) — je teda MENEJ prísna než párovanie tu. Keby v `g3k`
		// existoval riadok s rovnakou `rola`, ale INÝM `dim` (chýba práve ten s
		// presne zhodným `dim`), `swap` by ho ticho POUŽIL aj s jeho (možno
		// nekompatibilným) vzorcom — presne ten istý druh tichého zlého odpisu, aký
		// táto funkcia existuje zachytiť. Preto je to FAIL-LOUD, nie skip. Na dnešnom
		// `cfg_seed.json` je to no-op (každá existujúca `Koľajnica` skupina má S aj V
		// riadok s identickým kódom/vzorcom) — chyba sa prejaví len na syntetickej/
		// mutovanej konfigurácii.
		if (!r3) {
			return (
				`Koľajnica „${r2.nazov}" (${styl}) nemá vo svojej 3K skupine „${system}|${g3kStyl}" ` +
				`žiadny zodpovedajúci riadok — sieťková výmena kódu by nenašla čo dosadiť. ` +
				`Skontroluj nastavenia (${system}).`
			);
		}
		const nezhoda =
			r2.koef !== r3.koef ||
			r2.offset !== r3.offset ||
			r2.delitN !== r3.delitN ||
			(Number(r2.dlzkaTyce) || 0) !== (Number(r3.dlzkaTyce) || 0);
		if (nezhoda) {
			return (
				`Koľajnica „${r2.nazov}" (${styl}) a jej 3K náprotivok „${r3.nazov}" majú rozdielny ` +
				`vzorec dĺžky rezu — sieťková výmena kódu by dala nesprávnu dĺžku. Skontroluj ` +
				`nastavenia vzorcov (${system}).`
			);
		}
	}
	return null;
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
	if (!g) return { r: null, err: 'Neznámy systém/štýl.' }; // validSys vyššie to už zaručuje
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
