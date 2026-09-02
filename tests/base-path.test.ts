// #5822: čisté base-path helpery (bez SvelteKit runtime) — appka môže bežať pod
// `/automatizacie/` (same-origin s Odoo, iframe) alebo na koreni origin (dnešný VPS).
// `stripBase` = base-relatívna appka cesta pre porovnania v hooks (auth brána, b2b
// denylist ostávajú base-LESS a nezmenené); `frameGuardHeaders` = env-gated
// `frame-ancestors` CSP vs dnešný `X-Frame-Options: DENY`.
import { describe, it, expect } from 'vitest';
import { stripBase, frameGuardHeaders } from '../src/lib/base-path';

describe('#5822 stripBase — base-relatívna appka cesta', () => {
	it('base="" (dnešný koreň) → pathname nezmenený (byte-identicky)', () => {
		expect(stripBase('/zasklenia', '')).toBe('/zasklenia');
		expect(stripBase('/', '')).toBe('/');
		expect(stripBase('/login?next=/x', '')).toBe('/login?next=/x');
	});

	it('base nastavená → odstráni prefix', () => {
		expect(stripBase('/automatizacie/zasklenia', '/automatizacie')).toBe('/zasklenia');
		expect(stripBase('/automatizacie/dopyty-konfigurator/pdf', '/automatizacie')).toBe(
			'/dopyty-konfigurator/pdf'
		);
	});

	it('presná zhoda base (root appky) → "/"', () => {
		expect(stripBase('/automatizacie', '/automatizacie')).toBe('/');
		expect(stripBase('/automatizacie/', '/automatizacie')).toBe('/');
	});

	it('prefix-false-match: base="/app" vs "/application" sa NEodreže (fail-safe)', () => {
		expect(stripBase('/application', '/app')).toBe('/application');
	});

	it('cesta mimo base (v prode sa nestane, nginx routuje len base/*) → fail-safe pôvodná', () => {
		expect(stripBase('/other', '/automatizacie')).toBe('/other');
	});

	it('prázdny pathname → "/"', () => {
		expect(stripBase('', '')).toBe('/');
		expect(stripBase('', '/automatizacie')).toBe('/');
	});
});

describe('#5822 frameGuardHeaders — env-gated iframe povolenie', () => {
	it('unset/prázdne → X-Frame-Options: DENY (dnešné správanie), žiadne CSP', () => {
		for (const v of [undefined, null, '', '   ']) {
			const h = frameGuardHeaders(v);
			expect(h.xFrameOptions).toBe('DENY');
			expect(h.csp).toBeUndefined();
		}
	});

	it('nastavené → Content-Security-Policy: frame-ancestors <hodnota>, žiadne X-Frame-Options', () => {
		const h = frameGuardHeaders("'self' https://erp.montalu.cloud https://*.newlevel.media");
		expect(h.csp).toBe("frame-ancestors 'self' https://erp.montalu.cloud https://*.newlevel.media");
		expect(h.xFrameOptions).toBeUndefined();
	});

	it("jednoduchá hodnota 'none' (deny cez CSP) je platná", () => {
		expect(frameGuardHeaders("'none'").csp).toBe("frame-ancestors 'none'");
	});

	it('header-injection: CR/LF/control znaky sa odstránia (žiadny header split)', () => {
		const h = frameGuardHeaders("'self'\r\nSet-Cookie: evil=1");
		expect(h.csp).toMatch(/^frame-ancestors /);
		expect(h.csp).not.toContain('\r');
		expect(h.csp).not.toContain('\n');
	});

	it("direktíva-injection: ';' sa odstráni → hodnota ostáva JEDINÁ frame-ancestors direktíva", () => {
		const h = frameGuardHeaders("'self'; script-src 'unsafe-inline'");
		expect(h.csp).not.toContain(';');
		expect(h.csp).toMatch(/^frame-ancestors /);
	});

	it('okolité/nadbytočné medzery sa normalizujú a orežú', () => {
		expect(frameGuardHeaders('   \t  ')).toEqual({ xFrameOptions: 'DENY' });
		expect(frameGuardHeaders("  'self'   https://a  ").csp).toBe(
			"frame-ancestors 'self' https://a"
		);
	});
});
