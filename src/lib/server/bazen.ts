// Bazén (kryt bazéna) — Money rozpis 1:1 z ODPIS.xlsx BAZENY vrátane
// auto-koľajníc. Port z n8n verzie (n8n/bazen2dlv/bazen_node_body.js +
// bazen_prepocitaj_body.js), overenej proti Excelu. Čísla nemeniť bez
// zmeny vektorov v tests/bazen.test.ts.
//
// Oproti n8n verzii OPRAVENÉ (nálezy auditu): ručné úpravy množstiev sa
// VALIDUJÚ (záporné/nečíselné sa odmietnu, nie ticho 0) a výsledok ukazuje
// aj riadky vynulované úpravou.

export interface BazenVstup {
	zak: string;
	op: string;
	zakaznik: string;
	model: string; // 'Premier / Exclusive' | 'Star'
	kolaj: string; // 'Jednokolaj' | 'Dvojkolaj'
	pocetSekcii: number;
	pocetPriecok: number;
	dvere: boolean;
	vs4500: number;
	vs6000: number;
	ss4500: number;
	ss6000: number;
	ms4500: number;
	ms6000: number;
	dlzkaKolajnic: number;
	prieckovy4300: number;
	prieckovy6000: number;
	vyklopneCelo: number;
	caka: boolean;
}

export interface BazenPolozka {
	kod: string;
	nazov: string;
	qty: number;
}

interface BomParams {
	pocetSekcii: number;
	pocetPriecok: number;
	dvere: number;
	jednokolaj: number;
	dvojkolaj: number;
	vs4500: number;
	vs6000: number;
	ss4500: number;
	ss6000: number;
	ms4500: number;
	ms6000: number;
	koraj2_4600: number;
	koraj2_6700: number;
	koraj3_4600: number;
	koraj3_6700: number;
	prieckovy4300: number;
	prieckovy6000: number;
	vyklopneCelo: number;
}

const BOM: [string, string, (p: BomParams) => number][] = [
	['BPP00091', '2-koľaj Surový 4600 mm', (p) => p.koraj2_4600 * 4.6],
	['BPP00092', '2-koľaj Surový 6700 mm', (p) => p.koraj2_6700 * 6.7],
	['BPP00094', '3-koľaj Surový 4600 mm', (p) => p.koraj3_4600 * 4.6],
	['BPP00097', '3-koľaj Surový 6700 mm', (p) => p.koraj3_6700 * 6.7],
	['BPP00054', 'Čelný profil Surový 4500 mm', (p) => (p.vs4500 * 2 + p.ss4500 + p.ms4500) * 4.5],
	['BPP00057', 'Čelný profil Surový 6000 mm', (p) => (p.vs6000 * 2 + p.ss6000 + p.ms6000) * 6],
	['BPP00061', 'Krajný profil Surový 4500 mm', (p) => (p.ss4500 + p.ms4500 + (p.dvere === 1 && p.vs4500 === 1 ? 1 : 0)) * 4.5],
	['BPP00064', 'Krajný profil Surový 6000 mm', (p) => (p.ss6000 + p.ms6000 + (p.dvere === 1 && p.vs6000 === 1 ? 1 : 0)) * 6],
	['BPP00068', 'Čelná nožička Surový 7500 mm', (p) => 2.4 + (p.pocetSekcii - 2) * 0.4 * 2],
	['BPP00072', 'Krajná nožička Surová 7500 mm', (p) => 0.8 + (p.pocetSekcii - 2) * 0.8],
	['BPP00087', 'Krycia lišta Surový 7500 mm', (p) => 2.4 + (p.pocetSekcii - 2) * 0.4 * 2 + (0.8 + (p.pocetSekcii - 2) * 0.8)],
	// BPP00046 (starý „Kladkový profil") je 0 na sklade → Money odpis zlyhá.
	// Dominik 2026-07-05: nahradiť za BPP202414 „Kladkový profil V2 Surový 4400 mm".
	['BPP202414', 'Kladkový profil V2 Surový 4400 mm', (p) => p.pocetSekcii * 2.2 * p.jednokolaj + 2 * (p.pocetSekcii * 2.2 * p.dvojkolaj)],
	['BPP00050', 'Kladkový profil jednokolaj Surový 4400 mm', (p) => p.pocetSekcii * 2.2 * p.jednokolaj],
	['BPP00076', 'Priečkový profil Surový 4300 mm', (p) => p.prieckovy4300 * 4.3],
	['BPP00079', 'Priečkový profil Surový 6000 mm', (p) => p.prieckovy6000 * 6],
	['BPP20245', 'Priečna výstuha Surový 4200 mm', (p) => p.pocetPriecok * p.pocetSekcii * 4.2],
	['BPP00083', 'Výklopné čelo Surový 6000 mm', (p) => p.vyklopneCelo * 6],
	['BPP20254', 'Kladkový profil dverový Surový 4400mm', (p) => p.dvere * 4.4],
	['BPP20255', 'Dverový profil Surový 6000mm', (p) => p.dvere * 6],
	['BPP20256', 'Dverová kolajnica Surový 4400mm', (p) => p.dvere * 4.4]
];

const STAR_MAP: Record<string, string> = {
	BPP00054: 'BPP20249',
	BPP00057: 'BPP202410',
	BPP00061: 'BPP202412',
	BPP00064: 'BPP202411'
};
const STAR_NAME: Record<string, string> = {
	BPP20249: 'Čelný profil - STAR Surový 4500 mm',
	BPP202410: 'Čelný profil - STAR Surový 6000 mm',
	BPP202412: 'Krajný profil - STAR Surový 4500 mm',
	BPP202411: 'Krajný profil - STAR Surový 6000 mm'
};

const R = (x: number) => Math.round(x * 1000) / 1000;

/** sekcie → počet 2-koľajníc a 3-koľajníc */
export function decompose(N: number): { k2: number; k3: number } {
	N = Math.round(N);
	if (N < 2) return { k2: N === 1 ? 1 : 0, k3: 0 };
	const r = N % 3;
	if (r === 0) return { k2: 0, k3: N / 3 };
	if (r === 2) return { k2: 1, k3: (N - 2) / 3 };
	return { k2: 2, k3: (N - 4) / 3 };
}

/** minimálne pokrytie dĺžky kusmi 4600/6700 (najmenší presah, potom kusy) */
export function minCover(L: number): [number, number] {
	if (!(L > 0)) return [0, 0];
	const A = [4600, 6700];
	const cap = Math.ceil(L / A[0]) + 1;
	let best: [number, number] = [0, 0];
	let bk: number | null = null;
	for (let a = 0; a <= cap; a++)
		for (let b = 0; b <= cap; b++) {
			const c = a + b;
			if (!c) continue;
			const t = a * A[0] + b * A[1];
			if (t >= L) {
				const k = t * 1000 + c;
				if (bk === null || k < bk) {
					bk = k;
					best = [a, b];
				}
			}
		}
	return best;
}

export function computeBazen(v: BazenVstup): { out: BazenPolozka[]; error: string | null } {
	const dvojkolaj = v.kolaj.toLowerCase().includes('dvoj') ? 1 : 0;
	const dec = decompose(v.pocetSekcii);
	const cov = minCover(v.dlzkaKolajnic);
	const sides = dvojkolaj ? 2 : 1;

	const p: BomParams = {
		pocetSekcii: v.pocetSekcii,
		pocetPriecok: v.pocetPriecok,
		dvere: v.dvere ? 1 : 0,
		jednokolaj: dvojkolaj ? 0 : 1,
		dvojkolaj,
		vs4500: v.vs4500,
		vs6000: v.vs6000,
		ss4500: v.ss4500,
		ss6000: v.ss6000,
		ms4500: v.ms4500,
		ms6000: v.ms6000,
		koraj2_4600: dec.k2 * cov[0] * sides,
		koraj2_6700: dec.k2 * cov[1] * sides,
		koraj3_4600: dec.k3 * cov[0] * sides,
		koraj3_6700: dec.k3 * cov[1] * sides,
		prieckovy4300: v.prieckovy4300,
		prieckovy6000: v.prieckovy6000,
		vyklopneCelo: v.vyklopneCelo
	};

	const star = v.model.toLowerCase().includes('star');
	// celý rozpis (aj nulové položky) — kontrolná stránka ukáže všetko editovateľné
	const out = BOM.map(([code, name, fn]) => {
		let kod = code,
			nazov = name;
		if (star && STAR_MAP[code]) {
			kod = STAR_MAP[code];
			nazov = STAR_NAME[kod];
		}
		return { kod, nazov, qty: R(fn(p)) };
	});

	let error: string | null = null;
	if (!v.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!v.op) error = 'Chýba OP/OPDL číslo (ide do popisu dokladu).';
	else if (!v.zakaznik) error = 'Chýba zákazník.';
	else if (!(v.pocetSekcii > 0)) error = 'Zadaj počet sekcií (väčší ako 0).';
	else if (out.every((o) => o.qty <= 0)) error = 'Žiadne položky na výstup — skontroluj zadané počty.';

	return { out, error };
}

/**
 * Aplikuje ručné úpravy množstiev z kontrolnej stránky. Kľúč = kod.
 * Na rozdiel od n8n verzie: nečíselná alebo záporná hodnota = CHYBA
 * (nie tiché 0 do Money) a limit 10 000 m chráni pred preklepom.
 */
export function applyEdits(
	out: BazenPolozka[],
	edits: Map<string, string>
): { finalOut: BazenPolozka[]; zmenene: string[]; error: string | null } {
	const finalOut: BazenPolozka[] = [];
	const zmenene: string[] = [];
	for (const o of out) {
		const raw = edits.get(o.kod);
		if (raw === undefined || raw.trim() === '') {
			finalOut.push({ ...o });
			continue;
		}
		const q = parseFloat(String(raw).replace(',', '.'));
		if (!Number.isFinite(q)) return { finalOut: [], zmenene: [], error: `Neplatné množstvo „${raw}" pri ${o.kod} ${o.nazov}.` };
		if (q < 0) return { finalOut: [], zmenene: [], error: `Záporné množstvo (${q}) pri ${o.kod} ${o.nazov} — do Money nesmie ísť.` };
		if (q > 100000) return { finalOut: [], zmenene: [], error: `Podozrivo veľké množstvo (${q} m) pri ${o.kod} ${o.nazov}.` };
		const rq = R(q);
		if (rq !== o.qty) zmenene.push(o.kod);
		finalOut.push({ kod: o.kod, nazov: o.nazov, qty: rq });
	}
	return { finalOut, zmenene, error: null };
}
