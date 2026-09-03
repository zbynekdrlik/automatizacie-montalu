// Zasklenia: dvojkrokový tok — (1) „nahlad" spočíta plán BEZ zápisu,
// (2) „odoslat" prepočíta ZNOVA zo surových vstupov (nikdy never klientom
// poslaným číslam) a zapíše odpis s dedup ochranou.

import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/log';
import {
	loadCfg,
	listSysStyly,
	listGlassTypes,
	glassTypesForSystem,
	efektivnaKorekcia,
	efektivnaRedukciaZero
} from '$lib/server/db';
import {
	safeCompute,
	safeComputeMulti,
	systemyRucnaKolajnica,
	buildPosuvSpec,
	type ComputeResult,
	type MultiResult,
	type PosuvSpec
} from '$lib/server/compute';
import { isB2B, type SessionUser } from '$lib/server/auth';
import { znovaZOdpisu } from '$lib/server/znova';
import { checkB2BWidth, checkB2BHeight } from '$lib/server/b2b-limits';
import { sysStylPre, sklaDoPonuky, type ExistujeSysStyl, type TriedaZaNazov } from '$lib/styl';
import {
	writeOdpis,
	isLive,
	targetDirFor,
	filenameFor,
	contentHash,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	type OdpisJob
} from '$lib/server/money';
import { kovanieDoOdpisu } from '$lib/server/kovanie';
import { komponentyPre } from '$lib/server/komponenty-cfg';
import type { Farba } from '$lib/komponenty';
import { enrichPolozky, type CenyResult } from '$lib/server/ceny';
import { skloCenaPre, type SkloCenaResult, type SkloPlanVstup } from '$lib/server/sklo-cena';
import {
	parseVstup,
	parseMultiVstup,
	OTVARANIA,
	KOVANIA,
	type Vstup,
	type MultiVstup
} from '$lib/server/vstup';

function jobFor(
	vstup: Vstup,
	r: ComputeResult,
	createdBy: string,
	kovanie: OdpisJob['polozky'] = []
): OdpisJob {
	return {
		modul: 'zasklenia',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: r.system,
		popis: (vstup.op + ' : ' + vstup.zakaznik).trim(),
		// profily (metre) + kovanie (kusy a tesnenia) — kovanie ide za profilmi,
		// aby si dielňa v xlsx zachovala poradie, na ktoré je zvyknutá
		polozky: [...r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })), ...kovanie],
		detail: {
			system: r.system,
			styl: r.styl,
			s: r.S,
			v: r.V,
			// zaznamenaj presné zloženie ak zadané, inak základné sklo
			sklo: vstup.skloPresne || vstup.sklo,
			skloZaklad: vstup.sklo,
			otvaranie: vstup.otvaranie,
			// kovanie (kľučky) — len záznam do histórie/plánu, do Money položiek nejde
			kovanieL: vstup.kovanieL,
			kovanieP: vstup.kovanieP,
			kovanieStred: vstup.kovanieStred,
			kovanieStredOkno: vstup.kovanieStredOkno,
			poznamka: vstup.poznamka,
			ral: vstup.ral,
			// klín — len záznam do histórie/plánu, do Money položiek nejde
			klin: vstup.klin,
			// sieťka (#86–#90) — len záznam do histórie/plánu, do Money položiek nejde
			sietka: vstup.sietka,
			// ručne zadané koľajnice — MENIA odpis, preto do histórie (audit prečo
			// sedí toľko metrov); null = počítané zo šírky
			kolajnica: vstup.kolajnica,
			// jednostranná FAB — MENÍ počet kľučiek/krytiek vložky v odpise
			jednostrannaFab: vstup.jednostrannaFab,
			// RAL farba kovania — MENÍ Money kód (kľučka/krytka vložky R9005 vs R7016,
			// Štandard zámok); do histórie kvôli auditu + „Použiť znova" (#338)
			farbaKovania: vstup.farbaKovania,
			// prídavná koľajnica — MENÍ odpis (spodná koľajnica o veľkosť vyššie);
			// bez nej by „Použiť znova" prebralo zákazku s iným odpisom, než mala
			pridavnaKolajnica: vstup.pridavnaKolajnica,
			// výška vŕtania zámku — display-only (Deluxe), ale patrí k zadaniu
			vrtanieZamku: vstup.vrtanieZamku,
			// #156 (krok 0 pre #155): celý naparsovaný vstup 1:1, VEDĽA polí vyššie —
			// tie ostávajú (znova.ts z nich odvodzuje predvyplnenie formulára), toto
			// je surová záloha nezávislá od toho, čo si niekto pamätá zrkadliť
			vstupRaw: vstup
		}
	};
}

/**
 * Kovanie (kusy + tesnenia) pre zákazku. Berie TIE ISTÉ specy, z ktorých sa počítal
 * nárezový plán — inak by sa odpis kovania mohol rozísť s tým, čo sa reže.
 * Chyba tu MUSÍ zastaviť odoslanie: radšej žiadny odpis než polovičný.
 */
function kovanieFor(specs: PosuvSpec[], jednostrannaFab: boolean, farbaKovania?: Farba | null) {
	return kovanieDoOdpisu(loadCfg(), specs, jednostrannaFab, farbaKovania ?? undefined);
}

/**
 * Cenový zoznam materiálu (#154, fáza 1) — LEN pre interných. B2B nesmie vidieť
 * nákupnú cenu/maržu/sklad vôbec (šéf 2026-08-12) — obrana do hĺbky ako Money-write
 * hranica (access-control skill §2): dáta sa pre b2b vôbec NEDOPOČÍTAJÚ, nielen
 * neukážu v UI, takže sa nikdy nedostanú do HTML odpovede ani skriptovaným POST-om.
 */
function cenyPre(user: SessionUser | null, polozky: OdpisJob['polozky']): CenyResult | undefined {
	if (isB2B(user)) return undefined;
	return enrichPolozky(polozky);
}

/**
 * Náklad na sklo (display-only, #225) — rovnaká interná-only hranica ako `cenyPre`:
 * pre b2b sa cena skla vôbec NEDOPOČÍTA, takže sa nikdy nedostane do HTML odpovede.
 */
function skloCenyPre(user: SessionUser | null, plany: SkloPlanVstup[]): SkloCenaResult | undefined {
	if (isB2B(user)) return undefined;
	return skloCenaPre(plany);
}

/** Existuje taký nárezák? Zdroj pravdy pre server je konfigurácia (cfg z DB). */
const existujeVCfg =
	(cfg: ReturnType<typeof loadCfg>): ExistujeSysStyl =>
	(s) =>
		!!cfg[s];

/** Sklo musí patriť k systému AJ k štýlu (napr. Štandard + opona nemá IZO skladbu).
 *  #443: `sklaDoPonuky` dostáva trieda-lookup (`platne` je práve TENTO systém, takže
 *  `find` podľa mena je jednoznačný) — basic/IZO filter sa rozhoduje primárne triedou,
 *  regex `jeIzoSklo` ostáva fallback len pre neklasifikované sklo. */
function skloPre(cfg: ReturnType<typeof loadCfg>, system: string, styl: string, sklo: string) {
	const platne = glassTypesForSystem(system);
	const triedaZa: TriedaZaNazov = (nazov) =>
		platne.find((g) => g.nazov === nazov)?.hrubkaTrieda ?? null;
	const povolene = sklaDoPonuky(
		system,
		styl,
		platne.map((g) => g.nazov),
		existujeVCfg(cfg),
		triedaZa
	);
	return povolene.includes(sklo) ? (platne.find((g) => g.nazov === sklo) ?? null) : null;
}

function compute(vstup: Vstup): {
	r: ComputeResult | null;
	err: string | null;
	spec: PosuvSpec | null;
} {
	const cfg = loadCfg();
	// sklo musí patriť k zvolenému systému (Robust = 4/16/4, Slide = 4/8/4) —
	// nedá sa cez skriptovaný POST poslať cudzie sklo
	const g = skloPre(cfg, vstup.system, vstup.styl, vstup.sklo);
	if (!g) return { r: null, err: 'Vyber typ skla platný pre zvolený systém a štýl.', spec: null };
	// hrúbka skla (Deluxe 6/10) vyberá kladka/klzný profil; Robust/Slide = 0
	// prídavná koľajnica: spodná koľajnica o 1 väčšia (compute gejtuje na Štandard +)
	// sysStylPre: v Štandard + vyberá basic/IZO nárezák ZVOLENÁ TRIEDA skla (#443,
	// regex jeIzoSklo len fallback pre neklasifikované sklo)
	// #109: zdieľaný builder pre OBE cesty (compute() aj computeMultiFrom()) — nové
	// pole PosuvSpec, ktoré tu chýba, je teraz kompilačná chyba, nie tichá diera.
	const spec: PosuvSpec = buildPosuvSpec({
		sysStyl: sysStylPre(vstup.system, vstup.styl, vstup.sklo, existujeVCfg(cfg), g.hrubkaTrieda),
		S: vstup.s,
		V: vstup.v,
		// #443: pre klasifikované Slide sklo DERIVOVANÉ z triedy (efektivnaRedukciaZero);
		// inak uložený stĺpec (honest-null fallback)
		redukciaZero: efektivnaRedukciaZero(g),
		skloHrubka: g.hrubka,
		// #443: reťaz precedencie per-sklo (#440) → trieda (systém × 6/16) → systémová
		skloKorekcia: efektivnaKorekcia(g, vstup.system),
		pridavnaKolajnica: vstup.pridavnaKolajnica,
		// ručná dĺžka koľajnice (Patrik): mení rez → mení metre v odpise
		kolajnica: vstup.kolajnica ?? undefined,
		// sieťka (#86–#90, KOREKCIA 2026-08-02) — na Robust/Slide MENÍ odpis
		// (rám+nos+[2K→3K koľajnica]), gate je vo vnútri computeFlat
		sietka: vstup.sietka,
		// jednoposuvová cesta tieto polia zo `spec` NIKDY nečíta — jobFor() číta
		// otvaranie/sklo/kovanie*/klin PRIAMO z `vstup` (jedna sada hodnôt, jeden
		// formulár). Explicitný `undefined` namiesto tichého vynechania poľa —
		// presne dôvod #109 (viď design komentár na tickete).
		otvaranie: undefined,
		sklo: undefined,
		kovanieL: undefined,
		kovanieP: undefined,
		kovanieStred: undefined,
		kovanieStredOkno: undefined,
		klin: undefined
	});
	const out = safeCompute(
		cfg,
		spec.sysStyl,
		spec.S,
		spec.V,
		spec.redukciaZero,
		spec.skloHrubka,
		spec.pridavnaKolajnica,
		spec.kolajnica,
		spec.sietka,
		spec.skloKorekcia
	);
	return { ...out, spec };
}

// ---- Viac posuvov (zimná záhrada) ----

function computeMultiFrom(vstup: MultiVstup) {
	const cfg = loadCfg();
	const specs: PosuvSpec[] = [];
	for (const [i, p] of vstup.posuvy.entries()) {
		const g = skloPre(cfg, p.system, p.styl, p.sklo);
		if (!g)
			return {
				r: null,
				err: `Posuv ${i + 1}: vyber typ skla platný pre zvolený systém a štýl.`,
				specs: []
			};
		// #109: rovnaký zdieľaný builder ako compute() vyššie — na tejto ceste sú
		// naopak VŠETKY polia potrebné (echo pre plán/tlač cez PosuvInfo, viď design
		// komentár na tickete).
		specs.push(
			buildPosuvSpec({
				sysStyl: sysStylPre(p.system, p.styl, p.sklo, existujeVCfg(cfg), g.hrubkaTrieda),
				S: p.s,
				V: p.v,
				// #443: pre klasifikované Slide sklo DERIVOVANÉ z triedy; inak uložený stĺpec
				redukciaZero: efektivnaRedukciaZero(g),
				skloHrubka: g.hrubka,
				// #443: reťaz precedencie per-sklo (#440) → trieda (systém × 6/16) → systémová
				skloKorekcia: efektivnaKorekcia(g, p.system),
				otvaranie: p.otvaranie,
				sklo: p.sklo,
				kovanieL: p.kovanieL,
				kovanieP: p.kovanieP,
				kovanieStred: p.kovanieStred,
				kovanieStredOkno: p.kovanieStredOkno,
				klin: p.klin,
				// prídavná koľajnica je vstup na úrovni objednávky → platí pre všetky posuvy
				pridavnaKolajnica: vstup.pridavnaKolajnica,
				// ručná dĺžka koľajnice je PER POSUV (každý posuv má vlastnú šírku)
				kolajnica: p.kolajnica ?? undefined,
				// sieťka (#86–#90, KOREKCIA 2026-08-02) — na Robust/Slide MENÍ Money odpis
				// (rám+nos+[2K→3K koľajnica]), gate je vo vnútri computeMulti/computeFlat
				sietka: p.sietka ?? undefined
			})
		);
	}
	return { ...safeComputeMulti(cfg, specs), specs };
}

function jobForMulti(
	vstup: MultiVstup,
	r: MultiResult,
	createdBy: string,
	kovanie: OdpisJob['polozky'] = []
): OdpisJob {
	const sys0 = r.posuvy[0]?.system ?? 'Robust';
	return {
		modul: 'zasklenia',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: sys0,
		popis: (vstup.op + ' : ' + vstup.zakaznik).trim(),
		polozky: [...r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })), ...kovanie],
		detail: {
			zimnaZahrada: true,
			pocetPosuvov: r.posuvy.length,
			jednostrannaFab: vstup.jednostrannaFab,
			// RAL farba kovania — MENÍ Money kód kovania (#338); audit + „Použiť znova"
			farbaKovania: vstup.farbaKovania,
			pridavnaKolajnica: vstup.pridavnaKolajnica,
			poznamka: vstup.poznamka,
			ral: vstup.ral,
			posuvy: r.posuvy.map((p, i) => ({
				posuv: i + 1,
				system: p.system,
				styl: p.styl,
				s: p.S,
				v: p.V,
				sklo: vstup.posuvy[i]?.sklo,
				otvaranie: p.otvaranie,
				kovanieL: vstup.posuvy[i]?.kovanieL,
				kovanieP: vstup.posuvy[i]?.kovanieP,
				kovanieStred: vstup.posuvy[i]?.kovanieStred,
				kovanieStredOkno: vstup.posuvy[i]?.kovanieStredOkno,
				klin: vstup.posuvy[i]?.klin ?? null,
				kolajnica: vstup.posuvy[i]?.kolajnica ?? null,
				sietka: vstup.posuvy[i]?.sietka ?? null
			})),
			// #156 (krok 0 pre #155): celý naparsovaný MultiVstup 1:1, VEDĽA polí vyššie
			vstupRaw: vstup
		}
	};
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const styly = listSysStyly();
	// „Použiť znova" z histórie — len pre interných (b2b históriu odpisov nemá).
	// Vracia iba PREDVYPLNENIE formulára; nič sa tým nezapisuje ani neodpisuje.
	const znovaId = Number(url.searchParams.get('znova') ?? '');
	const znova = znovaId && !isB2B(locals.user) ? znovaZOdpisu(znovaId) : null;
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		systemy,
		styly, // len existujúce kombinácie — neplatná voľba sa nedá odoslať
		// sklá s príslušnosťou k systému — klient ponúkne len platné pre zvolený
		// systém (Robust = 4/16/4, Slide = 4/8/4). `trieda` (#443) — trieda skladby
		// (6/16/NULL); server-side selekcia nárezáku je autoritatívna (compute()),
		// toto pole je zatiaľ len prenesené dáta pre budúce klientske využitie.
		skla: listGlassTypes().map((g) => ({
			nazov: g.nazov,
			system: g.system,
			trieda: g.hrubkaTrieda
		})),
		otvarania: OTVARANIA,
		// kovanie krídla — zoznam pre selecty (len Robust), display-only
		kovania: KOVANIA,
		// systémy, kde má zmysel ručná dĺžka koľajnice (majú hornú + spodnú zvlášť):
		// Deluxe / Štandard + / Štandard. Robust a Slide majú jednu obvodovú (Patrik).
		systemyKolajnica: systemyRucnaKolajnica(loadCfg()),
		// systémy, kde má „Jednostranná FAB" checkbox zmysel — t.j. ich kovanie má
		// aspoň jednu položku riadenú pravidlom `naUzaverPodlaFab` (kľučka/krytka
		// vložky), ktorú FAB reálne polovičkuje. Dnes iba Robust; Deluxe/Slide/
		// Štandard tieto položky nemajú, takže FAB tam nič nerobí (#431, Patrik:
		// „Delux odstrániť ... Jednostranná FAB"). Derivované z configu — nový systém
		// s FAB položkou checkbox dostane automaticky, bez úpravy tejto stránky.
		systemyFab: systemy.filter((sys) =>
			(komponentyPre(sys) ?? []).some((k) => k.pravidlo.typ === 'naUzaverPodlaFab')
		),
		// systémy, ktorých kovanie má RAL farebné varianty (kľučka/krytka/zámok R9005 vs
		// R7016) → formulár musí ponúknuť voľbu farby kovania (#338). Derivované z configu.
		systemyFarba: systemy.filter((sys) =>
			(komponentyPre(sys) ?? []).some((k) => k.farba !== undefined)
		),
		// platné RAL možnosti PER SYSTÉM (#354) — Deluxe (R9006/R7016, len 10mm je live)
		// a Robust/Štandard (R9005/R7016) majú ROZDIELNU farebnú množinu; zdieľaný pevný
		// zoznam by nesprávnu voľbu pre daný systém TICHO preskočil (farba-mismatch nie je
		// chyba, len absent) namiesto ponuky len platných kombinácií. Derivované z configu,
		// nie hardcoded — nová farba/systém sa premietne bez úpravy tejto stránky.
		ralPreSystem: Object.fromEntries(
			systemy.map((sys) => [
				sys,
				[...new Set((komponentyPre(sys) ?? []).map((k) => k.farba).filter((f) => f !== undefined))]
			])
		),
		znova,
		live: isLive()
	};
};

export const actions = {
	nahlad: async ({ request, locals }) => {
		// dátum vzniku plánu pre tlačenú hlavičku (#114) — server clock PRI spracovaní
		// akcie, nie new Date() na klientovi, aby sa nemenilo, ak stránka ostane otvorená
		const vytvorene = new Date().toISOString();
		const { vstup, error } = parseVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };

		// b2b: šírka na sklo blokuje (nedá sa vyrobiť), výška NEblokuje — len
		// upozorní „bez záruky" (Dominik). Interní users tieto limity NEVIDIA.
		let heightWarn: string | undefined;
		if (isB2B(locals.user)) {
			const cfg = loadCfg();
			const sysStyl = sysStylPre(vstup.system, vstup.styl, vstup.sklo, existujeVCfg(cfg));
			const wErr = checkB2BWidth(cfg, sysStyl, vstup.s);
			if (wErr) return { step: 'form' as const, error: wErr, vstup };
			heightWarn = checkB2BHeight(sysStyl, vstup.v) ?? undefined;
		}

		const { r, err, spec } = compute(vstup);
		if (err || !r || !spec)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		// kovanie (kusy + tesnenia) — chyba v počtoch zastaví už náhľad, aby sa
		// nedalo odoslať niečo, čo appka nevie spočítať celé
		const kov = kovanieFor([spec], vstup.jednostrannaFab, vstup.farbaKovania);
		if (kov.err) return { step: 'form' as const, error: kov.err, vstup };
		const job = jobFor(vstup, r, '', kov.polozky);
		return {
			step: 'nahlad' as const,
			vstup,
			plan: r,
			kovanie: kov.polozky,
			// cenový zoznam materiálu (#154, fáza 1) — LEN pre interných; undefined pre
			// b2b, takže sa nedostane ani do HTML odpovede (obrana do hĺbky)
			ceny: cenyPre(locals.user, job.polozky),
			// náklad na sklo (display-only, #225) — LEN pre interných, undefined pre b2b;
			// plocha reálnych tabúľ × cena/m² zo snapshotu, honest-null keď cena chýba
			skloCeny: skloCenyPre(locals.user, [
				{
					label: '',
					system: vstup.system,
					variant: vstup.sklo,
					sirka: r.sklo.sirka,
					vyska: r.sklo.vyska,
					pocet: r.sklo.pocet
				}
			]),
			// hash plánu — potvrdenie zapíše len PRESNE to, čo užívateľ videl
			planHash: contentHash(vstup.zak, job.polozky),
			warn: kov.warn,
			heightWarn,
			vytvorene,
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor(r.system, vstup.caka)
			}
		};
	},

	odoslat: async ({ request, locals }) => {
		// dátum vzniku plánu pre tlačenú hlavičku (#114) — pozri poznámku pri `nahlad`
		const vytvorene = new Date().toISOString();
		// b2b nesmie zapisovať do Money — obrana do hĺbky, UI tlačidlo je skryté,
		// ale skriptovaný POST musí byť odmietnutý aj tu (pred parsom/výpočtom/zápisom)
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseVstup(formData);
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err, spec } = compute(vstup);
		if (err || !r || !spec)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		const kov = kovanieFor([spec], vstup.jednostrannaFab, vstup.farbaKovania);
		if (kov.err) return { step: 'form' as const, error: kov.err, vstup };

		// ak niekto medzi náhľadom a potvrdením zmenil vzorce (Nastavenia),
		// prepočet už nesedí s tým, čo užívateľ videl → nezapisuj, ukáž nový náhľad
		const potvrdene = String(formData.get('planHash') ?? '');
		const job = jobFor(vstup, r, locals.user?.username ?? '', kov.polozky);
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'nahlad' as const,
				vstup,
				plan: r,
				planHash: aktualny,
				// #338: nestrať upozornenie na neúplné kovanie (Štandard tesnenia/kefy) pri
				// re-náhľade po zmene vzorcov — obe hlášky spoj, nie prepíš
				warn: [
					'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
					kov.warn
				]
					.filter(Boolean)
					.join(' '),
				vytvorene,
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.system, vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job, overrideOpts(formData));
			if (outcome.status === 'duplicate') {
				// 200 render (nie fail(409)) — non-2xx na form POST loguje v prehliadači
				// console error a porušuje zero-console-errors; blokovanie drží DB constraint
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					vstup
				};
			}
			if (outcome.status === 'blocked') {
				return {
					step: 'blocked' as const,
					blokReason: outcome.reason!,
					blokAction: '?/odoslat',
					rawEntries: rawFormEntries(formData),
					error: blokHlaska(outcome, vstup.zak, vstup.op),
					vstup
				};
			}
			return { step: 'hotovo', vstup, plan: r, kovanie: kov.polozky, outcome, vytvorene };
		} catch (e) {
			logger('zasklenia').error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				vstup
			};
		}
	},

	// „← Späť a upraviť": vráti formulár s PREDVYPLNENÝMI hodnotami (nekompútuje,
	// len echo vstupu) — inak by sa formulár vynuloval (nález Dominik).
	upravit: async ({ request }) => {
		const { vstup } = parseVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	upravitMulti: async ({ request }) => {
		const { vstup } = parseMultiVstup(await request.formData());
		return { step: 'form' as const, multiVstup: vstup };
	},

	// ---- Viac posuvov (zimná záhrada): spoločné balenie tyčí naprieč posuvmi ----
	nahladMulti: async ({ request, locals }) => {
		// dátum vzniku plánu pre tlačenú hlavičku (#114) — pozri poznámku pri `nahlad`
		const vytvorene = new Date().toISOString();
		const { vstup, error } = parseMultiVstup(await request.formData());
		if (error) return { step: 'form' as const, error, multiVstup: vstup };

		// b2b: per-posuv šírka blokuje celý náhľad na prvej chybe; výšky, ktoré
		// presiahnu limit, sa zbierajú (bez duplicít) do jedného upozornenia.
		let heightWarn: string | undefined;
		if (isB2B(locals.user)) {
			const cfg = loadCfg();
			const warns: string[] = [];
			for (const p of vstup.posuvy) {
				const sysStyl = sysStylPre(p.system, p.styl, p.sklo, existujeVCfg(cfg));
				const wErr = checkB2BWidth(cfg, sysStyl, p.s);
				if (wErr) return { step: 'form' as const, error: wErr, multiVstup: vstup };
				const hW = checkB2BHeight(sysStyl, p.v);
				if (hW) warns.push(hW);
			}
			heightWarn = warns.length ? [...new Set(warns)].join(' ') : undefined;
		}

		const { r, err, specs } = computeMultiFrom(vstup);
		if (err || !r)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };
		const kov = kovanieFor(specs, vstup.jednostrannaFab, vstup.farbaKovania);
		if (kov.err) return { step: 'form' as const, error: kov.err, multiVstup: vstup };
		const job = jobForMulti(vstup, r, '', kov.polozky);
		return {
			step: 'nahladMulti' as const,
			multiVstup: vstup,
			multi: r,
			kovanie: kov.polozky,
			// cenový zoznam materiálu (#154, fáza 1) — LEN pre interných (viď nahlad vyššie)
			ceny: cenyPre(locals.user, job.polozky),
			// náklad na sklo per posuv + súhrn (display-only, #225) — LEN pre interných
			skloCeny: skloCenyPre(
				locals.user,
				r.posuvy.map((p, i) => ({
					label: 'Posuv ' + (i + 1),
					system: p.system,
					variant: vstup.posuvy[i]?.sklo ?? '',
					sirka: p.sklo.sirka,
					vyska: p.sklo.vyska,
					pocet: p.sklo.pocet
				}))
			),
			planHash: contentHash(vstup.zak, job.polozky),
			warn: kov.warn,
			heightWarn,
			vytvorene,
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor(r.posuvy[0]?.system ?? 'Robust', vstup.caka)
			}
		};
	},

	odoslatMulti: async ({ request, locals }) => {
		// dátum vzniku plánu pre tlačenú hlavičku (#114) — pozri poznámku pri `nahlad`
		const vytvorene = new Date().toISOString();
		// b2b nesmie zapisovať do Money — obrana do hĺbky, viď odoslat vyššie
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseMultiVstup(formData);
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const { r, err, specs } = computeMultiFrom(vstup);
		if (err || !r)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };

		const potvrdene = String(formData.get('planHash') ?? '');
		const kov = kovanieFor(specs, vstup.jednostrannaFab, vstup.farbaKovania);
		if (kov.err) return { step: 'form' as const, error: kov.err, multiVstup: vstup };
		const job = jobForMulti(vstup, r, locals.user?.username ?? '', kov.polozky);
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'nahladMulti' as const,
				multiVstup: vstup,
				multi: r,
				planHash: aktualny,
				// #338: nestrať upozornenie na neúplné kovanie (Štandard tesnenia/kefy) pri
				// re-náhľade po zmene vzorcov — obe hlášky spoj, nie prepíš
				warn: [
					'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
					kov.warn
				]
					.filter(Boolean)
					.join(' '),
				vytvorene,
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.posuvy[0]?.system ?? 'Robust', vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job, overrideOpts(formData));
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					multiVstup: vstup
				};
			}
			if (outcome.status === 'blocked') {
				return {
					step: 'blocked' as const,
					blokReason: outcome.reason!,
					blokAction: '?/odoslatMulti',
					rawEntries: rawFormEntries(formData),
					error: blokHlaska(outcome, vstup.zak, vstup.op),
					multiVstup: vstup
				};
			}
			return {
				step: 'hotovoMulti',
				multiVstup: vstup,
				multi: r,
				kovanie: kov.polozky,
				outcome,
				vytvorene
			};
		} catch (e) {
			logger('zasklenia').error('writeOdpis (multi) zlyhal', {
				zak: vstup.zak,
				op: vstup.op,
				error: e
			});
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				multiVstup: vstup
			};
		}
	}
} satisfies Actions;
