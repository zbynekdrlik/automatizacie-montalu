// #496: Download endpoint pre prílohy objednávky skla
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSuborData, getSuborMeta } from '$lib/server/objednavka-skla';

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Neplatné ID.');

	const meta = getSuborMeta(id);
	if (!meta) error(404, 'Súbor sa nenašiel.');

	const data = getSuborData(id);
	if (!data) error(404, 'Súbor sa nenašiel.');

	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': meta.typ || 'application/octet-stream',
			'content-disposition': `attachment; filename="${encodeURIComponent(meta.nazov)}"`,
			'content-length': String(data.length)
		}
	});
};
