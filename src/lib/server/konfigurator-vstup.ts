// Parser + validácia vstupu verejného konfigurátora pergoly (#275, fáza 1). Žije mimo
// +page.server.ts (SvelteKit dovolí exportovať z +page.server.ts len load/actions/…),
// takže sa dá priamo unit-testovať — viď nova-stranka pasca #1. Server-only ($lib/server/):
// importuje katalóg `SKLO_STRECHA_TYPY` (nesie Money kód), ale používa LEN `.nazov` na
// validáciu názvu skla — Money kód sa tu NIKDY nečíta ani neemituje (guard:
// tests/konfigurator-money-safety.test.ts). RAL paleta nemá žiadny Money údaj.
// Rozmery sa validujú cez rozmedzia enginu `pergola-navrh` (znovupoužité v konfigurator.ts).
import { SKLO_STRECHA_TYPY } from '$lib/sklo-strecha';
import { RAL_PALETA } from '$lib/vykres/ral';
import {
	vyskaPriStene,
	KONF_SIRKA_MIN,
	KONF_SIRKA_MAX,
	KONF_HLBKA_MIN,
	KONF_HLBKA_MAX,
	KONF_VYSKA_MIN,
	KONF_VYSKA_MAX,
	KONF_SKLON_MIN,
	KONF_SKLON_MAX,
	KONF_VYSKA_STENA_MAX,
	type KonfiguratorVstup
} from '$lib/konfigurator';

/** Číslo zo vstupu: akceptuje desatinnú čiarku aj medzery (napr. „6 000", „5,5"). */
function cislo(v: FormDataEntryValue | null | undefined): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.replace(/\s/g, '')
	);
}

/** Množina platných názvov strešného skla — LEN `.nazov`, žiadny Money kód. */
const PLATNE_SKLA = new Set(SKLO_STRECHA_TYPY.map((t) => t.nazov));

/** Sparsuje FormData na typovaný vstup, alebo vráti { error } s hláškou v slovenčine.
 *  Neznámy názov skla / neplatná farba / rozmer mimo rozmedzia → odmietnuté (žiadna
 *  injekcia ľubovoľného reťazca do súhrnu). */
export function parseKonfiguratorVstup(
	fd: FormData
): { vstup: KonfiguratorVstup } | { error: string } {
	const sirka = cislo(fd.get('sirka'));
	if (!Number.isFinite(sirka) || sirka < KONF_SIRKA_MIN || sirka > KONF_SIRKA_MAX)
		return { error: `Šírka musí byť ${KONF_SIRKA_MIN}–${KONF_SIRKA_MAX} mm.` };

	const hlbka = cislo(fd.get('hlbka'));
	if (!Number.isFinite(hlbka) || hlbka < KONF_HLBKA_MIN || hlbka > KONF_HLBKA_MAX)
		return { error: `Hĺbka musí byť ${KONF_HLBKA_MIN}–${KONF_HLBKA_MAX} mm.` };

	const vyskaVpredu = cislo(fd.get('vyskaVpredu'));
	if (!Number.isFinite(vyskaVpredu) || vyskaVpredu < KONF_VYSKA_MIN || vyskaVpredu > KONF_VYSKA_MAX)
		return { error: `Výška vpredu musí byť ${KONF_VYSKA_MIN}–${KONF_VYSKA_MAX} mm.` };

	const sklonDeg = cislo(fd.get('sklonDeg'));
	if (!Number.isFinite(sklonDeg) || sklonDeg < KONF_SKLON_MIN || sklonDeg > KONF_SKLON_MAX)
		return { error: `Sklon strechy musí byť ${KONF_SKLON_MIN}–${KONF_SKLON_MAX}°.` };

	// dopočet výšky pri stene cez engine — kombinácia výška+hĺbka+sklon nesmie presiahnuť
	// konštrukčné rozmedzie enginu (pultová strecha stúpa k stene)
	const stena = vyskaPriStene(vyskaVpredu, sklonDeg, hlbka);
	if (stena > KONF_VYSKA_STENA_MAX)
		return {
			error: `Kombinácia výšky, hĺbky a sklonu je pri stene priveľmi vysoká (max ${KONF_VYSKA_STENA_MAX} mm). Zmenši sklon alebo hĺbku.`
		};

	const sklo = String(fd.get('sklo') ?? '').trim();
	if (!PLATNE_SKLA.has(sklo)) return { error: 'Vyber platný typ strešného skla.' };

	const farbaKod = String(fd.get('farba') ?? '').trim();
	const ral = RAL_PALETA.find((r) => r.kod === farbaKod);
	if (!ral) return { error: 'Vyber platnú farbu konštrukcie.' };
	const farba = `RAL ${ral.kod} ${ral.nazov}`;

	return { vstup: { sirka, hlbka, vyskaVpredu, sklonDeg, sklo, farba } };
}
