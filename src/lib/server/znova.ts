// „Použiť znova" — z uloženého odpisu spraví PREDVYPLNENIE formulára zasklení.
//
// Patrik 2026-07-31: „môže znova zavolať to, čo použil minule, len zmení zákazníka —
// viacerí zákazníci si objednávajú to isté a nemusí to nanovo vypĺňať."
//
// Čo tento modul ROBÍ a čo NEROBÍ:
//   • NEODPISUJE nič. Vracia `Vstup` / `MultiVstup` — presne to, čo po chybe/náhľade
//     vracia akcia — takže stránka ich predvyplní tou istou cestou a človek ešte musí
//     kliknúť Spočítať a Odoslať. Žiadna nová cesta do Money nevzniká.
//   • ZAK, OP ani zákazník sa NEPREBERAJÚ — to je práve to, čo sa pri novej zákazke
//     mení, a prebratie starého ZAK+OP by aj tak narazilo na dedup kľúč.
//   • Sklo, ktoré sa pre daný systém už neponúka (napr. kalené 8/10 mm v Robuste po
//     migrácii v19), sa ZAHODÍ a ohlási v `chybajuce`. Radšej prázdna voľba, ktorú
//     obsluha vidí, než potichu prenesená hodnota, ktorú server odmietne.
import { getOdpis } from './money';
import { glassTypesForSystem, listSysStyly } from './db';
import type { Vstup, MultiVstup, PosuvVstup } from './vstup';
import type { Klin } from '$lib/klin';
import type { KolajnicaRucne } from '$lib/kolajnica';
import type { Sietka } from '$lib/sietka';

export interface ZnovaVysledok {
	/** z ktorej zákazky sa predvypĺňa (do hlášky nad formulárom) */
	zdroj: { id: number; zak: string; op: string; created_at: string };
	/** jednoposuvové predvyplnenie — tvar, aký vracia akcia `nahlad` */
	vstup?: Vstup;
	/** viac-posuvové (zimná záhrada) predvyplnenie */
	multiVstup?: MultiVstup;
	/** čo sa nedalo prebrať (sklo/štýl už neexistuje) — vypíše sa obsluhe */
	chybajuce: string[];
}

const s = (x: unknown): string => (typeof x === 'string' ? x : '');
const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const b = (x: unknown): boolean => x === true;
const obj = <T>(x: unknown): T | null => (x && typeof x === 'object' ? (x as T) : null);

/** sklo, ktoré daný systém stále ponúka; inak '' + záznam do `chybajuce` */
function platneSklo(system: string, sklo: string, chybajuce: string[], kde: string): string {
	if (!sklo) return '';
	if (glassTypesForSystem(system).some((g) => g.nazov === sklo)) return sklo;
	chybajuce.push(`${kde}: sklo „${sklo}" sa už pre systém ${system} neponúka — vyber nové`);
	return '';
}

/** jeden posuv z uloženého detailu → tvar, ktorý formulár rozumie */
function posuvZDetailu(
	d: Record<string, unknown>,
	styly: { system: string; styl: string }[],
	chybajuce: string[],
	kde: string
): PosuvVstup {
	const system = s(d.system);
	const styl = s(d.styl);
	if (system && styl && !styly.some((x) => x.system === system && x.styl === styl))
		chybajuce.push(`${kde}: štýl ${system} ${styl} už v konfigurácii nie je`);
	// v histórii je pod `sklo` uložené PRESNÉ zloženie, ak ho obsluha zadala;
	// základné sklo (to, ktoré určuje vzorec) je `skloZaklad`
	const zaklad = s(d.skloZaklad) || s(d.sklo);
	return {
		system,
		styl,
		s: n(d.s),
		v: n(d.v),
		sklo: platneSklo(system, zaklad, chybajuce, kde),
		otvaranie: s(d.otvaranie),
		kovanieL: s(d.kovanieL),
		kovanieP: s(d.kovanieP),
		kovanieStred: s(d.kovanieStred),
		kovanieStredOkno: d.kovanieStredOkno === 'P' ? 'P' : 'L',
		klin: obj<Klin>(d.klin),
		kolajnica: obj<KolajnicaRucne>(d.kolajnica),
		sietka: obj<Sietka>(d.sietka)
	};
}

/**
 * Postaví predvyplnenie z odpisu `id`. Vracia `null`, keď záznam neexistuje, nie je
 * zo zasklení (pergola/bazén majú vlastné formuláre) alebo má pokazený detail.
 */
export function znovaZOdpisu(id: number): ZnovaVysledok | null {
	const row = getOdpis(id);
	if (!row || row.modul !== 'zasklenia') return null;

	let d: Record<string, unknown>;
	try {
		d = JSON.parse(row.detail || '{}') as Record<string, unknown>;
	} catch {
		return null;
	}

	const styly = listSysStyly();
	const chybajuce: string[] = [];
	const zdroj = { id: row.id, zak: row.zak, op: row.op, created_at: row.created_at };
	// spoločné polia; ZAK/OP/zákazník sa zámerne NEpreberajú
	const spolocne = {
		zak: '',
		op: '',
		zakaznik: '',
		poznamka: s(d.poznamka),
		ral: s(d.ral),
		caka: row.caka === 1,
		pridavnaKolajnica: b(d.pridavnaKolajnica),
		jednostrannaFab: b(d.jednostrannaFab)
	};

	if (d.zimnaZahrada === true) {
		const posuvy = Array.isArray(d.posuvy) ? (d.posuvy as Record<string, unknown>[]) : [];
		if (!posuvy.length) return null;
		const multiVstup: MultiVstup = {
			...spolocne,
			posuvy: posuvy.map((p, i) => posuvZDetailu(p, styly, chybajuce, `Posuv ${i + 1}`))
		};
		return { zdroj, chybajuce, multiVstup };
	}

	const p = posuvZDetailu(d, styly, chybajuce, 'Posuv');
	const vstup: Vstup = {
		...spolocne,
		...p,
		skloPresne: s(d.skloZaklad) ? s(d.sklo) : '',
		vrtanieZamku: n(d.vrtanieZamku) || 1050
	};
	return { zdroj, chybajuce, vstup };
}
