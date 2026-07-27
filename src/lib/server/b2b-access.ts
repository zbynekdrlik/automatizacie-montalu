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
	'/zasklenia/nastavenia'
];

/** Cieľ presmerovania pre b2b, alebo null keď cesta je povolená. */
export function b2bRedirectTarget(pathname: string): string | null {
	if (pathname === '/') return '/zasklenia';
	for (const p of B2B_FORBIDDEN_PREFIXES)
		if (pathname === p || pathname.startsWith(p + '/')) return '/zasklenia';
	return null;
}
