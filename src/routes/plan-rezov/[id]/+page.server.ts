// #505: Detail uloženého plánu rezov — rekomputuje výsledok z uložených vstupov.
// Vstupy (cad_text, dlzka_tyce, rezna_medzera) sú v DB; výsledok sa vždy počíta
// znova cez spocitajPlanRezov() (design: inputs-only, recompute on load).
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPlan } from '$lib/server/plan-rezov-ulozene';
import { parsePlanRezov } from '$lib/server/plan-rezov-vstup';
import { spocitajPlanRezov } from '$lib/server/plan-rezov';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) error(404, 'Neplatné id plánu.');

	const plan = getPlan(id);
	if (!plan) error(404, 'Plán nebol nájdený.');

	// Rekomputuj výsledok z uložených vstupov
	const { riadky, preskocene } = parsePlanRezov(plan.cadText);
	const vysledok = spocitajPlanRezov(
		{ dlzkaTyce: plan.dlzkaTyce, reznaMedzera: plan.reznaMedzera, riadky },
		preskocene
	);

	return {
		plan: {
			id: plan.id,
			nazov: plan.nazov,
			zak: plan.zak,
			dlzkaTyce: plan.dlzkaTyce,
			reznaMedzera: plan.reznaMedzera,
			createdAt: plan.createdAt,
			createdBy: plan.createdBy
		},
		vysledok
	};
};
