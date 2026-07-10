// Editor vzorcov: bounds validácia, transakčný zápis, audit trail a
// old→new náhľad odpisu na kontrolných rozmeroch.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, listGlassTypes } from '$lib/server/db';
import { getEditableRows, saveCfgChanges, getAuditLog } from '$lib/server/cfg-editor';
import { safeCompute } from '$lib/server/compute';

export const load: PageServerLoad = async ({ url }) => {
	const styly = listSysStyly();
	const sysStyl = url.searchParams.get('sysStyl') ?? styly[0]?.sysStyl ?? '';
	const editable = getEditableRows(sysStyl);
	return {
		styly,
		sysStyl,
		editable,
		glass: listGlassTypes(),
		audit: getAuditLog(30).map((a) => ({ ...a, zmeny: JSON.parse(a.zmeny) }))
	};
};

export const actions: Actions = {
	ulozit: async ({ request, locals }) => {
		const form = await request.formData();
		const sysStyl = String(form.get('sysStyl') ?? '');
		const num = (v: FormDataEntryValue | null) =>
			parseFloat(String(v ?? '').replace(',', '.'));

		const offsets = new Map<number, number>();
		for (const [key, value] of form.entries()) {
			const m = key.match(/^offset_(\d+)$/);
			if (m) offsets.set(Number(m[1]), num(value));
		}
		const skloOffset = num(form.get('skloOffset'));

		const glassRedukcia = new Map<string, boolean>();
		for (const g of listGlassTypes()) glassRedukcia.set(g.nazov, form.get(`glass_${g.nazov}`) === '1');

		// náhľad PRED zmenou na kontrolných rozmeroch. Deluxe: kladka/klzný je
		// hrúbko-závislý (6/10) — bez zvolenej hrúbky by z náhľadu vypadol, tak zvoľ
		// reprezentatívnu 6mm (odpis metre je pre 6 aj 10 rovnaký, líši sa len kód).
		const pS = num(form.get('previewS')) || 5000;
		const pV = num(form.get('previewV')) || 2000;
		const previewHrubka = sysStyl.startsWith('Deluxe|') ? 6 : 0;
		const pred = safeCompute(loadCfg(), sysStyl, pS, pV, false, previewHrubka);

		const { zmeny, error } = saveCfgChanges({
			sysStyl,
			username: locals.user?.username ?? '',
			offsets,
			skloOffset,
			glassRedukcia
		});
		if (error) return { error, sysStyl };

		const po = safeCompute(loadCfg(), sysStyl, pS, pV, false, previewHrubka);
		return {
			ulozene: true,
			sysStyl,
			zmeny,
			preview: {
				S: pS,
				V: pV,
				pred: pred.r ? { odpis: pred.r.odpis, sklo: pred.r.sklo } : null,
				po: po.r ? { odpis: po.r.odpis, sklo: po.r.sklo } : null
			}
		};
	}
};
