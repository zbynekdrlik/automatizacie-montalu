// #264: reálna klientska IP za Cloudflare. Reťazec klient → CF edge → Caddy → app.
// Caddy pridá CF edge ako POSLEDNÝ XFF prvok, takže getClientAddress() (XFF_DEPTH=1)
// vracia CF edge IP, nie reálneho klienta — throttle kľúč (username, ip) degraduje na
// zdieľaný CF PoP. Fix: dôveruj autoritatívnej `Cf-Connecting-Ip` LEN keď priamy hop
// (edge) je preukázateľne Cloudflare IP, inak fallback na edge (spoof-safe, CF-down-safe).
import { describe, it, expect } from 'vitest';
import { isCloudflareIp, resolveClientIp } from '../src/lib/server/client-ip';

describe('isCloudflareIp — CIDR match voči oficiálnym CF rozsahom', () => {
	it('CF IPv4 edge (naživo zalogovaná 172.70.225.170 ∈ 172.64.0.0/13) → true', () => {
		expect(isCloudflareIp('172.70.225.170')).toBe(true);
	});
	it('ďalší CF IPv4 rozsah (104.16.0.0/13) → true', () => {
		expect(isCloudflareIp('104.16.5.9')).toBe(true);
	});
	it('CF IPv6 (2606:4700::/32) → true', () => {
		expect(isCloudflareIp('2606:4700:0:0:0:0:0:1111')).toBe(true);
		expect(isCloudflareIp('2606:4700::1111')).toBe(true); // :: kompresia
	});
	it('reálna klientska IPv4 mimo CF (85.248.11.235) → false', () => {
		expect(isCloudflareIp('85.248.11.235')).toBe(false);
	});
	it('cudzia IPv4 (8.8.8.8) → false', () => {
		expect(isCloudflareIp('8.8.8.8')).toBe(false);
	});
	it('cudzia IPv6 (Google DNS) → false', () => {
		expect(isCloudflareIp('2001:4860:4860::8888')).toBe(false);
	});
	it('CF IPv6 z ďalších rozsahov (2400:cb00::/32, 2c0f:f248::/32) → true', () => {
		expect(isCloudflareIp('2400:cb00::1')).toBe(true);
		expect(isCloudflareIp('2c0f:f248::abcd')).toBe(true);
	});
	it('IPv6 s vedúcim `::` (loopback ::1) → false (mimo CF, pokrýva head-empty vetvu)', () => {
		expect(isCloudflareIp('::1')).toBe(false);
		expect(isCloudflareIp('::')).toBe(false);
	});
	it('nevalidný / prázdny / undefined vstup → false (bezpečný fallback)', () => {
		expect(isCloudflareIp('nonsense')).toBe(false);
		expect(isCloudflareIp('')).toBe(false);
		expect(isCloudflareIp(undefined)).toBe(false);
		expect(isCloudflareIp('999.1.1.1')).toBe(false);
	});
});

describe('resolveClientIp — reálny klient za Cloudflare (#264 regresia)', () => {
	it('CF edge + platná Cf-Connecting-Ip → REÁLNY klient, nie edge IP', () => {
		// PRESNE bug z #251 post-deploy: edge=CF PoP, reálny klient v Cf-Connecting-Ip
		expect(resolveClientIp('172.70.225.170', '85.248.11.235')).toBe('85.248.11.235');
	});
	it('non-CF edge + podvrhnutá Cf-Connecting-Ip → fallback na edge (spoof-safe)', () => {
		// útočník trafí origin priamo mimo CF a podstrčí fake hlavičku → NEDÔVERUJ jej,
		// kľúčuj jeho reálnu (Caddym pripojenú) peer IP
		expect(resolveClientIp('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9');
	});
	it('CF edge + chýbajúca Cf-Connecting-Ip → fallback na edge', () => {
		expect(resolveClientIp('172.70.225.170', null)).toBe('172.70.225.170');
	});
	it('CF edge + nevalidná Cf-Connecting-Ip → fallback na edge (nedôveruj balastu)', () => {
		expect(resolveClientIp('172.70.225.170', 'nonsense')).toBe('172.70.225.170');
	});
	it('undefined edge (chýbajúci XFF) → undefined aj keď hlavička je (nevieme overiť hop)', () => {
		expect(resolveClientIp(undefined, '85.248.11.235')).toBe(undefined);
	});
	it('oreže whitespace v Cf-Connecting-Ip pred dôverou', () => {
		expect(resolveClientIp('172.70.225.170', '  85.248.11.235  ')).toBe('85.248.11.235');
	});
});
