<script lang="ts">
	import { untrack } from 'svelte';
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import { checkB2BWidth, checkB2BHeight } from '$lib/b2b-limits';
	import { defaultSklo, fmtSkloRozmer } from '$lib/sklo';
	import {
		stylyDoPonuky,
		sklaDoPonuky,
		sysStylPre,
		skloVyberaIzo,
		pridavnaKolajnicaDefault,
		standardPlusRailEligible
	} from '$lib/styl';
	import { popisMulti, posuvySlovom } from '$lib/popis';
	import { nazovSystemu } from '$lib/system-nazvy';
	import { popisRucnejKolajnice, KOLAJNICA_MAX, KOLAJNICA_MIN } from '$lib/kolajnica';
	import { klinPopis, type Klin } from '$lib/klin';
	import KlinPolia from '$lib/components/KlinPolia.svelte';
	import {
		sietkaPopis,
		maSietkaSystem,
		maSietkaSystemVyber,
		sietkaStrana,
		potrebuje3KKolajnicu,
		popis3KKolajnicaVymena,
		pridavnaKolajnicaHint,
		rozmerSietovinyPre,
		uchytLabel,
		type Sietka,
		type SietkaUchyt
	} from '$lib/sietka';
	import SietkaPolia from '$lib/components/SietkaPolia.svelte';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	import { resolve } from '$app/paths';
	import { formatDatumCasSk } from '$lib/datum';

	let { data, form } = $props();

	// b2b nesmie odpisovať do Money — server to aj tak odmietne (defense in depth),
	// tu skrývame odoslat/odoslatMulti UI, aby to b2b účet ani neskúšal
	const isB2B = $derived(data.user?.role === 'b2b');

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

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
	// vyberá kladka/klzný profil; Štandard +: Float 4/6/10 + Izolačné 4.8.4);
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

	type PosuvRow = {
		system: string;
		styl: string;
		s: number | string;
		v: number | string;
		sklo: string;
		otvaranie: string;
		kovanieL: string;
		kovanieP: string;
		kovanieStred: string;
		kovanieStredOkno: 'L' | 'P';
		// klín TOHOTO posuvu — ploché polia (rovnaký tvar ako primárny posuv), do
		// JSON-u idú tak, ako ich parsuje server (klin='1' + 4 rozmery + ks)
		klin: boolean;
		klinDlzka: number | string;
		klinSirka: number | string;
		klinV1: number | string;
		klinV2: number | string;
		klinKs: number | string;
		// ručné dĺžky koľajníc TOHOTO posuvu — prázdne = počítaj zo šírky (mení odpis)
		kolajnicaHorna: number | string;
		kolajnicaSpodna: number | string;
		// sieťka TOHOTO posuvu (#86–#90, KOREKCIA 2026-08-02) — rozmer sa už nezadáva
		sietka: boolean;
		sietkaUchyt: SietkaUchyt;
		// systém sieťky (#110) — prázdny reťazec = rovnaký ako posuv tohto riadku
		sietkaSystem: string;
	};

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
		else if (!otvaraniaPre.includes(otvaranie)) otvaranie = otvaraniaPre[0];
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
	// kovanie do Money má zatiaľ len Robust (Slide čaká na skladové zásoby v Money)
	let maKovanie = $derived(data.systemyKovanie.includes(system));
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
		if (!stylyPre.includes(styl)) styl = stylyPre[0];
	});
	// sklá platné pre zvolený systém A ŠTÝL (jeho vlastné + spoločné ALL)
	let sklaPre = $derived(sklaForSystem(system, styl));
	$effect(() => {
		const zoznam = sklaPre;
		// už zvolené sklo si drž, kým je v ponuke (zmena počtu krídel nesmie
		// prepísať voľbu obsluhy); inak predvoľba = vždy ČÍRE, ak ho systém má
		const chcene = untrack(() => sklo) || prim()?.sklo;
		sklo = chcene && zoznam.includes(chcene) ? chcene : defaultSklo(zoznam);
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
	// celý zoznam posuvov (primárny + ďalšie) → JSON pre multi submit
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
		const st = stylyForSystem(p.system);
		if (!st.includes(p.styl)) p.styl = st[0];
		const sk = sklaForSystem(p.system, p.styl);
		if (!sk.includes(p.sklo)) p.sklo = defaultSklo(sk);
		const ot = otvaraniaForStyl(p.styl);
		if (!ot.includes(p.otvaranie)) p.otvaranie = ot[0];
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

	// b2b HNEĎ pri zadávaní: šírka na sklo mimo limitu = blok (nedá sa vyrobiť),
	// výška nad limit = nezáväzné upozornenie. LEN pre b2b (interní bez obmedzení).
	// Server checkB2BWidth/checkB2BHeight ostáva (obrana do hĺbky). data.styly nesie N.
	// dimOrNull vracia rozmer LEN v medziach poľa [300, 20000] mm — kým b2b user
	// dopisuje šírku po číslici (3 → 30 → 300 → 3000), medzihodnoty pod 300 sa
	// nevyhodnocujú, takže neblikne falošný ⛔; natívna min/max validácia + server
	// stráženie odoslania platia ďalej.
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

<!-- Poznámka (viacriadková, vľavo) + RAL (veľkým, vpravo) na nárezovom pláne aj
     v tlači. Zdieľané pre jedno- aj viac-posuvový plán. Display-only — do Money
     odpisu (.xlsx) NEJDE ani poznámka, ani RAL. -->
{#snippet poznamkaRal()}
	{#if vstup.poznamka || vstup.ral}
		<div class="card poznamka-ral" data-testid="poznamka-ral">
			{#if vstup.poznamka}
				<div class="pr-note">
					<div class="sec">Poznámka</div>
					<div class="poznamka-plan">{vstup.poznamka}</div>
				</div>
			{/if}
			{#if vstup.ral}
				<div class="pr-ral">
					<div class="sec">RAL</div>
					<div class="ral-val" data-testid="ral-val">{vstup.ral}</div>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet kovanieStrany(
	nadpis: string,
	lava: string,
	prava: string,
	stred = '',
	stredOkno: 'L' | 'P' = 'L'
)}
	<div class="kov-posuv">
		<div class="kov-hd">{nadpis}</div>
		<div class="row"><span>ľavá strana</span><b>{lava || '—'}</b></div>
		<div class="row"><span>pravá strana</span><b>{prava || '—'}</b></div>
		{#if stred}
			<div class="row">
				<span>stredové okno ({stredOkno === 'P' ? 'pravé' : 'ľavé'})</span><b>{stred}</b>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet planKarty(p: NonNullable<typeof plan>)}
	{@render poznamkaRal()}
	<div class="card">
		<div class="sec">Rozmery</div>
		<div class="g">
			<div><span>Šírka</span><b>{p.S} mm</b></div>
			<div><span>Výška</span><b>{p.V} mm</b></div>
			<div><span>Plocha</span><b>{fmtM(p.m2)} m²</b></div>
			{#if vstup.kolajnica?.horna}
				<div>
					<span>Koľajnica horná (ručne)</span>
					<b data-testid="kolajnica-horna">{vstup.kolajnica.horna} mm</b>
				</div>
			{/if}
			{#if vstup.kolajnica?.spodna}
				<div>
					<span>Koľajnica spodná (ručne)</span>
					<b data-testid="kolajnica-spodna">{vstup.kolajnica.spodna} mm</b>
				</div>
			{/if}
		</div>
	</div>

	<div class="card">
		<div class="sec">Náhľad</div>
		<Nahlad2D
			S={p.S}
			V={p.V}
			N={p.N}
			skloS={p.sklo.sirka}
			skloV={p.sklo.vyska}
			otvaranie={vstup.otvaranie}
			system={p.system}
			vrtanieZamku={vstup.vrtanieZamku}
			kovanieL={vstup.kovanieL}
			kovanieP={vstup.kovanieP}
			kovanieStred={vstup.kovanieStred}
			kovanieStredOkno={vstup.kovanieStredOkno}
			klin={vstup.klin}
			sietka={vstup.sietka}
		/>
	</div>

	{#if vstup.kovanieL || vstup.kovanieP || vstup.kovanieStred}
		<div class="card" data-testid="kovanie-strany">
			<div class="sec">Kovanie — kľučky a FAB</div>
			{@render kovanieStrany(
				'Posuv 1',
				vstup.kovanieL,
				vstup.kovanieP,
				vstup.kovanieStred,
				vstup.kovanieStredOkno
			)}
		</div>
	{/if}

	{#if vstup.klin}
		<div class="card" data-testid="klin-karta">
			<div class="sec">Klín</div>
			<div class="g">
				<div><span>Dĺžka</span><b data-testid="klin-dlzka">{vstup.klin.dlzka} mm</b></div>
				<div><span>Šírka (hĺbka)</span><b>{vstup.klin.sirka} mm</b></div>
				<div><span>Výška 1</span><b>{vstup.klin.v1} mm</b></div>
				<div><span>Výška 2</span><b>{vstup.klin.v2} mm</b></div>
				<div><span>Počet</span><b>{vstup.klin.ks} ks</b></div>
			</div>
		</div>
	{/if}

	{#if vstup.sietka}
		{@const rozmer = rozmerSietovinyPre(p.system, p.sklo.sirka, p.sklo.vyska)}
		{@const sietkaSystemVal = vstup.sietka.system ?? p.system}
		{@const pridavnaHint = pridavnaKolajnicaHint(
			p.system,
			vstup.styl,
			true,
			vstup.pridavnaKolajnica
		)}
		<div class="card" data-testid="sietka-karta">
			<div class="sec">Sieťka — v Money odpise</div>
			<div class="g">
				<div>
					<span>Strana</span><b data-testid="sietka-strana"
						>{sietkaStrana(vstup.otvaranie) ?? '—'}</b
					>
				</div>
				{#if maSietkaSystemVyber(p.system)}
					<div>
						<span>Systém sieťky</span><b data-testid="sietka-system">{sietkaSystemVal}</b>
					</div>
				{/if}
				<div>
					<span>Rozmer sieťoviny (objednávka u dodávateľa)</span><b data-testid="sietka-rozmer"
						>{fmtM(rozmer.sirka)} × {fmtM(rozmer.vyska)} mm</b
					>
				</div>
				<div><span>Úchyt</span><b>{uchytLabel(vstup.sietka.uchyt)}</b></div>
				<div>
					<span>Profily navyše</span><b
						>{maSietkaSystemVyber(p.system)
							? '+2 šírka prírezov + 1 krajová + 1 nos + 1 dorazová'
							: p.system === 'Slide'
								? '+2 rámové rezy (S aj V) + 1 nosový rez + redukcia pre sieťku'
								: '+2 rámové rezy (S aj V) + 1 nosový rez'}</b
					>
				</div>
				<div><span>Joklík</span><b>bez skladovej karty — nájde dielňa, neodpisuje sa</b></div>
			</div>
			{#if potrebuje3KKolajnicu(vstup.styl)}
				<p class="sub" data-testid="sietka-2k-warn-karta">
					⚠ 2K systém — appka automaticky odpíše {popis3KKolajnicaVymena(p.system)}.
				</p>
			{/if}
			{#if pridavnaHint}
				<p class="sub" data-testid="pridavna-v-sietke-karta">
					ℹ {pridavnaHint}
				</p>
			{/if}
		</div>
	{/if}

	<div class="card">
		<div class="sec">Sklo (mm)</div>
		<div class="g">
			<div><span>Šírka</span><b data-testid="sklo-sirka">{fmtM(p.sklo.sirka)}</b></div>
			<div><span>Výška</span><b data-testid="sklo-vyska">{fmtM(p.sklo.vyska)}</b></div>
			<div><span>Počet</span><b>{p.sklo.pocet} ks</b></div>
			<div><span>Typ</span><b style="font-size:13px">{vstup.skloPresne || vstup.sklo}</b></div>
			<div>
				<span>Rozmer (na objednávku skla)</span><b data-testid="sklo-rozmer"
					>{fmtSkloRozmer(p.sklo.sirka, p.sklo.vyska)}</b
				>
			</div>
		</div>
	</div>

	<div class="card">
		<div class="sec">Zoznam materiálu — profily</div>
		<table data-testid="material-tabulka">
			<thead
				><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead
			>
			<tbody>
				{#each p.material as m (m.kod)}
					<tr>
						<td style="width:52px"><ProfilObrazok kod={m.kod} nazov={m.nazov} /></td>
						<td>{m.nazov}</td>
						<td class="c">{m.kod}</td>
						<td
							>{m.rezy
								.filter((x) => x.ks > 0)
								.map((x) => `${x.ks}×${x.rozmer} mm`)
								.join(' + ') || '—'}</td
						>
						<td class="c"><b>{m.tyce}</b></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<div class="sec">Odpis (do Money)</div>
		{#each p.odpis.filter((o) => o.metre > 0) as o (o.kod)}
			<div class="row"><span>{o.kod} · {o.nazov}</span><b>{fmtM(o.metre)} m</b></div>
		{/each}
	</div>

	{#if form?.kovanie?.length}
		<div class="card" data-testid="kovanie-karta">
			<div class="sec">Kovanie a tesnenia (do Money)</div>
			{#each form.kovanie as k (k.kod)}
				<div class="row">
					<span>{k.kod} · {k.nazov}</span><b>{k.mj === 'ks' ? k.qty : fmtM(k.qty)} {k.mj}</b>
				</div>
			{/each}
		</div>
	{/if}

	<!-- cenový zoznam materiálu (#154, fáza 1) — LEN pre interných; b2b nikdy nedostane
	     `form.ceny` (viď cenyPre v +page.server.ts), takže sa im tento blok vôbec nevykreslí -->
	{#if form?.ceny}
		<CenyTabulka ceny={form.ceny} />
	{/if}

	<div class="card">
		<div class="sec">Rozpis rezov na tyče — pre pílu</div>
		<p class="sub" style="margin-bottom:14px">
			Každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci (dĺžka tyče je pri
			každom profile — Deluxe má kratšie: kladka/klzný 3600, 5K horná 6000 mm).
		</p>
		<RozpisRezov material={p.material} />
	</div>
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
{/snippet}

{#snippet planKartyMulti(m: NonNullable<typeof multi>)}
	{@render poznamkaRal()}
	<div class="card">
		<div class="sec">Posuvy ({m.posuvy.length}) — spolu {fmtM(m.m2)} m²</div>
		<table>
			<thead
				><tr><th></th><th>Systém</th><th>Rozmer</th><th>Sklo (mm)</th><th>Otváranie</th></tr></thead
			>
			<tbody>
				{#each m.posuvy as pv, i (i)}
					<tr>
						<td class="c"><b>Posuv {i + 1}</b></td>
						<td>{nazovSystemu(pv.system)} {pv.styl}</td>
						<td
							>{pv.S} × {pv.V} mm{#if popisRucnejKolajnice(pv.kolajnica)}<span
									class="kol-rucne"
									data-testid={`kolajnica-rucne-${i}`}>{popisRucnejKolajnice(pv.kolajnica)}</span
								>{/if}</td
						>
						<!-- oddeľovač je v BUNKE ako výraz — `{#if} · {/if}` by o medzeru pred
						     bodkou prišlo pri kompilácii (zachytil e2e: „2115mm· Izolačné") -->
						<td data-testid={`posuv-sklo-${i}`}
							>{fmtSkloRozmer(pv.sklo.sirka, pv.sklo.vyska) +
								(pv.skloNazov ? ` · ${pv.skloNazov}` : '')}</td
						>
						<td>{pv.otvaranie ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<div class="sec">Náhľady posuvov</div>
		<div class="posuv-nahlady">
			{#each m.posuvy as pv, i (i)}
				<div class="posuv-nahlad">
					<div class="posuv-nahlad-hd">Posuv {i + 1}</div>
					<Nahlad2D
						S={pv.S}
						V={pv.V}
						N={pv.N}
						skloS={pv.sklo.sirka}
						skloV={pv.sklo.vyska}
						otvaranie={pv.otvaranie ?? 'Opona'}
						system={pv.system}
						kovanieL={pv.kovanieL ?? ''}
						kovanieP={pv.kovanieP ?? ''}
						kovanieStred={pv.kovanieStred ?? ''}
						kovanieStredOkno={(pv.kovanieStredOkno ?? 'L') as 'L' | 'P'}
						klin={pv.klin ?? null}
						sietka={pv.sietka ?? null}
					/>
				</div>
			{/each}
		</div>
	</div>

	<!-- Patrik 2026-07-31 (Odoo „Vyroba automatizacia"): „pri posuve Robust by som
	     potreboval tie kľučky fabky vypísať niekam rozumnejšie, zle je to vidieť —
	     kľudne aj pod tie posuvy". V kresbe sú ďalej, toto je čitateľný výpis. -->
	{#if m.posuvy.some((pv) => pv.kovanieL || pv.kovanieP || pv.kovanieStred)}
		<div class="card" data-testid="kovanie-strany-multi">
			<div class="sec">Kovanie — kľučky a FAB</div>
			{#each m.posuvy as pv, i (i)}
				{#if pv.kovanieL || pv.kovanieP || pv.kovanieStred}
					{@render kovanieStrany(
						`Posuv ${i + 1}`,
						pv.kovanieL ?? '',
						pv.kovanieP ?? '',
						pv.kovanieStred ?? '',
						(pv.kovanieStredOkno ?? 'L') as 'L' | 'P'
					)}
				{/if}
			{/each}
		</div>
	{/if}

	{#if m.posuvy.some((pv) => pv.klin)}
		<div class="card" data-testid="klin-karta-multi">
			<div class="sec">Klíny</div>
			{#each m.posuvy as pv, i (i)}
				{#if pv.klin}
					<div class="row"><span>Posuv {i + 1}</span><b>{klinPopis(pv.klin)}</b></div>
				{/if}
			{/each}
		</div>
	{/if}

	{#if m.posuvy.some((pv) => pv.sietka)}
		<div class="card" data-testid="sietka-karta-multi">
			<div class="sec">Sieťky — v Money odpise</div>
			{#each m.posuvy as pv, i (i)}
				{#if pv.sietka}
					{@const rozmer = rozmerSietovinyPre(pv.system, pv.sklo.sirka, pv.sklo.vyska)}
					{@const pridavnaHint = pridavnaKolajnicaHint(
						pv.system,
						pv.styl,
						true,
						vstup.pridavnaKolajnica
					)}
					<div class="row">
						<span
							>Posuv {i + 1}{#if sietkaStrana(pv.otvaranie ?? '')}
								· strana {sietkaStrana(pv.otvaranie ?? '')}{/if}</span
						><b>{sietkaPopis(pv.sietka, rozmer)}</b>
					</div>
					{#if potrebuje3KKolajnicu(pv.styl)}
						<p class="sub" data-testid={`sietka-2k-warn-multi-${i}`}>
							⚠ Posuv {i + 1}: 2K systém — appka automaticky odpíše {popis3KKolajnicaVymena(
								pv.system
							)}.
						</p>
					{/if}
					{#if pridavnaHint}
						<p class="sub" data-testid={`pridavna-v-sietke-multi-${i}`}>
							ℹ Posuv {i + 1}: {pridavnaHint}
						</p>
					{/if}
				{/if}
			{/each}
		</div>
	{/if}

	<div class="card">
		<div class="sec">Zoznam materiálu — spoločný (naprieč posuvmi)</div>
		<table data-testid="material-tabulka">
			<thead
				><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead
			>
			<tbody>
				{#each m.material as mt (mt.kod)}
					<tr>
						<td style="width:52px"><ProfilObrazok kod={mt.kod} nazov={mt.nazov} /></td>
						<td>{mt.nazov}</td>
						<td class="c">{mt.kod}</td>
						<td
							>{mt.rezy
								.filter((x) => x.ks > 0)
								.map((x) => `${x.ks}×${x.rozmer} mm`)
								.join(' + ') || '—'}</td
						>
						<td class="c"><b>{mt.tyce}</b></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<div class="sec">Odpis (do Money) — spoločný za celú zákazku</div>
		{#each m.odpis.filter((o) => o.metre > 0) as o (o.kod)}
			<div class="row"><span>{o.kod} · {o.nazov}</span><b>{fmtM(o.metre)} m</b></div>
		{/each}
	</div>

	{#if form?.kovanie?.length}
		<div class="card" data-testid="kovanie-karta">
			<div class="sec">Kovanie a tesnenia (do Money)</div>
			{#each form.kovanie as k (k.kod)}
				<div class="row">
					<span>{k.kod} · {k.nazov}</span><b>{k.mj === 'ks' ? k.qty : fmtM(k.qty)} {k.mj}</b>
				</div>
			{/each}
		</div>
	{/if}

	<!-- cenový zoznam materiálu (#154, fáza 1) — LEN pre interných, viď planKarty vyššie -->
	{#if form?.ceny}
		<CenyTabulka ceny={form.ceny} />
	{/if}

	<div class="card">
		<div class="sec">Rozpis rezov na tyče — pre pílu (posuvy zdieľajú tyče)</div>
		<p class="sub" style="margin-bottom:14px">
			Rezy z rôznych posuvov sú v jednej tyči — pri každom reze je číslo posuvu (P1/P2/…).
		</p>
		<RozpisRezov material={m.material} viacPosuvov={true} />
	</div>
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Zasklenia — nárezový plán</h1>
		<p class="sub">
			Zadaj rozmery, ukážem nárezový plán s náhľadom.
			{#if !isB2B}Odpis sa do Money odošle až po tvojom potvrdení.{/if}
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
		<p class="sub">
			📐 Potrebuješ zákaznícky návrhový výkres namiesto nárezového plánu?
			<a href={resolve('/zasklenia/navrh')} data-testid="link-navrh">→ Návrhový výkres</a>
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

	<div class="card">
		<form method="POST" action="?/nahlad">
			<div class="grid3">
				<div class="field">
					<label for="zak">Číslo objednávky (ZAK) *</label>
					<input id="zak" name="zak" bind:value={zakS} required />
				</div>
				<div class="field">
					<label for="op">OP/OPDL číslo *</label>
					<input id="op" name="op" bind:value={opS} required />
				</div>
				<div class="field">
					<label for="zakaznik">Zákazník *</label>
					<input id="zakaznik" name="zakaznik" bind:value={zakaznikS} required />
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="system">Systém</label>
					<select id="system" name="system" bind:value={system}>
						{#each data.systemy as sys (sys)}<option value={sys}>{nazovSystemu(sys)}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="styl">Štýl</label>
					<select id="styl" name="styl" bind:value={styl}>
						{#each stylyPre as st (st)}<option>{st}</option>{/each}
					</select>
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="s">Šírka (mm) *</label>
					<input
						id="s"
						name="s"
						type="number"
						min="300"
						max="20000"
						step="any"
						bind:value={sirka}
						required
					/>{#if b2bSirkaErr}<span class="b2b-blok" data-testid="b2b-sirka-err">
							⛔ {b2bSirkaErr}</span
						>{/if}
				</div>
				<div class="field">
					<label for="v">Výška (mm) *</label>
					<input
						id="v"
						name="v"
						type="number"
						min="300"
						max="20000"
						step="any"
						bind:value={vyska}
						required
					/>{#if b2bVyskaWarn}<span class="b2b-upoz" data-testid="b2b-vyska-warn">
							{b2bVyskaWarn}</span
						>{/if}
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="sklo">Sklo (základ — určuje vzorec)</label>
					<select id="sklo" name="sklo" bind:value={sklo}>
						{#each sklaPre as g (g)}<option>{g}</option>{/each}
					</select>
					{#if narezakHint}<span class="hint" data-testid="narezak-hint">{narezakHint}</span>{/if}
				</div>
				<div class="field">
					<label for="otvaranie">Otváranie</label>
					<select id="otvaranie" name="otvaranie" bind:value={otvaranie}>
						{#each otvaraniaPre as o (o)}<option>{o}</option>{/each}
					</select>
					{#if jeOpona}<span class="hint">Pri 2× štýle je otváranie vždy opona (od stredu).</span
						>{/if}
				</div>
			</div>
			<!-- Kovanie (kľučka) — LEN Robust; ľavá aj pravá strana zvlášť, pri každom
			     posuve sólo. Display-only: plán/náhľad + detail v histórii, Money NIE.
			     #88: pri sieťke sa kľučka NEPONÚKA (namiesto nej úchyt v SietkaPolia). -->
			{#if jeRobust && !sietkaS}
				<div class="grid2">
					<div class="field">
						<label for="kovanieL">Kovanie — ľavá strana</label>
						<select id="kovanieL" name="kovanieL" bind:value={kovanieLS}>
							<option value="">—</option>
							{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for="kovanieP">Kovanie — pravá strana</label>
						<select id="kovanieP" name="kovanieP" bind:value={kovaniePS}>
							<option value="">—</option>
							{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
						</select>
					</div>
				</div>
				<!-- Opona má kľučku NAVYŠE na jednom z dvoch krídel v strede (Patrik
				     2026-07-31: „ak máme 2x3, kľučka bude okno 1, okno 6 a potom buď
				     okno 3 alebo 4"). Money sa tým nemení — opony majú 3 uzávery
				     (a teda 3 kľučky) v tabuľke komponentov už teraz. -->
				{#if jeOpona}
					<div class="grid2" data-testid="kovanie-stred-polia">
						<div class="field">
							<label for="kovanieStred">Kovanie — stredové okno</label>
							<select id="kovanieStred" name="kovanieStred" bind:value={kovanieStredS}>
								<option value="">—</option>
								{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
							</select>
						</div>
						<div class="field">
							<label for="kovanieStredOkno">Ktoré okno v strede</label>
							<select id="kovanieStredOkno" name="kovanieStredOkno" bind:value={kovanieStredOknoS}>
								<option value="L">ľavé zo stredovej dvojice</option>
								<option value="P">pravé zo stredovej dvojice</option>
							</select>
						</div>
					</div>
				{/if}
			{/if}
			{#if system === 'Deluxe'}
				<div class="field">
					<label for="vrtanieZamku">Výška vŕtania zámku (mm) — otvory ⌀46 na krajných sklách</label>
					<input
						id="vrtanieZamku"
						name="vrtanieZamku"
						type="number"
						min="0"
						max="20000"
						step="any"
						bind:value={vrtanieZamkuS}
					/>
				</div>
			{/if}
			<div class="field">
				<label for="skloPresne">Presné zloženie skla (nepovinné — nemení vzorec)</label>
				<input
					id="skloPresne"
					name="skloPresne"
					bind:value={skloPresneS}
					maxlength="120"
					placeholder="napr. Stopsol Classic Grey, dubová kôra…"
				/>
			</div>
			<div class="field">
				<label for="poznamka"
					>Poznámka (viacriadková — vľavo na pláne aj v tlači, píš pod seba)</label
				>
				<textarea
					id="poznamka"
					name="poznamka"
					rows="4"
					bind:value={poznamkaS}
					maxlength="300"
					placeholder="napr. pozor na ľavé krídlo&#10;dodať do piatku&#10;montáž 5.8."
					style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"
				></textarea>
			</div>
			<div class="field">
				<label for="ral">RAL (farba) — zobrazí sa veľkým vpravo na pláne aj v tlači</label>
				<input
					id="ral"
					name="ral"
					bind:value={ralS}
					maxlength="40"
					placeholder="napr. 7016 / RAL 9005…"
				/>
			</div>
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input type="checkbox" name="caka" value="1" bind:checked={cakaS} style="width:auto" />
					⏳ Čaká na materiál (odloží import do priečinka NA ODPIS)
				</label>
			</div>
			<!-- 6K nemá väčšiu koľajnicu (7K neexistuje) → checkbox sa skryje. Zdieľaný
			     predikát `standardPlusRailEligible` (styl.ts) — rovnaký gate ako
			     `pridavnaKolajnicaDefault` aj `railUpsize` v compute.ts (#134). -->
			{#if standardPlusRailEligible(system, styl)}
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							type="checkbox"
							name="pridavnaKolajnica"
							value="1"
							bind:checked={pridavnaKolajnicaS}
							style="width:auto"
						/>
						➕ Prídavná koľajnica (spodná koľajnica o veľkosť väčšia)
					</label>
				</div>
			{/if}
			<!-- Jednostranná FAB (Dominik 2026-07-28: „chodí jeden zo 100") — MENÍ Money
			     odpis: kľučka a krytka vložky idú 1 ks namiesto 2 ks na uzáver. -->
			{#if maKovanie}
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							type="checkbox"
							name="jednostrannaFab"
							value="1"
							bind:checked={jednostrannaFabS}
							style="width:auto"
							data-testid="jednostranna-fab"
						/>
						🔑 Jednostranná FAB (menej kľučiek a krytiek vložky v odpise)
					</label>
				</div>
			{/if}
			<!-- Ručná dĺžka koľajnice (Patrik 2026-07-28): dielňa občas reže hornú a spodnú
			     inak než na šírku otvoru (napr. 2690 / 2695 mm). MENÍ Money odpis — prázdne
			     pole = pôvodný výpočet zo šírky. Len systémy s oddelenou hornou/spodnou. -->
			{#if maKolajnicu}
				<div class="grid2" data-testid="kolajnica-polia">
					<div class="field">
						<label for="kolajnicaHorna">Koľajnica horná (mm) — prázdne = podľa šírky</label>
						<input
							id="kolajnicaHorna"
							name="kolajnicaHorna"
							type="number"
							min={KOLAJNICA_MIN}
							max={KOLAJNICA_MAX}
							step="any"
							bind:value={kolHS}
							placeholder={String(sirka || '')}
						/>
					</div>
					<div class="field">
						<label for="kolajnicaSpodna">Koľajnica spodná (mm) — prázdne = podľa šírky</label>
						<input
							id="kolajnicaSpodna"
							name="kolajnicaSpodna"
							type="number"
							min={KOLAJNICA_MIN}
							max={KOLAJNICA_MAX}
							step="any"
							bind:value={kolSS}
							placeholder={String(sirka || '')}
						/>
					</div>
				</div>
			{/if}
			<!-- Klín nad posuvom (Patrik): zapínač + dĺžka/šírka/výška 1/výška 2 + ks.
			     Display-only — kreslí sa v náhľade, do Money odpisu nevstupuje. -->
			<KlinPolia
				idPrefix="klin"
				names={true}
				bind:on={klinS}
				bind:dlzka={klinDlzkaS}
				bind:sirka={klinSirkaS}
				bind:v1={klinV1S}
				bind:v2={klinV2S}
				bind:ks={klinKsS}
			/>
			<!-- Sieťka (#86–#90, KOREKCIA 2026-08-02, #110 systém sieťky): zapínač + úchyt.
			     Len na systémoch, kde ju appka ponúka (Robust/Slide/Štandard/Štandard +).
			     Rám/nos/redukcia IDE do Money odpisu (úchyt display-only). -->
			{#if maSietka}
				<SietkaPolia
					idPrefix="sietka"
					names={true}
					{system}
					{styl}
					strana={sietkaStranaVal}
					pridavna={pridavnaKolajnicaS}
					bind:on={sietkaS}
					bind:uchyt={sietkaUchytS}
					bind:sietkaSystem={sietkaSystemS}
				/>
			{/if}
			<!-- Zimná záhrada: ďalšie posuvy sa zoptimalizujú do zdieľaných tyčí -->
			<input type="hidden" name="posuvy" value={posuvyJSON} />
			{#each posuvyExtra as p, i (i)}
				<div class="posuv-box">
					<div class="posuv-hd">
						<b>Posuv {i + 2}</b>
						<button type="button" class="link-del" onclick={() => removePosuv(i)}>✕ odobrať</button>
					</div>
					<div class="grid2">
						<div class="field">
							<label for={`ps${i}-sys`}>Systém</label>
							<select id={`ps${i}-sys`} bind:value={p.system} onchange={() => fixPosuv(i)}>
								{#each data.systemy as sys (sys)}<option value={sys}>{nazovSystemu(sys)}</option
									>{/each}
							</select>
						</div>
						<div class="field">
							<label for={`ps${i}-styl`}>Štýl</label>
							<select id={`ps${i}-styl`} bind:value={p.styl} onchange={() => fixPosuv(i)}>
								{#each stylyForSystem(p.system) as st (st)}<option>{st}</option>{/each}
							</select>
						</div>
					</div>
					<div class="grid2">
						<div class="field">
							<label for={`ps${i}-s`}>Šírka (mm) *</label>
							<input
								id={`ps${i}-s`}
								type="number"
								min="300"
								max="20000"
								step="any"
								bind:value={p.s}
								required
							/>{#if posuvB2bErrs[i]}<span class="b2b-blok" data-testid={`b2b-sirka-err-${i}`}>
									⛔ {posuvB2bErrs[i]}</span
								>{/if}
						</div>
						<div class="field">
							<label for={`ps${i}-v`}>Výška (mm) *</label>
							<input
								id={`ps${i}-v`}
								type="number"
								min="300"
								max="20000"
								step="any"
								bind:value={p.v}
								required
							/>{#if posuvB2bWarns[i]}<span class="b2b-upoz" data-testid={`b2b-vyska-warn-${i}`}>
									{posuvB2bWarns[i]}</span
								>{/if}
						</div>
					</div>
					<div class="grid2">
						<div class="field">
							<label for={`ps${i}-sklo`}>Sklo</label>
							<select id={`ps${i}-sklo`} bind:value={p.sklo}>
								{#each sklaForSystem(p.system, p.styl) as g (g)}<option>{g}</option>{/each}
							</select>
						</div>
						<div class="field">
							<label for={`ps${i}-otv`}>Otváranie</label>
							<select id={`ps${i}-otv`} bind:value={p.otvaranie}>
								{#each otvaraniaForStyl(p.styl) as o (o)}<option>{o}</option>{/each}
							</select>
						</div>
					</div>
					{#if p.system === 'Robust' && !p.sietka}
						<div class="grid2">
							<div class="field">
								<label for={`ps${i}-kovl`}>Kovanie — ľavá strana</label>
								<select id={`ps${i}-kovl`} bind:value={p.kovanieL}>
									<option value="">—</option>
									{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
								</select>
							</div>
							<div class="field">
								<label for={`ps${i}-kovp`}>Kovanie — pravá strana</label>
								<select id={`ps${i}-kovp`} bind:value={p.kovanieP}>
									<option value="">—</option>
									{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
								</select>
							</div>
						</div>
						{#if p.styl.startsWith('2x')}
							<div class="grid2" data-testid={`kovanie-stred-polia-${i}`}>
								<div class="field">
									<label for={`ps${i}-kovs`}>Kovanie — stredové okno</label>
									<select id={`ps${i}-kovs`} bind:value={p.kovanieStred}>
										<option value="">—</option>
										{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
									</select>
								</div>
								<div class="field">
									<label for={`ps${i}-kovso`}>Ktoré okno v strede</label>
									<select id={`ps${i}-kovso`} bind:value={p.kovanieStredOkno}>
										<option value="L">ľavé zo stredovej dvojice</option>
										<option value="P">pravé zo stredovej dvojice</option>
									</select>
								</div>
							</div>
						{/if}
					{/if}
					{#if kolajnicaPre(p.system)}
						<div class="grid2" data-testid={`kolajnica-polia-${i}`}>
							<div class="field">
								<label for={`ps${i}-kolh`}>Koľajnica horná (mm) — prázdne = podľa šírky</label>
								<input
									id={`ps${i}-kolh`}
									type="number"
									min={KOLAJNICA_MIN}
									max={KOLAJNICA_MAX}
									step="any"
									bind:value={p.kolajnicaHorna}
									placeholder={String(p.s || '')}
								/>
							</div>
							<div class="field">
								<label for={`ps${i}-kols`}>Koľajnica spodná (mm) — prázdne = podľa šírky</label>
								<input
									id={`ps${i}-kols`}
									type="number"
									min={KOLAJNICA_MIN}
									max={KOLAJNICA_MAX}
									step="any"
									bind:value={p.kolajnicaSpodna}
									placeholder={String(p.s || '')}
								/>
							</div>
						</div>
					{/if}
					<KlinPolia
						idPrefix={`ps${i}-klin`}
						bind:on={p.klin}
						bind:dlzka={p.klinDlzka}
						bind:sirka={p.klinSirka}
						bind:v1={p.klinV1}
						bind:v2={p.klinV2}
						bind:ks={p.klinKs}
					/>
					{#if maSietkaSystem(p.system)}
						<SietkaPolia
							idPrefix={`ps${i}-sietka`}
							system={p.system}
							styl={p.styl}
							strana={sietkaStrana(p.otvaranie)}
							pridavna={pridavnaKolajnicaS}
							bind:on={p.sietka}
							bind:uchyt={p.sietkaUchyt}
							bind:sietkaSystem={p.sietkaSystem}
							onZmena={(on) => {
								if (on) {
									p.kovanieL = '';
									p.kovanieP = '';
									p.kovanieStred = '';
								}
							}}
						/>
					{/if}
				</div>
			{/each}
			<button type="button" class="btn secondary" onclick={addPosuv}>➕ Pridať posuv</button>
			<button
				class="btn"
				type="submit"
				formaction={jeMulti ? '?/nahladMulti' : '?/nahlad'}
				disabled={b2bBlok}
				data-testid="spocitat"
			>
				{jeMulti
					? `Spočítať spoločný plán (${posuvySlovom(posuvyExtra.length + 1)})`
					: 'Spočítať nárezový plán'}
			</button>
		</form>
	</div>
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

	{@render planKarty(plan)}

	<div class="card noprint">
		{#if !isB2B}
			<form method="POST" action="?/odoslat">
				{@render hiddenVstup()}
				<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
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

	{@render planKarty(plan)}

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

	{@render planKartyMulti(multi)}

	<div class="card noprint">
		{#if !isB2B}
			<form method="POST" action="?/odoslatMulti">
				{@render hiddenMulti()}
				<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
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

	{@render planKartyMulti(multi)}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/zasklenia')}>➕ Nový nárezový plán</a>
	</div>
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
