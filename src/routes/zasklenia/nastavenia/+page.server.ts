// Editor vzorcov: bounds validácia, transakčný zápis, audit trail a
// old→new náhľad odpisu na kontrolných rozmeroch.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, glassTypesForSystem, systemFromSysStyl } from '$lib/server/db';
import {
	getEditableRows,
	saveCfgChanges,
	getAuditLog,
	type CfgZmena
} from '$lib/server/cfg-editor';
import { safeCompute } from '$lib/server/compute';

export const load: PageServerLoad = async ({ url }) => {
	const styly = listSysStyly();
	const sysStyl = url.searchParams.get('sysStyl') ?? styly[0]?.sysStyl ?? '';
	const editable = getEditableRows(sysStyl);
	// #438: sklá LEN vybraného systému (nie deduplikované naprieč systémami). „3.3.1"
	// žije v Slide aj Štandard + (UNIQUE(nazov, system)); cross-systémový render + save
	// prehadzoval redukciu obidvom. glassTypesForSystem rieši alias starý Štandard →
	// Štandard +. Identita checkboxu je row `id`, aby sa rovnaké názvy nikdy nekolidovali.
	const system = systemFromSysStyl(sysStyl);
	return {
		styly,
		sysStyl,
		system,
		editable,
		glass: glassTypesForSystem(system),
		audit: getAuditLog(30).map((a) => ({ ...a, zmeny: JSON.parse(a.zmeny) as CfgZmena[] }))
	};
};

export const actions = {
	ulozit: async ({ request, locals }) => {
		const form = await request.formData();
		const sysStyl = String(form.get('sysStyl') ?? '');
		const num = (v: FormDataEntryValue | null) => parseFloat(String(v ?? '').replace(',', '.'));

		const offsets = new Map<number, number>();
		for (const [key, value] of form.entries()) {
			const m = key.match(/^offset_(\d+)$/);
			if (m) offsets.set(Number(m[1]), num(value));
		}
		const skloOffset = num(form.get('skloOffset'));

		// #438: checkbox identita = row `id` (glass_<id>); mapa je kľúčovaná row id LEN pre
		// sklá tohto systému. Save zapisuje `WHERE id=?`, takže rovnaké meno v inom systéme
		// („3.3.1" je Slide aj Štandard +) sa nikdy nedotkne.
		const glassRedukcia = new Map<number, boolean>();
		// #440: per-sklo korekcia rozmeru — mapa kľúčovaná row `id` (rovnako ako redukcia). Prázdne
		// pole = NULL (zruš override → systémový skloOffset), NIE 0 (0 je legitímna explicitná hodnota).
		const glassKorekcia = new Map<number, number | null>();
		for (const g of glassTypesForSystem(systemFromSysStyl(sysStyl))) {
			glassRedukcia.set(g.id, form.get(`glass_${g.id}`) === '1');
			const raw = String(form.get(`korekcia_${g.id}`) ?? '').trim();
			glassKorekcia.set(g.id, raw === '' ? null : num(raw));
		}

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
			glassRedukcia,
			glassKorekcia
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
} satisfies Actions;
