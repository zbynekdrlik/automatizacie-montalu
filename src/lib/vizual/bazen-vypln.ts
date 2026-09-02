// Zákaznícky 3D vizuál bazénového zastrešenia (#405) — mapovanie kategórie
// polykarbonátovej VÝPLNE na jej vizuálny vzhľad (priehľadnosť/farba/útlm).
// Čistá logika (žiadny THREE/DOM import) — konzument (`materialy.ts` cez
// `vytvorSkloMaterial`/`nastavSkloVzhlad`) dostane iba tento `SkloVzhlad` tvar.
// `import type` nesie NULOVÝ runtime dôsledok. Nemapuje sa na žiadny Money kód
// ani cenu (to je scope inde) — vzor `pergola-sklo.ts`.
import type { SkloVzhlad } from './materialy';

/** Typy výplne ponúkané v zákazníckom konfigurátore bazéna (polykarbonát). */
export type BazenVyplnTyp = 'cire' | 'opalove' | 'dymove';

export const BAZEN_VYPLN_TYP_DEFAULT: BazenVyplnTyp = 'cire';

/** Ľudský (slovenský) názov typu výplne pre popisok pod obrázkom (nikdy do rastra). */
export const BAZEN_VYPLN_NAZVY: Record<BazenVyplnTyp, string> = {
	cire: 'Číry polykarbonát',
	opalove: 'Opálový polykarbonát',
	dymove: 'Dymový polykarbonát'
};

// Vzhľady jednotlivých typov. Polykarbonát je opticky o niečo menej číry než sklo
// (vyššia drsnosť povrchu, mierne vyššia opacita). `transmission` režim (mid/high)
// číta `farbaHex`/`attenuationHex`/`attenuationDistanceM`, `falosne` (low) číta
// `farbaHex`/`opacity`/`roughness` — každý typ nesie oba páry (konzistentný na
// oboch tieroch). Kratší `attenuationDistanceM` = sýtejší tón (Beer–Lambert po
// kanáli, viď `materialy.ts` header).
const VZHLADY: Record<BazenVyplnTyp, SkloVzhlad> = {
	// číry — vysoká priehľadnosť, jemný chladný nádych
	cire: {
		farbaHex: 0xf4f8f6,
		attenuationHex: 0x6fae95,
		attenuationDistanceM: 0.09,
		opacity: 0.22,
		roughness: 0.08
	},
	// opálový (mliečny) — mliečne rozptýlené svetlo, výrazne vyššia drsnosť
	opalove: {
		farbaHex: 0xf0f2f2,
		attenuationHex: 0xb8c0c2,
		attenuationDistanceM: 0.06,
		opacity: 0.66,
		roughness: 0.55
	},
	// dymový (bronzový) — teplý hnedo-bronzový tón, tlmenie priameho slnka
	dymove: {
		farbaHex: 0xdcc9b0,
		attenuationHex: 0x5c4022,
		attenuationDistanceM: 0.04,
		opacity: 0.5,
		roughness: 0.12
	}
};

/** Vzhľad výplne pre daný typ. Neznámy/neplatný typ padne na `cire` (nikdy
 *  nevráti undefined — materiál musí vždy dostať platný vzhľad). */
export function bazenVyplnVzhlad(typ: BazenVyplnTyp | undefined): SkloVzhlad {
	return VZHLADY[typ ?? BAZEN_VYPLN_TYP_DEFAULT] ?? VZHLADY[BAZEN_VYPLN_TYP_DEFAULT];
}

/** Typ výplne z jej zákazníckeho NÁZVU (kategórie) — heuristika na podreťazec,
 *  aby vizuál vrstva ostala oddelená od `konfigurator-bazen` (žiadny import
 *  wizard modulu → money-safety import-graf ostáva čistý). Neznámy názov → `cire`
 *  (bezpečný default — číra výplň). */
export function bazenVyplnTyp(nazov: string | null | undefined): BazenVyplnTyp {
	const s = String(nazov ?? '').toLowerCase();
	if (s.includes('opál') || s.includes('opal') || s.includes('mlie')) return 'opalove';
	if (s.includes('dym') || s.includes('bronz')) return 'dymove';
	return 'cire';
}

/** Priamo názov → vzhľad (skratka pre wrapper komponent). */
export function bazenVyplnVzhladZNazvu(nazov: string | null | undefined): SkloVzhlad {
	return bazenVyplnVzhlad(bazenVyplnTyp(nazov));
}
