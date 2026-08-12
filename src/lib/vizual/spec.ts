// Zákaznícky 3D náhľad (#170) — THREE-free geometrická vrstva. Žiadny súbor v
// tomto module nesmie importovať `three` ani sa dotknúť DOM/`window` — to je to,
// čo ho robí testovateľným v obyčajnom Vitest node prostredí a bezpečným v SSR.
// Jednotky vždy mm (viď jednotky.ts). Jediné miesto, kde sa toto prepočítava na
// three.js metre, je `builder.ts`.

/** Tvar jedného geometrického dielu — buď kváder (box), alebo extrudovaný
 *  polygonálny prierez (klín a podobne). Vždy v mm. */
export type Tvar =
	| { kind: 'box'; w: number; h: number; d: number }
	| { kind: 'extrude'; obrys: [number, number][]; dlzka: number };

/** Rola dielu — určuje materiál a či sa vôbec vykreslí (napr. rola 'klucka'
 *  s 0 dielmi = appka nedodáva kovanie). */
export type Rola = 'ram' | 'sklo' | 'kolajnica' | 'klucka' | 'sietka' | 'klin';

/** Jeden geometrický diel modelu — mm, `pos` je STRED dielu. */
export interface DielSpec {
	rola: Rola;
	tvar: Tvar;
	/** mm, stred dielu */
	pos: { x: number; y: number; z: number };
	/** radiány, voliteľná rotácia okolo stredu */
	rot?: { x: number; y: number; z: number };
}

/** Výsledok geometrickej funkcie pre jednu produktovú rodinu. */
export interface VizVysledok {
	diely: DielSpec[];
	/** mm, celková obálka modelu */
	bbox: { w: number; h: number; d: number };
	/** 'vykresova' = presné rozmery z appky; 'ilustracna' = časť je štylizovaná
	 *  aproximácia (napr. neznámy oblúk bazéna vo fáze 3) */
	presnost: 'vykresova' | 'ilustracna';
	/** slovenské captiony, ktoré UI MUSÍ vypísať POD obrázkom (nikdy do rastra) */
	poznamky: string[];
}
