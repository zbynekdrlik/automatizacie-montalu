// #264: reálna klientska IP za Cloudflare (throttle kľúč + audit log).
//
// Reťazec: klient → Cloudflare edge → Caddy (`reverse_proxy automatizacie-montalu:3000`,
// žiadne trusted_proxies) → app kontajner. Caddy pridá ako POSLEDNÝ prvok X-Forwarded-For
// IP priameho peera = CF edge node, takže adapter-node `getClientAddress()` (XFF_DEPTH=1 →
// posledný XFF prvok) vracia CF edge IP, nie prehliadač klienta. Cloudflare popri tom
// nastavuje autoritatívnu `Cf-Connecting-Ip` (reálna klientska IP; klient ju cez CF nevie
// podvrhnúť, CF ju prepisuje) a Caddy ju bez zmeny prepošle.
//
// Fix (prístup C, #264): dôveruj `Cf-Connecting-Ip` LEN keď priamy hop (edge IP z XFF)
// je preukázateľne Cloudflare IP → požiadavka reálne prešla cez CF. Inak (niekto trafil
// origin priamo mimo CF, alebo CF vypadol) fallback na edge IP — Caddym pripojený skutočný
// peer, ktorý klient nevie ovplyvniť. Spoof-safe (fake Cf-Connecting-Ip pri priamom hite na
// origin sa ignoruje) aj CF-down-safe (throttle beží ďalej na reálnej peer IP). Bez zásahu
// do infra (Caddyfile) — appka sa nespolieha na proxy config (defense-in-depth ako #251).
//
// CIDR match: žiadna 3rd-party lib (bundling riziko pod Vite SSR + adapter-node pre pár
// desiatok riadkov — rovnaká úvaha ako #245/#251). CF rozsahy sú statický, roky stabilný
// zoznam z https://www.cloudflare.com/ips/; Node builtiny (`node:net` na validáciu rodiny,
// uint32 pre v4, BigInt pre v6) to pokryjú presne.
import { isIP } from 'node:net';

/** Oficiálne Cloudflare IPv4 rozsahy — https://www.cloudflare.com/ips-v4 */
const CF_IPV4 = [
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'108.162.192.0/18',
	'190.93.240.0/20',
	'188.114.96.0/20',
	'197.234.240.0/22',
	'198.41.128.0/17',
	'162.158.0.0/15',
	'104.16.0.0/13',
	'104.24.0.0/14',
	'172.64.0.0/13',
	'131.0.72.0/22'
];

/** Oficiálne Cloudflare IPv6 rozsahy — https://www.cloudflare.com/ips-v6 */
const CF_IPV6 = [
	'2400:cb00::/32',
	'2606:4700::/32',
	'2803:f800::/32',
	'2405:b500::/32',
	'2405:8100::/32',
	'2a06:98c0::/29',
	'2c0f:f248::/32'
];

/** IPv4 dotted-quad → uint32, alebo null pri nevalidnom tvare. */
function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return null;
		const v = Number(p);
		if (v > 255) return null;
		n = n * 256 + v;
	}
	return n >>> 0;
}

function cidrMatchV4(ipInt: number, cidr: string): boolean {
	const [base = '', prefixStr] = cidr.split('/');
	const prefix = Number(prefixStr);
	const baseInt = ipv4ToInt(base);
	if (baseInt === null) return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipInt & mask) >>> 0 === (baseInt & mask) >>> 0;
}

/**
 * IPv6 → 128-bit BigInt (podpora `::` kompresie). Vnorená IPv4 (`::ffff:1.2.3.4`) nie je
 * podporovaná (CF edge IP sú natívne v6) → vráti null = bezpečný „nie CF" fallback.
 */
function ipv6ToBigInt(ip: string): bigint | null {
	if (ip.includes('.')) return null;
	const halves = ip.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
	if (halves.length === 1) {
		if (head.length !== 8) return null;
	} else if (head.length + tail.length >= 8) {
		return null; // `::` musí zastúpiť aspoň jednu skupinu núl
	}
	const missing = 8 - head.length - tail.length;
	const filler: string[] = new Array<string>(missing).fill('0');
	const groups = [...head, ...filler, ...tail];
	let result = 0n;
	for (const g of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
		result = (result << 16n) | BigInt(parseInt(g, 16));
	}
	return result;
}

function cidrMatchV6(ipInt: bigint, cidr: string): boolean {
	const [base = '', prefixStr] = cidr.split('/');
	const prefix = Number(prefixStr);
	const baseInt = ipv6ToBigInt(base);
	if (baseInt === null) return false;
	const shift = 128n - BigInt(prefix);
	return ipInt >> shift === baseInt >> shift;
}

/** True ak `ip` patrí do niektorého publikovaného Cloudflare rozsahu (v4 alebo v6). */
export function isCloudflareIp(ip: string | undefined): boolean {
	if (!ip) return false;
	const fam = isIP(ip);
	if (fam === 4) {
		const n = ipv4ToInt(ip);
		return n !== null && CF_IPV4.some((c) => cidrMatchV4(n, c));
	}
	if (fam === 6) {
		const n = ipv6ToBigInt(ip);
		return n !== null && CF_IPV6.some((c) => cidrMatchV6(n, c));
	}
	return false;
}

/**
 * Reálna klientska IP pre throttle kľúč + log. `edgeIp` = posledný XFF prvok
 * (`getClientAddress()` s XFF_DEPTH=1) = priamy peer na Caddy. Ak je edgeIp Cloudflare IP,
 * požiadavka prešla cez CF → vráť validovanú `Cf-Connecting-Ip` (reálny klient). Inak
 * fallback na edgeIp (Caddym pripojený skutočný peer — spoof-safe aj pri výpadku CF).
 */
export function resolveClientIp(
	edgeIp: string | undefined,
	cfConnectingIp: string | null | undefined
): string | undefined {
	if (edgeIp && isCloudflareIp(edgeIp)) {
		const cf = cfConnectingIp?.trim();
		if (cf && isIP(cf) !== 0) return cf;
	}
	return edgeIp;
}
