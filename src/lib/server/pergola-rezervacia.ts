// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221). Most medzi vzorcovým enginom
// (`$lib/pergola-narez`, display-only, počíta materiál z rozmerov) a Money odpisovou
// cestou (`$lib/server/pergola` transform → PRP metre tyčí, `$lib/server/money`
// writeOdpis). Rezervácia = klasický odpis do Money hneď pri zadaní objednávky
// (call s Dominikom 19.8.2026), z NÁVRHOV/rozmerov, bez CAD-u, bez +20 %.
//
// DISCIPLÍNA: do odpisu idú LEN potvrdené položky s istou dĺžkou rezu
// (`dlzkaRezuMm != null`). Honest-null (napr. priečka 18004 = HH krovu #161) a
// „nepodporované" ostávajú čestne „zatiaľ nepočítané" a NIKDY sa ticho nepridajú.
// Tým, že potvrdené riadky enginu majú presne tvar `CadRow`, prechádzajú tým istým
// na 20/20 Money pároch overeným `transformRows` jadrom → rezervácia je bit-presne
// v rovnakom formáte ako reálny CAD odpis (→ #227 aktualizácia na reálne čísla).
import { transformRows, catalogCodes, type CadRow } from './pergola';
import { spocitajNarez, type PergolaNarezVstup, type NarezVysledok } from '$lib/pergola-narez';
import { rucnaValidacia, type RucnaPolozka } from '$lib/pergola-rucne';
import { spocitajTesnenia, type TesnenieRozmer } from '$lib/pergola-tesnenia';
import type { OdpisJob, Polozka } from './money';
import type { MJ } from '$lib/komponenty';
// Re-export tesnenia types pre konzumentov, ktorí pôvodne importovali odtiaľto (#419 extrakcia)
export { spocitajTesnenia, type TesnenieRozmer, type TesnenieStav } from '$lib/pergola-tesnenia';

/**
 * Potvrdené riadky nárezu → `CadRow[]` pre Money odpis. LEN riadky s ISTOU dĺžkou
 * rezu (`dlzkaRezuMm != null`) a nenulovým počtom. Honest-null sa VYNECHAJÚ — do
 * rezervácie nikdy nejde vymyslené číslo (čestný null, #155 disciplína).
 */
export function narezToCadRows(vysledok: NarezVysledok): CadRow[] {
	return vysledok.vypocitane
		.filter((p) => p.dlzkaRezuMm != null && p.pocetKs > 0)
		.map((p) => ({
			code: p.kod,
			name: p.nazov,
			qty: p.pocetKs,
			cut_mm: p.dlzkaRezuMm as number
		}));
}

export interface VylucenaPolozka {
	kod: string;
	nazov: string;
	dovod: string;
}

/**
 * Potvrdené riadky, ktoré sa do rezervácie NEDOSTALI, lebo dĺžka rezu zatiaľ nie je
 * istá (`dlzkaRezuMm === null`) — na zobrazenie „zatiaľ nepočítané". Počet je istý,
 * dĺžku rezu ešte nemáme (napr. priečka = HH krovu #161).
 */
export function vylucenePolozky(vysledok: NarezVysledok): VylucenaPolozka[] {
	return vysledok.vypocitane
		.filter((p) => p.dlzkaRezuMm == null)
		.map((p) => ({
			kod: p.kod,
			nazov: p.nazov,
			dovod: p.poznamka ?? 'dĺžka rezu zatiaľ neznáma — čaká na vzorec'
		}));
}

// --- Tesnenia (#339) — EXTRAHOVANÉ do `$lib/pergola-tesnenia.ts` (#419) -----------
// Typy + katalóg + `spocitajTesnenia` žijú v client-safe pure module, re-exportované
// vyššie cez `export { … } from '$lib/pergola-tesnenia'`. Sem už nepatria (boli tu
// pôvodne, keď boli server-only display; extrakcia umožnila client-side expedíciu).

/** Identifikačné polia zákazky (do dokladu/dedupu/názvu súboru). */
export interface RezervaciaIdent {
	zak: string;
	op: string;
	zakaznik: string;
}

export interface RezervaciaRozpis {
	/** nenulové Money položky (PRP kód + metre surových tyčí) — na zobrazenie. `rucne:true`
	 *  = ručne pridaný riadok (#234), zobrazí sa s odznakom „ručne pridané"; `mj` nesie
	 *  jednotku (spočítané sú vždy 'm', ručné môžu byť 'ks'). */
	nonzero: { kod: string; nazov: string; qty: number; rucne?: boolean; mj?: MJ }[];
	/** VŠETKÝCH 25 katalógových riadkov do xlsx (aj nulové — 1:1 ako CAD/bazén) + ručné
	 *  riadky (#234) na konci (Money kód + MJ položky). */
	polozky: Polozka[];
	/** #234 — varovania k ručným riadkom (neznámy kód v katalógu). Nikdy tiché prijatie. */
	manualWarnings: string[];
	/** čestne nespočítané (honest-null) — „zatiaľ nepočítané" */
	vylucene: VylucenaPolozka[];
	/** engine zoznam „zatiaľ nepodporované" (krov, sklá, lišty…) */
	nepodporovane: string[];
	/** dlhé-rez poznámky (rez > najdlhšia tyč → spoj nad nohou skontrolovať) */
	longNotes: string[];
	/** tesnenia (gumy) #339 — dĺžky z callu; do Money NEIDÚ (kód null), len na zobrazenie */
	tesnenia: TesnenieRozmer[];
	/** počet nenulových Money položiek, ktoré tvoria rezervačný odpis */
	pocetPolozok: number;
}

/**
 * Zostaví Money rozpis rezervácie z rozmerov — BEZ akéhokoľvek zápisu. Vráti chybu
 * (nie tiché prázdno), keď: chýba ZAK/zákazník/OP, z rozmerov nevyšli žiadne potvrdené
 * položky, alebo sa niektorý kód nedá namapovať na Money PRP (nikdy tichý výpadok
 * materiálu — rovnaká disciplína ako `validatePergola` v CAD ceste).
 */
export function buildRezervaciaRozpis(
	vstup: PergolaNarezVstup,
	ident: RezervaciaIdent,
	manualRows: RucnaPolozka[] = []
): { rozpis: RezervaciaRozpis; error: null } | { rozpis: null; error: string } {
	if (!ident.zak.trim()) return { rozpis: null, error: 'Chýba číslo objednávky (ZAK).' };
	if (!ident.zakaznik.trim()) return { rozpis: null, error: 'Chýba zákazník.' };
	if (!ident.op.trim())
		return { rozpis: null, error: 'Chýba OP/OPDL číslo (ide do popisu dokladu).' };

	const vysledok = spocitajNarez(vstup);
	const cadRows = narezToCadRows(vysledok);
	// #234 — odpis môže vzniknúť aj LEN z ručných riadkov; prázdny je len keď nemáme ani
	// spočítané, ani ručné položky.
	if (cadRows.length === 0 && manualRows.length === 0)
		return {
			rozpis: null,
			error: 'Z rozmerov zatiaľ nevyšli žiadne potvrdené položky na odpis.'
		};

	// transformRows([]) vráti 25 katalógových riadkov s qty 0 — bezpečné aj pri prázdnych
	// cadRows (odpis len z ručných riadkov).
	const t = transformRows(cadRows);
	if (t.unresolved.length)
		return {
			rozpis: null,
			error: 'Nenamapované kódy na Money: ' + t.unresolved.map((u) => u.cad).join(', ')
		};

	// #234 — ručné riadky OBÍDU CAD transform: sú už Money kód + MJ (m/ks), NIE CAD dĺžky.
	// Validácia proti katalógu: neznámy kód = VAROVANIE, nie tiché prijatie (ani odmietnutie).
	const codes = catalogCodes();
	const computedNonzero = t.out
		.filter((o) => o.qty > 0)
		.map((o) => ({ kod: o.prp, nazov: o.name, qty: o.qty }));
	// kódy, ktoré už vyšli zo spočítaných — na varovanie pred dvojitým odpisom (#234 review)
	const computedCodes = new Set(computedNonzero.map((o) => o.kod));
	const warnings: string[] = [];
	const manualNonzero: { kod: string; nazov: string; qty: number; rucne?: boolean; mj?: MJ }[] = [];
	const manualPolozky: Polozka[] = [];
	for (const m of manualRows) {
		if (!(m.mnozstvo > 0)) continue; // prázdny/nulový ručný riadok sa nezahŕňa
		const v = rucnaValidacia(m.kod, codes);
		if (v.warning) warnings.push(v.warning);
		// #234 review — ručný kód, ktorý UŽ vyšiel zo spočítaných, by v Money dvojito odpísal
		if (computedCodes.has(m.kod))
			warnings.push(
				`Kód „${m.kod}" už je medzi spočítanými položkami — ručný riadok sa pripočíta navyše (over, či nejde o dvojitý odpis).`
			);
		manualNonzero.push({ kod: m.kod, nazov: m.nazov, qty: m.mnozstvo, rucne: true, mj: m.mj });
		manualPolozky.push({ kod: m.kod, nazov: m.nazov, qty: m.mnozstvo, mj: m.mj });
	}
	// dedup varovaní — rovnaký neznámy/kolízny kód na dvoch riadkoch by inak dal rovnaký
	// string a v svelte `{#each … (w)}` spôsobil duplicate-key chybu (#234 review)
	const manualWarnings = [...new Set(warnings)];

	const nonzero = [...computedNonzero, ...manualNonzero];
	if (nonzero.length === 0)
		return { rozpis: null, error: 'Z rozmerov nevyšli žiadne Money položky na rezerváciu.' };

	// VŠETKÝCH 25 katalógových riadkov (aj nulové) — presne ako CAD/bazén odpis — + ručné
	// riadky na konci (idú do xlsx so svojou MJ).
	const polozky: Polozka[] = [
		...t.out.map((o) => ({ kod: o.prp, nazov: o.name, qty: o.qty })),
		...manualPolozky
	];
	const longNotes = t.trace
		.filter((tr) => tr.notes.length)
		.map((tr) => tr.name + ': ' + tr.notes.join('; '));

	return {
		rozpis: {
			nonzero,
			polozky,
			manualWarnings,
			vylucene: vylucenePolozky(vysledok),
			// #233 — engine `nepodporovane` je teraz {kratky, detail}; rozpis nesie len krátku
			// vetu (string[], tvar nezmenený; rez-nahlad ho nerenderuje).
			nepodporovane: vysledok.nepodporovane.map((n) => n.kratky),
			longNotes,
			// #339 — tesnenia (gumy): dĺžky z callu; do Money NEIDÚ (kód null), len na zobrazenie
			tesnenia: spocitajTesnenia(vysledok),
			pocetPolozok: nonzero.length
		},
		error: null
	};
}

/**
 * `OdpisJob` pre rezerváciu. `modul='pergola'` → ZDIEĽANÝ dedup s CAD odpisom (rezervácia
 * a neskorší CAD odpis tej istej ZAK+OP kolidujú → bráni dvojitému odpisu materiálu).
 * `rezervacia:true` → názov súboru dostane marker „REZ" (`filenameFor`). Doklad (`popis`)
 * je označený „REZ", takže rezerváciu vidno aj v Money. `detail` nesie rozmery zákazky +
 * vylúčené kódy, aby #227 (aktualizácia na reálne čísla) vedela rezerváciu nájsť/napárovať.
 */
export function rezervaciaJob(
	vstup: PergolaNarezVstup,
	ident: RezervaciaIdent,
	rozpis: RezervaciaRozpis,
	createdBy: string
): OdpisJob {
	const zak = ident.zak.trim();
	const op = ident.op.trim();
	const zakaznik = ident.zakaznik.trim();
	return {
		modul: 'pergola',
		zak,
		op,
		zakaznik,
		// rezervácia rezervuje TERAZ (ide priamo do Money importu), nie do NA ODPIS/čaká
		caka: false,
		createdBy,
		cakaSubdir: 'Pergola',
		// doklad označený „REZ" — v Money hneď vidno, že ide o rezerváciu
		popis: ('REZ ' + op + ' ' + zakaznik).trim(),
		polozky: rozpis.polozky,
		rezervacia: true,
		detail: {
			rezervacia: true,
			riadkov: rozpis.pocetPolozok,
			// #234 — koľko z nich je ručne pridaných (pometrané) — na napárovanie/audit (#227)
			rucneRiadkov: rozpis.nonzero.filter((o) => o.rucne).length,
			// rozmery zákazky (podklad rezervácie) — #227 z nich vie napárovať/aktualizovať
			system: vstup.system,
			sirka: vstup.sirka,
			hlbka: vstup.hlbka,
			uchytenie: vstup.uchytenie,
			pocetPrednychNoh: vstup.pocetPrednychNoh,
			// kódy, ktoré rezervácia čestne NEZAHRNULA (honest-null) — čo treba doplniť
			// pri aktualizácii na reálne čísla
			vylucene: rozpis.vylucene.map((v) => v.kod)
		}
	};
}
