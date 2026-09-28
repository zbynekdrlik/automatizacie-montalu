// #577: posledné odoslanie objednávky skla do Odoo + odkaz (RED stub — implementácia v GREEN).

export interface OdoslanieOdoo {
	glassOrderId: number;
	name: string;
	odoslal: string;
	odoslaneKedy: string;
	url: string | null;
}

export function odooObjednavkaSklaUrl(_glassOrderId: number): string | null {
	return null;
}

export function ulozOdoslanieOdoo(
	_zak: string,
	_odoo: { glassOrderId: number; name?: string },
	_odoslal: string
): void {}

export function posledneOdoslanieOdoo(_zak: string): OdoslanieOdoo | null {
	return null;
}
