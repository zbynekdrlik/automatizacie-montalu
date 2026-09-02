// FIX z CADu (#380): (1) „spocitat" prepočíta CAD nárez (bez zápisu), (2) náhľad s Money
// rozpisom + počtami tyčí + výberom kombinácií pri rezoch > 7500, (3) „odoslat" prepočíta
// ZNOVA zo surového vstupu + volieb a zapíše odpis (modul='fix'). Tenká route — celý tok žije
// v zdieľanom `$lib/server/cad-odpis` (#393); FIX identita (modul='fix') v `$lib/server/fix-cad`.
import type { Actions, PageServerLoad } from './$types';
import { isLive } from '$lib/server/money';
import { cadSpocitat, cadUpravit, cadOdoslat } from '$lib/server/cad-odpis';
import { FIX_CAD_OPTS } from '$lib/server/fix-cad';

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions = {
	spocitat: async ({ request, locals }) => cadSpocitat(await request.formData(), locals.user),
	upravit: async ({ request }) => cadUpravit(await request.formData()),
	odoslat: async ({ request, locals }) =>
		cadOdoslat(await request.formData(), locals.user, FIX_CAD_OPTS)
} satisfies Actions;
