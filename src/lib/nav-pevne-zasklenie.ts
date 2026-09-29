// #592 (Odoo úloha 1220, Marek 29.9.): „Fixy" a „Clip" v hornej lište zjednotené pod JEDNU
// položku „Pevné zasklenie" — „fix z appky, fix z cadu, a zábradlia". Tu žije zoznam volieb a
// aktívny stav skupiny (čisté dáta → unit test `tests/nav-pevne-zasklenie.test.ts`); render je
// v `src/routes/+layout.svelte`. URL sa NEMENIA (žiadne presmerovanie) — skupina je len navigácia.
//
// Ďalší typ pevného zasklenia (napr. zábradlia iného systému) = nový riadok tu, nič iné.
// B2B: všetky tri routy sú v `B2B_FORBIDDEN_PREFIXES`, preto b2b vetva lišty skupinu vôbec
// nerenderuje; drift guard v unit teste padne, ak by sa niektorá b2b sprístupnila bez filtra.
import type { RouteId } from '$app/types';

export const PEVNE_ZASKLENIE_LABEL = 'Pevné zasklenie';

export const PEVNE_ZASKLENIE_LINKS = [
	{ href: '/fix', label: 'Fix z appky' },
	{ href: '/fix/cad', label: 'Fix z CADu' },
	// CLIP zábradlie nárez + Money odpis (#372) — v Money modelované ako „Pevné zasklenie Clip"
	{ href: '/clip', label: 'Zábradlia (CLIP)' }
] as const satisfies readonly { href: RouteId; label: string }[];

// Prefixy vetiev, na ktorých je skupina aktívna (celé /fix* vrátane /fix/cad, a /clip*).
const PREFIXY = ['/fix', '/clip'] as const;

/** Je `pathname` stránka skupiny „Pevné zasklenie"? Presná zhoda alebo pod-cesta (nie `/fixy`). */
export function jePevneZasklenie(pathname: string): boolean {
	return PREFIXY.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
