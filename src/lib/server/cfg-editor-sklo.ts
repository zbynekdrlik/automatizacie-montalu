// Editor vzorcov: SKRYTÉ zápisy do `typ='sklo'` riadkov (Sklo šírka/výška), ktoré formulár
// NEUKAZUJE — rozhodnutie, ČO sa zapíše, oddelené od DB transakcie v `saveCfgChanges`
// (`cfg-editor.ts`). Čisté funkcie (bez DB): vstup = riadky editora, nové offsety, aktuálne
// riadky skla a N; výstup = mapa dim → nový offset skla + audit záznamy 1:1 k zápisom.
// Dva zdroje, oba podmienené a auditované (`.claude/rules/cfg-editor.md` PASCA #1 a #3):
//  1. #504 rámový→sklo mirror (rovnaká dim) — len keď sa rámový zmenil A sklo ho sledovalo,
//  2. #610 väzba sklo šírka→profil podľa pravidla výroby (`sklo-sleduje-profil.ts`, Štandard +
//     opona IZO: kladkový − 10 mm na krídlo) — len keď sa profil zmenil A sklo pravidlo sledovalo.
// Rámový mirror má prednosť (prvý rozhodnutý zápis danej dim vyhráva → jeden audit záznam).
import type { CfgZmena, EditRow } from './cfg-editor';
import {
	skloSledujeProfil,
	skloSleduje,
	skloOffsetZProfilu,
	skloSledujePole,
	type SkloSledujeProfil
} from './sklo-sleduje-profil';
import { logger } from './log';

const log = logger('cfg-editor');

export interface SkloRiadok {
	dim: 'S' | 'V';
	offset: number;
}

interface VazbaSkla {
	pravidlo: SkloSledujeProfil;
	profil: EditRow;
	skloS: number;
}

/** #610: väzba šírky skla na profil pre štýl — `null` = štýl väzbu nemá, alebo chýba /
 *  je nejednoznačný profil či riadok Sklo šírka (vtedy sa NIKDY nehádá, ktorý riadok posunúť). */
function vazbaSkla(sysStyl: string, rows: EditRow[], sklo: SkloRiadok[]): VazbaSkla | null {
	const pravidlo = skloSledujeProfil(sysStyl);
	if (!pravidlo) return null;
	const profil = rows.filter((r) => r.kod === pravidlo.profilKod && r.dim === 'S');
	const skloS = sklo.filter((r) => r.dim === 'S');
	if (profil.length !== 1 || skloS.length !== 1) {
		log.warn('väzba sklo šírka→profil: chýba/nejednoznačný riadok — väzba sa neuplatní', {
			sysStyl,
			profilKod: pravidlo.profilKod,
			profilov: profil.length,
			skiel: skloS.length
		});
		return null;
	}
	return { pravidlo, profil: profil[0]!, skloS: skloS[0]!.offset };
}

/** #610: stav väzby pre editor (poznámka pri poli profilu): `sleduje` = sklo pravidlo PRÁVE
 *  sleduje → pri zmene profilu sa posunie; `false` = samostatne nastavené sklo, neposunie sa.
 *  `null` = štýl väzbu nemá / nejednoznačné riadky (žiadna poznámka). */
export function skloSledujeStav(
	sysStyl: string,
	rows: EditRow[],
	sklo: SkloRiadok[],
	n: number
): { profilId: number; mmNaKridlo: number; sleduje: boolean } | null {
	const v = vazbaSkla(sysStyl, rows, sklo);
	if (!v) return null;
	return {
		profilId: v.profil.id,
		mmNaKridlo: v.pravidlo.mmNaKridlo,
		sleduje: skloSleduje(v.pravidlo, v.skloS, v.profil.offset, n)
	};
}

/** Rozhodne skryté zápisy do riadkov skla pri uložení editora (#504 + #610). Každý zápis má
 *  práve jeden audit záznam v `zmeny` (cfg_audit invariant). */
export function rozhodniSkloZapisy(
	sysStyl: string,
	rows: EditRow[],
	offsets: Map<number, number>,
	sklo: SkloRiadok[],
	n: number
): { skloZapisy: Map<'S' | 'V', number>; zmeny: CfgZmena[] } {
	const zmeny: CfgZmena[] = [];
	const skloZapisy = new Map<'S' | 'V', number>();

	// #504: sklo riadky sa historicky zrkadlili z rámového profilu ROVNAKEJ dimenzie
	// BEZPODMIENEČNE pri každom uložení — to prepisovalo NEZÁVISLÉ sklo offsety (opona IZO
	// sklo výška = V−135, rámový stredový = V−33; 29 z 39 štýlov má sklo ≠ rámový; prod
	// korupcia 14.9., cfg_rez 419/409/399/377). Nový kontrakt: zrkadli rámový→sklo LEN keď
	// sa rámový offset SKUTOČNE zmenil A sklo ho práve sledovalo (sklo.offset === starý
	// rámový.offset) — inak je sklo samostatný rozmer a ostáva. Zrkadlenie sa auditni (zmeny).
	const skloByDim = new Map<'S' | 'V', number>(sklo.map((r) => [r.dim, r.offset]));
	for (const r of rows) {
		const nova = offsets.get(r.id);
		if (nova === undefined || nova === r.offset) continue; // rámový sa nezmenil
		if (!/rámový/i.test(r.nazov)) continue;
		const skloStara = skloByDim.get(r.dim);
		// sklo ho práve sledovalo (rovný štýl) → drž v synchróne; inak nezávislé → nechaj tak
		if (skloStara === undefined || skloStara !== r.offset) continue;
		// prvý zmenený rámový danej dim vyhráva → JEDEN auditovaný záznam, ktorý presne
		// zodpovedá tomu, čo sa zapíše (deterministické; predtým last-wins zápis vs. viac
		// audit záznamov, ak by štýl mal 2 rámový riadky tej istej dim s rôznymi novými hodnotami)
		if (skloZapisy.has(r.dim)) continue;
		skloZapisy.set(r.dim, nova);
		zmeny.push({
			pole: `Sklo ${r.dim === 'S' ? 'šírka' : 'výška'} (zrkadlené z „${r.nazov}")`,
			stara: skloStara,
			nova
		});
	}

	// #610: sklo šírka sleduje profil podľa pravidla výroby (`sklo-sleduje-profil.ts`). Rovnaký
	// kontrakt ako rámový mirror: posuň sklo LEN keď sa offset profilu SKUTOČNE zmenil A sklo
	// pravidlo dovtedy sledovalo (`sklo == profil_starý − mm·N`) — inak je to ručná výnimka a
	// ostáva. Rámový mirror má prednosť (`skloZapisy.has`).
	const vazba = skloZapisy.has('S') ? null : vazbaSkla(sysStyl, rows, sklo);
	const nova = vazba ? offsets.get(vazba.profil.id) : undefined;
	if (vazba && nova !== undefined && nova !== vazba.profil.offset) {
		const { pravidlo, profil, skloS } = vazba;
		const detail = { sysStyl, profil: profil.nazov, profilStara: profil.offset, profilNova: nova };
		if (skloSleduje(pravidlo, skloS, profil.offset, n)) {
			const skloNova = skloOffsetZProfilu(pravidlo, nova, n);
			skloZapisy.set('S', skloNova);
			zmeny.push({ pole: skloSledujePole(pravidlo), stara: skloS, nova: skloNova });
			log.info('väzba sklo šírka→profil: sklo sa posunie s profilom', {
				...detail,
				skloStara: skloS,
				skloNova
			});
		} else {
			log.info('väzba sklo šírka→profil: sklo pravidlo nesleduje (ručná výnimka) — nedotknuté', {
				...detail,
				sklo: skloS,
				n
			});
		}
	}

	return { skloZapisy, zmeny };
}
