// #5822: čisté base-path helpery (žiadny SvelteKit runtime import → jednoducho
// unit-testovateľné). Appka môže bežať pod `/automatizacie/` (same-origin s Odoo,
// aby sa dala vložiť do webclient iframe) ALEBO na koreni origin (dnešný samostatný
// VPS). `base` sa čerpá z `$app/paths` (bakované pri builde z `APP_BASE_PATH`); tieto
// helpery ju dostávajú ako argument, aby ostali čisté.

/**
 * Vráti base-relatívnu appka cestu (bez `base` prefixu) pre porovnania v `hooks.server.ts`
 * (auth brána `PUBLIC_PATHS`, b2b denylist `b2bRedirectTarget`) — tie ostávajú base-LESS
 * a nezmenené, base sa rieši len tu a pri tvorbe redirect Location.
 *
 * `base=""` (dnešný koreň) → pathname sa vráti nezmenený (byte-identicky ako dnes).
 * Prefix sa odreže IBA keď pathname je presne `base` alebo pokračuje `base + "/"` —
 * takže `base="/app"` NEodreže `/application` (klasický prefix-false-match, fail-safe).
 * Cesta mimo base (v prode sa nestane — nginx routuje len `base/*`) sa vráti nezmenená.
 */
export function stripBase(pathname: string, base: string): string {
	if (base) {
		if (pathname === base) return '/';
		if (pathname.startsWith(base + '/')) return pathname.slice(base.length);
	}
	return pathname || '/';
}

export interface FrameGuard {
	/** Hodnota `Content-Security-Policy` (len `frame-ancestors …`) — set keď je framing povolený. */
	csp?: string;
	/** `X-Frame-Options` hodnota — set keď framing NIE JE povolený (dnešné `DENY`). */
	xFrameOptions?: string;
}

/**
 * Sanitizuje hodnotu `frame-ancestors`. Whitelist znakov reálnych zdrojov
 * (`'self'`, `https://erp.montalu.cloud`, `https://*.newlevel.media`, `'none'`):
 * písmená/číslice, medzera, `.:*'/_-`. Čokoľvek iné (CR/LF/control ⇒ obrana proti
 * header-injection; `;` ⇒ zabráni vloženiu ĎALŠEJ CSP direktívy, hodnota ostáva
 * JEDINÁ `frame-ancestors` direktíva) sa nahradí medzerou; medzery sa znormalizujú
 * a oreže sa. Prázdne po sanitizácii ⇒ `""` (volajúci to berie ako „unset").
 */
function sanitizeFrameAncestors(v: string | undefined | null): string {
	if (!v) return '';
	return v
		.replace(/[^A-Za-z0-9 .:*'/_-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Env-gated iframe povolenie. `frameAncestors` (z `APP_FRAME_ANCESTORS`) prázdne/unset ⇒
 * dnešné `X-Frame-Options: DENY` (byte-identicky); nastavené ⇒ `Content-Security-Policy:
 * frame-ancestors <hodnota>` a ŽIADNE `X-Frame-Options` (práve jedna z hlavičiek naraz,
 * aby nekonfliktovali). Cieľová go-live hodnota:
 * `'self' https://erp.montalu.cloud https://*.newlevel.media`.
 */
export function frameGuardHeaders(frameAncestors: string | undefined | null): FrameGuard {
	const v = sanitizeFrameAncestors(frameAncestors);
	if (v) return { csp: `frame-ancestors ${v}` };
	return { xFrameOptions: 'DENY' };
}
