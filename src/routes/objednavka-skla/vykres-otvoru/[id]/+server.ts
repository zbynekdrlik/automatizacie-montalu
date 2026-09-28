// #587: PDF výkres tabule s vŕtaným otvorom k riadku objednávky skla — ten istý, čo ide ako príloha
// do Odoo (IZOS). Obsluha si ho na podklade skontroluje pred odoslaním. Generuje sa z NAŠICH
// uložených dát (nie z nahratého súboru) → servírovať ako `application/pdf` inline je bezpečné
// (na rozdiel od `/objednavka-skla/subor/[id]`, kde je vynútený octet-stream kvôli XSS).
// b2b je zakázané prefixom `/objednavka-skla` (`b2b-access.ts`). Money-NEUTRÁLNE.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSkloPolozka } from '$lib/server/objednavka-skla';
import {
	generateVykresOtvoruPdf,
	vykresOtvoruFilename,
	vykresOtvoruZPolozky
} from '$lib/server/sklo-otvor-pdf';
import { logger } from '$lib/server/log';

const log = logger('vykres-otvoru');

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Neplatné ID.');

	const polozka = getSkloPolozka(id);
	const vstup = polozka ? vykresOtvoruZPolozky(polozka) : null;
	if (!vstup) error(404, 'Riadok nemá otvor so známou polohou — výkres nie je.');

	const pdf = await generateVykresOtvoruPdf(vstup);
	const nazov = vykresOtvoruFilename(vstup);
	log.info('vykres otvoru stiahnuty', { id, zak: vstup.zak, bajtov: pdf.length });
	return new Response(new Uint8Array(pdf), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="${nazov}"`,
			'content-length': String(pdf.length),
			'cache-control': 'no-store'
		}
	});
};
