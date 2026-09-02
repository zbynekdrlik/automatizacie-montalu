import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(303, base + '/zasklenia'); // #5822: base-prefix pre beh pod `/automatizacie/`
};
