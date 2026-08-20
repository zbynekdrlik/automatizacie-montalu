// Zdieľaný SVG kótovací helper (#137) — geometria kót, kolízie popiskov, formátovanie,
// mierka. Modul je čistý TS bez DOM — testuje sa priamo matematika, nie vykreslenie.
import { describe, it, expect } from 'vitest';
import {
	fmtMm,
	fmtDeg,
	textWidth,
	boxesCollide,
	placeLabel,
	readableLabelAngle,
	lineDimension,
	horizontalDimension,
	verticalDimension,
	witnessLine,
	angleDimension,
	fitScale,
	viewBoxAttr,
	type Box
} from '../src/lib/vykres/kota';

describe('fmtMm / fmtDeg — slovenský formát (čiarka namiesto bodky)', () => {
	it('celé číslo bez desatín', () => {
		expect(fmtMm(2500)).toBe('2500');
	});
	it('desatinné číslo — čiarka, zaokrúhlené na 1 desatinné miesto (default)', () => {
		expect(fmtMm(693.456)).toBe('693,5');
	});
	it('vlastný počet desatinných miest', () => {
		expect(fmtMm(4.3456, 2)).toBe('4,35');
	});
	it('fmtDeg pridáva stupňový symbol', () => {
		expect(fmtDeg(4.3)).toBe('4,3°');
	});
	it('záporné číslo si zachová znamienko', () => {
		expect(fmtMm(-12.34)).toBe('-12,3');
	});
});

describe('textWidth — odhad šírky textu', () => {
	it('dlhší text je širší (monotónnosť)', () => {
		expect(textWidth('123')).toBeLessThan(textWidth('123456'));
	});
	it('väčší font-size škáluje lineárne', () => {
		const w11 = textWidth('1000', 11);
		const w22 = textWidth('1000', 22);
		expect(w22).toBeCloseTo(w11 * 2, 5);
	});
	it('prázdny text má nulovú šírku', () => {
		expect(textWidth('')).toBe(0);
	});
});

describe('boxesCollide', () => {
	const a: Box = { x: 100, y: 100, w: 40, h: 14 };
	it('prekrývajúce sa boxy kolidujú', () => {
		expect(boxesCollide(a, { x: 105, y: 100, w: 40, h: 14 })).toBe(true);
	});
	it('dostatočne vzdialené boxy nekolidujú', () => {
		expect(boxesCollide(a, { x: 300, y: 300, w: 40, h: 14 })).toBe(false);
	});
	it('presne na hranici medzery (gap) NEkoliduje — ostrá nerovnosť', () => {
		// stred vzdialený presne (w1+w2)/2 + gapX → hranica, nie kolízia
		const b: Box = { x: a.x + (a.w + 40) / 2 + 7, y: a.y, w: 40, h: 14 };
		expect(boxesCollide(a, b, 7, 5)).toBe(false);
	});
	it('tesne PRED hranicou koliduje', () => {
		const b: Box = { x: a.x + (a.w + 40) / 2 + 6.9, y: a.y, w: 40, h: 14 };
		expect(boxesCollide(a, b, 7, 5)).toBe(true);
	});
	it('rovnaké X, rôzne Y ďaleko od seba — nekoliduje (obe osi musia byť blízko)', () => {
		expect(boxesCollide(a, { x: a.x, y: a.y + 500, w: 40, h: 14 })).toBe(false);
	});
});

describe('placeLabel — greedy kolízne umiestnenie (zovšeobecnenie FixVykres2D L124-141)', () => {
	it('prvý kandidát bez kolízie sa vyberie priamo', () => {
		const candidates = [{ x: 0, y: 0, w: 20, h: 14, tag: 'a' }];
		const r = placeLabel(candidates, []);
		expect(r.tag).toBe('a');
	});
	it('preskočí kolidujúceho kandidáta a vyberie ďalšieho voľného', () => {
		const existing: Box[] = [{ x: 0, y: 0, w: 20, h: 14 }];
		const candidates = [
			{ x: 1, y: 0, w: 20, h: 14, tag: 'koliduje' },
			{ x: 200, y: 0, w: 20, h: 14, tag: 'volny' }
		];
		expect(placeLabel(candidates, existing).tag).toBe('volny');
	});
	it('keď kolidujú všetci kandidáti, vráti POSLEDNÉHO (fallback — nikdy nezmizne)', () => {
		const existing: Box[] = [{ x: 0, y: 0, w: 500, h: 500 }];
		const candidates = [
			{ x: 1, y: 1, w: 20, h: 14, tag: 'a' },
			{ x: 2, y: 2, w: 20, h: 14, tag: 'posledny' }
		];
		expect(placeLabel(candidates, existing).tag).toBe('posledny');
	});
	it('prázdne pole kandidátov vyhodí chybu (programátorská chyba volajúceho)', () => {
		expect(() => placeLabel([], [])).toThrow();
	});
});

describe('readableLabelAngle — normalizácia na (-90°,90°], text nikdy hlavou dole', () => {
	it('0° zostáva 0°', () => {
		expect(readableLabelAngle(0)).toBe(0);
	});
	it('malý kladný uhol zostáva nezmenený (sklon strechy typu 4,3°)', () => {
		expect(readableLabelAngle(4.3)).toBeCloseTo(4.3, 6);
	});
	it('malý záporný uhol zostáva nezmenený', () => {
		expect(readableLabelAngle(-4.3)).toBeCloseTo(-4.3, 6);
	});
	it('180° (obrátený vodorovný smer) sa normalizuje na 0°', () => {
		expect(readableLabelAngle(180)).toBe(0);
	});
	it('-180° sa tiež normalizuje na 0°', () => {
		expect(readableLabelAngle(-180)).toBe(0);
	});
	it('135° sa preklopí na -45° (rovnaká vizuálna orientácia)', () => {
		expect(readableLabelAngle(135)).toBeCloseTo(-45, 6);
	});
	it('-135° sa preklopí na 45°', () => {
		expect(readableLabelAngle(-135)).toBeCloseTo(45, 6);
	});
	it('výsledok je vždy v rozsahu (-90,90] pre ľubovoľný vstup (fuzz cez celý kruh)', () => {
		for (let deg = -720; deg <= 720; deg += 5) {
			const a = readableLabelAngle(deg);
			expect(a).toBeGreaterThan(-90 - 1e-9);
			expect(a).toBeLessThanOrEqual(90 + 1e-9);
		}
	});
});

describe('lineDimension — vodorovná kóta (dy=0)', () => {
	it('kótová čiara spája presne zadané body (bez posunu, perpOffset=0)', () => {
		const g = lineDimension(0, 100, 200, 100, 0);
		expect(g.lines[0]).toEqual({ x1: 0, y1: 100, x2: 200, y2: 100 });
	});
	it('ťaháky sú KOLMÉ (vertikálne) na vodorovnú kótovú čiaru', () => {
		const g = lineDimension(0, 100, 200, 100, 0, { tick: 5 });
		// ťahák na začiatku: rovnaké x, y ±tick
		expect(g.lines[1].x1).toBeCloseTo(0, 6);
		expect(g.lines[1].x2).toBeCloseTo(0, 6);
		expect(g.lines[1].y2 - g.lines[1].y1).toBeCloseTo(10, 6); // 2×tick
	});
	it('perpOffset posunie kótovú čiaru KOLMO (nadol, keďže SVG y rastie dole)', () => {
		const g = lineDimension(0, 100, 200, 100, 20);
		expect(g.lines[0].y1).toBeCloseTo(120, 6);
		expect(g.lines[0].y2).toBeCloseTo(120, 6);
		expect(g.lines[0].x1).toBeCloseTo(0, 6);
		expect(g.lines[0].x2).toBeCloseTo(200, 6);
	});
	it('popisok je v strede a bez otočenia', () => {
		const g = lineDimension(0, 100, 200, 100, 0);
		expect(g.label.x).toBeCloseTo(100, 6);
		expect(g.label.rotate).toBe(0);
	});
});

describe('lineDimension — witnesses (odkazové čiary), issue #137 bod „s odkazovými čiarami"', () => {
	it('perpOffset===0: ŽIADNE odkazové čiary (kótová čiara leží priamo na geometrii)', () => {
		const g = lineDimension(0, 100, 200, 100, 0);
		expect(g.witnesses).toEqual([]);
	});
	it('perpOffset>0 (nadol): odkazové čiary idú OD geometrie K odsadenej kótovej čiare, s presahom za ňu', () => {
		const g = lineDimension(0, 100, 200, 100, 20, { tick: 5 });
		expect(g.witnesses).toHaveLength(2);
		const [w0, w1] = g.witnesses;
		// začínajú tesne pri geometrii (y≈100, malá medzera gap=2 default)
		expect(w0!.x1).toBeCloseTo(0, 6);
		expect(w0!.y1).toBeCloseTo(102, 6); // 100 + gap(2)
		expect(w1!.x1).toBeCloseTo(200, 6);
		// končia ZA kótovou čiarou (perpOffset 20 + overshoot 3 default)
		expect(w0!.y2).toBeCloseTo(123, 6);
		expect(w1!.y2).toBeCloseTo(123, 6);
	});
	it('perpOffset<0 (nahor): odkazové čiary idú SPRÁVNYM smerom (nie opačným) a presahujú za kótovú čiaru', () => {
		const g = lineDimension(0, 100, 200, 100, -20, { tick: 5 });
		const [w0] = g.witnesses;
		// smer je NAHOR (y klesá) — odkazová čiara musí prekonať aspoň |perpOffset|, teda
		// jej koncový bod musí byť VYŠŠIE (menšie y) ako samotná odsadená kótová čiara (y=80)
		expect(w0!.y2).toBeLessThan(80);
		expect(w0!.y1).toBeLessThan(100); // začína tiež smerom nahor, nie nadol
	});
	it('zvislá kóta s perpOffset: odkazové čiary sú vodorovné (kolmé na zvislý smer)', () => {
		const g = lineDimension(50, 0, 50, 300, 15);
		expect(g.witnesses).toHaveLength(2);
		expect(g.witnesses[0]!.y1).toBeCloseTo(g.witnesses[0]!.y2, 6); // vodorovný segment
	});
});

describe('lineDimension — zvislá kóta cez všeobecnú funkciu (dx=0)', () => {
	it('kótová čiara spája zadané body', () => {
		const g = lineDimension(50, 0, 50, 300, 0);
		expect(g.lines[0]).toEqual({ x1: 50, y1: 0, x2: 50, y2: 300 });
	});
	it('ťaháky sú KOLMÉ (horizontálne) na zvislú kótovú čiaru', () => {
		const g = lineDimension(50, 0, 50, 300, 0, { tick: 6 });
		expect(g.lines[1].y1).toBeCloseTo(0, 6);
		expect(g.lines[1].y2).toBeCloseTo(0, 6);
		expect(Math.abs(g.lines[1].x2 - g.lines[1].x1)).toBeCloseTo(12, 6); // 2×tick
	});
});

describe('lineDimension — pozdĺž šikmej hrany (napr. sklon strechy 4,3°)', () => {
	it('kótová čiara má rovnakú dĺžku ako geometria pri perpOffset=0', () => {
		const x0 = 0,
			y0 = 0,
			x1 = 100,
			y1 = 100 * Math.tan((4.3 * Math.PI) / 180);
		const g = lineDimension(x0, y0, x1, y1, 0);
		const dlzkaGeom = Math.hypot(x1 - x0, y1 - y0);
		const dlzkaKota = Math.hypot(g.lines[0].x2 - g.lines[0].x1, g.lines[0].y2 - g.lines[0].y1);
		expect(dlzkaKota).toBeCloseTo(dlzkaGeom, 6);
	});
	it('popisok je otočený približne o uhol sklonu (čitateľný, nie hlavou dole)', () => {
		const g = lineDimension(0, 0, 100, 100 * Math.tan((4.3 * Math.PI) / 180), 0);
		expect(g.label.rotate).toBeCloseTo(4.3, 3);
	});
});

describe('horizontalDimension — wrapper', () => {
	it('zodpovedá priamemu volaniu lineDimension s perpOffset=0 a y1=y2', () => {
		const g = horizontalDimension(10, 210, 50, 0, { tick: 4, labelOffset: -6 });
		expect(g.lines[0]).toEqual({ x1: 10, y1: 50, x2: 210, y2: 50 });
		expect(g.label.rotate).toBe(0);
		expect(g.label.y).toBeCloseTo(50 - 6, 6); // labelOffset v smere normály (0,1)*-6 = (0,-6)
	});
	it('perpOffset posunie kótovú čiaru MIMO geometrie a zapne odkazové čiary (nález review)', () => {
		const g = horizontalDimension(10, 210, 50, 12);
		expect(g.lines[0].y1).toBeCloseTo(62, 6); // 50 + 12
		expect(g.witnesses).toHaveLength(2);
	});
	it('perpOffset default je 0 — zachováva pôvodné správanie bez tretieho argumentu', () => {
		const g = horizontalDimension(10, 210, 50);
		expect(g.lines[0].y1).toBeCloseTo(50, 6);
		expect(g.witnesses).toEqual([]);
	});
});

describe('verticalDimension — wrapper, VŽDY -90° bez ohľadu na poradie y0/y1', () => {
	it('y0 (hore) < y1 (dole): rotate === -90', () => {
		const g = verticalDimension(0, 300, 40);
		expect(g.label.rotate).toBe(-90);
		expect(g.lines[0]).toEqual({ x1: 40, y1: 0, x2: 40, y2: 300 });
	});
	it('opačné poradie (y0 > y1): rotate JE STÁLE -90 (kanonická konvencia)', () => {
		const g = verticalDimension(300, 0, 40);
		expect(g.label.rotate).toBe(-90);
	});
	it('ťaháky sú kolmé (horizontálne segmenty) na zvislú kótu', () => {
		const g = verticalDimension(0, 300, 40, 0, { tick: 6 });
		expect(g.lines[1].y1).toBeCloseTo(0, 6);
		expect(Math.abs(g.lines[1].x2 - g.lines[1].x1)).toBeCloseTo(12, 6); // 2×tick
	});
	it('perpOffset posunie kótovú čiaru MIMO geometrie, rotate ostáva -90, zapne odkazové čiary (nález review)', () => {
		const g = verticalDimension(0, 300, 40, 15);
		expect(g.lines[0].x1).toBeCloseTo(40 - 15, 6); // normála (-1,0) pri smere zhora nadol
		expect(g.label.rotate).toBe(-90);
		expect(g.witnesses).toHaveLength(2);
	});
});

describe('witnessLine — odkazová čiara s medzerou a presahom', () => {
	it('začína s medzerou (gap) od bodu geometrie, v smere dir', () => {
		const w = witnessLine(0, 0, 1, 0, 30, 2, 3);
		expect(w.x1).toBeCloseTo(2, 6);
		expect(w.y1).toBeCloseTo(0, 6);
	});
	it('končí ZA offsetom (presah)', () => {
		const w = witnessLine(0, 0, 1, 0, 30, 2, 3);
		expect(w.x2).toBeCloseTo(33, 6); // offset(30) + overshoot(3)
	});
	it('funguje aj vo zvislom smere', () => {
		const w = witnessLine(50, 100, 0, -1, 20, 2, 4);
		expect(w.x1).toBeCloseTo(50, 6);
		expect(w.y1).toBeCloseTo(98, 6); // 100 - 2
		expect(w.y2).toBeCloseTo(76, 6); // 100 - (20+4)
	});
});

// ---------------------------------------------------------------------------
// angleDimension — geometricky prísne overenie cez SVG arc endpoint→center
// parameterizáciu (SVG spec F.6.5), aby largeArc/sweep flag boli GARANTOVANE
// správne, nielen "vyzerajú OK". Round-trip: z arcPath vyparsujeme parametre,
// prepočítame stred podľa oficiálneho vzorca a porovnáme s pôvodným (cx,cy).
// ---------------------------------------------------------------------------

/** Prepočíta stred kruhového oblúka (rx=ry=r, bez rotácie) z SVG endpoint parametrov
 *  podľa https://www.w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter */
function arcCenterFromEndpoints(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	r: number,
	largeArc: 0 | 1,
	sweep: 0 | 1
): { cx: number; cy: number } {
	const x1p = (x1 - x2) / 2;
	const y1p = (y1 - y2) / 2;
	const num = r * r * r * r - r * r * y1p * y1p - r * r * x1p * x1p;
	const den = r * r * y1p * y1p + r * r * x1p * x1p;
	const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
	const cxp = (coef * (r * y1p)) / r;
	const cyp = (coef * (-r * x1p)) / r;
	return { cx: cxp + (x1 + x2) / 2, cy: cyp + (y1 + y2) / 2 };
}

function parseArcPath(d: string) {
	// "M x0 y0 A r r 0 largeArc sweep x1 y1" — čísla môžu byť aj vo vedeckej notácii
	// (napr. "6.123233995736766e-16" z JS Math.cos/sin zaokrúhľovacej chyby pri 90°).
	const NUM = '[-\\d.eE+]+';
	const m = d.match(
		new RegExp(
			`^M\\s+(${NUM})\\s+(${NUM})\\s+A\\s+(${NUM})\\s+${NUM}\\s+0\\s+([01])\\s+([01])\\s+(${NUM})\\s+(${NUM})$`
		)
	);
	if (!m) throw new Error('nečakaný tvar arcPath: ' + d);
	return {
		x0: Number(m[1]),
		y0: Number(m[2]),
		r: Number(m[3]),
		largeArc: Number(m[4]) as 0 | 1,
		sweep: Number(m[5]) as 0 | 1,
		x1: Number(m[6]),
		y1: Number(m[7])
	};
}

describe('angleDimension — geometria oblúka (round-trip overenie stredu)', () => {
	const cases: [number, number, string][] = [
		[0, 90, '0°→90° (menší oblúk, 1. kvadrant)'],
		[0, 45, '0°→45° (ostrý uhol, ako sklon strechy)'],
		[0, 180, '0°→180° (presne polkruh, largeArc hranica)'],
		[0, 270, '0°→270° (väčší oblúk, largeArc=1)'],
		[350, 10, 'wraparound cez 0°/360° (350°→10°, delta=20°)'],
		[45, 315, '45°→315° (delta=270°, largeArc=1)'],
		[-30, 30, 'záporný fromDeg (-30°→30°)']
	];

	for (const [from, to, popis] of cases) {
		it(`stred oblúka sa zhoduje so zadaným (cx,cy) — ${popis}`, () => {
			const cx = 123.4,
				cy = -56.7,
				r = 40;
			const g = angleDimension(cx, cy, r, from, to);
			const p = parseArcPath(g.arcPath);
			expect(p.r).toBeCloseTo(r, 6);
			const recovered = arcCenterFromEndpoints(p.x0, p.y0, p.x1, p.y1, p.r, p.largeArc, p.sweep);
			expect(recovered.cx).toBeCloseTo(cx, 4);
			expect(recovered.cy).toBeCloseTo(cy, 4);
		});
	}

	it('start/end body ležia presne na kružnici s polomerom r okolo (cx,cy)', () => {
		const cx = 10,
			cy = 20,
			r = 15;
		const g = angleDimension(cx, cy, r, 0, 60);
		expect(Math.hypot(g.start.x - cx, g.start.y - cy)).toBeCloseTo(r, 6);
		expect(Math.hypot(g.end.x - cx, g.end.y - cy)).toBeCloseTo(r, 6);
	});

	it('largeArc=0 pre uhol ≤180°, largeArc=1 pre uhol >180°', () => {
		expect(parseArcPath(angleDimension(0, 0, 10, 0, 90).arcPath).largeArc).toBe(0);
		expect(parseArcPath(angleDimension(0, 0, 10, 0, 270).arcPath).largeArc).toBe(1);
	});

	it('popisok leží ĎALEJ od stredu ako r (za oblúkom), na polovici uhla', () => {
		const g = angleDimension(0, 0, 10, 0, 90);
		const distLabel = Math.hypot(g.label.x, g.label.y);
		expect(distLabel).toBeCloseTo(22, 6); // r(10) + 12
		// polovica uhla 0→90 je 45°, label by mal byť v 1. kvadrante (x>0, SVG y<0 = hore)
		expect(g.label.x).toBeGreaterThan(0);
		expect(g.label.y).toBeLessThan(0);
	});

	it('degenerovaný uhol (fromDeg === toDeg, delta=0) nehodí chybu — bod, nie oblúk', () => {
		expect(() => angleDimension(0, 0, 10, 45, 45)).not.toThrow();
		const g = angleDimension(0, 0, 10, 45, 45);
		// start a end splynú do toho istého bodu (nulová dĺžka oblúka)
		expect(g.start.x).toBeCloseTo(g.end.x, 6);
		expect(g.start.y).toBeCloseTo(g.end.y, 6);
	});
});

describe('fitScale', () => {
	it('vráti menšiu z dvoch mierok (limitujúci rozmer)', () => {
		// 1000mm×500mm do 800px×800px → limituje šírka (0.8) < výška (1.6)
		expect(fitScale(1000, 500, 800, 800)).toBeCloseTo(0.8, 6);
	});
	it('štvorcový objekt do štvorcového priestoru — presné 1:1', () => {
		expect(fitScale(500, 500, 500, 500)).toBeCloseTo(1, 6);
	});
	it('neplatné (nekladné) vstupy vrátia bezpečný fallback 1, nie NaN/Infinity', () => {
		expect(fitScale(0, 500, 800, 800)).toBe(1);
		expect(fitScale(-10, 500, 800, 800)).toBe(1);
		expect(fitScale(500, 500, 0, 800)).toBe(1);
	});
});

describe('viewBoxAttr', () => {
	it('formátuje "0 0 w h"', () => {
		expect(viewBoxAttr(297, 210)).toBe('0 0 297 210');
	});
});
