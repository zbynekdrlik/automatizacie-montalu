// Pergola — MATERIÁL / NÁREZ z rozmerov (#155). Čistý TS engine bez závislosti na
// Svelte/DOM/serveri — plne unit-testovateľný (viď tests/pergola-narez.test.ts).
//
// DISPLAY-ONLY: NIKAM do Money nezapisuje. NEimportuje `$lib/server/money` ani
// `$lib/server/pergola` (Money odpisová cesta) — statický guard je v
// tests/pergola-narez-money-safety.test.ts. Kódy/názvy profilov sú KÓPIA stringov z
// katalógu (aby sa modul nezaviazal na server odpisový modul), nie import.
//
// DISCIPLÍNA (#155): engine počíta LEN vzorce POTVRDENÉ na callu s Dominikom
// (13.8.2026, komentár na #155). Všetko O-blokované (kótovaný výkres O1, výstuha
// profil O2/O3, strop 700 pre krov O4, sklá O11, krov #161) je vypísané ako
// „zatiaľ nepodporované" — NIKDY sa nehádže vzorec. Preto je výsledok rozdelený na
// `vypocitane` (potvrdené), `informativne` (odvodené hodnoty na zobrazenie) a
// `nepodporovane` (čaká na pravidlá).

/** zaokrúhlenie na 0,1 mm — rovnaká disciplína ako R1 v pergola-navrh.ts */
const R1 = (x: number) => Math.round(x * 10) / 10;

// --- Potvrdené konštanty (dôkaz = citácie t=… v analýze callu na #155) -----------
/** štandardná predná svetlosť [mm] (spodná hrana žľabu po odčítaní výstuhy), t=1011–1034s */
export const PREDNA_SVETLOST_STD = 2200;
/** dĺžka prednej nohy = predná svetlosť + tento prídavok [mm], t=1061–1072s
 *  (overené 1:1 na ZAK2026302: 2200+15 = 2215, 4× stĺp 2215 mm) */
export const PREDNA_NOHA_PRIDAVOK = 15;
/** rez výstuhy medzi nohami = šírka − toto [mm] (Dominikov doslovný citát t=985–993s).
 *  INFORMATÍVNE — per-systém varianta (šírka − 2×noha) je O2, profil je O3, oboje blokované. */
export const VYSTUHA_ODPOCET = 280;
/** maximálny rozostup priečok [mm] — cieľ 650–700, tvrdý strop 700, t=133–157s */
export const MAX_ROZOSTUP_PRIECOK = 700;

export const KOD_PRIECKA_NORMAL = '18004';
export const KOD_PRIECKA_LIGHT = '18102';

// --- Rozsahy vstupu --------------------------------------------------------------
export const SIRKA_MIN = 1000;
export const SIRKA_MAX = 20000;
export const HLBKA_MIN = 1000;
export const HLBKA_MAX = 10000;
export const SVETLOST_MIN = 1500;
export const SVETLOST_MAX = 4000;
export const VYSKA_ZADNA_MIN = 1500;
export const VYSKA_ZADNA_MAX = 5000;
export const POCET_NOH_MIN = 2;
export const POCET_NOH_MAX = 20;

export type PergolaSystem = 'Robust' | 'Massive';
export type Uchytenie = 'stena' | 'samostatne';
/** rozmer HORNÉHO profilu zadnej konštrukcie [mm] — do vzorca zadnej nohy. Z callu:
 *  NIE je viazaný na systém (Massive sa dá aj z horného 110), preto samostatná voľba
 *  110/140, t=1360–1417s. */
export type HornyProfil = 110 | 140;

export interface SystemProfil {
	stlp: { kod: string; nazov: string; rozmer: 110 | 140 };
	zlab: { kod: string; nazov: string };
}

/** Systém pergoly určuje profil stĺpu AJ žľabu (t=170–213s). Kódy/názvy = kópia z
 *  katalógu profilov (NIE import server/pergola). */
export const SYSTEMY: Record<PergolaSystem, SystemProfil> = {
	Robust: {
		stlp: { kod: '18013', nazov: 'Profil 110x110 V2', rozmer: 110 },
		zlab: { kod: '18021', nazov: 'Žlabový profil 110 V2' }
	},
	Massive: {
		stlp: { kod: '18017', nazov: 'Profil 140x140', rozmer: 140 },
		zlab: { kod: '18018', nazov: 'Žlabový profil 140' }
	}
};

export interface PergolaNarezVstup {
	system: PergolaSystem;
	/** celková šírka pergoly [mm] */
	sirka: number;
	/** hĺbka pergoly [mm] — evidenčný rozmer (potvrdené vzorce ju zatiaľ nepoužívajú;
	 *  dĺžky priečok/krovu, ktoré ju potrebujú, sú O1/#161 blokované) */
	hlbka: number;
	/** predná svetlá výška [mm], štandard 2200 */
	prednaSvetlost: number;
	/** zadná výška [mm] — použije sa LEN pri samostatne stojacej (zadné nohy) */
	vyskaZadna: number;
	/** počet predných nôh (CELNE_NOHY) — riadiaci vstup, rozostupy sa dopočítajú (t=1436–1510s) */
	pocetPrednychNoh: number;
	/** na stenu (9/10, bez zadných nôh) vs samostatne stojaca (t=1313–1319s) */
	uchytenie: Uchytenie;
	/** počet zadných nôh — LEN pri samostatne stojacej */
	pocetZadnychNoh: number;
	/** rozmer horného profilu zadnej konštrukcie (110/140) — do vzorca zadnej nohy */
	hornyProfilZadnej: HornyProfil;
	/** priečka light (18102) vs normal (18004) — manuálny checkbox, volí Money KÓD
	 *  priečky. Zdroj = ťažba Money histórie (17/17 zákaziek, 9× normal/11× light),
	 *  NIE call. POZOR na zámenu: krov „light/vystužený" z callu (t=225–252s) je INÝ
	 *  vstup bez vzorca → patrí ku #161, v tomto engine NIE JE. */
	prieckaLight: boolean;
	/** zosilnený nosník — profil je O2/O3 blokovaný, len vypíšeme ako nepodporované */
	zosilnenyNosnik: boolean;
}

/** Jedna položka nárezu. `dlzkaRezuMm === null` = počet je potvrdený, ale dĺžku rezu
 *  ešte nemáme (čaká na kótovaný výkres, O1) — NIKDY nevymýšľame číslo. */
export interface PolozkaNarezu {
	kod: string;
	nazov: string;
	dlzkaRezuMm: number | null;
	pocetKs: number;
	poznamka?: string;
}

export interface NarezInformativne {
	prednaSvetlost: number;
	prednaNohaDlzka: number;
	/** null keď na stenu (bez zadných nôh) */
	zadnaNohaDlzka: number | null;
	/** rez výstuhy = šírka − 280 (informatívne, profil O2/O3) */
	vystuhaRezMm: number;
	pocetPriecok: number;
	/** dopočítaný rozostup predných nôh [mm], null keď < 2 nohy */
	rozostupPrednychNoh: number | null;
}

export interface NarezVysledok {
	vypocitane: PolozkaNarezu[];
	informativne: NarezInformativne;
	nepodporovane: string[];
}

/** Počet priečok z max. rozostupu 700 mm: `ceil(šírka/700) + 1` (rozostup ≤ 700 zaručený). */
export function pocetPriecok(sirka: number): number {
	if (!(sirka > 0)) return 0;
	return Math.ceil(sirka / MAX_ROZOSTUP_PRIECOK) + 1;
}

/** Rozdelí materiál na potvrdené položky, informatívne hodnoty a zoznam „zatiaľ
 *  nepodporované". Čistá funkcia — bez vedľajších efektov, bez Money zápisu. */
export function spocitajNarez(v: PergolaNarezVstup): NarezVysledok {
	const sys = SYSTEMY[v.system];
	const prednaNohaDlzka = R1(v.prednaSvetlost + PREDNA_NOHA_PRIDAVOK);
	const samostatne = v.uchytenie === 'samostatne';
	const zadnaNohaDlzka = samostatne ? R1(v.vyskaZadna - v.hornyProfilZadnej) : null;
	const priecky = pocetPriecok(v.sirka);
	const rozostup = v.pocetPrednychNoh > 1 ? R1(v.sirka / (v.pocetPrednychNoh - 1)) : null;

	const vypocitane: PolozkaNarezu[] = [
		{
			kod: sys.stlp.kod,
			nazov: `${sys.stlp.nazov} — predná noha`,
			dlzkaRezuMm: prednaNohaDlzka,
			pocetKs: v.pocetPrednychNoh
		}
	];
	if (samostatne) {
		vypocitane.push({
			kod: sys.stlp.kod,
			nazov: `${sys.stlp.nazov} — zadná noha`,
			dlzkaRezuMm: zadnaNohaDlzka,
			pocetKs: v.pocetZadnychNoh
		});
	}
	vypocitane.push({
		kod: v.prieckaLight ? KOD_PRIECKA_LIGHT : KOD_PRIECKA_NORMAL,
		nazov: v.prieckaLight ? 'Priečkový profil 105 (light)' : 'Priečkový profil 105',
		dlzkaRezuMm: null,
		pocetKs: priecky,
		poznamka: 'dĺžka rezu čaká na kótovaný výkres (O1)'
	});

	const nepodporovane: string[] = [
		'Krov / krokvy (počet, rozostup, dĺžka rezu) — geometria krovu je v #161; strop 700 mm pre rozostup krovu je otvorená otázka (O4).',
		`Žľab (${sys.zlab.kod} ${sys.zlab.nazov}) — vždy prítomný, dĺžka rezu čaká na kótovaný výkres (O1).`,
		'Kotviaci profil horný V2 (18019) — vždy prítomný, dĺžka rezu čaká na kótovaný výkres (O1).',
		'Prítlačná (18006) / zaklapávacia čelná (18005) / maskovacie lišty (18007/18008) — dĺžky viazané na hornú hranu krovu (#161).',
		'Sklá / strešná výplň (šírky, dĺžky, materiál, RAL) — vedome ručne, appka ich nepočíta (O11).',
		'Spád / kliny — patria k zaskleniu pod pergolou, nie k nohám pergoly (mimo scope #155).'
	];
	if (v.zosilnenyNosnik) {
		nepodporovane.push(
			'Zosilnený nosník — profil (Robust 250×110 alebo 230×110 / Massive 200×140) čaká na potvrdenie kódu a pravidla (O2/O3); rez výstuhy = šírka − 280 je zatiaľ len informatívny.'
		);
	}

	return {
		vypocitane,
		informativne: {
			prednaSvetlost: v.prednaSvetlost,
			prednaNohaDlzka,
			zadnaNohaDlzka,
			vystuhaRezMm: R1(v.sirka - VYSTUHA_ODPOCET),
			pocetPriecok: priecky,
			rozostupPrednychNoh: rozostup
		},
		nepodporovane
	};
}

/** Serverová validácia rozsahov — Slovak chybová hláška, alebo null keď je vstup
 *  platný. Server je jediný strážca rozsahov (rovnaká disciplína ako fix.ts /
 *  pergola-navrh.ts). */
export function chybaPergolaNarezVstupu(v: PergolaNarezVstup): string | null {
	if (v.system !== 'Robust' && v.system !== 'Massive') return 'Neplatný systém pergoly.';
	if (!(v.sirka >= SIRKA_MIN && v.sirka <= SIRKA_MAX))
		return `Šírka musí byť ${SIRKA_MIN}–${SIRKA_MAX} mm.`;
	if (!(v.hlbka >= HLBKA_MIN && v.hlbka <= HLBKA_MAX))
		return `Hĺbka musí byť ${HLBKA_MIN}–${HLBKA_MAX} mm.`;
	if (!(v.prednaSvetlost >= SVETLOST_MIN && v.prednaSvetlost <= SVETLOST_MAX))
		return `Predná svetlosť musí byť ${SVETLOST_MIN}–${SVETLOST_MAX} mm.`;
	if (!(v.pocetPrednychNoh >= POCET_NOH_MIN && v.pocetPrednychNoh <= POCET_NOH_MAX))
		return `Počet predných nôh musí byť ${POCET_NOH_MIN}–${POCET_NOH_MAX}.`;
	if (v.hornyProfilZadnej !== 110 && v.hornyProfilZadnej !== 140)
		return 'Horný profil zadnej konštrukcie musí byť 110 alebo 140.';
	// zadné nohy sa validujú LEN pri samostatne stojacej — na stenu sa nepoužívajú
	if (v.uchytenie === 'samostatne') {
		if (!(v.vyskaZadna >= VYSKA_ZADNA_MIN && v.vyskaZadna <= VYSKA_ZADNA_MAX))
			return `Výška zadná musí byť ${VYSKA_ZADNA_MIN}–${VYSKA_ZADNA_MAX} mm.`;
		if (!(v.pocetZadnychNoh >= POCET_NOH_MIN && v.pocetZadnychNoh <= POCET_NOH_MAX))
			return `Počet zadných nôh musí byť ${POCET_NOH_MIN}–${POCET_NOH_MAX}.`;
	}
	return null;
}
