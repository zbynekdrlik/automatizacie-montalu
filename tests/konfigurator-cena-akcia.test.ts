// Kontrakt zdieľanej throttle predohry cenových `vypocet` akcií (`cenaThrottle`, #428). Extrahovaná
// per-IP rate-limit predohra 4 route akcií (pergola/bazén/zimná záhrada/oplotenie). Overuje POVOLENÚ
// vetvu (→ null), prekročenie limitu (→ fail(429) s BYTE-IDENTICKÝM tvarom `{...prazdno, error}` vrátane
// poradia kľúčov + retry-after hlavička) aj `getClientAddress()` throw (→ catch, endpoint sa nezhodí).
import { describe, it, expect, beforeEach } from 'vitest';
import { cenaThrottle } from '../src/lib/server/konfigurator-cena-akcia';
import {
	allowRequest,
	KONF_MAX_REQ,
	_resetPublicThrottle
} from '../src/lib/server/public-throttle';

type ThrottleEvent = Parameters<typeof cenaThrottle>[0];

function fakeEvent(
	getAddr: () => string,
	onSetHeaders?: (h: Record<string, string>) => void
): ThrottleEvent {
	return {
		request: { headers: { get: () => null } },
		getClientAddress: getAddr,
		setHeaders: (h: Record<string, string>) => onSetHeaders?.(h)
	} as unknown as ThrottleEvent;
}

// `fail(status, body)` konštruuje ActionFailure { status, data } (viď @sveltejs/kit).
type ActionFail = { status: number; data: Record<string, unknown> };

describe('cenaThrottle (#428 zdieľaná throttle predohra cenových vypocet akcií)', () => {
	beforeEach(() => _resetPublicThrottle());

	it('POVOLENÁ požiadavka → null (volateľ pokračuje parse → cena)', () => {
		const r = cenaThrottle(
			fakeEvent(() => '1.2.3.4'),
			{ cena: null, cenyModely: null }
		);
		expect(r).toBeNull();
	});

	it('getClientAddress() hodí → catch (edgeIp undefined) → null, endpoint sa NEzhodí', () => {
		const r = cenaThrottle(
			fakeEvent(() => {
				throw new Error('ADDRESS_HEADER nastavený, hlavička chýba');
			}),
			{ cena: null }
		);
		expect(r).toBeNull();
	});

	it('prekročený rate-limit → fail(429) s tvarom {cena,cenyModely,error} + retry-after', () => {
		// vyčerpaj okno tej istej IP (rovnaký bucket kľúč, aký `cenaThrottle` odvodí z „9.9.9.9")
		for (let i = 0; i < KONF_MAX_REQ; i++) allowRequest('9.9.9.9');
		const headers: Array<Record<string, string>> = [];
		const r = cenaThrottle(
			fakeEvent(
				() => '9.9.9.9',
				(h) => headers.push(h)
			),
			{
				cena: null,
				cenyModely: null
			}
		) as unknown as ActionFail;
		expect(r.status).toBe(429);
		expect(r.data).toEqual({
			cena: null,
			cenyModely: null,
			error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.'
		});
		// poradie kľúčov: prázdne dátové polia PRED error (byte-identické s pôvodným inline tvarom)
		expect(Object.keys(r.data)).toEqual(['cena', 'cenyModely', 'error']);
		expect(headers[0]).toEqual({ 'retry-after': '60' }); // okno 60 000 ms → 60 s
	});

	it('pergolový `prazdno` tvar {vysledok:null} → 429 nesie {vysledok:null, error}', () => {
		for (let i = 0; i < KONF_MAX_REQ; i++) allowRequest('8.8.8.8');
		const r = cenaThrottle(
			fakeEvent(() => '8.8.8.8'),
			{
				vysledok: null
			}
		) as unknown as ActionFail;
		expect(r.status).toBe(429);
		expect(r.data).toEqual({
			vysledok: null,
			error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.'
		});
		expect(Object.keys(r.data)).toEqual(['vysledok', 'error']);
	});
});
