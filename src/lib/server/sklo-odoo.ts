// #579: Odoo typy skla (`montalu.glass.type`) v ponuke nárezáku zasklení podľa HRÚBKY systému.
//
// Design (Prístup 1, main 28.9.): hrúbka je spojka medzi Odoo a výpočtom. Systém povoľuje hrúbkové
// triedy (`sklo-povolene.ts` `ODOO_HRUBKY` — JEDEN zdroj); Odoo typ s `total_thickness_mm` v triede
// (a správneho druhu) sa ponúkne a počíta sa ako reprezentatívne LOKÁLNE výpočtové sklo:
//   • lokálne povolené sklo, ktoré naň matcher #556 mapuje (napr. ESG Float čirý 6mm → „ESG kalené
//     6 mm"), keď je také JEDINÉ;
//   • inak predvolené sklo triedy (Robust 24 → „Izolačné sklo 4/16/4 číre").
// Výpočtový katalóg `glass_types`, vzorce, profily a Money sú NEDOTKNUTÉ — do výpočtu ide vždy len
// lokálne sklo; zvolený Odoo typ (`skloOdoo`) ide do objednávky skla a na plán.
//
// Lokálne sklo sa z ponuky skryje, keď ho nahrádza Odoo typ počítaný tým istým sklom (jeho prvý
// taký náprotivok je `zastupca` — predvolené sklo sa tak zobrazí ako Odoo typ). Sklá s povlakom,
// ktorý matcher nerozlišuje (stopsol), sa NIKDY neskryjú. Odoo nedostupné → dnešná lokálna ponuka.
import { logger } from './log';
import { listGlassTypes } from './db';
import { fetchGlassTypes, type GlassTypeOption, type GlassTypesResult } from './odoo-glass-types';
import { matchOdooGlassType, cennikPopis } from './glass-match';
import { parseVstup, parseMultiVstup, type Vstup, type MultiVstup } from './vstup';
import { odooTriedyPre, odooDruhSedi, ponukaSkielSystemu } from '$lib/sklo-povolene';
import { zoskupTypySkla } from '$lib/objednavka-skla-typy';
import { ODOO_PREFIX, type PonukaSkiel, type VolbaSkla } from '$lib/sklo-odoo';

const log = logger('sklo-odoo');

/** Skupina lokálnych skiel bez Odoo náprotivku. */
export const SKUPINA_Z_APPKY = 'Z appky (bez typu v Odoo)';

/** Povlaky, ktoré matcher #556 nerozlišuje (páruje ich ako číre) — také lokálne sklo nemá
 *  spoľahlivý Odoo náprotivok, preto sa neskrýva ani nepoužije ako výpočtový zdroj Odoo typu. */
const POVLAK_BEZ_OSI = /stopsol/i;

function lokalnaVolba(n: string, popis: string): VolbaSkla {
	return { value: n, label: popis ? `${n} · cenník: ${popis}` : n, nazov: n, vypocet: n, odoo: '' };
}

/**
 * Ponuka „Sklo (základ)" pre systém. `lokalne` = lokálna povolená ponuka systému
 * (`ponukaSkielSystemu`), `odoo` = výsledok `fetchGlassTypes`. ČISTÁ (žiadne IO).
 */
export function ponukaSkielPre(
	system: string,
	lokalne: readonly string[],
	odoo: GlassTypesResult
): PonukaSkiel {
	if (odoo.source !== 'odoo')
		return {
			skupiny: [{ label: '', items: lokalne.map((n) => lokalnaVolba(n, '')) }],
			zastupca: {}
		};

	// len triedy, ktorých výpočtové sklo systém naozaj ponúka (obrana pri zmene allow-listu)
	const triedy = odooTriedyPre(system).filter((t) => lokalne.includes(t.sklo));
	const triedaPre = (o: GlassTypeOption) =>
		triedy.find((t) => t.mm === o.hrubkaMm && odooDruhSedi(t.druh, o.category));
	// hrúbka 0 (dátová chyba v Odoo) nikdy nesedí na triedu → neponúkne sa (warn v fetchGlassTypes)
	const typy = odoo.items.filter((o) => o.hrubkaMm > 0 && triedaPre(o));

	// lokálne sklo → jeho Odoo náprotivky v ponuke (matcher #556: zloženie ∧ kategória ∧ odtieň)
	const kandidati = new Map<string, GlassTypeOption[]>();
	for (const n of lokalne) {
		if (POVLAK_BEZ_OSI.test(n)) continue;
		const k = matchOdooGlassType(n, typy).kandidati;
		if (k.length > 0) kandidati.set(n, k);
	}
	const vypocetPre = (o: GlassTypeOption): string => {
		const zdroje = [...kandidati].filter(([, k]) => k.includes(o)).map(([n]) => n);
		return zdroje.length === 1 ? zdroje[0]! : triedaPre(o)!.sklo;
	};
	const volby = new Map<string, VolbaSkla>(
		typy.map((o) => [
			o.value,
			{
				value: ODOO_PREFIX + o.value,
				label: o.label,
				nazov: o.name || o.value,
				vypocet: vypocetPre(o),
				odoo: o.value
			}
		])
	);
	const skupiny = zoskupTypySkla(typy, [], false).map((g) => ({
		label: g.label,
		items: g.items.map((i) => volby.get(i.value)!)
	}));

	// skryté lokálne sklo = má Odoo náprotivok počítaný TÝM ISTÝM sklom (inak by voľba zmenila výpočet)
	const zastupca: Record<string, string> = {};
	for (const [n, k] of kandidati) {
		const z = k.map((o) => volby.get(o.value)!).find((v) => v.vypocet === n);
		if (z) zastupca[n] = z.value;
	}
	const zAppky = lokalne
		.filter((n) => !(n in zastupca))
		.map((n) => lokalnaVolba(n, cennikPopis(n, odoo.items, 'odoo')));
	if (zAppky.length > 0) skupiny.push({ label: SKUPINA_Z_APPKY, items: zAppky });
	return { skupiny, zastupca };
}

/** Ponuky skiel pre všetky systémy nárezáka (page load) — JEDEN Odoo fetch (cache, 3 s timeout). */
export async function ponukySkiel(
	systemy: readonly string[]
): Promise<Record<string, PonukaSkiel>> {
	const odoo = await fetchGlassTypes();
	const katalog = listGlassTypes();
	return Object.fromEntries(
		systemy.map((s) => [s, ponukaSkielPre(s, ponukaSkielSystemu(s, katalog), odoo)])
	);
}

type SOdoo = { system: string; sklo: string; skloOdoo?: string; skloOdooNazov?: string };

/**
 * Over zvolený Odoo typ posuvu voči živému katalógu a doplň jeho názov (`skloOdooNazov`) na plán.
 * Typ musí byť v ponuke systému A počítať sa zvoleným výpočtovým sklom (inak by podvrhnutý POST
 * dostal do objednávky iné sklo, než sa počíta). Pri nedostupnom Odoo sa typ prijme bez overenia —
 * ovplyvňuje len text objednávky/plánu, nikdy výpočet ani Money. Vráti chybovú hlášku alebo null.
 */
export async function overSkloOdoo(p: SOdoo): Promise<string | null> {
	if (!p.skloOdoo) return null;
	const odoo = await fetchGlassTypes();
	if (odoo.source !== 'odoo') {
		log.warn('overSkloOdoo: Odoo nedostupné — typ skla prijatý bez overenia', {
			system: p.system,
			skloOdoo: p.skloOdoo
		});
		p.skloOdooNazov = p.skloOdoo;
		return null;
	}
	const ponuka = ponukaSkielPre(p.system, ponukaSkielSystemu(p.system, listGlassTypes()), odoo);
	const o = ponuka.skupiny.flatMap((g) => g.items).find((x) => x.odoo === p.skloOdoo);
	if (!o || o.vypocet !== p.sklo) {
		log.warn('overSkloOdoo: Odoo typ skla nepatrí k systému/výpočtovému sklu — odmietnuté', {
			system: p.system,
			sklo: p.sklo,
			skloOdoo: p.skloOdoo,
			vypocet: o?.vypocet ?? null
		});
		return `Typ skla z Odoo „${p.skloOdoo}" sa pre systém ${p.system} a toto sklo neponúka — vyber sklo znova.`;
	}
	p.skloOdooNazov = o.nazov;
	return null;
}

/** `parseVstup` + overenie Odoo typu skla (akcie nahlad/odoslat/pridatSkla). */
export async function parseVstupSOdoo(
	form: FormData
): Promise<{ vstup: Vstup; error: string | null }> {
	const r = parseVstup(form);
	if (r.error) return r;
	const e = await overSkloOdoo(r.vstup);
	return e ? { vstup: r.vstup, error: e } : r;
}

/** `parseMultiVstup` + overenie Odoo typu skla KAŽDÉHO posuvu. */
export async function parseMultiVstupSOdoo(
	form: FormData
): Promise<{ vstup: MultiVstup; error: string | null }> {
	const r = parseMultiVstup(form);
	if (r.error) return r;
	for (const [i, p] of r.vstup.posuvy.entries()) {
		const e = await overSkloOdoo(p);
		if (e) return { vstup: r.vstup, error: `Zasklenie ${i + 1}: ${e}` };
	}
	return r;
}
