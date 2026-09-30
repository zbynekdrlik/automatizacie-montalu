// #592 (Odoo úloha 1220, Marek 29.9.; ROZHODNUTÉ owner 30.9. „1"): „Fixy" a „Clip" zjednotené
// pod „Pevné zasklenie" — „fix z appky, fix z cadu, a zábradlia". V hornej lište je to JEDEN
// obyčajný odkaz na /fix (žiadny dropdown), výber režimu sú TRI veľké karty pod nadpisom stránky
// (`$lib/components/PevneZasklenieKarty.svelte`, na /fix, /fix/cad aj /clip). Tu žijú čisté dáta
// kariet + aktívny stav lišty (unit test `tests/nav-pevne-zasklenie.test.ts`). URL sa NEMENIA.
//
// Ďalší typ pevného zasklenia (napr. zábradlia iného systému) = nový riadok v
// `PEVNE_ZASKLENIE_KARTY` + `<PevneZasklenieKarty aktivna=…>` na jeho stránke, nič iné.
// B2B: všetky tri routy sú v `B2B_FORBIDDEN_PREFIXES`, preto b2b nemá odkaz v lište a na stránky
// s kartami sa nedostane; drift guard v unit teste padne, ak by sa niektorá b2b sprístupnila bez
// filtrovania kariet.
import type { RouteId } from '$app/types';

export const PEVNE_ZASKLENIE_KARTY = [
	{
		href: '/fix',
		nadpis: 'Fix z appky',
		stitok: 'z rozmerov',
		popis: 'Zadaj rozmery — vykreslím výkres konštrukcie na tlač. Do Money nejde nič.'
	},
	{
		href: '/fix/cad',
		nadpis: 'Fix z cadu',
		stitok: 'CAD → Money',
		popis: 'Máš hotový CAD nárez — prepíšem ho na Money odpis a počty tyčí pre Solid Edge.'
	},
	// CLIP zábradlie nárez + Money odpis (#372) — v Money modelované ako „Pevné zasklenie Clip"
	{
		href: '/clip',
		nadpis: 'Zábradlia (CLIP)',
		stitok: 'zábradlie → Money',
		popis: 'Zadaj rozmer zábradlia a počet výplní — rozpis rezov, odpis do Money a objednávka skla.'
	}
] as const satisfies readonly { href: RouteId; nadpis: string; stitok: string; popis: string }[];

export type PevneZasklenieHref = (typeof PEVNE_ZASKLENIE_KARTY)[number]['href'];

/** Jediný odkaz v hornej lište — vedie na prvú kartu (Fix z appky). */
export const PEVNE_ZASKLENIE_NAV = {
	href: '/fix',
	label: 'Pevné zasklenie'
} as const satisfies { href: PevneZasklenieHref; label: string };

/**
 * Je `pathname` stránka skupiny „Pevné zasklenie" (odkaz v lište je aktívny)? Presná zhoda s
 * niektorou kartou alebo jej pod-cesta (`/fix` pokrýva aj `/fix/cad`; nie `/fixy`). Odvodené
 * priamo zo zoznamu kariet, takže nový riadok netreba nikde inde dopĺňať.
 */
export function jePevneZasklenie(pathname: string): boolean {
	return PEVNE_ZASKLENIE_KARTY.some(
		({ href }) => pathname === href || pathname.startsWith(href + '/')
	);
}
