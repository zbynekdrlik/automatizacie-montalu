// #496: Objednávka skla podklad per zákazka — zoznam sklových tabúľ z modulov
// (zasklenia, FIX, pergola), per-položka rozmery/atyp, prílohy, tlač.
// Money-NEUTRÁLNE (objednávka u dodávateľa, nie odpis).
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listSklaPreZakazku,
	nastavRezim,
	zmazPolozku,
	pridajSubor,
	listSubory,
	zmazSubor,
	MAX_SUBOR_VELKOST
} from '$lib/server/objednavka-skla';

// Server-side file extension allowlist (#496 review RED-1: stored XSS prevention).
// Client-side `accept` attribute is UX only — a forged POST bypasses it.
const ALLOWED_EXTENSIONS = ['.pdf', '.dxf', '.dwg', '.step', '.stp', '.igs', '.iges'];

function allowedExtension(filename: string): boolean {
	const ext = '.' + (filename.split('.').pop() ?? '').toLowerCase();
	return ALLOWED_EXTENSIONS.includes(ext);
}

export const load: PageServerLoad = async ({ params }) => {
	// SvelteKit already decodes params — no decodeURIComponent (review BLUE-7: double-decode)
	const zak = params.zak.trim();
	if (!zak) error(404, 'Zákazka nie je zadaná.');

	const polozky = listSklaPreZakazku(zak);

	// Pre každú položku načítaj zoznam príloh (bez dát — len metadata)
	const suboryMap: Record<number, { id: number; nazov: string; typ: string; velkost: number }[]> =
		{};
	for (const p of polozky) {
		const s = listSubory(p.id);
		if (s.length > 0) {
			suboryMap[p.id] = s.map((f) => ({
				id: f.id,
				nazov: f.nazov,
				typ: f.typ,
				velkost: f.velkost
			}));
		}
	}

	return { zak, polozky, suboryMap };
};

export const actions = {
	nastavRezim: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const rezim = String(form.get('rezim') ?? '');
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		if (rezim !== 'rozmery' && rezim !== 'atyp') return fail(400, { error: 'Neplatný režim.' });
		nastavRezim(id, rezim);
		return { ok: true };
	},

	zmazat: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		zmazPolozku(id);
		return { ok: true };
	},

	nahratSubor: async ({ request }) => {
		const form = await request.formData();
		const polozkaId = Number(form.get('polozkaId'));
		if (!Number.isInteger(polozkaId) || polozkaId <= 0)
			return fail(400, { error: 'Neplatné ID položky.' });

		const subor = form.get('subor');
		if (!(subor instanceof File) || subor.size === 0) return fail(400, { error: 'Vyberte súbor.' });

		if (subor.size > MAX_SUBOR_VELKOST)
			return fail(400, {
				error: `Súbor je príliš veľký (max ${MAX_SUBOR_VELKOST / 1024 / 1024} MB).`
			});

		// Server-side extension allowlist — client `accept` is UX only
		if (!allowedExtension(subor.name))
			return fail(400, {
				error: `Nepovolený typ súboru. Povolené: ${ALLOWED_EXTENSIONS.join(', ')}.`
			});

		const buf = Buffer.from(await subor.arrayBuffer());
		// Force safe MIME type regardless of browser-reported type
		pridajSubor(polozkaId, subor.name, 'application/octet-stream', buf);

		// Auto-switch to atyp when a file is uploaded
		nastavRezim(polozkaId, 'atyp');
		return { ok: true };
	},

	zmazatSubor: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID súboru.' });
		zmazSubor(id);
		return { ok: true };
	}
	// stiahnutSubor removed (review YELLOW-1: dead code — download uses GET endpoint)
} satisfies Actions;
