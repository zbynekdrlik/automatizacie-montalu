// AR náhľad pergoly (#286) — samostatná AR viewer stránka (cieľ desktop→telefón QR;
// funguje aj priamo na mobile). UNIVERZÁLNY load (`+page.ts`, nie `+page.server.ts`) —
// číta konfiguráciu z query parametrov, bez servera → NIE JE „write-bearing" (b2b drift
// guard ju nepokrýva) a je Money-neutrálny (žiadny import katalógu/ceny/servera).
import type { PageLoad } from './$types';
import {
	KONF_SIRKA_MIN,
	KONF_SIRKA_MAX,
	KONF_HLBKA_MIN,
	KONF_HLBKA_MAX,
	KONF_VYSKA_MIN,
	KONF_VYSKA_MAX,
	KONF_VYSKA_STENA_MAX
} from '$lib/konfigurator';

function cislo(v: string | null): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.trim()
	);
}

function vRozmedzi(x: number, min: number, max: number): boolean {
	return Number.isFinite(x) && x >= min && x <= max;
}

export const load: PageLoad = ({ url }) => {
	const q = url.searchParams;
	const sirkaMm = cislo(q.get('sirka'));
	const hlbkaMm = cislo(q.get('hlbka'));
	const vyskaVpreduMm = cislo(q.get('vyskaVpredu'));
	const vyskaPriSteneMm = cislo(q.get('vyskaPriStene'));
	const typSkla = String(q.get('sklo') ?? '');
	const ralKod = String(q.get('farba') ?? '');
	// #329 časť 2: model (LIGHT/ROBUST/MASSIVE) → hrúbky profilov v GLB. Neznámy/chýbajúci → ''
	// (PergolaAR ho vynechá z query, GLB endpoint → škála 1.0).
	const modelRaw = String(q.get('model') ?? '').trim();
	const model =
		modelRaw === 'LIGHT' || modelRaw === 'ROBUST' || modelRaw === 'MASSIVE' ? modelRaw : '';
	// ROVNAKÉ rozmedzia ako GLB endpoint (/konfigurator/model.glb) — bez toho by stránka
	// namontovala model-viewer s neplatnou konfiguráciou, ktorej GLB fetch by 400-nul
	// (network console error → poruší zero-console). Neplatné → „chýba konfigurácia" hláška.
	const platne =
		vRozmedzi(sirkaMm, KONF_SIRKA_MIN, KONF_SIRKA_MAX) &&
		vRozmedzi(hlbkaMm, KONF_HLBKA_MIN, KONF_HLBKA_MAX) &&
		vRozmedzi(vyskaVpreduMm, KONF_VYSKA_MIN, KONF_VYSKA_MAX) &&
		// výška pri stene: nikdy nižšia než vpredu, nikdy nad konštrukčné max enginu
		vRozmedzi(vyskaPriSteneMm, vyskaVpreduMm, KONF_VYSKA_STENA_MAX);
	return { sirkaMm, hlbkaMm, vyskaVpreduMm, vyskaPriSteneMm, typSkla, ralKod, model, platne };
};
