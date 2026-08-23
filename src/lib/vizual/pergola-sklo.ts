// Zákaznícky 3D vizuál pergoly (#276) — mapovanie typu strešného skla na jeho
// vizuálny vzhľad (priehľadnosť/farba/útlm). Čistá logika (žiadny THREE/DOM
// import) — konzument (`materialy.ts` cez `vytvorSkloMaterial`/`nastavSkloVzhlad`)
// dostane iba tento `SkloVzhlad` tvar a nastaví ho na materiál. `import type`
// nesie NULOVÝ runtime dôsledok (žiadny prístup k THREE ani k Money ceste).
import type { SkloVzhlad } from './materialy';

/** Typy strešného skla ponúkané v zákazníckom konfigurátore pergoly. Vizuál, nie
 *  katalóg — nemapuje sa na žiadny Money kód ani cenu (to je scope inde). */
export type PergolaTypSkla = 'cire' | 'dymove' | 'bronzove' | 'matne';

export const PERGOLA_TYP_SKLA_DEFAULT: PergolaTypSkla = 'cire';

/** Ľudský (slovenský) názov typu skla pre popisok pod obrázkom (nikdy do
 *  rastra — §2.6). */
export const PERGOLA_SKLA_NAZVY: Record<PergolaTypSkla, string> = {
	cire: 'Číre sklo',
	dymove: 'Dymové sklo',
	bronzove: 'Bronzové sklo',
	matne: 'Matné (opál) sklo'
};

// Vzhľady jednotlivých typov. `transmission` režim (mid/high tier) číta
// `farbaHex`/`attenuationHex`/`attenuationDistanceM`, `falosne` (low tier) číta
// `farbaHex`/`opacity`/`roughness` — preto každý typ nesie oba páry, nech
// vyzerá konzistentne na oboch tieroch. Kratší `attenuationDistanceM` = sýtejší
// tón (Beer–Lambert po kanáli, viď `materialy.ts` header).
const VZHLADY: Record<PergolaTypSkla, SkloVzhlad> = {
	// číre — jemný chladný nádych, vysoká priehľadnosť (blízke pôvodnému
	// zasklenia sklu)
	cire: {
		farbaHex: 0xf2faf7,
		attenuationHex: 0x2f9478,
		attenuationDistanceM: 0.06,
		opacity: 0.16,
		roughness: 0.05
	},
	// dymové — neutrálna sivá, stredná priehľadnosť
	dymove: {
		farbaHex: 0xd6dade,
		attenuationHex: 0x3d444b,
		attenuationDistanceM: 0.028,
		opacity: 0.4,
		roughness: 0.06
	},
	// bronzové — teplý hnedo-bronzový tón
	bronzove: {
		farbaHex: 0xe8d7bd,
		attenuationHex: 0x6b4a24,
		attenuationDistanceM: 0.03,
		opacity: 0.4,
		roughness: 0.06
	},
	// matné (opál) — mliečne, nižšia priehľadnosť, výrazne vyššia drsnosť
	matne: {
		farbaHex: 0xeef1f3,
		attenuationHex: 0x9aa4ac,
		attenuationDistanceM: 0.05,
		opacity: 0.62,
		roughness: 0.5
	}
};

/** Vzhľad skla pre daný typ. Neznámy/neplatný typ padne na `cire` (nikdy nevráti
 *  undefined — materiál musí vždy dostať platný vzhľad). */
export function pergolaSkloVzhlad(typ: PergolaTypSkla | undefined): SkloVzhlad {
	return VZHLADY[typ ?? PERGOLA_TYP_SKLA_DEFAULT] ?? VZHLADY[PERGOLA_TYP_SKLA_DEFAULT];
}
