// Pergola návrhový výkres (#138) — geometria + validácia. Vzorové hodnoty z OP260032:
// polia [3000,3000] (6000 celkom), hĺbka 3500, výška vpredu 2500, pri stene 2800,
// 8 panelov strešnej výplne. Číselná zhoda s VIEW A "2200"/"4,3°" NIE je cieľom —
// zdôvodnené v design komentári na #138 (jedna čestná formula, nie per-view magické
// konštanty vyladené na jeden demo príklad).
import { describe, it, expect } from 'vitest';
import {
	stlpyZPolí,
	vypocitajSklon,
	defaultPanelSirka,
	defaultPanelDlzka,
	vypocitajGeometriu,
	izometriaHrany,
	zvodoveBody,
	poznamkaKotva,
	chybaPergolaNavrhVstupu,
	farbaKonstrukcie,
	ciarovaFarba,
	RAL_PALETA,
	RAL_INY_KOD,
	RAL_FALLBACK_HEX,
	PERGOLA_REZIM_DEFAULT,
	NOSNIK_HRUBKA_MM,
	PANEL_MEDZERA_MM,
	PANEL_TRIM_MM,
	STLP_HRUBKA_VIZ_MM,
	type PergolaNavrhVstup
} from '../src/lib/pergola-navrh';

const VZOR: PergolaNavrhVstup = {
	polia: [3000, 3000],
	hlbka: 3500,
	vyskaVpredu: 2500,
	vyskaPriStene: 2800,
	panelPocet: 8,
	zvody: [
		{ postIndex: 0, strana: 'predna' },
		{ postIndex: 2, strana: 'zadna' }
	],
	ral: '7016-ANTRACIT JŠ',
	textVyplne: 'FIX v 1. etape STADUR RAL 7016JŠ',
	poznamkaIzometria: 'bez výplne',
	op: 'OP260032',
	nazov: 'PERGOLA — NÁVRH',
	revizia: '1',
	varianta: 'NAVRH',
	vypracoval: 'test',
	rezimVykresu: 'technicky',
	ralKod: ''
};

describe('stlpyZPolí — kumulatívne X pozície stĺpov', () => {
	it('dve polia 3000+3000 → tri stĺpy [0, 3000, 6000]', () => {
		expect(stlpyZPolí([3000, 3000])).toEqual([0, 3000, 6000]);
	});
	it('jedno pole → dva stĺpy', () => {
		expect(stlpyZPolí([4000])).toEqual([0, 4000]);
	});
	it('prázdne polia → jeden bod na 0 (žiadne rozpätie)', () => {
		expect(stlpyZPolí([])).toEqual([0]);
	});
});

describe('vypocitajSklon — priamy pravouhlý trojuholník', () => {
	it('stena vyššia než predok → kladný sklon', () => {
		const s = vypocitajSklon(2500, 2800, 3500);
		expect(s).toBeCloseTo((Math.atan(300 / 3500) * 180) / Math.PI, 10);
		expect(s).toBeGreaterThan(0);
	});
	it('rovnaké výšky → sklon 0°', () => {
		expect(vypocitajSklon(2500, 2500, 3500)).toBe(0);
	});
	it('predok vyšší než stena → záporný sklon', () => {
		expect(vypocitajSklon(2800, 2500, 3500)).toBeLessThan(0);
	});
	it('neplatná (nekladná) hĺbka vráti 0 (obranný fallback, nie NaN/Infinity)', () => {
		expect(vypocitajSklon(2500, 2800, 0)).toBe(0);
		expect(vypocitajSklon(2500, 2800, -100)).toBe(0);
	});
});

describe('defaultPanelSirka — presne sedí na vzore (6000/8 − 24 = 726)', () => {
	it('vzorové hodnoty', () => {
		expect(defaultPanelSirka(6000, 8)).toBe(726);
	});
	it('neplatné vstupy vrátia 0', () => {
		expect(defaultPanelSirka(0, 8)).toBe(0);
		expect(defaultPanelSirka(6000, 0)).toBe(0);
	});
});

describe('defaultPanelDlzka — presne sedí na vzore (3500 − 89 = 3411)', () => {
	it('vzorové hodnoty', () => {
		expect(defaultPanelDlzka(3500)).toBe(3411);
	});
	it('neplatný vstup vráti 0', () => {
		expect(defaultPanelDlzka(0)).toBe(0);
	});
});

describe('vypocitajGeometriu — vzorové OP260032 hodnoty', () => {
	const g = vypocitajGeometriu(VZOR);
	it('celková šírka a stĺpy', () => {
		expect(g.celkovaSirka).toBe(6000);
		expect(g.postX).toEqual([0, 3000, 6000]);
	});
	it('svetlá výška vpredu — presne sedí na vzore (2500 − 190 = 2310)', () => {
		expect(g.svetlaVyska).toBe(2500 - NOSNIK_HRUBKA_MM);
		expect(g.svetlaVyska).toBe(2310);
	});
	it('panelSirka/panelDlzka bez override = default', () => {
		expect(g.panelSirka).toBe(726);
		expect(g.panelDlzka).toBe(3411);
	});
	it('ručný prepis (override) má prednosť pred defaultom', () => {
		const g2 = vypocitajGeometriu({ ...VZOR, panelSirkaOverride: 700, panelDlzkaOverride: 3000 });
		expect(g2.panelSirka).toBe(700);
		expect(g2.panelDlzka).toBe(3000);
	});
});

describe('izometriaHrany — počet a konzistencia 3D hrán', () => {
	const g = vypocitajGeometriu(VZOR);
	const hrany = izometriaHrany(g, VZOR);

	it('počet hrán: 2 na stĺp (predný+zadný) × 3 stĺpy + 2 hlavné nosníky + (panelPocet+1) krokiev', () => {
		expect(hrany.length).toBe(2 * 3 + 2 + (8 + 1));
	});

	it('každá krokva ide od predného (z=0) po zadný (z=hĺbka) okraj v rovnakom X', () => {
		const krokvy = hrany.filter((h) => h.a.z === 0 && h.b.z === VZOR.hlbka && h.a.x === h.b.x);
		expect(krokvy.length).toBe(9); // panelPocet(8) + 1 hraníc
	});

	it('krajné krokvy (x=0 a x=celkováSirka) sú označené ako hlavné', () => {
		const krajne = hrany.filter(
			(h) => h.a.z === 0 && h.b.z === VZOR.hlbka && (h.a.x === 0 || h.a.x === g.celkovaSirka)
		);
		expect(krajne.every((h) => h.hlavna)).toBe(true);
	});

	it('vnútorné krokvy NIE sú hlavné (tenšia čiara)', () => {
		const vnutorne = hrany.filter(
			(h) => h.a.z === 0 && h.b.z === VZOR.hlbka && h.a.x > 0 && h.a.x < g.celkovaSirka
		);
		expect(vnutorne.length).toBeGreaterThan(0);
		expect(vnutorne.every((h) => !h.hlavna)).toBe(true);
	});

	it('stĺpy siahajú od zeme (y=0) po príslušnú výšku', () => {
		const predneStlpy = hrany.filter((h) => h.a.z === 0 && h.b.z === 0 && h.a.x === h.b.x);
		expect(predneStlpy.length).toBe(3);
		for (const s of predneStlpy) {
			expect(s.a.y).toBe(0);
			expect(s.b.y).toBe(VZOR.vyskaVpredu);
		}
	});
});

describe('zvodoveBody — kotvové body pre ZVOD šípky', () => {
	const g = vypocitajGeometriu(VZOR);
	it('predná pozícia kotví na prednom stĺpe, v strede jeho výšky', () => {
		const b = zvodoveBody(VZOR, g);
		const predny = b.find((z) => z.strana === 'predna')!;
		expect(predny.bod).toEqual({ x: 0, y: VZOR.vyskaVpredu / 2, z: 0 });
	});
	it('zadná pozícia kotví na zadnom stĺpe, v strede jeho výšky, pri stene (z=hĺbka)', () => {
		const b = zvodoveBody(VZOR, g);
		const zadny = b.find((z) => z.strana === 'zadna')!;
		expect(zadny.bod).toEqual({ x: 6000, y: VZOR.vyskaPriStene / 2, z: VZOR.hlbka });
	});
	it('neplatný postIndex sa ticho preskočí (obranný fallback)', () => {
		const v2 = { ...VZOR, zvody: [{ postIndex: 99, strana: 'predna' as const }] };
		expect(zvodoveBody(v2, g)).toEqual([]);
	});
});

describe('poznamkaKotva — kotva odkazovej čiary v poslednej sekcii výplne', () => {
	it('je v strede poslednej panelovej sekcie a v strede sklonu/hĺbky', () => {
		const g = vypocitajGeometriu(VZOR);
		const kotva = poznamkaKotva(g, VZOR);
		const sekcia = g.celkovaSirka / VZOR.panelPocet;
		expect(kotva.x).toBeCloseTo(g.celkovaSirka - sekcia / 2, 1);
		expect(kotva.y).toBeCloseTo((VZOR.vyskaVpredu + VZOR.vyskaPriStene) / 2, 6);
		expect(kotva.z).toBeCloseTo(VZOR.hlbka / 2, 6);
	});
});

describe('chybaPergolaNavrhVstupu — validácia', () => {
	it('vzorové hodnoty sú platné (žiadna chyba)', () => {
		expect(chybaPergolaNavrhVstupu(VZOR)).toBeNull();
	});
	it('prázdne polia = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, polia: [] })).toMatch(/počet polí/i);
	});
	it('príliš veľa polí = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, polia: Array(9).fill(3000) })).toMatch(/počet polí/i);
	});
	it('rozpätie mimo rozsahu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, polia: [100] })).toMatch(/rozpätie/i);
	});
	it('hĺbka mimo rozsahu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, hlbka: 100 })).toMatch(/hĺbka/i);
	});
	it('výška vpredu mimo rozsahu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, vyskaVpredu: 100 })).toMatch(/výška vpredu/i);
	});
	it('výška pri stene mimo rozsahu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, vyskaPriStene: 100 })).toMatch(/pri stene/i);
	});
	it('počet panelov mimo rozsahu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, panelPocet: 0 })).toMatch(/počet panelov/i);
	});
	it('nekladný override šírky panelu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, panelSirkaOverride: -1 })).toMatch(/ručná šírka/i);
	});
	it('nekladný override dĺžky panelu = chyba', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, panelDlzkaOverride: 0 })).toMatch(/ručná dĺžka/i);
	});
	it('neplatná pozícia zvodu (mimo počtu stĺpov) = chyba', () => {
		expect(
			chybaPergolaNavrhVstupu({ ...VZOR, zvody: [{ postIndex: 5, strana: 'predna' }] })
		).toMatch(/zvod/i);
	});
	// #144 — VO odberateľ (b2b) nemá Montalu OP číslo; OP je teraz voliteľné PRE
	// VŠETKÝCH (formulár je zdieľaný interní/b2b) — prázdne sa v pečiatke vykreslí
	// ako „—" (PergolaNavrhVykres.svelte), nie je to už validačná chyba.
	it('#144: chýbajúce OP číslo NIE JE chyba (voliteľné)', () => {
		expect(chybaPergolaNavrhVstupu({ ...VZOR, op: '' })).toBeNull();
	});
	it('konštanty sú stabilné (dokumentované hodnoty, nie magické čísla bez zmyslu)', () => {
		expect(NOSNIK_HRUBKA_MM).toBe(190);
		expect(PANEL_MEDZERA_MM).toBe(24);
		expect(PANEL_TRIM_MM).toBe(89);
		// #146: len vizuálna konštanta (hrúbka stĺpa v kresbe), nevstupuje do
		// žiadneho geometrického výpočtu ani Money odpisu — viď komentár v
		// pergola-navrh.ts
		expect(STLP_HRUBKA_VIZ_MM).toBe(100);
	});
});

// #150 — farebný režim výkresu podľa RAL
describe('RAL_PALETA — firemná paleta zo zadania #150', () => {
	it('obsahuje presne 5 zadaných odtieňov so správnymi hex kódmi', () => {
		expect(RAL_PALETA).toHaveLength(5);
		const hexPodlaKodu = Object.fromEntries(RAL_PALETA.map((r) => [r.kod, r.hex]));
		expect(hexPodlaKodu['7016']).toBe('#383E42');
		expect(hexPodlaKodu['9006']).toBe('#A5A8A6');
		expect(hexPodlaKodu['9010']).toBe('#F1EDE1');
		expect(hexPodlaKodu['8014']).toBe('#382C1E');
		expect(hexPodlaKodu['9005']).toBe('#0E0E10');
	});
	it('svetlé odtiene (9010 BIELA, 9006 STRIEBORNÁ) sú označené tmavyObrys — potrebujú tenký tmavý obrys', () => {
		const svetle = RAL_PALETA.filter((r) => r.kod === '9010' || r.kod === '9006');
		expect(svetle.every((r) => r.tmavyObrys)).toBe(true);
	});
	it('tmavé odtiene (7016, 8014, 9005) NIE SÚ tmavyObrys', () => {
		const tmave = RAL_PALETA.filter((r) => ['7016', '8014', '9005'].includes(r.kod));
		expect(tmave).toHaveLength(3);
		expect(tmave.every((r) => !r.tmavyObrys)).toBe(true);
	});
});

describe('farbaKonstrukcie — lookup s čestným fallbackom', () => {
	it('známy kód vráti presný odtieň z RAL_PALETA', () => {
		expect(farbaKonstrukcie('7016')).toEqual({ hex: '#383E42', tmavyObrys: false });
		expect(farbaKonstrukcie('9006')).toEqual({ hex: '#A5A8A6', tmavyObrys: true });
	});
	it('"iny" (voľný text) vráti neutrálny fallback, nie predstieraný odtieň', () => {
		expect(farbaKonstrukcie(RAL_INY_KOD)).toEqual({ hex: RAL_FALLBACK_HEX, tmavyObrys: false });
	});
	it('prázdne/neznáme kódy vrátia rovnaký neutrálny fallback', () => {
		expect(farbaKonstrukcie('')).toEqual({ hex: RAL_FALLBACK_HEX, tmavyObrys: false });
		expect(farbaKonstrukcie('9999')).toEqual({ hex: RAL_FALLBACK_HEX, tmavyObrys: false });
	});
});

describe('ciarovaFarba — stroke pre čiarové prvky (izometria bez fill)', () => {
	it('tmavé odtiene sa nemenia (fill aj stroke rovnaký, ako pri filled tvaroch)', () => {
		const farba = farbaKonstrukcie('7016');
		expect(ciarovaFarba(farba)).toBe('#383E42');
	});
	it('svetlé odtiene (tmavyObrys) sa STMAVIA — čiara na bielom hárku nesmie zmiznúť', () => {
		const farba9010 = farbaKonstrukcie('9010');
		const stmavena = ciarovaFarba(farba9010);
		expect(stmavena).not.toBe(farba9010.hex);
		expect(stmavena).toMatch(/^#[0-9a-f]{6}$/);
		// stmavená verzia musí byť skutočne TMAVŠIA (nižší súčet RGB zložiek)
		const suma = (hex: string) =>
			parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
		expect(suma(stmavena)).toBeLessThan(suma(farba9010.hex));
	});
	it('9006 STRIEBORNÁ sa tiež stmaví (druhý svetlý odtieň zo zadania)', () => {
		const farba9006 = farbaKonstrukcie('9006');
		expect(ciarovaFarba(farba9006)).not.toBe(farba9006.hex);
	});
});

describe('PergolaNavrhVstup — rezimVykresu/ralKod default (#150)', () => {
	it('PERGOLA_REZIM_DEFAULT je "technicky" (zhoda s CAD vzorom OP260032)', () => {
		expect(PERGOLA_REZIM_DEFAULT).toBe('technicky');
	});
});
