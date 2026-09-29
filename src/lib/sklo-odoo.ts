// #579: ponuka „Sklo (základ)" v nárezáku zasklení = Odoo typy skla podľa hrúbky systému (#594: pri
// dostupnom Odoo LEN tie — žiadne lokálne sklá appky; Odoo nedostupné → lokálne sklá). CLIENT-SAFE
// (žiadny `$lib/server` import) — ponuku per systém počíta server (`$lib/server/sklo-odoo` `ponukaSkielPre`), klient ju len zúži podľa štýlu a prekladá
// voľbu selectu na DVE polia formulára:
//   • `sklo`     = LOKÁLNE výpočtové sklo (vzorce, IZO nárezák, hrúbka, tesnenie, Money — nič z toho
//                  sa nemení, všetok existujúci kód pracuje ďalej s ním);
//   • `skloOdoo` = presne zvolený Odoo typ (`cennik_code || name`) → objednávka skla + plán.
// Voľba selectu je ODVODENÁ (`volbaSkla`) z týchto dvoch polí — žiadny ďalší stav ani `$effect`.
// #594: keď lokálne `sklo` v ponuke nie je (Odoo ponuka), select ukáže PRVÝ presný Odoo náprotivok
// tohto skla (predvolené sklo systému aj „Použiť znova" starého odpisu); keď taká voľba nie je,
// `ponukaPreStyl` pridá lokálne sklo ako jedinú doplnkovú voľbu „pôvodné sklo z appky".
import { SKLO_INE } from './sklo';

/** Prefix hodnoty `<option>` pre Odoo voľbu (nikdy sa nebije s lokálnym názvom skla). */
export const ODOO_PREFIX = 'odoo:';

/** #594: poznámka doplnkovej lokálnej voľby (sklo starého odpisu bez Odoo náprotivku). */
export const POVODNE_SKLO_APPKY = 'pôvodné sklo z appky';

/** Jedna voľba selectu „Sklo (základ)". */
export interface VolbaSkla {
	/** hodnota `<option>` — lokálny názov, alebo `ODOO_PREFIX + odoo` */
	value: string;
	/** text `<option>` */
	label: string;
	/** názov na pláne/objednávke (Odoo `name` alebo lokálny názov) */
	nazov: string;
	/** lokálne výpočtové sklo, ktorým sa voľba počíta */
	vypocet: string;
	/** Odoo hodnota (`cennik_code || name`); '' pri lokálnom skle */
	odoo: string;
	/**
	 * #594: voľba je PRESNÝ náprotivok svojho výpočtového skla (matcher #556: zloženie ∧ kategória ∧
	 * odtieň ∧ povlak) — len taká môže byť predvolená. Napr. stopsol / bronz / VSG typ, ktorý sa
	 * počíta ako „4/16/4 číre" / „Float sklo 6 mm", NIE JE náprotivok. Lokálne sklo = samo sebe.
	 */
	naprotivok: boolean;
}

/** `<optgroup>` ponuky (prázdny `label` = bez skupiny — lokálny fallback). */
export interface SkupinaVolieb {
	label: string;
	items: VolbaSkla[];
}

/** Ponuka skiel jedného systému (zo servera). */
export interface PonukaSkiel {
	skupiny: SkupinaVolieb[];
}

const lokalnaVolba = (n: string): VolbaSkla => ({
	value: n,
	label: n,
	nazov: n,
	vypocet: n,
	odoo: '',
	naprotivok: true
});

/**
 * Ponuka pre systém + štýl: voľby, ktorých výpočtové sklo štýl povoľuje (`povolene` = výsledok
 * `sklaForSystem` — ten istý IZO gate štýlu ako lokálne sklá), prázdne skupiny vynechané. Bez
 * serverovej ponuky (neznámy systém) = lokálne názvy 1:1. Sentinel „Iné" sem nepatrí (volajúci ho
 * pridáva zvlášť).
 *
 * #594: `sklo` = aktuálne výpočtové sklo formulára. Keď je povolené, ale žiadna voľba ponuky sa ním
 * nepočíta (Odoo ponuka nemá lokálne sklá — napr. „Použiť znova" starého odpisu so sklom, ktoré
 * Odoo nemá), pridá sa ako JEDINÁ doplnková voľba „<sklo> · pôvodné sklo z appky" — inak by select
 * nemal čo ukázať a obsluha by sklo nevidela.
 */
export function ponukaPreStyl(
	p: PonukaSkiel | undefined,
	povolene: readonly string[],
	sklo = ''
): SkupinaVolieb[] {
	if (!p) return [{ label: '', items: povolene.map(lokalnaVolba) }];
	const ok = new Set(povolene);
	const sk = p.skupiny
		.map((g) => ({ label: g.label, items: g.items.filter((o) => ok.has(o.vypocet)) }))
		.filter((g) => g.items.length > 0);
	const doplnit =
		sklo !== '' &&
		sklo !== SKLO_INE &&
		ok.has(sklo) &&
		!sk.some((g) => g.items.some((o) => o.vypocet === sklo));
	if (!doplnit) return sk;
	return [
		...sk,
		{
			label: '',
			items: [{ ...lokalnaVolba(sklo), label: `${sklo} · ${POVODNE_SKLO_APPKY}` }]
		}
	];
}

const vsetky = (skupiny: readonly SkupinaVolieb[]): VolbaSkla[] => skupiny.flatMap((g) => g.items);

/**
 * Hodnota selectu pre stav (`sklo`, `skloOdoo`): zvolený Odoo typ, ak je v ponuke a stále sa počíta
 * zvoleným výpočtovým sklom; inak lokálne sklo, keď je v ponuke (záloha bez Odoo, doplnková voľba);
 * inak (#594) PRVÝ presný Odoo náprotivok tohto skla (`naprotivok`; pri AL/TH prvý v poradí), a keď
 * náprotivok nie je, prvá Odoo voľba počítaná týmto sklom (predvolené sklo / „Použiť znova" —
 * viditeľný výber v selecte, nikdy stopsol/bronz/VSG typ pred presným); inak sklo samo (aj „Iné").
 */
export function volbaSkla(
	sklo: string,
	skloOdoo: string,
	skupiny: readonly SkupinaVolieb[]
): string {
	const v = vsetky(skupiny);
	if (skloOdoo) {
		const o = v.find((x) => x.odoo === skloOdoo && x.vypocet === sklo);
		if (o) return o.value;
	}
	if (v.some((x) => x.value === sklo)) return sklo;
	const odooPre = v.filter((x) => x.odoo !== '' && x.vypocet === sklo);
	return (odooPre.find((x) => x.naprotivok) ?? odooPre[0])?.value ?? sklo;
}

/** Voľba selectu → polia formulára (`sklo` výpočtové, `skloOdoo` Odoo typ alebo ''). */
export function rozlozVolbu(
	value: string,
	skupiny: readonly SkupinaVolieb[]
): { sklo: string; skloOdoo: string } {
	const o = vsetky(skupiny).find((x) => x.value === value);
	return o ? { sklo: o.vypocet, skloOdoo: o.odoo } : { sklo: value, skloOdoo: '' };
}

/**
 * Odoo typ, ktorý select pre stav (`sklo`, `skloOdoo`) naozaj ukazuje ('' pri lokálnom skle alebo
 * keď typ po zmene skla/štýlu už neplatí). Toto (nie surový stav) sa posiela na server.
 */
export function skloOdooPre(
	p: PonukaSkiel | undefined,
	povolene: readonly string[],
	sklo: string,
	skloOdoo: string
): string {
	const sk = ponukaPreStyl(p, povolene, sklo);
	return rozlozVolbu(volbaSkla(sklo, skloOdoo, sk), sk).skloOdoo;
}
