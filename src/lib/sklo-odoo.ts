// #579: ponuka „Sklo (základ)" v nárezáku zasklení = lokálne (výpočtové) sklá appky + Odoo typy
// skla podľa hrúbky systému. CLIENT-SAFE (žiadny `$lib/server` import) — ponuku per systém počíta
// server (`$lib/server/sklo-odoo` `ponukaSkielPre`), klient ju len zúži podľa štýlu a prekladá
// voľbu selectu na DVE polia formulára:
//   • `sklo`     = LOKÁLNE výpočtové sklo (vzorce, IZO nárezák, hrúbka, tesnenie, Money — nič z toho
//                  sa nemení, všetok existujúci kód pracuje ďalej s ním);
//   • `skloOdoo` = presne zvolený Odoo typ (`cennik_code || name`) → objednávka skla + plán.
// Voľba selectu je ODVODENÁ (`volbaSkla`) z týchto dvoch polí — žiadny ďalší stav ani `$effect`.

/** Prefix hodnoty `<option>` pre Odoo voľbu (nikdy sa nebije s lokálnym názvom skla). */
export const ODOO_PREFIX = 'odoo:';

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
	odoo: ''
});

/**
 * Ponuka pre systém + štýl: voľby, ktorých výpočtové sklo štýl povoľuje (`povolene` = výsledok
 * `sklaForSystem` — ten istý IZO gate štýlu ako lokálne sklá), prázdne skupiny vynechané. Bez
 * serverovej ponuky (neznámy systém) = lokálne názvy 1:1. Sentinel „Iné" sem nepatrí (volajúci ho
 * pridáva zvlášť).
 */
export function ponukaPreStyl(
	p: PonukaSkiel | undefined,
	povolene: readonly string[]
): SkupinaVolieb[] {
	if (!p) return [{ label: '', items: povolene.map(lokalnaVolba) }];
	const ok = new Set(povolene);
	return p.skupiny
		.map((g) => ({ label: g.label, items: g.items.filter((o) => ok.has(o.vypocet)) }))
		.filter((g) => g.items.length > 0);
}

const vsetky = (skupiny: readonly SkupinaVolieb[]): VolbaSkla[] => skupiny.flatMap((g) => g.items);

/**
 * Hodnota selectu pre stav (`sklo`, `skloOdoo`): zvolený Odoo typ, ak je v ponuke a stále sa počíta
 * zvoleným výpočtovým sklom; inak lokálne sklo samo (aj sentinel „Iné").
 */
export function volbaSkla(
	sklo: string,
	skloOdoo: string,
	skupiny: readonly SkupinaVolieb[]
): string {
	if (skloOdoo) {
		const o = vsetky(skupiny).find((x) => x.odoo === skloOdoo && x.vypocet === sklo);
		if (o) return o.value;
	}
	return sklo;
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
	const sk = ponukaPreStyl(p, povolene);
	return rozlozVolbu(volbaSkla(sklo, skloOdoo, sk), sk).skloOdoo;
}
