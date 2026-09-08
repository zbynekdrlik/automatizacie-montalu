// #496: Landing page — vstupný formulár pre číslo zákazky
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const zak = String(form.get('zak') ?? '').trim();
		if (!zak) return { error: 'Zadajte číslo zákazky.' };
		redirect(303, `/objednavka-skla/${encodeURIComponent(zak)}`);
	}
} satisfies Actions;
