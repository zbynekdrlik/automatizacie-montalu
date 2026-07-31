// Zasklenia: dvojkrokový tok — (1) „nahlad" spočíta plán BEZ zápisu,
// (2) „odoslat" prepočíta ZNOVA zo surových vstupov (nikdy never klientom
// poslaným číslam) a zapíše odpis s dedup ochranou.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, listGlassTypes, glassTypesForSystem } from '$lib/server/db';
import { safeCompute, safeComputeMulti, systemyRucnaKolajnica } from '$lib/server/compute';
import { isB2B } from '$lib/server/auth';
import { checkB2BWidth, checkB2BHeight } from '$lib/server/b2b-limits';
import { sysStylPre, sklaDoPonuky, type ExistujeSysStyl } from '$lib/styl';
import {
	writeOdpis,
	isLive,
	targetDirFor,
	filenameFor,
	contentHash,
	type OdpisJob
} from '$lib/server/money';
import type { ComputeResult, MultiResult, PosuvSpec } from '$lib/server/compute';
import { kovanieDoOdpisu } from '$lib/server/kovanie';
import { komponentyPre } from '$lib/server/komponenty-cfg';
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
		polozky: [
			...r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
			...kovanie
		],
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
			// ručne zadané koľajnice — MENIA odpis, preto do histórie (audit prečo
			// sedí toľko metrov); null = počítané zo šírky
			kolajnica: vstup.kolajnica,
			// jednostranná FAB — MENÍ počet kľučiek/krytiek vložky v odpise
			jednostrannaFab: vstup.jednostrannaFab
		}
	};
}

/**
 * Kovanie (kusy + tesnenia) pre zákazku. Berie TIE ISTÉ specy, z ktorých sa počítal
 * nárezový plán — inak by sa odpis kovania mohol rozísť s tým, čo sa reže.
 * Chyba tu MUSÍ zastaviť odoslanie: radšej žiadny odpis než polovičný.
 */
function kovanieFor(specs: PosuvSpec[], jednostrannaFab: boolean) {
	return kovanieDoOdpisu(loadCfg(), specs, jednostrannaFab);
}

/** Existuje taký nárezák? Zdroj pravdy pre server je konfigurácia (cfg z DB). */
const existujeVCfg = (cfg: ReturnType<typeof loadCfg>): ExistujeSysStyl => (s) => !!cfg[s];

/** Sklo musí patriť k systému AJ k štýlu (napr. Štandard + opona nemá IZO skladbu). */
function skloPre(cfg: ReturnType<typeof loadCfg>, system: string, styl: string, sklo: string) {
	const platne = glassTypesForSystem(system);
	const povolene = sklaDoPonuky(
		system,
		styl,
		platne.map((g) => g.nazov),
		existujeVCfg(cfg)
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
	// sysStylPre: v Štandard + vyberá basic/IZO nárezák ZVOLENÉ SKLO (Patrik)
	const spec: PosuvSpec = {
		sysStyl: sysStylPre(vstup.system, vstup.styl, vstup.sklo, existujeVCfg(cfg)),
		S: vstup.s,
		V: vstup.v,
		redukciaZero: g.redukciaZero,
		skloHrubka: g.hrubka,
		pridavnaKolajnica: vstup.pridavnaKolajnica,
		// ručná dĺžka koľajnice (Patrik): mení rez → mení metre v odpise
		kolajnica: vstup.kolajnica ?? undefined
	};
	const out = safeCompute(
		cfg,
		spec.sysStyl,
		spec.S,
		spec.V,
		spec.redukciaZero,
		spec.skloHrubka,
		spec.pridavnaKolajnica,
		spec.kolajnica
	);
	return { ...out, spec };
}

// ---- Viac posuvov (zimná záhrada) ----

function computeMultiFrom(vstup: MultiVstup) {
	const cfg = loadCfg();
	const specs: PosuvSpec[] = [];
	for (let i = 0; i < vstup.posuvy.length; i++) {
		const p = vstup.posuvy[i];
		const g = skloPre(cfg, p.system, p.styl, p.sklo);
		if (!g)
			return {
				r: null,
				err: `Posuv ${i + 1}: vyber typ skla platný pre zvolený systém a štýl.`,
				specs: []
			};
		specs.push({
			sysStyl: sysStylPre(p.system, p.styl, p.sklo, existujeVCfg(cfg)),
			S: p.s,
			V: p.v,
			redukciaZero: g.redukciaZero,
			skloHrubka: g.hrubka,
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
			kolajnica: p.kolajnica ?? undefined
		});
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
		polozky: [
			...r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
			...kovanie
		],
		detail: {
			zimnaZahrada: true,
			pocetPosuvov: r.posuvy.length,
			jednostrannaFab: vstup.jednostrannaFab,
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
				kolajnica: vstup.posuvy[i]?.kolajnica ?? null
			}))
		}
	};
}

export const load: PageServerLoad = async () => {
	const styly = listSysStyly();
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		systemy,
		styly, // len existujúce kombinácie — neplatná voľba sa nedá odoslať
		// sklá s príslušnosťou k systému — klient ponúkne len platné pre zvolený
		// systém (Robust = 4/16/4, Slide = 4/8/4)
		skla: listGlassTypes().map((g) => ({ nazov: g.nazov, system: g.system })),
		otvarania: OTVARANIA,
		// kovanie krídla — zoznam pre selecty (len Robust), display-only
		kovania: KOVANIA,
		// systémy, kde má zmysel ručná dĺžka koľajnice (majú hornú + spodnú zvlášť):
		// Deluxe / Štandard + / Štandard. Robust a Slide majú jednu obvodovú (Patrik).
		systemyKolajnica: systemyRucnaKolajnica(loadCfg()),
		// systémy, ktoré posielajú kovanie do Money (Slide čaká na skladové zásoby) —
		// derivuje sa z konfigurácie kovania, aby sa zoznam nemusel držať na dvoch miestach
		systemyKovanie: systemy.filter((sys) => komponentyPre(sys) !== null),
		live: isLive()
	};
};

export const actions: Actions = {
	nahlad: async ({ request, locals }) => {
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
		if (err || !r || !spec) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		// kovanie (kusy + tesnenia) — chyba v počtoch zastaví už náhľad, aby sa
		// nedalo odoslať niečo, čo appka nevie spočítať celé
		const kov = kovanieFor([spec], vstup.jednostrannaFab);
		if (kov.err) return { step: 'form' as const, error: kov.err, vstup };
		const job = jobFor(vstup, r, '', kov.polozky);
		return {
			step: 'nahlad' as const,
			vstup,
			plan: r,
			kovanie: kov.polozky,
			// hash plánu — potvrdenie zapíše len PRESNE to, čo užívateľ videl
			planHash: contentHash(vstup.zak, job.polozky),
			warn: null as string | null,
			heightWarn,
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor(r.system, vstup.caka)
			}
		};
	},

	odoslat: async ({ request, locals }) => {
		// b2b nesmie zapisovať do Money — obrana do hĺbky, UI tlačidlo je skryté,
		// ale skriptovaný POST musí byť odmietnutý aj tu (pred parsom/výpočtom/zápisom)
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseVstup(formData);
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err, spec } = compute(vstup);
		if (err || !r || !spec) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		const kov = kovanieFor([spec], vstup.jednostrannaFab);
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
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.system, vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job);
			if (outcome.status === 'duplicate') {
				// 200 render (nie fail(409)) — non-2xx na form POST loguje v prehliadači
				// console error a porušuje zero-console-errors; blokovanie drží DB constraint
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					vstup
				};
			}
			return { step: 'hotovo', vstup, plan: r, kovanie: kov.polozky, outcome };
		} catch (e) {
			console.error('writeOdpis zlyhal:', e);
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
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };
		const kov = kovanieFor(specs, vstup.jednostrannaFab);
		if (kov.err) return { step: 'form' as const, error: kov.err, multiVstup: vstup };
		const job = jobForMulti(vstup, r, '', kov.polozky);
		return {
			step: 'nahladMulti' as const,
			multiVstup: vstup,
			multi: r,
			kovanie: kov.polozky,
			planHash: contentHash(vstup.zak, job.polozky),
			warn: null as string | null,
			heightWarn,
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor((r.posuvy[0]?.system ?? 'Robust'), vstup.caka)
			}
		};
	},

	odoslatMulti: async ({ request, locals }) => {
		// b2b nesmie zapisovať do Money — obrana do hĺbky, viď odoslat vyššie
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseMultiVstup(formData);
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const { r, err, specs } = computeMultiFrom(vstup);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };

		const potvrdene = String(formData.get('planHash') ?? '');
		const kov = kovanieFor(specs, vstup.jednostrannaFab);
		if (kov.err) return { step: 'form' as const, error: kov.err, multiVstup: vstup };
		const job = jobForMulti(vstup, r, locals.user?.username ?? '', kov.polozky);
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'nahladMulti' as const,
				multiVstup: vstup,
				multi: r,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor((r.posuvy[0]?.system ?? 'Robust'), vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job);
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					multiVstup: vstup
				};
			}
			return { step: 'hotovoMulti', multiVstup: vstup, multi: r, kovanie: kov.polozky, outcome };
		} catch (e) {
			console.error('writeOdpis (multi) zlyhal:', e);
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				multiVstup: vstup
			};
		}
	}
};
