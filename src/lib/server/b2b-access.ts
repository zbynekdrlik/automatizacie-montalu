// B2B smie LEN /zasklenia (nie /zasklenia/nastavenia). Denylist (nie allowlist) —
// allowlist by zablokoval SvelteKit assety /_app/* → prázdna stránka. Assety nikdy
// nesadnú na denylist, takže prejdú.
const B2B_FORBIDDEN_PREFIXES = [
	'/pergola',
	'/fix',
	'/bazen',
	// CLIP zábradlie nárez + Money odpis (#372) — interný Money-zápisový modul,
	// b2b nemá požiadavku; drift guard: tests/b2b-route-coverage.test.ts
	'/clip',
	'/odpisy',
	'/problem',
	'/pouzivatelia',
	'/zasklenia/nastavenia',
	// interná demo/preview stránka pre návrhové výkresy (#137) — nikdy pre b2b
	'/vykresy',
	// nárezový optimalizátor (#212) — kalkulačka pre dielňu (interní), žiadny Money
	// odpis; b2b nemá požiadavku, konvencia = nová route zakázaná, kým sa vedome
	// nerozhodne inak (drift guard: tests/b2b-route-coverage.test.ts)
	'/optimalizator',
	// #245: test-only route na overenie chybovej stránky (v prode 404, len E2E ju
	// zapína cez ENABLE_TEST_ERROR_ROUTE) — b2b sem nemá čo robiť; drift guard
	// (tests/b2b-route-coverage.test.ts) beztak vyžaduje, aby bola v denyliste.
	'/__test-error',
	// #282: interný prehľad zákazníckych dopytov z konfigurátora — INTERNÉ-only
	// (kontaktné údaje + súhrn + re-download PDF). Pokrýva aj /dopyty-konfigurator/pdf
	// (GET endpoint) prefixom. b2b sem nemá prístup; drift guard to vynúti.
	'/dopyty-konfigurator',
	// #5960: „Uložiť ponuku" → Odoo sale.order per-user Odoo kredenciálom. Len pre interných
	// Odoo používateľov (`source:'odoo'`); b2b (lokálny `role:'b2b'`) sem nemá čo robiť — a
	// endpoint by ho beztak odmietol. Drift guard (tests/b2b-route-coverage.test.ts) to vynúti.
	'/ulozit-ponuku'
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
