// Šikmé FIX zasklenie (do boku pergoly) — geometria konštrukcie.
//
// Dominik 2026-07-15/16: fixy do bokov pergoly nie sú pravouhlé — horná hrana je
// šikmá podľa sklonu strechy, takže rezy nie sú 45/90, ale „celá škála uhlov".
// Zadanie userom 2026-07-27: **appka kreslí rovnakú KONŠTRUKCIU ako výrobné
// výkresy (OP260236 FIX KMS, OP260264 FIX Minegis) a dielňa už podľa nej reže.**
// Preto tu počítame rozmery a uhly konštrukcie, nie rezné dĺžky profilov.
//
// Money: tento modul do Money NEZAPISUJE NIČ a ani nemôže — karty Cortizo COR-60 CE
// (COR7042/7043/2117/7001…) v Money katalógu neexistujú (overené read-only SQL
// 2026-07-27). Výstup je výkres na tlač.

/** jedno pole (sekcia medzi stĺpikmi) šikmého fixu */
export interface FixPole {
	/** šírka poľa [mm] */
	sirka: number;
	/** výška na ĽAVOM okraji poľa [mm] */
	vLavo: number;
	/** výška na PRAVOM okraji poľa [mm] */
	vPravo: number;
	/** dĺžka šikmej hrany nad týmto poľom [mm] */
	sikma: number;
	/** plocha poľa [m²] */
	m2: number;
}

export interface FixVykres {
	/** celková šírka (spodná hrana) [mm] */
	S: number;
	/** výška na ľavom kraji [mm] */
	V1: number;
	/** výška na pravom kraji [mm] */
	V2: number;
	/** sklon hornej hrany [°] — vždy kladný, smer hovorí `klesaVpravo` */
	alfa: number;
	/** true = pravá strana je NIŽŠIA (horná hrana klesá doprava) */
	klesaVpravo: boolean;
	/** dĺžka celej šikmej hrany [mm] */
	sikmaCelkom: number;
	/** ostrý vnútorný uhol konštrukcie [°] = 90 − alfa (pri vyššej strane) */
	uholOstry: number;
	/** tupý vnútorný uhol konštrukcie [°] = 90 + alfa (pri nižšej strane) */
	uholTupy: number;
	polia: FixPole[];
	/** kumulatívne šírky od ľavého kraja (kóty ako na výkrese) [mm] */
	kumulSirka: number[];
	/** kumulatívne dĺžky šikmej hrany od ľavého kraja [mm] */
	kumulSikma: number[];
	/** výšky na deliacich čiarach (stĺpikoch), bez krajov [mm] */
	vyskyStlpikov: number[];
	/** celková plocha [m²] */
	m2: number;
}

const R1 = (x: number) => Math.round(x * 10) / 10;
const R3 = (x: number) => Math.round(x * 1000) / 1000;

/** rovnomerné rozdelenie šírky na `n` polí (zvyšok z delenia dostane posledné pole) */
export function rovnomernePolia(S: number, n: number): number[] {
	const k = Math.max(1, Math.round(n));
	const w = R1(S / k);
	const polia = Array.from({ length: k }, () => w);
	polia[k - 1] = R1(S - w * (k - 1));
	return polia;
}

/**
 * Geometria šikmého fixu. `V1` je výška na ľavom kraji, `V2` na pravom — ktorá je
 * väčšia je jedno, sklon si odvodíme. `polia` sú šírky jednotlivých polí zľava
 * doprava; ich súčet musí sedieť so `S` (kontroluje volajúci / `chybaFixVstupu`).
 *
 * Zrkadlenie (ľavý vs pravý kus) NIE je vec výpočtu — je to tá istá konštrukcia
 * otočená, takže sa rieši až v kresbe. Dĺžky a uhly sú v oboch prípadoch rovnaké.
 */
export function pocitajFix(S: number, V1: number, V2: number, polia: number[]): FixVykres {
	const dv = V2 - V1;
	const alfaRad = Math.atan(Math.abs(dv) / S);
	const alfa = R1((alfaRad * 180) / Math.PI);
	const vyskaV = (x: number) => V1 + (dv * x) / S; // výška v mieste x od ľavého kraja

	const kumulSirka: number[] = [];
	const kumulSikma: number[] = [];
	const vyskyStlpikov: number[] = [];
	const out: FixPole[] = [];
	let x = 0;
	for (let i = 0; i < polia.length; i++) {
		const w = polia[i];
		const vL = vyskaV(x);
		const vP = vyskaV(x + w);
		x += w;
		kumulSirka.push(R1(x));
		kumulSikma.push(R1(x / Math.cos(alfaRad)));
		if (i < polia.length - 1) vyskyStlpikov.push(R1(vP));
		out.push({
			sirka: R1(w),
			vLavo: R1(vL),
			vPravo: R1(vP),
			sikma: R1(w / Math.cos(alfaRad)),
			m2: R3(((vL + vP) / 2) * w * 1e-6)
		});
	}
	return {
		S: R1(S),
		V1: R1(V1),
		V2: R1(V2),
		alfa,
		klesaVpravo: dv < 0,
		sikmaCelkom: R1(S / Math.cos(alfaRad)),
		uholOstry: R1(90 - alfa),
		uholTupy: R1(90 + alfa),
		polia: out,
		kumulSirka,
		kumulSikma,
		vyskyStlpikov,
		m2: R3(((V1 + V2) / 2) * S * 1e-6)
	};
}

export const FIX_MIN = 100;
export const FIX_MAX = 20000;
export const FIX_MAX_POLI = 8;
/** tolerancia na súčet šírok polí voči celkovej šírke [mm] */
export const FIX_TOL = 0.5;

/**
 * Serverová kontrola vstupu (HTML5 min/max obíde skriptovaný POST). Vracia text
 * chyby alebo null. Aspoň jedna výška musí byť kladná; druhá smie byť 0 =
 * konštrukcia dobehnutá do špičky (trojuholník).
 */
export function chybaFixVstupu(S: number, V1: number, V2: number, polia: number[]): string | null {
	const rozmerOk = (x: number) => x >= 300 && x <= FIX_MAX;
	const vyskaOk = (x: number) => x >= 0 && x <= FIX_MAX;
	if (!rozmerOk(S)) return `Šírka musí byť 300–${FIX_MAX} mm.`;
	if (!vyskaOk(V1) || !vyskaOk(V2)) return `Výšky musia byť 0–${FIX_MAX} mm.`;
	if (!(V1 > 0 || V2 > 0)) return 'Zadaj aspoň jednu výšku.';
	if (V1 === V2) return 'Výšky sú rovnaké — to je obyčajný pravouhlý fix, nie šikmý.';
	if (!polia.length || polia.length > FIX_MAX_POLI)
		return `Počet polí musí byť 1–${FIX_MAX_POLI}.`;
	if (polia.some((w) => !(w >= FIX_MIN && w <= FIX_MAX)))
		return `Šírka poľa musí byť ${FIX_MIN}–${FIX_MAX} mm.`;
	const sucet = polia.reduce((a, b) => a + b, 0);
	if (Math.abs(sucet - S) > FIX_TOL)
		return `Súčet šírok polí (${R1(sucet)} mm) sa nerovná celkovej šírke (${R1(S)} mm).`;
	return null;
}
