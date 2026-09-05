<script lang="ts">
	import { untrack } from 'svelte';
	import { checkB2BWidth, checkB2BHeight } from '$lib/b2b-limits';
	import { defaultSklo } from '$lib/sklo';
	import {
		stylyDoPonuky,
		sklaDoPonuky,
		sysStylPre,
		skloVyberaIzo,
		pridavnaKolajnicaDefault
	} from '$lib/styl';
	import { popisMulti } from '$lib/popis';
	import { nazovSystemu } from '$lib/system-nazvy';
	import { type Klin } from '$lib/klin';
	import { type Farba } from '$lib/komponenty';
	import { maSietkaSystem, sietkaStrana, type Sietka, type SietkaUchyt } from '$lib/sietka';
	import { resolve } from '$app/paths';
	import { formatDatumCasSk } from '$lib/datum';
	// #250 — vyčlenené krokové subkomponenty (vzor #239); +page ostáva state+compute hub
	import { type PosuvRow } from '$lib/zasklenia-form';
	import ZasklieniaForm from '$lib/components/zasklenia/ZasklieniaForm.svelte';
	import PlanKarty from '$lib/components/zasklenia/PlanKarty.svelte';
	import PlanKartyMulti from '$lib/components/zasklenia/PlanKartyMulti.svelte';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import SkladVarovania from '$lib/components/SkladVarovania.svelte';
	import OdpisNavrhNav from '$lib/components/OdpisNavrhNav.svelte';

	let { data, form } = $props();

	// b2b nesmie odpisovať do Money — server to aj tak odmietne (defense in depth),
	// tu skrývame odoslat/odoslatMulti UI, aby to b2b účet ani neskúšal
	const isB2B = $derived(data.user?.role === 'b2b');

	// Zdroj predvyplnenia: (1) akcia — po chybe/náhľade sa vraciame k odoslaným
	// hodnotám, alebo (2) „Použiť znova" z histórie (`?znova=<id>`), ktoré server
	// vracia v ROVNAKOM tvare. Jedna cesta pre oboje — žiadna druhá vetva.
	let fv = $derived(form?.vstup ?? data.znova?.vstup ?? null);
	let fmv = $derived(form?.multiVstup ?? data.znova?.multiVstup ?? null);
	// predvyplnenie: jedno- aj viac-posuvový vstup zdieľa zak/op/zákazník/poznámku/čaká
	let vstup = $derived.by(() => {
		const zd = fv ?? fmv ?? null;
		return {
			zak: zd?.zak ?? '',
			op: zd?.op ?? '',
			zakaznik: zd?.zakaznik ?? '',
			system: fv?.system ?? 'Robust',
			styl: fv?.styl ?? '2K',
			s: (fv?.s ?? '') as unknown as number,
			v: (fv?.v ?? '') as unknown as number,
			sklo: fv?.sklo ?? '',
			skloPresne: fv?.skloPresne ?? '',
			otvaranie: fv?.otvaranie ?? 'P - L',
			kovanieL: fv?.kovanieL ?? '',
			kovanieP: fv?.kovanieP ?? '',
			kovanieStred: fv?.kovanieStred ?? '',
			kovanieStredOkno: (fv?.kovanieStredOkno ?? 'L') as 'L' | 'P',
			vrtanieZamku: fv?.vrtanieZamku ?? 1050,
			poznamka: zd?.poznamka ?? '',
			ral: zd?.ral ?? '',
			caka: zd?.caka ?? false,
			pridavnaKolajnica: zd?.pridavnaKolajnica ?? false,
			jednostrannaFab: zd?.jednostrannaFab ?? false,
			// RAL farba kovania (#338) — vyberá Money kód farebného variantu
			farbaKovania: (zd?.farbaKovania ?? null) as Farba | null,
			klin: (fv?.klin ?? null) as Klin | null,
			// ručné dĺžky koľajníc — MENIA odpis; null = počítané zo šírky
			kolajnica: (fv?.kolajnica ?? null) as { horna?: number; spodna?: number } | null,
			// sieťka (#86–#90, KOREKCIA 2026-08-02) — na Robust/Slide jednom behu krídel
			// IDE do Money odpisu (rám+nos+[2K→3K koľajnica]); úchyt zostáva display-only
			sietka: (fv?.sietka ?? null) as Sietka | null
		};
	});

	// primárny posuv (posuv 1) = ploché polia; ďalšie posuvy (zimná záhrada) v posuvyExtra.
	// po chybe/náhľade obnov primárny z jednoposuvového ALEBO viacposuvového vstupu
	const prim = () => fmv?.posuvy?.[0] ?? fv ?? null;
	// Štandard +: v ponuke sú LEN počty krídel (2K…6K, opona 2x…). Či sa ťahá basic
	// alebo IZO nárezák, rozhoduje zvolené SKLO — Patrik 2026-07-27: „ako pri SLIDE,
	// zvolím počet okien a podľa výberu skla mi určí, ktorý nárezák to bude ťahať".
	const stylyForSystem = (sys: string) =>
		stylyDoPonuky(
			sys,
			data.styly.filter((x) => x.system === sys).map((x) => x.styl)
		);
	// Deluxe aj Štandard +: LEN vlastné sklá (Deluxe: Float kalené 6/10 — hrúbka
	// vyberá kladka/klzný profil; Štandard +: Float 4/6/10 + „3.3.1" + Izolačné 4.8.4);
	// spoločné 'ALL' sklá nemajú ich profil (musí sedieť so serverovým
	// glassTypesForSystem, inak by formulár ponúkol sklo, ktoré server odmietne).
	// (a Štandard + opona nemá izolačnú skladbu → sklaDoPonuky ju odfiltruje)
	// existencia nárezáka podľa data.styly (server má ten istý test nad cfg)
	const existuje = (sysStyl: string) => data.styly.some((x) => x.sysStyl === sysStyl);
	const sklaForSystem = (sys: string, styl: string) =>
		sklaDoPonuky(
			sys,
			styl,
			data.skla
				.filter((g) =>
					sys === 'Deluxe' || sys === 'Štandard +' || sys === 'Štandard'
						? g.system === (sys === 'Štandard' ? 'Štandard +' : sys)
						: g.system === sys || g.system === 'ALL'
				)
				.map((g) => g.nazov),
			existuje
		);
	const otvaraniaForStyl = (st: string) => (st?.startsWith('2x') ? ['Opona'] : data.otvarania);

	// VŠETKY editovateľné polia sú $state (bind) — nie jednosmerné value={vstup.x}.
	// Jednosmerné by sa pri každom re-renderi (napr. po zmene rozmeru) vymazali.
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');
	let skloPresneS = $state('');
	let poznamkaS = $state('');
	let ralS = $state('');
	let cakaS = $state(false);
	let pridavnaKolajnicaS = $state(false);
	// #132: hranový tracker pre DEFAULT „Prídavná koľajnica" — pozri
	// pridavnaKolajnicaOdporucana nižšie prečo je hranový, nie „vždy keď true"
	let pridavnaKolajnicaOdporucanaPrev = $state(false);
	// jednostranná FAB — výnimka, MENÍ Money odpis (kľučka/krytka vložky 1 ks)
	let jednostrannaFabS = $state(false);
	// RAL farba kovania (#338) — MENÍ Money kód (kľučka/krytka/zámok R9005 vs R7016).
	// '' = nezvolená → engine vyhlási chybu pri systéme s farebnou položkou.
	let farbaKovaniaS = $state<'' | Farba>('');
	let system = $state('Robust');
	let styl = $state('2K');
	let sklo = $state('');
	let otvaranie = $state('P - L');
	// kovanie (kľučka) ľavej/pravej strany — len Robust, len na plán/náhľad
	let kovanieLS = $state('');
	let kovaniePS = $state('');
	let kovanieStredS = $state('');
	let kovanieStredOknoS = $state<'L' | 'P'>('L');
	let sirka = $state<number | string>('');
	let vyska = $state<number | string>('');
	let vrtanieZamkuS = $state<number | string>(1050);
	// klín primárneho posuvu (Patrik 2026-07-27) — display-only, do Money nejde
	let klinS = $state(false);
	let klinDlzkaS = $state<number | string>('');
	let klinSirkaS = $state<number | string>('');
	let klinV1S = $state<number | string>('');
	let klinV2S = $state<number | string>('');
	let klinKsS = $state<number | string>(1);
	// sieťka primárneho posuvu (#86–#90, KOREKCIA 2026-08-02) — rozmer sa už nezadáva
	let sietkaS = $state(false);
	let sietkaUchytS = $state<SietkaUchyt>('ziadny');
	// systém sieťky (#110) — prázdny reťazec = rovnaký ako posuv
	let sietkaSystemS = $state('');
	// ručné dĺžky koľajníc primárneho posuvu (Patrik 2026-07-28) — MENIA Money odpis
	let kolHS = $state<number | string>('');
	let kolSS = $state<number | string>('');
	let posuvyExtra = $state<PosuvRow[]>([]);
	$effect(() => {
		const zd = fv ?? fmv ?? null;
		zakS = zd?.zak ?? '';
		opS = zd?.op ?? '';
		zakaznikS = zd?.zakaznik ?? '';
		skloPresneS = fv?.skloPresne ?? '';
		vrtanieZamkuS = fv?.vrtanieZamku ?? 1050;
		poznamkaS = zd?.poznamka ?? '';
		ralS = zd?.ral ?? '';
		cakaS = zd?.caka ?? false;
		pridavnaKolajnicaS = zd?.pridavnaKolajnica ?? false;
		jednostrannaFabS = zd?.jednostrannaFab ?? false;
		// stará objednávka spred farby → '' → obsluha musí farbu znova zvoliť (#338)
		farbaKovaniaS = zd?.farbaKovania ?? '';
		const kl = (fv?.klin ?? null) as Klin | null;
		klinS = !!kl;
		klinDlzkaS = kl?.dlzka ?? '';
		klinSirkaS = kl?.sirka ?? '';
		klinV1S = kl?.v1 ?? '';
		klinV2S = kl?.v2 ?? '';
		klinKsS = kl?.ks ?? 1;
		const sk = (fv?.sietka ?? null) as Sietka | null;
		sietkaS = !!sk;
		sietkaUchytS = sk?.uchyt ?? 'ziadny';
		sietkaSystemS = sk?.system ?? '';
		const kolP = (prim()?.kolajnica ?? null) as { horna?: number; spodna?: number } | null;
		kolHS = kolP?.horna ?? '';
		kolSS = kolP?.spodna ?? '';
		const p = prim();
		// #132: zasej hranový tracker priamo z OBNOVENÝCH dát (nie z reaktívnych
		// system/styl/sklo, ktoré sa ustália až v neskorších efektoch) — inak by
		// hranový $effect nižšie po tomto obnovení videl zmenu a prepísal by
		// zd?.pridavnaKolajnica, ktorý sme práve nastavili vyššie ("Použiť znova"
		// sa NESMIE prepísať).
		pridavnaKolajnicaOdporucanaPrev = pridavnaKolajnicaDefault(
			p?.system ?? 'Robust',
			p?.styl ?? '2K',
			p?.sklo ?? ''
		);
		system = p?.system ?? 'Robust';
		styl = p?.styl ?? '2K';
		otvaranie = p?.otvaranie ?? 'P - L';
		kovanieLS = p?.kovanieL ?? '';
		kovaniePS = p?.kovanieP ?? '';
		kovanieStredS = p?.kovanieStred ?? '';
		kovanieStredOknoS = (p?.kovanieStredOkno ?? 'L') as 'L' | 'P';
		sirka = (p?.s as number | string) ?? '';
		vyska = (p?.v as number | string) ?? '';
		posuvyExtra = (fmv?.posuvy ?? []).slice(1).map((x) => ({
			...x,
			kovanieStred: x.kovanieStred ?? '',
			kovanieStredOkno: (x.kovanieStredOkno ?? 'L') as 'L' | 'P',
			klin: !!x.klin,
			klinDlzka: x.klin?.dlzka ?? '',
			klinSirka: x.klin?.sirka ?? '',
			klinV1: x.klin?.v1 ?? '',
			klinV2: x.klin?.v2 ?? '',
			klinKs: x.klin?.ks ?? 1,
			kolajnicaHorna: x.kolajnica?.horna ?? '',
			kolajnicaSpodna: x.kolajnica?.spodna ?? '',
			sietka: !!x.sietka,
			sietkaUchyt: x.sietka?.uchyt ?? 'ziadny',
			sietkaSystem: x.sietka?.system ?? ''
		}));
	});
	// 2x2K / 2x3K = opona (otváranie od stredu) → povoľ len „Opona" a nastav ju
	let jeOpona = $derived(styl.startsWith('2x'));
	let otvaraniaPre = $derived(otvaraniaForStyl(styl));
	$effect(() => {
		if (jeOpona) otvaranie = 'Opona';
		// otvaraniaPre je vždy neprázdne (['Opona'] alebo data.otvarania)
		else if (!otvaraniaPre.includes(otvaranie)) otvaranie = otvaraniaPre[0]!;
	});
	// kovanie je zatiaľ len robustové — pri inom systéme voľbu zahoď (aj v JSON-e
	// posuvov), nech sa na plán nedostane kovanie k systému, ktorý ho neponúka
	let jeRobust = $derived(system === 'Robust');
	// #88: sieťka nemá kľučku/FAB — kým je zapnutá, kovanie sa v ponuke skryje aj
	// vynuluje (namiesto neho sa ponúka úchyt v SietkaPolia)
	$effect(() => {
		if (!jeRobust || sietkaS) {
			kovanieLS = '';
			kovaniePS = '';
			kovanieStredS = '';
		}
	});
	// sieťka (#86–#90) sa ponúka na Robust/Slide/Štandard/Štandard + — pri inom
	// systéme zapínač zhoď. `sietkaSystemS` sa netrie automaticky pri každej zmene
	// systému posuvu — keď systém prestane mať výber (`maSietkaSystemVyber`), server
	// aj tak hodnotu zahodí (`sanitizeSietka`), takže netreba duplicitnú klientskú
	// logiku, ktorá by pri obnovení z histórie riskovala vymazať práve načítanú
	// hodnotu skôr, než sa stihne zobraziť.
	let maSietka = $derived(maSietkaSystem(system));
	$effect(() => {
		if (!maSietka) {
			sietkaS = false;
			sietkaUchytS = 'ziadny';
			sietkaSystemS = '';
		}
	});
	// strana sieťky podľa smeru posuvu (L-P → ľavá, P-L → pravá)
	let sietkaStranaVal = $derived(sietkaStrana(otvaranie));
	// ručná dĺžka koľajnice má zmysel len tam, kde je horná a spodná ZVLÁŠŤ
	// (Deluxe / Štandard + / Štandard); zoznam posiela server z konfigurácie
	const kolajnicaPre = (sys: string) => data.systemyKolajnica.includes(sys);
	// „Jednostranná FAB" checkbox má zmysel len tam, kde ho kovanie reálne používa
	// (položky s pravidlom `naUzaverPodlaFab` — dnes iba Robust); pri Deluxe/Slide/
	// Štandard nič nerobí, tak ho skryjeme (#431). FAB je vstup na úrovni objednávky
	// (ako `maFarbu` nižšie), takže stačí, aby ho potreboval HOCIKTORÝ posuv — inak by
	// mixed objednávka (primárny Deluxe + ďalší posuv Robust) o FAB pre Robust prišla.
	let maFab = $derived(
		[system, ...posuvyExtra.map((p) => p.system)].some((s) => (data.systemyFab ?? []).includes(s))
	);
	// keď žiadny posuv v hre nemá FAB položky, checkbox je skrytý — vynuluj hodnotu,
	// aby zaseknuté „1" (napr. z „Použiť znova" Robust objednávky) neostalo trčať v
	// skrytom stave (rovnaký vzor ako `maKolajnicu` nižšie). Money-bezpečné: bez FAB
	// položiek by hodnota aj tak nič nemenila.
	$effect(() => {
		if (!maFab) jednostrannaFabS = false;
	});
	// systém má RAL farebné varianty kovania → treba zvoliť farbu (#338). Farba je
	// spoločná pre celú objednávku, takže stačí, aby JU potreboval hociktorý posuv
	// (aj ďalší posuv zimnej záhrady s iným systémom než primárny).
	let maFarbu = $derived(
		[system, ...posuvyExtra.map((p) => p.system)].some((s) => (data.systemyFarba ?? []).includes(s))
	);
	// platné RAL možnosti pre RAL <select> (#354) — zjednotenie farieb naprieč systémami
	// v hre (rovnaká „hociktorý posuv" únia ako `maFarbu` vyššie), zo servera odvodených
	// per-systém množín (Deluxe R9006/R7016 ≠ Robust/Štandard R9005/R7016).
	let ralOptions = $derived.by(() => {
		const systemyVHre = [system, ...posuvyExtra.map((p) => p.system)];
		const zjednotene: Farba[] = [];
		for (const s of systemyVHre)
			for (const f of data.ralPreSystem?.[s] ?? []) if (!zjednotene.includes(f)) zjednotene.push(f);
		return zjednotene;
	});
	// zvolená farba, ktorá je pre AKTUÁLNU množinu neplatná (napr. R9005 z Robustu
	// po prepnutí na Deluxe, ktorý ponúka len R9006/R7016) sa zahodí — inak by
	// bola vidno v selecte prázdna, ale mohla by v `farbaKovaniaS` ostať trčať
	// neplatná hodnota (#354; do #354 všetky farebné systémy zdieľali JEDNU
	// množinu R9005/R7016, takže tento prípad dovtedy nemohol nastať).
	$effect(() => {
		if (farbaKovaniaS && !ralOptions.includes(farbaKovaniaS)) farbaKovaniaS = '';
	});
	let maKolajnicu = $derived(kolajnicaPre(system));
	$effect(() => {
		if (!maKolajnicu) {
			kolHS = '';
			kolSS = '';
		}
	});
	// Štandard +: povedz obsluhe, ktorý nárezák sklo práve vyberá (basic vs IZO)
	let narezakHint = $derived.by(() => {
		if (!skloVyberaIzo(system) || !sklo) return '';
		const styl2 = sysStylPre(system, styl, sklo, existuje).split('|')[1];
		return `Podľa skla sa ťahá nárezák ${system} ${styl2}.`;
	});
	let stylyPre = $derived(stylyForSystem(system));
	$effect(() => {
		if (!stylyPre.includes(styl)) styl = stylyPre[0]!; // stylyPre neprázdne pre platný systém
	});
	// sklá platné pre zvolený systém A ŠTÝL (jeho vlastné + spoločné ALL)
	let sklaPre = $derived(sklaForSystem(system, styl));
	$effect(() => {
		const zoznam = sklaPre;
		// už zvolené sklo si drž, kým je v ponuke (zmena počtu krídel nesmie
		// prepísať voľbu obsluhy); inak predvoľba = vždy ČÍRE, ak ho systém má
		const chcene = untrack(() => sklo) || prim()?.sklo;
		sklo = chcene && zoznam.includes(chcene) ? chcene : defaultSklo(zoznam, system);
	});

	// #132 (Patrik, Odoo 207 #1646652: „vždy dávame pri štandardoch IZO spodnú
	// koľaj navyše") — DEFAULT pre checkbox „Prídavná koľajnica", odvodený z
	// PRIMÁRNEHO posuvu (system/styl/sklo tu vždy nesú posuv 1 — rovnaký gate
	// ako viditeľnosť checkboxu nižšie, žiadna nová sémantika naprieč posuvmi).
	// HRANOVO spúšťané, nie „vždy keď true": $effect prepíše `pridavnaKolajnicaS`
	// LEN keď sa odporúčaná hodnota SKUTOČNE zmení (sklo prepnuté na/z IZO,
	// prípadne zmena systému/štýlu) — kým sa nemení, obsluhin ručný klik (v
	// hociktorom smere) ostáva nedotknutý, aj keď medzitým zmení iné pole
	// (rozmery, poznámku, RAL…). Prepnutie NA IZO teda vždy zaškrtne (nová
	// voľba skla = nová príležitosť na default), prepnutie PREČ z IZO vždy
	// odškrtne (nenechá zaškrtnutý checkbox bez platného IZO dôvodu — presne
	// ten „stays ticked after the reason disappears" bug, ktorému sa chceme
	// vyhnúť). `pridavnaKolajnicaOdporucanaPrev` sa zasieva aj v reštart-efekte
	// vyššie, aby „Použiť znova" nikdy neprepísalo obnovenú hodnotu.
	let pridavnaKolajnicaOdporucana = $derived(pridavnaKolajnicaDefault(system, styl, sklo));
	$effect(() => {
		const chce = pridavnaKolajnicaOdporucana;
		if (chce !== untrack(() => pridavnaKolajnicaOdporucanaPrev)) {
			pridavnaKolajnicaS = chce;
			pridavnaKolajnicaOdporucanaPrev = chce;
		}
	});

	// viac-posuvový režim: aktívny keď je pridaný aspoň jeden ďalší posuv
	let jeMulti = $derived(posuvyExtra.length > 0);
	// celý zoznam zasklení (primárny + ďalšie) → JSON pre multi submit
	let posuvyJSON = $derived(
		JSON.stringify([
			{
				system,
				styl,
				s: sirka,
				v: vyska,
				sklo,
				otvaranie,
				kovanieL: kovanieLS,
				kovanieP: kovaniePS,
				kovanieStred: kovanieStredS,
				kovanieStredOkno: kovanieStredOknoS,
				klin: klinS ? '1' : '',
				klinDlzka: klinDlzkaS,
				klinSirka: klinSirkaS,
				klinV1: klinV1S,
				klinV2: klinV2S,
				klinKs: klinKsS,
				kolajnicaHorna: kolHS,
				kolajnicaSpodna: kolSS,
				sietka: sietkaS ? '1' : '',
				sietkaUchyt: sietkaUchytS,
				sietkaSystem: sietkaSystemS
			},
			...posuvyExtra.map((p) => ({
				system: p.system,
				styl: p.styl,
				s: p.s,
				v: p.v,
				sklo: p.sklo,
				otvaranie: p.otvaranie,
				kovanieL: p.kovanieL,
				kovanieP: p.kovanieP,
				kovanieStred: p.kovanieStred,
				kovanieStredOkno: p.kovanieStredOkno,
				klin: p.klin ? '1' : '',
				klinDlzka: p.klinDlzka,
				klinSirka: p.klinSirka,
				klinV1: p.klinV1,
				klinV2: p.klinV2,
				klinKs: p.klinKs,
				kolajnicaHorna: p.kolajnicaHorna,
				kolajnicaSpodna: p.kolajnicaSpodna,
				sietka: p.sietka ? '1' : '',
				sietkaUchyt: p.sietkaUchyt,
				sietkaSystem: p.sietkaSystem
			}))
		])
	);
	// po zmene systému/štýlu ďalšieho posuvu daj do poriadku jeho štýl/sklo/otváranie
	function fixPosuv(i: number) {
		const p = posuvyExtra[i];
		if (!p) return; // i je vždy platný index do posuvyExtra — guard len pre typ
		const st = stylyForSystem(p.system);
		if (!st.includes(p.styl)) p.styl = st[0]!; // st neprázdne pre platný systém
		const sk = sklaForSystem(p.system, p.styl);
		if (!sk.includes(p.sklo)) p.sklo = defaultSklo(sk, p.system);
		const ot = otvaraniaForStyl(p.styl);
		if (!ot.includes(p.otvaranie)) p.otvaranie = ot[0]!; // ot vždy neprázdne
		if (p.system !== 'Robust') {
			p.kovanieL = '';
			p.kovanieP = '';
		}
		if (!kolajnicaPre(p.system)) {
			p.kolajnicaHorna = '';
			p.kolajnicaSpodna = '';
		}
		if (!maSietkaSystem(p.system)) {
			p.sietka = false;
			p.sietkaUchyt = 'ziadny';
			p.sietkaSystem = '';
		}
	}
	function addPosuv() {
		posuvyExtra = [
			...posuvyExtra,
			{
				system,
				styl,
				s: '',
				v: '',
				sklo,
				otvaranie,
				kovanieL: kovanieLS,
				kovanieP: kovaniePS,
				kovanieStred: '',
				kovanieStredOkno: 'L',
				klin: false,
				klinDlzka: '',
				klinSirka: '',
				klinV1: '',
				klinV2: '',
				klinKs: 1,
				kolajnicaHorna: '',
				kolajnicaSpodna: '',
				sietka: false,
				sietkaUchyt: 'ziadny',
				sietkaSystem: ''
			}
		];
		fixPosuv(posuvyExtra.length - 1);
	}
	function removePosuv(i: number) {
		posuvyExtra = posuvyExtra.filter((_, j) => j !== i);
	}

	let step = $derived(form?.step ?? 'form');
	let plan = $derived(form && 'plan' in form ? form.plan : null);
	let multi = $derived(form && 'multi' in form ? form.multi : null);
	let multiVstup = $derived(form?.multiVstup ?? null);

	// #461: vylúčené kódy z SkladVarovania — bindable, ide do hidden inputu vo formulári
	let vyluceneKodySingle = $state('');
	let vyluceneKodyMulti = $state('');

	// b2b HNEĎ pri zadávaní: šírka na sklo mimo limitu = blok (nedá sa vyrobiť),
	// výška nad limit = nezáväzné upozornenie. LEN pre b2b (interní bez obmedzení).
	// Server checkB2BWidth/checkB2BHeight ostáva (obrana do hĺbky). data.styly nesie N.
	// dimOrNull vracia rozmer LEN v medziach poľa [300, 20000] mm — kým b2b user
	// dopisuje šírku po číslici (3 → 30 → 300 → 3000), medzihodnoty pod 300 sa
	// nevyhodnocujú, takže neblikne falošný ⛔; natívna min/max validácia + server
	// stráženie odoslania platia ďalej.
	// POZN. (#216): toto 300 je ZÁMERNE b2b-scoped anti-flicker prah, NIE vstupný
	// floor — ten je teraz S_MIN=100 (viď $lib/zasklenia-navrh). b2b panel je vždy
	// ≥ 800 (checkB2BWidth), takže táto hodnota na b2b vetve nikdy neblokuje interné
	// malé okienka a nepatrí do „jediného zdroja pravdy" rozmerových medzí.
	const dimOrNull = (x: number | string): number | null => {
		const n = typeof x === 'number' ? x : parseFloat(String(x));
		return Number.isFinite(n) && n >= 300 && n <= 20000 ? n : null;
	};
	let b2bSirkaErr = $derived.by(() => {
		if (!isB2B) return null;
		const s = dimOrNull(sirka);
		return s === null
			? null
			: checkB2BWidth(data.styly, sysStylPre(system, styl, sklo, existuje), s);
	});
	let b2bVyskaWarn = $derived.by(() => {
		if (!isB2B) return null;
		const v = dimOrNull(vyska);
		return v === null ? null : checkB2BHeight(sysStylPre(system, styl, sklo, existuje), v);
	});
	let posuvB2bErrs = $derived(
		posuvyExtra.map((p) => {
			if (!isB2B) return null;
			const s = dimOrNull(p.s);
			return s === null
				? null
				: checkB2BWidth(data.styly, sysStylPre(p.system, p.styl, p.sklo, existuje), s);
		})
	);
	let posuvB2bWarns = $derived(
		posuvyExtra.map((p) => {
			if (!isB2B) return null;
			const v = dimOrNull(p.v);
			return v === null ? null : checkB2BHeight(sysStylPre(p.system, p.styl, p.sklo, existuje), v);
		})
	);
	// b2b nesmie spočítať pri šírkovej chybe (primárny alebo ktorýkoľvek posuv).
	let b2bBlok = $derived(isB2B && (b2bSirkaErr !== null || posuvB2bErrs.some((e) => e !== null)));
</script>

<svelte:head><title>Zasklenia — nárezový plán</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="system" value={vstup.system} />
	<input type="hidden" name="styl" value={vstup.styl} />
	<input type="hidden" name="s" value={vstup.s} />
	<input type="hidden" name="v" value={vstup.v} />
	<input type="hidden" name="sklo" value={vstup.sklo} />
	<input type="hidden" name="skloPresne" value={vstup.skloPresne} />
	<input type="hidden" name="otvaranie" value={vstup.otvaranie} />
	<input type="hidden" name="kovanieL" value={vstup.kovanieL} />
	<input type="hidden" name="kovanieP" value={vstup.kovanieP} />
	<input type="hidden" name="kovanieStred" value={vstup.kovanieStred} />
	<input type="hidden" name="kovanieStredOkno" value={vstup.kovanieStredOkno} />
	<input type="hidden" name="vrtanieZamku" value={vstup.vrtanieZamku} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	<input type="hidden" name="ral" value={vstup.ral} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
	{#if vstup.pridavnaKolajnica}<input type="hidden" name="pridavnaKolajnica" value="1" />{/if}
	{#if vstup.jednostrannaFab}<input type="hidden" name="jednostrannaFab" value="1" />{/if}
	{#if vstup.farbaKovania}<input
			type="hidden"
			name="farbaKovania"
			value={vstup.farbaKovania}
		/>{/if}
	{#if vstup.kolajnica?.horna}
		<input type="hidden" name="kolajnicaHorna" value={vstup.kolajnica.horna} />
	{/if}
	{#if vstup.kolajnica?.spodna}
		<input type="hidden" name="kolajnicaSpodna" value={vstup.kolajnica.spodna} />
	{/if}
	{#if vstup.klin}
		<input type="hidden" name="klin" value="1" />
		<input type="hidden" name="klinDlzka" value={vstup.klin.dlzka} />
		<input type="hidden" name="klinSirka" value={vstup.klin.sirka} />
		<input type="hidden" name="klinV1" value={vstup.klin.v1} />
		<input type="hidden" name="klinV2" value={vstup.klin.v2} />
		<input type="hidden" name="klinKs" value={vstup.klin.ks} />
	{/if}
	{#if vstup.sietka}
		<input type="hidden" name="sietka" value="1" />
		<input type="hidden" name="sietkaUchyt" value={vstup.sietka.uchyt} />
		{#if vstup.sietka.system}
			<input type="hidden" name="sietkaSystem" value={vstup.sietka.system} />
		{/if}
	{/if}
{/snippet}

{#snippet hiddenMulti()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	<input type="hidden" name="ral" value={vstup.ral} />
	<input type="hidden" name="posuvy" value={JSON.stringify(multiVstup?.posuvy ?? [])} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
	{#if vstup.pridavnaKolajnica}<input type="hidden" name="pridavnaKolajnica" value="1" />{/if}
	{#if vstup.jednostrannaFab}<input type="hidden" name="jednostrannaFab" value="1" />{/if}
	{#if vstup.farbaKovania}<input
			type="hidden"
			name="farbaKovania"
			value={vstup.farbaKovania}
		/>{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<OdpisNavrhNav modul="zasklenia" active="odpis" b2b={isB2B} />
	</div>
	<div class="card">
		<h1>Zasklenia — nárezový plán</h1>
		<p class="sub">
			Zadaj rozmery, ukážem nárezový plán s náhľadom.
			{#if !isB2B}Odpis sa do Money odošle až po tvojom potvrdení.{/if}
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
	</div>

	{#if data.znova && !form}
		<!-- „Použiť znova": nič sa neodpísalo, len sa predvyplnil formulár. ZAK/OP/zákazník
		     ostávajú prázdne — práve tie sa pri novej zákazke menia. -->
		<div class="okmsg" data-testid="znova-info">
			♻️ Predvyplnené zo zákazky <b>{data.znova.zdroj.zak}</b> (OP {data.znova.zdroj.op},
			{data.znova.zdroj.created_at}). Doplň nové číslo objednávky, OP a zákazníka — do Money sa
			zatiaľ neposlalo nič.
			{#if data.znova.chybajuce.length}
				<ul style="margin:8px 0 0 18px">
					{#each data.znova.chybajuce as ch (ch)}<li>{ch}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<ZasklieniaForm
		systemy={data.systemy}
		kovania={data.kovania}
		bind:zakS
		bind:opS
		bind:zakaznikS
		bind:system
		bind:styl
		bind:sklo
		bind:otvaranie
		bind:sirka
		bind:vyska
		bind:kovanieLS
		bind:kovaniePS
		bind:kovanieStredS
		bind:kovanieStredOknoS
		bind:vrtanieZamkuS
		bind:skloPresneS
		bind:poznamkaS
		bind:ralS
		bind:cakaS
		bind:pridavnaKolajnicaS
		bind:jednostrannaFabS
		bind:farbaKovaniaS
		bind:kolHS
		bind:kolSS
		bind:klinS
		bind:klinDlzkaS
		bind:klinSirkaS
		bind:klinV1S
		bind:klinV2S
		bind:klinKsS
		bind:sietkaS
		bind:sietkaUchytS
		bind:sietkaSystemS
		bind:posuvyExtra
		{stylyPre}
		{sklaPre}
		{otvaraniaPre}
		{b2bSirkaErr}
		{b2bVyskaWarn}
		{narezakHint}
		{jeOpona}
		{jeRobust}
		{maFab}
		{maFarbu}
		{ralOptions}
		{maKolajnicu}
		{maSietka}
		{sietkaStranaVal}
		{posuvB2bErrs}
		{posuvB2bWarns}
		{posuvyJSON}
		{jeMulti}
		{b2bBlok}
		{stylyForSystem}
		{sklaForSystem}
		{otvaraniaForStyl}
		{kolajnicaPre}
		{addPosuv}
		{removePosuv}
		{fixPosuv}
	/>
{:else if step === 'nahlad' && plan}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="plan-badge"
				>Zasklenia · {nazovSystemu(plan.system)} {plan.styl} · {vstup.otvaranie}</span
			>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
			{#if form?.vytvorene}
				<span class="vytvorene" data-testid="vytvorene">🕓 {formatDatumCasSk(form.vytvorene)}</span>
			{/if}
		</p>
	</div>

	{#if form?.warn}
		<div class="warn" data-testid="plan-warn">⚠️ {form.warn}</div>
	{/if}

	{#if form?.heightWarn}
		<div class="warn-zaruka" data-testid="height-warn">{form.heightWarn}</div>
	{/if}

	<PlanKarty {plan} {vstup} kovanie={form?.kovanie} ceny={form?.ceny} skloCeny={form?.skloCeny} />

	<!-- #448/#451: predodpisové skladové varovanie + odobrať (LEN interní; b2b server []) -->
	<SkladVarovania
		varovania={form?.skladVarovania}
		snapshotDatum={form?.snapshotDatum}
		bind:vyluceneKody={vyluceneKodySingle}
	/>

	<div class="card noprint">
		{#if !isB2B}
			<form method="POST" action="?/odoslat">
				{@render hiddenVstup()}
				<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
				<input type="hidden" name="vylucene_kody" value={vyluceneKodySingle} />
				<button class="btn" type="submit" data-testid="odoslat">
					{data.live
						? vstup.caka
							? '⏳ Odoslať odpis (odloží sa do NA ODPIS)'
							: '✅ Odoslať odpis do Money'
						: '🧪 Odoslať odpis (TEST priečinok)'}
				</button>
			</form>
		{/if}
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hiddenVstup()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
	</div>
{:else if step === 'hotovo' && plan && form?.outcome}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="plan-badge"
				>Zasklenia · {nazovSystemu(plan.system)} {plan.styl} · {vstup.otvaranie}</span
			>
			{#if form?.vytvorene}
				<span class="vytvorene" data-testid="vytvorene">🕓 {formatDatumCasSk(form.vytvorene)}</span>
			{/if}
		</p>
	</div>

	<div class="okmsg noprint" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS, presuň do dlv
			keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	<PlanKarty {plan} {vstup} kovanie={form?.kovanie} ceny={form?.ceny} skloCeny={form?.skloCeny} />

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/zasklenia')}>➕ Nový nárezový plán</a>
	</div>
{:else if step === 'nahladMulti' && multi}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="plan-badge">{popisMulti(multi.posuvy)}</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
			{#if form?.vytvorene}
				<span class="vytvorene" data-testid="vytvorene">🕓 {formatDatumCasSk(form.vytvorene)}</span>
			{/if}
		</p>
	</div>

	{#if form?.warn}<div class="warn" data-testid="plan-warn">⚠️ {form.warn}</div>{/if}
	{#if form?.heightWarn}
		<div class="warn-zaruka" data-testid="height-warn">{form.heightWarn}</div>
	{/if}

	<PlanKartyMulti
		{multi}
		{vstup}
		kovanie={form?.kovanie}
		ceny={form?.ceny}
		skloCeny={form?.skloCeny}
	/>

	<!-- #448/#451: predodpisové skladové varovanie + odobrať (LEN interní; b2b server []) -->
	<SkladVarovania
		varovania={form?.skladVarovania}
		snapshotDatum={form?.snapshotDatum}
		bind:vyluceneKody={vyluceneKodyMulti}
	/>

	<div class="card noprint">
		{#if !isB2B}
			<form method="POST" action="?/odoslatMulti">
				{@render hiddenMulti()}
				<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
				<input type="hidden" name="vylucene_kody" value={vyluceneKodyMulti} />
				<button class="btn" type="submit" data-testid="odoslat-multi">
					{data.live
						? vstup.caka
							? '⏳ Odoslať odpis (odloží sa do NA ODPIS)'
							: '✅ Odoslať odpis do Money'
						: '🧪 Odoslať odpis (TEST priečinok)'}
				</button>
			</form>
		{/if}
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravitMulti" style="display:inline">
			{@render hiddenMulti()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
	</div>
{:else if step === 'hotovoMulti' && multi && form?.outcome}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="plan-badge">{popisMulti(multi.posuvy)}</span>
			{#if form?.vytvorene}
				<span class="vytvorene" data-testid="vytvorene">🕓 {formatDatumCasSk(form.vytvorene)}</span>
			{/if}
		</p>
	</div>

	<div class="okmsg noprint" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	<PlanKartyMulti
		{multi}
		{vstup}
		kovanie={form?.kovanie}
		ceny={form?.ceny}
		skloCeny={form?.skloCeny}
	/>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/zasklenia')}>➕ Nový nárezový plán</a>
	</div>
{:else if step === 'blocked' && form && 'rawEntries' in form && form.rawEntries}
	<OdpisBlok
		rawEntries={form.rawEntries}
		blokReason={form.blokReason}
		blokAction={form.blokAction}
		error={form.error ?? ''}
	/>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href={resolve('/zasklenia')}>← Späť na formulár</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}
