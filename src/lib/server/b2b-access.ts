// B2B smie LEN /zasklenia (nie /zasklenia/nastavenia). Denylist (nie allowlist) —
// allowlist by zablokoval SvelteKit assety /_app/* → prázdna stránka. Assety nikdy
// nesadnú na denylist, takže prejdú.
const B2B_FORBIDDEN_PREFIXES = [
	'/pergola',
	'/fix',
	'/bazen',
	'/odpisy',
	'/problem',
	'/pouzivatelia',
	'/zasklenia/nastavenia',
	// interná demo/preview stránka pre návrhové výkresy (#137) — nikdy pre b2b
	'/vykresy'
];

// Podcesty POD inak zakázaným prefixom, ktoré sú pre b2b predsa len povolené (#144) —
// presná zhoda alebo pod-cesta. Zámerne úzke a explicitné (nikdy heuristika typu
// "obsahuje navrh"): každý ZÁKAZNÍCKY NÁVRHOVÝ (display-only) výkres, ktorý žije pod
// inak zakázaným Money-zápisovým prefixom (napr. /pergola = CAD nárez → Money odpis).
// Kontroluje sa PRED B2B_FORBIDDEN_PREFIXES, takže samotné /pergola aj akákoľvek INÁ
// /pergola/* podcesta ostávajú blokované — drift guard: tests/b2b-route-coverage.test.ts.
const B2B_ALLOWED_EXCEPTIONS = ['/pergola/navrh'];

/** Cieľ presmerovania pre b2b, alebo null keď cesta je povolená. */
export function b2bRedirectTarget(pathname: string): string | null {
	if (pathname === '/') return '/zasklenia';
	for (const ex of B2B_ALLOWED_EXCEPTIONS)
		if (pathname === ex || pathname.startsWith(ex + '/')) return null;
	for (const p of B2B_FORBIDDEN_PREFIXES)
		if (pathname === p || pathname.startsWith(p + '/')) return '/zasklenia';
	return null;
}
