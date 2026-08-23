// AR náhľad pergoly (#286) — samostatná AR viewer stránka (cieľ desktop→telefón QR;
// funguje aj priamo na mobile). UNIVERZÁLNY load (`+page.ts`, nie `+page.server.ts`) —
// číta konfiguráciu z query parametrov, bez servera → NIE JE „write-bearing" (b2b drift
// guard ju nepokrýva) a je Money-neutrálny (žiadny import katalógu/ceny/servera).
import type { PageLoad } from './$types';

function cislo(v: string | null): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.trim()
	);
}

export const load: PageLoad = ({ url }) => {
	const q = url.searchParams;
	const sirkaMm = cislo(q.get('sirka'));
	const hlbkaMm = cislo(q.get('hlbka'));
	const vyskaVpreduMm = cislo(q.get('vyskaVpredu'));
	const vyskaPriSteneMm = cislo(q.get('vyskaPriStene'));
	const typSkla = String(q.get('sklo') ?? '');
	const ralKod = String(q.get('farba') ?? '');
	const platne =
		Number.isFinite(sirkaMm) &&
		Number.isFinite(hlbkaMm) &&
		Number.isFinite(vyskaVpreduMm) &&
		Number.isFinite(vyskaPriSteneMm) &&
		sirkaMm > 0 &&
		hlbkaMm > 0 &&
		vyskaVpreduMm > 0 &&
		vyskaPriSteneMm > 0;
	return { sirkaMm, hlbkaMm, vyskaVpreduMm, vyskaPriSteneMm, typSkla, ralKod, platne };
};
