// #593 (Odoo úlohy 1214/1216, Marek 29.9.): sklo výplne CLIP zábradlia z Odoo + objednávka skla z CLIP.
//
// Design (Prístup 1, main 29.9.): výplň CLIP ponúka Odoo typy skla podľa HRÚBKY — ten istý
// mechanizmus ako nárezák zasklení (#579/#594, `sklo-odoo.ts` `ponukaSkielPre`): povolené hrúbky
// systému „CLIP" žijú v `cfg_sklo_hrubka` (migrácia v55: 6 mm jednoduché, 16 mm izolačné). Zvolený
// Odoo typ určí ŠABLÓNU podľa druhu (izolačné → `izo`, inak `klasika`); šablóna ostáva jediný vstup
// Money odpisu (zasklievací profil) — Money-NEUTRÁLNE. Odoo nedostupné (alebo CLIP bez hrúbok) →
// dnešné dve voľby izo/klasika.
//
// CLIP nemá lokálny výpočtový katalóg skiel (`glass_types`) — `ponukaSkielPre` preto dostane
// REPREZENTATÍVNU lokálnu ponuku (`CLIP_LOKALNE`): z nej odvodí výpočtové sklo každej Odoo voľby
// (`vypocetneSkloPre`: 16 mm izolačné → „Izolačné sklo 4/8/4 číre", 6 mm jednoduché → „Float sklo
// 6 mm") a to sa premapuje na šablónu. `VolbaSkla.vypocet` je teda pri CLIP ŠABLÓNA (`izo`/
// `klasika`) — klient (`$lib/sklo-odoo` `volbaSkla`/`rozlozVolbu`) s ňou pracuje ako s výpočtovým
// sklom. Predvolená voľba šablóny (`naprotivok`) = sklo, ktoré šablóna opisuje: izo → presný
// náprotivok „4/8/4 číre" (matcher #556), klasika („3.3.1 číre") → číre lepené VSG bez povlaku
// (matcher „3.3.1" na Odoo „VSG 33.1" nesadne — zloženie „3+3 / PVB").
import { logger } from './log';
import { fetchGlassTypes, type GlassTypesResult } from './odoo-glass-types';
import { ponukaSkielPre } from './sklo-odoo';
import { glassPovlak, glassTint } from './glass-match';
import { skloHrubkyPre } from './sklo-hrubky';
import { parseClipVstup, parseClipMultiVstup, type ClipMultiVstup } from './vstup';
import type { NoveSklo } from './objednavka-skla';
import type { OdooHrubka } from '$lib/sklo-povolene';
import type { PonukaSkiel, VolbaSkla } from '$lib/sklo-odoo';
import { m2Tabule } from '$lib/objednavka-skla-pozicia';
import { CLIP_VYPLN_POPIS, rozmerSklaClip, type ClipTyp, type ClipVstup } from '$lib/clip';

const log = logger('clip-sklo');

/** Systém CLIP v `cfg_sklo_hrubka` (nie je systém nárezáka zasklení — editor ho neponúka). */
export const CLIP_SYSTEM = 'CLIP';

/** Reprezentatívna lokálna ponuka CLIP → šablóna. Kľúče sú katalógové názvy skiel appky (vzory
 *  `vypocetneSkloPre` + matcher #556); nikdy sa nimi nepočíta Money — len sa odvodí šablóna. */
const CLIP_LOKALNE: Readonly<Record<string, ClipTyp>> = {
	'Izolačné sklo 4/8/4 číre': 'izo',
	'Float sklo 6 mm': 'klasika'
};

/** Je Odoo typ predvoleným sklom šablóny klasika („3.3.1 číre") — číre lepené VSG bez povlaku? */
function jeKlasikaVsg(o: { category: string; name: string }): boolean {
	return (
		o.category.trim().toLowerCase() === 'vsg' &&
		glassTint(o.name) === 'cire' &&
		glassPovlak(o.name) === 'ziadny'
	);
}

/** Lokálny názov skla šablóny pre objednávku skla bez Odoo voľby (potom matcher `priradOdooTypy`). */
const LOKALNY_TYP: Readonly<Record<ClipTyp, string>> = {
	izo: 'Izolačné sklo 4/8/4 číre',
	klasika: '3.3.1'
};

export function lokalnySkloClip(typ: ClipTyp): string {
	return LOKALNY_TYP[typ];
}

const SABLONY: readonly ClipTyp[] = ['izo', 'klasika'];

/** Chýbajúce šablóny, pre ktoré už padlo varovanie (warn raz za proces a kombináciu). */
const hlaseneChyba = new Set<string>();

/** Záloha ponuky = dnešné dve voľby (hodnota = šablóna). */
function lokalnaPonuka(): PonukaSkiel {
	const volba = (typ: ClipTyp): VolbaSkla => ({
		value: typ,
		label: CLIP_VYPLN_POPIS[typ],
		nazov: CLIP_VYPLN_POPIS[typ],
		vypocet: typ,
		odoo: '',
		naprotivok: true
	});
	return { skupiny: [{ label: '', items: [volba('izo'), volba('klasika')] }] };
}

/**
 * Ponuka výplne CLIP: skupiny „Odoo — <druh>" s Odoo typmi povolených hrúbok (`vypocet` = šablóna),
 * alebo záloha izo/klasika (Odoo nedostupné / žiadna Odoo voľba). Pri explicitných `hrubky` ČISTÁ.
 */
export function ponukaSkielClip(
	odoo: GlassTypesResult,
	hrubky: readonly OdooHrubka[] = skloHrubkyPre(CLIP_SYSTEM)
): PonukaSkiel {
	if (odoo.source !== 'odoo') return lokalnaPonuka();
	const p = ponukaSkielPre(CLIP_SYSTEM, Object.keys(CLIP_LOKALNE), odoo, hrubky);
	const volby = p.skupiny.flatMap((g) => g.items);
	// `ponukaSkielPre` pri systéme bez Odoo voľby vráti lokálne názvy — tie CLIP nepozná
	if (volby.length === 0 || volby.some((o) => o.odoo === '')) return lokalnaPonuka();
	const odooTyp = new Map(odoo.items.map((o) => [o.value, o]));
	const skupiny = p.skupiny.map((g) => ({
		label: g.label,
		items: g.items.map((o) => {
			const sablona = CLIP_LOKALNE[o.vypocet]!;
			const t = odooTyp.get(o.odoo);
			const naprotivok = sablona === 'izo' ? o.naprotivok : !!t && jeKlasikaVsg(t);
			return { ...o, vypocet: sablona, naprotivok };
		})
	}));
	// šablóna bez jedinej Odoo voľby (Odoo nemá sklo tej hrúbky/druhu) by sa nedala zvoliť →
	// doplň jej lokálnu voľbu (záloha), nech je vždy voliteľná každá šablóna
	const chyba = SABLONY.filter((t) => !skupiny.some((g) => g.items.some((o) => o.vypocet === t)));
	if (chyba.length === 0) return { skupiny };
	if (!hlaseneChyba.has(chyba.join())) {
		hlaseneChyba.add(chyba.join());
		log.warn('ponukaSkielClip: šablóna bez Odoo skla — ponúka sa lokálna voľba', { chyba });
	}
	const lok = lokalnaPonuka().skupiny[0]!.items.filter((o) => chyba.some((t) => t === o.vypocet));
	return { skupiny: [...skupiny, { label: '', items: lok }] };
}

/** Ponuka výplne pre page load `/clip` — JEDEN Odoo fetch (cache, 3 s timeout, fallback). */
export async function nacitajPonukuClip(): Promise<PonukaSkiel> {
	return ponukaSkielClip(await fetchGlassTypes());
}

/**
 * Over zvolený Odoo typ zábradlia voči živému katalógu a doplň jeho názov. Typ musí byť v ponuke
 * CLIP A patriť k zvolenej šablóne (inak by podvrhnutý POST objednal iné sklo, než sa počíta). Pri
 * nedostupnom Odoo sa prijme bez overenia (ovplyvňuje len text objednávky, nikdy Money).
 */
async function overSkloOdooClip(kus: ClipVstup): Promise<string | null> {
	if (!kus.skloOdoo) return null;
	const odoo = await fetchGlassTypes();
	if (odoo.source !== 'odoo') {
		log.warn('overSkloOdooClip: Odoo nedostupné — typ skla prijatý bez overenia', {
			skloOdoo: kus.skloOdoo,
			typ: kus.typ
		});
		return null;
	}
	const o = ponukaSkielClip(odoo)
		.skupiny.flatMap((g) => g.items)
		.find((x) => x.odoo === kus.skloOdoo);
	if (!o || o.vypocet !== kus.typ) {
		log.warn('overSkloOdooClip: Odoo typ skla nepatrí k šablóne výplne — odmietnuté', {
			skloOdoo: kus.skloOdoo,
			typ: kus.typ,
			sablona: o?.vypocet ?? null
		});
		return `Typ skla z Odoo „${kus.skloOdoo}" sa pre výplň ${CLIP_VYPLN_POPIS[kus.typ]} neponúka — vyber sklo znova.`;
	}
	kus.skloOdooNazov = o.nazov;
	return null;
}

/** `parseClipVstup` + overenie Odoo typu skla výplne. */
export async function parseClipVstupSOdoo(
	form: FormData
): Promise<{ vstup: ClipVstup; error: string | null }> {
	const r = parseClipVstup(form);
	if (r.error) return r;
	const e = await overSkloOdooClip(r.vstup);
	return e ? { vstup: r.vstup, error: e } : r;
}

/** `parseClipMultiVstup` + overenie Odoo typu skla KAŽDÉHO zábradlia. */
export async function parseClipMultiVstupSOdoo(
	form: FormData
): Promise<{ vstup: ClipMultiVstup; error: string | null }> {
	const r = parseClipMultiVstup(form);
	if (r.error) return r;
	for (const [i, k] of r.vstup.kusy.entries()) {
		const e = await overSkloOdooClip(k);
		if (e) return { vstup: r.vstup, error: `Zábradlie ${i + 1}: ${e}` };
	}
	return r;
}

/**
 * Riadky objednávky skla z CLIP zábradlí (producent modul `clip`): na zábradlie JEDEN riadok
 * „Zábradlie i" s N kusmi (N = počet výplní) rozmeru výplne (výplň = sklo, `rozmerSklaClip`).
 * Typ = zvolený Odoo typ, inak lokálny názov šablóny (producent ho potom páruje `priradOdooTypy`).
 * ČISTÁ — vstupy musia byť platné (`chybaClipVstupu`).
 */
export function sklaClip(
	kusy: readonly ClipVstup[],
	meta: { zak: string; op: string; createdBy: string }
): NoveSklo[] {
	return kusy.map((k, i) => {
		const r = rozmerSklaClip(k);
		return {
			zak: meta.zak,
			op: meta.op,
			modul: 'clip',
			popis: `Zábradlie ${i + 1}`,
			sirkaMm: r.sirka,
			vyskaMm: r.vyska,
			pocet: k.variant,
			typSkla: k.skloOdoo || lokalnySkloClip(k.typ),
			m2: m2Tabule(r.sirka, r.vyska, k.variant),
			createdBy: meta.createdBy
		};
	});
}
