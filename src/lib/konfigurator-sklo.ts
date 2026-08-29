// Zákaznícka vrstva strešného skla pre VEREJNÝ konfigurátor (#329 časť 4). montalu.sk ukazuje
// zákazníkovi len KATEGÓRIE skla, nie 14 katalógových typov s hrúbkami — zákazník nevyberá „aké
// hrubé sklo". Každá kategória sa mapuje na jeden KONKRÉTNY katalógový názov zo `SKLO_STRECHA_TYPY`
// (`.nazov`), ktorý sa POSTuje ďalej nezmenene → cena/PDF/dopyt/Odoo lead a odoslanie dostávajú
// presne ten istý katalógový `nazov` ako doteraz, takže NIČ v pipeline sa nemení.
//
// CLIENT-SAFE: modul nesie LEN katalógový `nazov` (ten ide klientovi cez `data.sklaKategorie[].katalogNazov`)
// + zákaznícky label/popis/ikonu — NIKDY Money kód (TS*) ani cenu. Preto ho smie importovať aj
// klientsky bundle (leak-guard `konfigurator-money-safety` ostáva zelený). Interné stránky
// (/zasklenia*, /pergola*) ostávajú na PLNOM katalógu `SKLO_STRECHA_TYPY` — táto vrstva je len
// pre verejný /konfigurator. Zhoda `katalogNazov` s reálnym katalógom je overená unit testom
// (`tests/konfigurator-sklo.test.ts`) — tam sa smie importovať `sklo-strecha` (test nie je klient).

export interface KonfSkloKategoria {
	/** stabilný kľúč kategórie — poradie + data-testid, nezávislý od labelu */
	kluc: string;
	/** zákaznícky label na chipe (BEZ hrúbky — 4.4.2/-8-6… ostáva interné) */
	label: string;
	/** krátky popis pre hover/ⓘ kartu (1 veta, plain SK) */
	popis: string;
	/** názov ikony vo `static/konfigurator/` (webp, z montalu.sk) */
	ikona: string;
	/** KONKRÉTNY katalógový názov (`SKLO_STRECHA_TYPY.nazov`) — POSTuje sa ďalej, interne mapuje
	 *  na Money kód (mimo klienta). Zákazník ho nikdy nevidí. */
	katalogNazov: string;
}

/** 6 zákazníckych kategórií strešného skla (poradie = od najčastejšieho/najlacnejšieho vzhľadu).
 *  Mapovanie schválené v tikete #329 (owner). */
export const KONF_SKLO_KATEGORIE: readonly KonfSkloKategoria[] = [
	{
		kluc: 'bezp-cire',
		label: 'Bezpečnostné sklo — číre',
		popis: 'Číre lepené bezpečnostné sklo — pri rozbití drží pohromade. Maximum svetla a výhľadu.',
		ikona: 'sklo-bezpecnostne.webp',
		katalogNazov: '4.4.2 číre'
	},
	{
		kluc: 'bezp-mliecne',
		label: 'Bezpečnostné sklo — mliečne',
		popis: 'Lepené bezpečnostné sklo s mliečnou fóliou — príjemný rozptýlený tieň a súkromie.',
		ikona: 'sklo-bezpecnostne.webp',
		katalogNazov: '4.4.2 mliečne'
	},
	{
		kluc: 'izo-cire',
		label: 'Izolačné sklo — číre',
		popis:
			'Dvojsklo s izolačnou medzerou — lepšie drží teplo, číry výhľad. Ideálne k zimnej záhrade.',
		ikona: 'sklo-izolacne.webp',
		katalogNazov: 'IZO 4.4.2-8-6 číre'
	},
	{
		kluc: 'izo-mliecne',
		label: 'Izolačné sklo — mliečne',
		popis: 'Izolačné dvojsklo s mliečnym vzhľadom — teplo aj rozptýlené svetlo a súkromie.',
		ikona: 'sklo-izolacne.webp',
		katalogNazov: 'IZO 4.4.2-8-6 mliečne'
	},
	{
		kluc: 'polykarbonat',
		label: 'Polykarbonát — číry',
		popis: 'Ľahká priehľadná výplň — cenovo najdostupnejšia, dobre rozptyľuje svetlo.',
		ikona: 'sklo-polykarbonat.webp',
		katalogNazov: 'polykarbonát 16 mm číry'
	},
	{
		kluc: 'panel',
		label: 'Plný panel',
		popis: 'Nepriehľadný izolačný panel — plný tieň a najlepšia tepelná ochrana.',
		ikona: 'sklo-panel.webp',
		katalogNazov: 'STADUR 24 mm'
	}
];

/** Množina konkrétnych katalógových názvov ponúkaných verejnému zákazníkovi (6 kategórií). */
export const KONF_SKLO_KATALOG_NAZVY: readonly string[] = KONF_SKLO_KATEGORIE.map(
	(k) => k.katalogNazov
);

/** Kategória podľa katalógového názvu (napr. na zobrazenie labelu/popisu k zvolenému sklu). */
export function konfSkloKategoriaPreNazov(katalogNazov: string): KonfSkloKategoria | undefined {
	return KONF_SKLO_KATEGORIE.find((k) => k.katalogNazov === katalogNazov);
}
