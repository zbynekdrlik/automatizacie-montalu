// #579: Odoo typy skla (`montalu.glass.type`) v ponuke nárezáku zasklení podľa HRÚBKY systému.
//
// Design (Prístup 1, main 28.9.): hrúbka je spojka medzi Odoo a výpočtom. Systém povoľuje hrúbkové
// triedy (tabuľka `cfg_sklo_hrubka`, `sklo-hrubky.ts` — JEDEN zdroj, nastavuje výroba v editore,
// #579 časť 2); Odoo typ s `total_thickness_mm` v triede (a správneho druhu) sa ponúkne a počíta sa
// ako reprezentatívne LOKÁLNE výpočtové sklo:
//   • lokálne povolené sklo, ktoré naň matcher #556 mapuje (napr. ESG Float čirý 6mm → „ESG kalené
//     6 mm"), keď je také JEDINÉ;
//   • inak výpočtové sklo triedy odvodené pravidlom `vypocetneSkloPre` (Robust 24 → „Izolačné sklo
//     4/16/4 číre").
// Výpočtový katalóg `glass_types`, vzorce, profily a Money sú NEDOTKNUTÉ — do výpočtu ide vždy len
// lokálne sklo; zvolený Odoo typ (`skloOdoo`) ide do objednávky skla a na plán.
//
// #594 (Odoo úloha 1218, Marek 29.9.: „tam majú byť iba odoo") OBRACIA ROZHODNUTÉ #579 („lokálne
// sklá ostávajú"): pri dostupnom Odoo ponuka NEMÁ lokálne sklá — len skupiny „Odoo — <druh>".
// Predvolené sklo systému = PRESNÝ Odoo náprotivok dnešného predvoleného lokálneho skla (klient
// `volbaSkla` + `naprotivok`, pri AL/TH prvý v poradí `zoskupTypySkla` — VIDITEĽNÝ v selecte); „Použiť
// znova" lokálneho skla bez Odoo náprotivku dostane doplnkovú voľbu (`ponukaPreStyl`). Odoo
// nedostupné → dnešná lokálna ponuka (záloha).
import { logger } from './log';
import { listGlassTypes } from './db';
import { fetchGlassTypes, type GlassTypeOption, type GlassTypesResult } from './odoo-glass-types';
import { matchOdooGlassType, glassPovlak } from './glass-match';
import { parseVstup, parseMultiVstup, type Vstup, type MultiVstup } from './vstup';
import {
	odooDruhSedi,
	ponukaSkielSystemu,
	vypocetneSkloPre,
	type OdooHrubka
} from '$lib/sklo-povolene';
import { skloHrubkyPre } from './sklo-hrubky';
import { zoskupTypySkla } from '$lib/objednavka-skla-typy';
import { ODOO_PREFIX, type PonukaSkiel, type VolbaSkla } from '$lib/sklo-odoo';

const log = logger('sklo-odoo');

/** Systémy, pre ktoré už padlo varovanie „žiadna Odoo voľba" (warn raz za proces). */
const hlaseneBezOdoo = new Set<string>();

/** Prefix skupín Odoo typov (za ním druh zo `zoskupTypySkla`). */
export const PREFIX_ODOO_SKUPINY = 'Odoo — ';

/** Lokálna voľba (záloha pri nedostupnom Odoo) — bez cenníkového popisu (Odoo dáta nie sú). */
function lokalnaVolba(n: string): VolbaSkla {
	return { value: n, label: n, nazov: n, vypocet: n, odoo: '', naprotivok: true };
}

/**
 * Ponuka „Sklo (základ)" pre systém. `lokalne` = lokálna povolená ponuka systému
 * (`ponukaSkielSystemu`), `odoo` = výsledok `fetchGlassTypes`, `hrubky` = povolené hrúbky systému
 * (default z tabuľky `cfg_sklo_hrubka`, cache). Pri explicitných `hrubky` ČISTÁ (žiadne IO).
 */
export function ponukaSkielPre(
	system: string,
	lokalne: readonly string[],
	odoo: GlassTypesResult,
	hrubky: readonly OdooHrubka[] = skloHrubkyPre(system)
): PonukaSkiel {
	if (odoo.source !== 'odoo') return { skupiny: [{ label: '', items: lokalne.map(lokalnaVolba) }] };

	// výpočtové sklo triedy sa ODVODÍ z lokálnej ponuky (nikdy sa nezadáva); trieda bez neho
	// (napr. katalóg/allow-list sa medzitým zmenil) sa vynechá
	const triedy = hrubky.flatMap((h) => {
		const sklo = vypocetneSkloPre(h.mm, h.druh, lokalne);
		return sklo ? [{ ...h, sklo }] : [];
	});
	const triedaPre = (o: GlassTypeOption) =>
		triedy.find((t) => t.mm === o.hrubkaMm && odooDruhSedi(t.druh, o.category));
	// hrúbka 0 (dátová chyba v Odoo) nikdy nesedí na triedu → neponúkne sa (warn v fetchGlassTypes)
	const typy = odoo.items.filter((o) => o.hrubkaMm > 0 && triedaPre(o));

	// lokálne sklo → jeho Odoo náprotivky v ponuke (matcher #556: zloženie ∧ kategória ∧ odtieň ∧
	// povlak). Výpočtový zdroj Odoo typu:
	//   1. PRESNÁ zhoda vrátane povlaku (stopsol ↔ stopsol) — keď je JEDINÁ;
	//   2. typ s povlakom, pre ktorý lokálne sklo s povlakom neexistuje (napr. „ESG Stopsol … 6mm"),
	//      sa počíta ako jeho sklo BEZ povlaku — povlak mení len text objednávky, nie nárez/Money;
	//   3. inak predvolené sklo triedy.
	// Os odtieňa v režime 'vypoctovy' (#594): extračiré/Matelux sa pre VÝPOČET správajú ako pred
	// #594 (číre) — nové odtiene menia len objednávku/popis, nikdy výpočtové sklo (Money-neutrálne).
	const zdrojePre = (povlak: 'presne' | 'ignoruj') => {
		const m = new Map<string, GlassTypeOption[]>();
		for (const n of lokalne) {
			if (povlak === 'ignoruj' && glassPovlak(n) !== 'ziadny') continue;
			const k = matchOdooGlassType(n, typy, { povlak, odtien: 'vypoctovy' }).kandidati;
			if (k.length > 0) m.set(n, k);
		}
		return (o: GlassTypeOption) => [...m].filter(([, k]) => k.includes(o)).map(([n]) => n);
	};
	const presne = zdrojePre('presne');
	const bezPovlaku = zdrojePre('ignoruj');
	const vypocetPre = (o: GlassTypeOption): string => {
		const p = presne(o);
		if (p.length === 1) return p[0]!;
		if (p.length === 0) {
			const b = bezPovlaku(o);
			if (b.length === 1) return b[0]!;
		}
		return triedaPre(o)!.sklo;
	};
	// #594: presný náprotivok výpočtového skla (matcher so VŠETKÝMI osami — odtieň aj povlak) —
	// len taký môže byť predvolený (inak by Robust predvolil stopsol, Štandard + VSG, Deluxe bronz)
	const naprotivokPre = (o: GlassTypeOption, vypocet: string) =>
		matchOdooGlassType(vypocet, typy).kandidati.includes(o);
	const volby = new Map<string, VolbaSkla>(
		typy.map((o) => {
			const vypocet = vypocetPre(o);
			return [
				o.value,
				{
					value: ODOO_PREFIX + o.value,
					label: o.label,
					nazov: o.name || o.value,
					vypocet,
					odoo: o.value,
					naprotivok: naprotivokPre(o, vypocet)
				}
			];
		})
	);
	const odooSkupiny = zoskupTypySkla(typy, [], false).map((g) => ({
		label: PREFIX_ODOO_SKUPINY + g.label,
		items: g.items.map((i) => volby.get(i.value)!)
	}));
	// systém bez jedinej Odoo voľby (napr. bez povolených hrúbok) by nemal čo ponúknuť → záloha
	// ako pri nedostupnom Odoo (inak by nárezák nevedel spočítať)
	if (odooSkupiny.length === 0) {
		// warn RAZ za proces a systém (ponuka sa počíta pri každom loade nárezáka)
		if (!hlaseneBezOdoo.has(system)) {
			hlaseneBezOdoo.add(system);
			log.warn('ponukaSkielPre: systém nemá žiadnu Odoo voľbu skla — lokálna ponuka', { system });
		}
		return { skupiny: [{ label: '', items: lokalne.map(lokalnaVolba) }] };
	}
	return { skupiny: odooSkupiny };
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
		// názov bez Odoo nepoznáme → plán ukáže lokálne sklo (nie holý kód typu)
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
