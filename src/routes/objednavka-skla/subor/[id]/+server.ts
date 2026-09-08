// #496: Download endpoint pre prílohy objednávky skla.
// Always serves as application/octet-stream (review RED-1: prevent stored XSS
// from user-uploaded files served with browser-reported MIME).
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

	// RFC 5987 filename encoding for Slovak diacritics (review YELLOW-2)
	const safeFilename = meta.nazov.replace(/[^\x20-\x7E]/g, '_');
	const encodedFilename = encodeURIComponent(meta.nazov);

	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
			'content-length': String(data.length)
		}
	});
};
