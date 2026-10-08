// #578/#587/#603: otvory riadku objednávky skla — hodnoty spec/polohy z producenta a PRECHODY
// starých riadkov podkladu na aktuálne pravidlo otvorov (`sklo-otvory.ts`), aby opakované
// „Pridať sklá" po zmene pravidla objednávku nezdvojilo. Vyčlenené z `objednavka-skla.ts`
// (1000-r. strop, `large-file-split.md`); tento modul z neho importuje LEN typ (žiadny cyklus).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { db } from './db';
import { normZak } from './money';
import { logger } from './log';
import { HOLE_SIZES, type HoleSize } from './odoo-rozpis-lines';
import { popisPozicie, zakladPozicie } from '../objednavka-skla-pozicia';
import { otvoryRucneZmenene, PRIPONA_OTVOR_RE } from '../sklo-otvory';
import type { NoveSklo } from './objednavka-skla';

const log = logger('objednavka-skla');

/** #587: stĺpce polohy otvoru (poradie `otvor_od_hrany_mm, otvor_od_spodku_mm, otvor_priemer_mm`). */
export type OtvorStlpce = [number | null, number | null, number | null];

/** #578: otvory z producenta → hodnoty `spec_holes_qty`/`spec_hole_size` (validované ako `nastavSpec`).
 *  #587: + poloha otvoru — uloží sa LEN pri otvoroch > 0 a kladných konečných číslach, inak NULL. */
export function otvoryRiadku(s: NoveSklo): {
	holesQty: number;
	holeSize: HoleSize | '';
	poloha: OtvorStlpce;
} {
	const holesQty = s.holesQty ?? 0;
	if (!Number.isInteger(holesQty) || holesQty < 0)
		throw new Error('Neplatný počet (otvory): musí byť celé číslo >= 0.');
	if (s.holeSize !== undefined && !HOLE_SIZES.includes(s.holeSize))
		throw new Error('Neplatný priemer otvoru.');
	const o = holesQty > 0 ? (s.otvor ?? null) : null;
	const platna =
		o != null && [o.odHranyMm, o.odSpodkuMm, o.priemerMm].every((x) => Number.isFinite(x) && x > 0);
	// otvory > 0 bez triedy → d30 (rovnako ako `nastavSpec`); bez otvorov trieda nemá zmysel
	return {
		holesQty,
		holeSize: holesQty > 0 ? s.holeSize || 'd30' : '',
		poloha: platna ? [o.odHranyMm, o.odSpodkuMm, o.priemerMm] : [null, null, null]
	};
}

// #578 prechod: riadok spred rozlíšenia otvorov = CELÝ posuv jedným riadkom (N ks) na tej istej
// pozícii BEZ prípony otvoru. Nový producent ho rozdelí na „s otvorom" + „bez" — ani jeden sa s ním
// nespáruje (iné kusy), takže bez prevodu by opakované „Pridať sklá" pridalo tabule NAVYŠE (dvojitá
// objednávka). Starý riadok sa preto PREVEDIE na riadok „s otvorom" (id + prílohy ostanú); zvyšok
// „bez" sa potom vloží bežne → výsledok = ako čerstvé pridanie. Otvory starého riadku sa NEfiltrujú
// (obsluha ich mohla pred #578 nastaviť ručne cez #521 spec) — prepíše ich pravidlo. Nový riadok sa
// nikdy nechytí: „s otvorom" má príponu (≠ základná pozícia), „bez" má menej kusov než celok.
const stmtStaryCelok = db.prepare(`
	SELECT id, popis FROM objednavka_skla
	WHERE zak_norm = ? AND op = ? AND modul = ?
	  AND sirka_mm IS ? AND vyska_mm IS ? AND v_lavo_mm IS ? AND v_pravo_mm IS ?
	  AND pocet = ? AND typ_skla = ?
`);
const stmtPrevedNaOtvor = db.prepare(`
	UPDATE objednavka_skla SET popis = ?, pocet = ?, m2 = ?, spec_holes_qty = ?, spec_hole_size = ?,
		otvor_od_hrany_mm = ?, otvor_od_spodku_mm = ?, otvor_priemer_mm = ?
	WHERE id = ?
`);

export function prevedStaryCelok(s: NoveSklo, polozky: NoveSklo[]): boolean {
	if (s.modul !== 'zasklenia' || !((s.holesQty ?? 0) > 0)) return false;
	const zaklad = zakladPozicie(s.popis, s.modul);
	// kusy CELÉHO posuvu = súčet riadkov tej istej pozície a toho istého skla v tomto pridaní
	const celok = polozky
		.filter(
			(p) =>
				p.modul === s.modul &&
				zakladPozicie(p.popis, p.modul) === zaklad &&
				p.sirkaMm === s.sirkaMm &&
				p.vyskaMm === s.vyskaMm &&
				p.typSkla === s.typSkla
		)
		.reduce((sum, p) => sum + p.pocet, 0);
	const kandidati = stmtStaryCelok.all(
		normZak(s.zak),
		s.op ?? '',
		s.modul,
		s.sirkaMm,
		s.vyskaMm ?? null,
		s.vLavoMm ?? null,
		s.vPravoMm ?? null,
		celok,
		s.typSkla
	) as { id: number; popis: string }[];
	const stary = kandidati.find((k) => popisPozicie(k.popis, s.modul) === zaklad);
	if (!stary) return false;
	const otvory = otvoryRiadku(s);
	stmtPrevedNaOtvor.run(
		s.popis,
		s.pocet,
		s.m2 ?? null,
		otvory.holesQty,
		otvory.holeSize,
		...otvory.poloha,
		stary.id
	);
	log.info('stary riadok posuvu prevedeny na riadok s otvorom', {
		id: stary.id,
		zak: s.zak,
		celok,
		sOtvorom: s.pocet
	});
	return true;
}

// #603 prechod: posuv rozdelený STARÝM pravidlom otvorov (pred #603 mala opona otvor len na krajných
// sklách: 2×3K = „s otvorom" 2 + „bez" 4) má rovnaký celok kusov, ale iné rozdelenie než producent
// (4 + 2). Ani jeden riadok sa nespáruje (identita = aj kusy) → opakované „Pridať sklá" by
// objednávku ZDVOJILO. Riadky sa preto PREVEDÚ: „s otvorom" dostane nové kusy + otvory + polohu (id
// + prílohy ostanú), „bez" nové kusy, a keď ho nové rozdelenie nemá (2×2K = 4 + 0), zmaže sa.
// Keď obsluha riadky upravila ručne (atyp, ručne zmenené otvory) alebo by sa mazal riadok s
// prílohou, prechod sa ODMIETNE: riadky toho posuvu sa NEpridajú (inak by sa objednávka zdvojila)
// a pozícia ide do upozornenia — opraví ju človek na podklade.
// Hranica: podklad otváranie neukladá — „Zasklenie 1" toho istého OP s rovnakým sklom a celkom je
// pre appku TEN ISTÝ posuv (ako dedup #514/#563); iné okno toho istého OP patrí do multi posuvu.
const stmtRiadkyPosuvu = db.prepare(`
	SELECT o.id, o.popis, o.pocet, o.spec_holes_qty AS otvory, o.spec_hole_size AS velkost, o.rezim,
	       (SELECT COUNT(*) FROM objednavka_skla_subory f WHERE f.polozka_id = o.id) AS prilohy
	FROM objednavka_skla o
	WHERE o.zak_norm = ? AND o.op = ? AND o.modul = ?
	  AND o.sirka_mm IS ? AND o.vyska_mm IS ? AND o.v_lavo_mm IS ? AND o.v_pravo_mm IS ?
	  AND o.typ_skla = ?
`);
const stmtNastavKusy = db.prepare('UPDATE objednavka_skla SET pocet = ?, m2 = ? WHERE id = ?');
const stmtZmazRiadok = db.prepare('DELETE FROM objednavka_skla WHERE id = ?');

interface RiadokPosuvu {
	id: number;
	popis: string;
	pocet: number;
	otvory: number;
	velkost: string;
	rezim: string;
	prilohy: number;
}

/** #603: výsledok prechodu starého rozdelenia posuvu (`null` = nebolo čo prevádzať). */
export type PrechodRozdelenia =
	| { stav: 'prevedene' }
	| { stav: 'odmietnute'; pozicia: string; dovod: string; riadky: NoveSklo[] };

/** Riadok „bez otvoru" TOHO ISTÉHO posuvu v tomto pridaní (pozícia + sklo ako riadok „s otvorom"). */
function novyBezPosuvu(s: NoveSklo, polozky: NoveSklo[], zaklad: string): NoveSklo | undefined {
	return polozky.find(
		(p) =>
			p !== s &&
			!((p.holesQty ?? 0) > 0) &&
			p.modul === s.modul &&
			zakladPozicie(p.popis, p.modul) === zaklad &&
			p.sirkaMm === s.sirkaMm &&
			p.vyskaMm === s.vyskaMm &&
			p.vLavoMm === s.vLavoMm &&
			p.vPravoMm === s.vPravoMm &&
			p.typSkla === s.typSkla
	);
}

/** Prevedie staré rozdelenie posuvu riadku `s` („s otvorom") na nové, alebo ho odmietne. */
export function prevedStareRozdelenie(s: NoveSklo, polozky: NoveSklo[]): PrechodRozdelenia | null {
	if (s.modul !== 'zasklenia' || !((s.holesQty ?? 0) > 0)) return null;
	const zaklad = zakladPozicie(s.popis, s.modul);
	const novyBez = novyBezPosuvu(s, polozky, zaklad);
	const celok = s.pocet + (novyBez?.pocet ?? 0);
	const riadky = (
		stmtRiadkyPosuvu.all(
			normZak(s.zak),
			s.op ?? '',
			s.modul,
			s.sirkaMm,
			s.vyskaMm ?? null,
			s.vLavoMm ?? null,
			s.vPravoMm ?? null,
			s.typSkla
		) as RiadokPosuvu[]
	).filter((r) => zakladPozicie(r.popis, s.modul) === zaklad);
	// „s otvorom" / „bez" podľa PRÍPONY pozície (čo zapísal producent), NIE podľa spec — ručne zmenené
	// otvory (zrušené na riadku s príponou, pridané na riadku bez nej) sú ručný zásah → odmietnutie
	const sOtvorom = riadky.filter((r) => PRIPONA_OTVOR_RE.test(r.popis));
	const bez = riadky.filter((r) => !PRIPONA_OTVOR_RE.test(r.popis));
	const [stary] = sOtvorom;
	const [staryBez] = bez;
	// presne JEDEN starý riadok „s otvorom" na tej istej pozícii (vrátane prípony ⌀) a najviac jeden „bez"
	if (!stary || sOtvorom.length > 1 || bez.length > 1) return null;
	if (popisPozicie(stary.popis, s.modul) !== popisPozicie(s.popis, s.modul)) return null;
	// rovnaké rozdelenie páruje dedup; iný celok kusov = iný posuv na tej istej pozícii
	if (stary.pocet === s.pocet || stary.pocet + (staryBez?.pocet ?? 0) !== celok) return null;
	// je to staré rozdelenie TOHO ISTÉHO posuvu — prepísať ho smie len bez ručných zásahov
	const dovod = riadky.some((r) => r.rezim === 'atyp')
		? 'ručne upravený riadok — atyp'
		: otvoryRucneZmenene({ popis: stary.popis, holesQty: stary.otvory, holeSize: stary.velkost }) ||
			  (staryBez?.otvory ?? 0) > 0
			? 'ručne zmenené otvory'
			: staryBez && !novyBez && staryBez.prilohy > 0
				? 'riadok bez otvoru má prílohu'
				: null;
	if (dovod) {
		log.warn('stare rozdelenie otvorov posuvu sa neda prepisat — skla posuvu sa nepridali', {
			zak: s.zak,
			pozicia: zaklad,
			dovod,
			riadky: riadky.map((r) => r.id)
		});
		return { stav: 'odmietnute', pozicia: zaklad, dovod, riadky: novyBez ? [s, novyBez] : [s] };
	}
	const otvory = otvoryRiadku(s);
	stmtPrevedNaOtvor.run(
		s.popis,
		s.pocet,
		s.m2 ?? null,
		otvory.holesQty,
		otvory.holeSize,
		...otvory.poloha,
		stary.id
	);
	if (staryBez && novyBez) stmtNastavKusy.run(novyBez.pocet, novyBez.m2 ?? null, staryBez.id);
	else if (staryBez) {
		stmtZmazRiadok.run(staryBez.id);
		log.warn('riadok bez otvoru zmazany — nove rozdelenie posuvu ho nema', {
			id: staryBez.id,
			zak: s.zak,
			pozicia: zaklad,
			pocet: staryBez.pocet
		});
	}
	log.info('stare rozdelenie otvorov posuvu prevedene na nove pravidlo', {
		id: stary.id,
		zak: s.zak,
		sOtvorom: `${stary.pocet} -> ${s.pocet}`,
		bez: `${staryBez?.pocet ?? 0} -> ${novyBez?.pocet ?? 0}`
	});
	return { stav: 'prevedene' };
}
