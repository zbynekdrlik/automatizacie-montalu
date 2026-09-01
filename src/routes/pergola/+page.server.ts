// Pergola CAD → Money odpis: (1) „spocitat" prepočíta CAD nárez (bez zápisu), (2) náhľad
// s Money rozpisom + počtami tyčí + výberom kombinácií pri rezoch > 7500, (3) „odoslat"
// prepočíta ZNOVA zo surového vstupu + volieb a zapíše odpis (modul='pergola'). Tenká route —
// celý tok žije v zdieľanom `$lib/server/cad-odpis` (#393; reuse pergola enginu + Money vrstvy).
import type { Actions, PageServerLoad } from './$types';
import { isLive } from '$lib/server/money';
import { cadSpocitat, cadUpravit, cadOdoslat, type CadActionOpts } from '$lib/server/cad-odpis';

// pergola odpis identita — popis prázdny prefix → „OP Zákazník" (1:1 s n8n verziou)
const PERGOLA_OPTS: CadActionOpts = {
	modul: 'pergola',
	cakaSubdir: 'Pergola',
	popisPrefix: '',
	logName: 'pergola'
};

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions = {
	spocitat: async ({ request, locals }) => cadSpocitat(await request.formData(), locals.user),
	upravit: async ({ request }) => cadUpravit(await request.formData()),
	odoslat: async ({ request, locals }) =>
		cadOdoslat(await request.formData(), locals.user, PERGOLA_OPTS)
} satisfies Actions;
