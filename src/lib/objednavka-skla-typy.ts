// #576: zoskupenie typov skla pre picker podkladu objednávky skla (RED stub — implementácia v GREEN).

export const SENTINEL_INE_SKLO = '__ine__';

export interface TypSklaVolba {
	value: string;
	label: string;
}

export interface SkupinaTypovSkla {
	label: string;
	items: TypSklaVolba[];
}

export function zoskupTypySkla(
	_items: (TypSklaVolba & { category: string })[],
	_kandidati: TypSklaVolba[]
): SkupinaTypovSkla[] {
	return [];
}
