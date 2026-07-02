import type { Actions, PageServerLoad } from './$types';
import { listOdpisy, releaseOdpis } from '$lib/server/money';

export const load: PageServerLoad = async () => {
	return { odpisy: listOdpisy(200) };
};

export const actions: Actions = {
	// uvoľnenie dedup kľúča — legitímna oprava: zmaž import v Money, uvoľni tu,
	// pošli znova. Auditované v histórii zmien.
	uvolnit: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return { error: 'Neplatný záznam.' };
		const ok = releaseOdpis(id, locals.user?.username ?? '');
		return ok ? { uvolnene: true } : { error: 'Záznam sa nenašiel.' };
	}
};
