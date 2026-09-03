// Editor vzorcov: bounds validácia, transakčný zápis, audit trail a
// old→new náhľad odpisu na kontrolných rozmeroch.

import type { Actions, PageServerLoad } from './$types';
import {
	loadCfg,
	listSysStyly,
	glassTypesForSystem,
	systemFromSysStyl,
	triedaKorekcia
} from '$lib/server/db';
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
	const glass = glassTypesForSystem(system);
	// #443: dva inputy trieda_6/trieda_16 sa zobrazia LEN keď má systém KLASIFIKOVANÉ
	// sklo tej triedy (inak by editor ponúkal korekciu pre triedu, ktorú tento systém
	// vôbec nemá — napr. trieda 16 pri Deluxe, kde je hrubkaTrieda vždy NULL).
	return {
		styly,
		sysStyl,
		system,
		editable,
		glass,
		maTrieda6: glass.some((g) => g.hrubkaTrieda === 6),
		maTrieda16: glass.some((g) => g.hrubkaTrieda === 16),
		trieda6Korekcia: triedaKorekcia(system, 6),
		trieda16Korekcia: triedaKorekcia(system, 16),
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
		const glass = glassTypesForSystem(systemFromSysStyl(sysStyl));
		// #443: redukcia checkbox sa v editore renderuje LEN pre trieda-NULL sklá (klasifikované
		// sklo má redukciu DERIVOVANÚ z triedy). HTML checkbox nevie odlíšiť „nerenderované" od
		// „renderované a odškrtnuté" (oboje sa jednoducho nepošle) — preto server iteruje TEN
		// ISTÝ filtrovaný set, aký UI zobrazilo, nikdy VŠETKY sklá systému (inak by neodoslaný
		// checkbox klasifikovaného skla ticho prepísal jeho uložený stĺpec na false pri uložení).
		for (const g of glass.filter((g) => g.hrubkaTrieda === null)) {
			glassRedukcia.set(g.id, form.get(`glass_${g.id}`) === '1');
		}
		for (const g of glass) {
			// LEN keď je pole reálne v POST-e (form.has). Chýbajúce pole (stará karta pred nasadením
			// bez korekčných inputov / skriptovaný POST, alebo #443 filtrovaný grid ukazujúci LEN
			// existujúce overridy) sa NErovná „prázdne = zruš override" — vynecháme ho z mapy →
			// saveCfgChanges ho nechá bez zmeny. Prítomné prázdne pole = NULL.
			if (form.has(`korekcia_${g.id}`)) {
				const raw = String(form.get(`korekcia_${g.id}`) ?? '').trim();
				glassKorekcia.set(g.id, raw === '' ? null : num(raw));
			}
		}
		// #443: korekcia PER TRIEDA (6/16) — rovnaký form.has() guard (chýbajúce pole = bez
		// zmeny; prítomné prázdne pole = NULL = zruš override → systémová).
		const triedaKorekciaVstup = new Map<6 | 16, number | null>();
		if (form.has('trieda_6')) {
			const raw = String(form.get('trieda_6') ?? '').trim();
			triedaKorekciaVstup.set(6, raw === '' ? null : num(raw));
		}
		if (form.has('trieda_16')) {
			const raw = String(form.get('trieda_16') ?? '').trim();
			triedaKorekciaVstup.set(16, raw === '' ? null : num(raw));
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
			glassKorekcia,
			triedaKorekcia: triedaKorekciaVstup
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
