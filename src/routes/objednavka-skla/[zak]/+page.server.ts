// #496: Objednávka skla podklad per zákazka — zoznam sklových tabúľ z modulov
// (zasklenia, FIX, pergola), per-položka rozmery/atyp, prílohy, tlač.
// Money-NEUTRÁLNE (objednávka u dodávateľa, nie odpis).
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listSklaPreZakazku,
	nastavRezim,
	nastavSpec,
	nastavTypSkla,
	nastavTypManual,
	zmazPolozku,
	pridajSubor,
	listSubory,
	zmazSubor,
	pridajSkloManual,
	nastavOpZakazky,
	opPodkladu,
	upozornenieCudzie,
	pridalRiadku,
	MAX_SUBOR_VELKOST
} from '$lib/server/objednavka-skla';
import { fetchGlassTypes } from '$lib/server/odoo-glass-types';
import { naviazanieRiadku } from '$lib/server/glass-match';
import {
	HOLE_SIZES,
	EDGE_FINISHES,
	type GlassSpec,
	type EdgeFinish,
	type HoleSize
} from '$lib/server/odoo-rozpis-lines';
import { uploadGlassOrderToOdoo } from '$lib/server/odoo-glass-order-upload';
import { vykresOtvoruZPolozky } from '$lib/server/sklo-otvor-pdf';
import {
	odooObjednavkaSklaUrl,
	posledneOdoslanieOdoo,
	ulozOdoslanieOdoo
} from '$lib/server/objednavka-skla-odoslanie';
import { zakazkaPrehlad, opZPrehladu } from '$lib/server/zakazka-ceny';
import { odooNazvySkiel } from '$lib/server/odoo-nazov-skla';
import { nadpisObjednavky } from '$lib/objednavka-skla-pozicia';
import { SENTINEL_INE_SKLO, neznameKategorie } from '$lib/objednavka-skla-typy';
import { logger } from '$lib/server/log';

const log = logger('objednavka-skla-podklad');
// #576: už nahlásené neznáme Odoo kategórie (warn raz za proces — load beží pri každom reloade)
const hlaseneKategorie = new Set<string>();

/** Parsuje `GlassSpec` z formData podkladu (checkbox → bool, number vstupy, selecty). */
function parseSpec(form: FormData): GlassSpec {
	const bool = (n: string) => form.get(n) != null;
	const int = (n: string) => {
		const v = Math.trunc(Number(form.get(n) ?? 0));
		return Number.isFinite(v) && v > 0 ? v : 0;
	};
	const edgeRaw = String(form.get('spec_edge_finish') ?? 'none');
	const holeRaw = String(form.get('spec_hole_size') ?? '');
	return {
		warmEdge: bool('spec_warm_edge'),
		coloredFrame: bool('spec_colored_frame'),
		muntinCrossQty: int('spec_muntin_cross_qty'),
		holesQty: int('spec_holes_qty'),
		holeSize: (HOLE_SIZES as readonly string[]).includes(holeRaw) ? (holeRaw as HoleSize | '') : '',
		cutoutSmallQty: int('spec_cutout_small_qty'),
		cutoutLargeQty: int('spec_cutout_large_qty'),
		edgeFinish: (EDGE_FINISHES as readonly string[]).includes(edgeRaw)
			? (edgeRaw as EdgeFinish)
			: 'none',
		hst: bool('spec_hst'),
		temperingOwnGlass: bool('spec_tempering_own_glass')
	};
}

// Server-side file extension allowlist (#496 review RED-1: stored XSS prevention).
// Client-side `accept` attribute is UX only — a forged POST bypasses it.
// #545: `.xlsx` pridané (Money OVSKL-štýl objednávka skla ako v prílohe úlohy 951).
const ALLOWED_EXTENSIONS = ['.pdf', '.dxf', '.dwg', '.step', '.stp', '.igs', '.iges', '.xlsx'];

// #548: sentinel voľby „iné sklo" v pickeri typu (odkryje vlastný typ + cenu €/m²). Nesmie kolidovať
// s katalógovým `value` (Odoo `cennik_code`/`name`) — podčiarknikový sentinel nikdy nie je katalóg.
// #576: jeden zdroj so svelte pickerom (`zoskupTypySkla` ho dáva do poslednej skupiny).
const MANUAL_TYP_SENTINEL = SENTINEL_INE_SKLO;

function allowedExtension(filename: string): boolean {
	const ext = '.' + (filename.split('.').pop() ?? '').toLowerCase();
	return ALLOWED_EXTENSIONS.includes(ext);
}

// #553: jeden zdroj pravdy pre validáciu prílohy — používajú ho OBE akcie (`nahratSubor` na
// existujúcom riadku, `pridatRiadok` s výkresom priamo vo formulári). Synchrónna kontrola (File,
// veľkosť, prípona z allowlistu); byte-obsah číta až volajúci. Server RE-validuje — client `accept`
// je len UX a forged POST ho obíde.
function validujSubor(
	subor: FormDataEntryValue | null
): { ok: true; subor: File } | { ok: false; error: string } {
	if (!(subor instanceof File) || subor.size === 0) return { ok: false, error: 'Vyberte súbor.' };
	if (subor.size > MAX_SUBOR_VELKOST)
		return {
			ok: false,
			error: `Súbor je príliš veľký (max ${MAX_SUBOR_VELKOST / 1024 / 1024} MB).`
		};
	if (!allowedExtension(subor.name))
		return {
			ok: false,
			error: `Nepovolený typ súboru. Povolené: ${ALLOWED_EXTENSIONS.join(', ')}.`
		};
	return { ok: true, subor };
}

// #565: voliteľný rozmer z formulára — prázdne/chýbajúce pole = `null` (nezadané); inak číslo
// orezané na celé mm (neplatný text → NaN, odmietne ho validácia v `pridajSkloManual`).
function volitelnyRozmer(v: FormDataEntryValue | null): number | null {
	const s = typeof v === 'string' ? v.trim() : '';
	return s === '' ? null : Math.trunc(Number(s));
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// SvelteKit already decodes params — no decodeURIComponent (review BLUE-7: double-decode)
	const zak = params.zak.trim();
	if (!zak) error(404, 'Zákazka nie je zadaná.');

	// #546: `?op=` predvyplnenie OP poľa z indexu „Nová objednávka len skla" (servis bez odpisu).
	// Len UI hint — perzistuje ho až akcia `nastavOp` (keď má podklad riadky). Nenormalizuje sa tu
	// (index už poslal `normOp`); je to display-only prefill, nikdy sa priamo nezapisuje.
	const prefillOp = (url.searchParams.get('op') ?? '').trim();

	const polozky = listSklaPreZakazku(zak);
	// #528: OP zákazky (z najnovšieho odpisu, live-first) pre QR zákazky v hlavičke výtlačku — QR
	// vedie na TÚ ISTÚ `sale.order` ako nahraná `glass_order`. Prázdny keď zákazka nemá odpis/OP.
	// #563: JEDEN prehľad zákazky → OP (live-first, rovnako ako `zakazkaOp`) aj meno zákazníka pre nadpis.
	const prehlad = zakazkaPrehlad(zak);
	const op = opZPrehladu(prehlad);
	// #545: OP uložené priamo na riadkoch podkladu (servisná objednávka bez odpisu). `null` (mixed) →
	// zobraz prázdne (operátor nastaví jedno OP). `effektivneOp` = precedencia odpis > podklad —
	// tlačidlo Odoslať sa zapne, keď je (≥ 1 riadok a) neprázdne.
	const podkladOp = opPodkladu(zak) ?? '';
	const effektivneOp = op || podkladOp;
	// #563: nadpis „Objednávka skla — {OP} {zákazník}" (vzor 37880); bez OP → ZAK, bez zákazníka → OP.
	const nadpis = nadpisObjednavky({ zak, op: effektivneOp, zakaznik: prehlad?.zakaznik ?? '' });
	// #571: podklad je kľúčovaný číslom zákazky → riadky od INÉHO používateľa ako prihlásený
	// (opakovaný skúšobný názov) = banner. Pokrýva aj FIX/pergola producentov (presmerujú sem) a
	// ručný „Pridať riadok". Len upozornenie — nič neblokuje, nič nemaže.
	// Bez logu (load beží pri každom reloade) — pridanie do cudzieho podkladu loguje zápisová vrstva.
	const cudzie = upozornenieCudzie(zak, locals?.user?.username ?? '');
	// #594 (úloha 1219): pri KAŽDOM riadku kto a kedy ho pridal — server-side čas (Europe/Bratislava)
	const pridal: Record<number, string> = Object.fromEntries(
		polozky.map((p) => [p.id, pridalRiadku(p)])
	);

	// Pre každú položku načítaj zoznam príloh (bez dát — len metadata)
	const suboryMap: Record<number, { id: number; nazov: string; typ: string; velkost: number }[]> =
		{};
	for (const p of polozky) {
		const s = listSubory(p.id);
		if (s.length > 0) {
			suboryMap[p.id] = s.map((f) => ({
				id: f.id,
				nazov: f.nazov,
				typ: f.typ,
				velkost: f.velkost
			}));
		}
	}

	// #540: zoznam typov skla pre picker riadka — živý Odoo `montalu.glass.type`, s lokálnym
	// fallbackom keď Odoo nedostupné (source sa zobrazí v UI). Money-neutrálne (len ordering).
	const { items: glassTypes, source: glassTypesSource } = await fetchGlassTypes();
	// #576: Odoo kategória, ktorú picker nepozná, by ticho spadla do „Ostatné" → warn RAZ za proces.
	const nezname = neznameKategorie(glassTypes).filter((c) => !hlaseneKategorie.has(c));
	if (nezname.length > 0) {
		for (const c of nezname) hlaseneKategorie.add(c);
		log.warn('neznáma Odoo kategória typu skla — v pickeri pod „Ostatné"', { kategorie: nezname });
	}

	// #556: riadky z výpočtu, ktorých `typ_skla` nie je platná Odoo hodnota (nejednoznačné „viac"
	// alebo „ziadne" pri vkladaní) → badge „nepriradené — vyber typ" + kandidáti (pri „viac") navrchu
	// pickera. Manuál „iné sklo" riadky (typSklaManual) sú zámerne mimo katalógu → nenaväzujú sa.
	// Prázdne pri lokálnom fallbacku (Odoo nedostupné) — bez Odoo dát nič nenaväzujeme.
	const naviazanie: Record<
		number,
		{ nepriradene: boolean; kandidati: { value: string; label: string }[] }
	> = {};
	for (const p of polozky) {
		if (p.typSklaManual) continue;
		const n = naviazanieRiadku(p.typSkla, glassTypes, glassTypesSource);
		if (n.nepriradene) {
			naviazanie[p.id] = {
				nepriradene: true,
				kandidati: n.kandidati.map((k) => ({ value: k.value, label: k.label }))
			};
		}
	}

	// #563: zobrazovací (reálny Money) názov typu skla pre riadky — LEN display, `typ_skla` sa nemení.
	// Jeden Odoo read pre všetky kódy (cache + 3 s timeout, fallback = uložený typ). Manuál „iné
	// sklo" riadky majú vlastný typ (mimo katalógu) → neprekladá sa.
	const nazvySkiel = await odooNazvySkiel(
		polozky.filter((p) => !p.typSklaManual).map((p) => p.typSkla)
	);

	// #577: posledné odoslanie podkladu do Odoo → trvalý odkaz na objednávku skla (aj po obnovení).
	const odoslanieOdoo = posledneOdoslanieOdoo(zak);
	// #587: ktoré riadky majú generovaný výkres otvoru — TÁ ISTÁ brána ako Odoo príloha aj GET endpoint
	const vykresOtvoru: Record<number, boolean> = Object.fromEntries(
		polozky.map((p) => [p.id, vykresOtvoruZPolozky(p) !== null])
	);

	return {
		zak,
		nadpis,
		cudzie,
		pridal,
		nazvySkiel,
		op,
		podkladOp,
		effektivneOp,
		prefillOp,
		polozky,
		suboryMap,
		glassTypes,
		glassTypesSource,
		naviazanie,
		odoslanieOdoo,
		vykresOtvoru
	};
};

export const actions = {
	nastavRezim: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const rezim = String(form.get('rezim') ?? '');
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		if (rezim !== 'rozmery' && rezim !== 'atyp') return fail(400, { error: 'Neplatný režim.' });
		try {
			nastavRezim(id, rezim);
		} catch (e) {
			// #565: riadok bez rozmerov (atyp podľa výkresu) sa nedá prepnúť na režim rozmery
			return fail(400, { error: e instanceof Error ? e.message : 'Neplatný režim.' });
		}
		return { ok: true };
	},

	// #545: ručný riadok objednávky skla (modul='manual'). Typ skla POVINNÝ; server RE-validuje
	// vstup (nikdy nedôveruje klientovi) — rovnaká disciplína ako producent-akcie.
	pridatRiadok: async ({ params, request, locals }) => {
		const zak = params.zak.trim();
		if (!zak) return fail(400, { pridatChyba: 'Zákazka nie je zadaná.' });
		const form = await request.formData();
		const popis = String(form.get('popis') ?? '').trim();
		const typVyber = String(form.get('typ_skla') ?? '').trim();
		// #565: prázdne pole = rozmer NEZADANÝ (`null`) — pri atype s výkresom povolené; validuje
		// `pridajSkloManual` (rozmery režim / atyp bez výkresu → throw → fail 400).
		const sirkaMm = volitelnyRozmer(form.get('sirka_mm'));
		const vyskaMm = volitelnyRozmer(form.get('vyska_mm'));
		const pocet = Math.trunc(Number(form.get('pocet')));
		const rezim = form.get('rezim') === 'atyp' ? 'atyp' : 'rozmery';
		// #548: „iné sklo" — sentinel `__ine__` v selecte odkryje vlastný typ + cenu €/m²; inak katalóg.
		const jeIne = typVyber === MANUAL_TYP_SENTINEL;
		const typSkla = jeIne ? undefined : typVyber;
		const typSklaManual = jeIne ? String(form.get('typ_skla_manual') ?? '').trim() : undefined;
		const cenaM2Manual = jeIne ? Number(form.get('cena_m2_manual')) : undefined;

		// #553: voliteľný výkres priamo vo formulári. Ak je súbor priložený → validuj PRED vložením
		// (neplatný → fail(400), NIČ sa nevloží), zdieľaný helper s `nahratSubor`.
		const suborEntry = form.get('subor');
		const maSubor = suborEntry instanceof File && suborEntry.size > 0;
		// #565: obsah výkresu načítaný PRED vložením — riadok + výkres sa uložia v jednej transakcii.
		let vykres: { nazov: string; data: Buffer } | undefined;
		if (maSubor) {
			const v = validujSubor(suborEntry);
			if (!v.ok) return fail(400, { pridatChyba: v.error });
			vykres = { nazov: v.subor.name, data: Buffer.from(await v.subor.arrayBuffer()) };
		}

		try {
			pridajSkloManual({
				zak,
				popis,
				typSkla,
				typSklaManual,
				cenaM2Manual,
				sirkaMm,
				vyskaMm,
				pocet,
				rezim,
				// #565: výkres sa uloží v TEJ ISTEJ transakcii ako riadok (vynútený bezpečný MIME)
				vykres,
				createdBy: locals.user?.username ?? ''
			});
		} catch (e) {
			return fail(400, { pridatChyba: e instanceof Error ? e.message : 'Neplatný riadok.' });
		}

		if (!vykres && rezim === 'atyp') {
			// atyp bez výkresu — nie chyba (Odoo vráti DQ, operátor doplní na riadku)
			return { ok: true, pridatUpozornenie: 'atyp bez výkresu — pripni súbor pri riadku' };
		}
		return { ok: true };
	},

	// #545: jedno OP objednávky pre celý podklad (servisná zákazka bez odpisu) → `op` všetkých riadkov.
	nastavOp: async ({ params, request }) => {
		const zak = params.zak.trim();
		if (!zak) return fail(400, { opChyba: 'Zákazka nie je zadaná.' });
		const form = await request.formData();
		const op = String(form.get('op') ?? '');
		try {
			nastavOpZakazky(zak, op);
		} catch (e) {
			return fail(400, { opChyba: e instanceof Error ? e.message : 'Neplatné OP.' });
		}
		return { ok: true };
	},

	zmazat: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		zmazPolozku(id);
		return { ok: true };
	},

	nahratSubor: async ({ request }) => {
		const form = await request.formData();
		const polozkaId = Number(form.get('polozkaId'));
		if (!Number.isInteger(polozkaId) || polozkaId <= 0)
			return fail(400, { error: 'Neplatné ID položky.' });

		// #553: zdieľaná validácia (File, veľkosť, allowlist prípon) — rovnaká ako `pridatRiadok`.
		const v = validujSubor(form.get('subor'));
		if (!v.ok) return fail(400, { error: v.error });

		const buf = Buffer.from(await v.subor.arrayBuffer());
		// Force safe MIME type regardless of browser-reported type
		pridajSubor(polozkaId, v.subor.name, 'application/octet-stream', buf);

		// Auto-switch to atyp when a file is uploaded
		nastavRezim(polozkaId, 'atyp');
		return { ok: true };
	},

	zmazatSubor: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID súboru.' });
		try {
			zmazSubor(id);
		} catch (e) {
			// #565: posledný výkres riadka bez rozmerov sa nemaže
			return fail(400, { error: e instanceof Error ? e.message : 'Súbor sa nedá zmazať.' });
		}
		return { ok: true };
	},

	// #540: výber typu skla z Odoo pickera — uloží Odoo `code` (alebo lokálny názov) do `typ_skla`
	// (= `glass_order.items[].glass_type`). Money-neutrálne (objednávka, nie výpočtový katalóg).
	nastavTyp: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const typ = String(form.get('typ_skla') ?? '').trim();
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		if (!typ) return fail(400, { error: 'Vyberte typ skla.' });
		try {
			nastavTypSkla(id, typ);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Neplatný typ skla.' });
		}
		return { ok: true };
	},

	// #548: „iné sklo" na EXISTUJÚCOM riadku — vlastný typ + cena €/m² (> 0). Vynuluje katalógový typ.
	nastavTypManual: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const typManual = String(form.get('typ_skla_manual') ?? '').trim();
		const cenaM2Manual = Number(form.get('cena_m2_manual'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		try {
			nastavTypManual(id, typManual, cenaM2Manual);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Neplatné iné sklo.' });
		}
		return { ok: true };
	},

	// #521: uloženie špecifikácie tabule (spec_* kľúče, ktoré appka nevie z katalógu).
	ulozitSpec: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Neplatné ID.' });
		try {
			nastavSpec(id, parseSpec(form));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Neplatná špecifikácia.' });
		}
		return { ok: true, specUlozene: true };
	},

	// #521: odoslanie objednávky skla do Odoo (glass_order). Vracia postavený payload (náhľad) +
	// výsledok — keď je upload vypnutý (dev/test), payload sa len zobrazí, PROD Odoo sa nevolá.
	odoslatDoOdoo: async ({ params, locals }) => {
		const zak = params.zak.trim();
		if (!zak) return fail(400, { error: 'Zákazka nie je zadaná.' });
		const out = await uploadGlassOrderToOdoo(zak);
		const dropped = out.droppedAttachments ?? [];
		// #577: úspešný upload s `glass_order_id` → priamy odkaz na objednávku skla v Odoo + uloženie
		// k podkladu (odkaz ostane aj po obnovení). Bez id (v1 intake / vypnuté / chyba) → žiadny odkaz.
		const glassOrderId = out.result === 'uploaded' ? out.odoo?.glassOrderId : undefined;
		const odkaz = glassOrderId != null ? odooObjednavkaSklaUrl(glassOrderId) : null;
		if (odkaz && glassOrderId != null) {
			// Zlyhanie uloženia nesmie zhodiť odpoveď — objednávka v Odoo UŽ existuje, odkaz sa vráti.
			try {
				ulozOdoslanieOdoo(
					zak,
					{ glassOrderId, name: out.odoo?.name },
					locals?.user?.username ?? ''
				);
			} catch (e) {
				log.error('uloženie odoslania objednávky skla zlyhalo', {
					zak,
					glassOrderId,
					err: e instanceof Error ? e.message : String(e)
				});
			}
		}
		return {
			ok: true,
			odoslane: {
				result: out.result,
				payload: out.payload,
				error: out.error,
				odoo: out.odoo ?? null,
				odkaz,
				droppedAttachments: dropped,
				droppedNames: dropped.map((d) => d.name).join(', ')
			}
		};
	}
} satisfies Actions;
