<script lang="ts">
	import { untrack } from 'svelte';
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import { checkB2BWidth, checkB2BHeight } from '$lib/b2b-limits';
	import { defaultSklo, fmtSkloRozmer } from '$lib/sklo';
	import { stylyDoPonuky, sklaDoPonuky, sysStylPre, skloVyberaIzo } from '$lib/styl';
	import { klinPopis, type Klin } from '$lib/klin';
	import KlinPolia from '$lib/components/KlinPolia.svelte';

	let { data, form } = $props();

	// b2b nesmie odpisovať do Money — server to aj tak odmietne (defense in depth),
	// tu skrývame odoslat/odoslatMulti UI, aby to b2b účet ani neskúšal
	const isB2B = $derived(data.user?.role === 'b2b');

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	// predvyplnenie: po chybe/náhľade sa vraciame k odoslaným hodnotám (jedno- aj
	// viac-posuvový vstup zdieľa zak/op/zákazník/poznámku/čaká)
	let vstup = $derived.by(() => {
		const zd = form?.vstup ?? form?.multiVstup ?? null;
		return {
			zak: zd?.zak ?? '',
			op: zd?.op ?? '',
			zakaznik: zd?.zakaznik ?? '',
			system: form?.vstup?.system ?? 'Robust',
			styl: form?.vstup?.styl ?? '2K',
			s: (form?.vstup?.s ?? '') as unknown as number,
			v: (form?.vstup?.v ?? '') as unknown as number,
			sklo: form?.vstup?.sklo ?? '',
			skloPresne: form?.vstup?.skloPresne ?? '',
			otvaranie: form?.vstup?.otvaranie ?? 'P - L',
			kovanieL: form?.vstup?.kovanieL ?? '',
			kovanieP: form?.vstup?.kovanieP ?? '',
			vrtanieZamku: form?.vstup?.vrtanieZamku ?? 1050,
			poznamka: zd?.poznamka ?? '',
			ral: zd?.ral ?? '',
			caka: zd?.caka ?? false,
			pridavnaKolajnica: zd?.pridavnaKolajnica ?? false,
			klin: (form?.vstup?.klin ?? null) as Klin | null
		};
	});

	// primárny posuv (posuv 1) = ploché polia; ďalšie posuvy (zimná záhrada) v posuvyExtra.
	// po chybe/náhľade obnov primárny z jednoposuvového ALEBO viacposuvového vstupu
	const prim = () => form?.multiVstup?.posuvy?.[0] ?? form?.vstup ?? null;
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
		// klín TOHOTO posuvu — ploché polia (rovnaký tvar ako primárny posuv), do
		// JSON-u idú tak, ako ich parsuje server (klin='1' + 4 rozmery + ks)
		klin: boolean;
		klinDlzka: number | string;
		klinSirka: number | string;
		klinV1: number | string;
		klinV2: number | string;
		klinKs: number | string;
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
	let system = $state('Robust');
	let styl = $state('2K');
	let sklo = $state('');
	let otvaranie = $state('P - L');
	// kovanie (kľučka) ľavej/pravej strany — len Robust, len na plán/náhľad
	let kovanieLS = $state('');
	let kovaniePS = $state('');
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
	let posuvyExtra = $state<PosuvRow[]>([]);
	$effect(() => {
		const zd = form?.vstup ?? form?.multiVstup ?? null;
		zakS = zd?.zak ?? '';
		opS = zd?.op ?? '';
		zakaznikS = zd?.zakaznik ?? '';
		skloPresneS = form?.vstup?.skloPresne ?? '';
		vrtanieZamkuS = form?.vstup?.vrtanieZamku ?? 1050;
		poznamkaS = zd?.poznamka ?? '';
		ralS = zd?.ral ?? '';
		cakaS = zd?.caka ?? false;
		pridavnaKolajnicaS = zd?.pridavnaKolajnica ?? false;
		const kl = (form?.vstup?.klin ?? null) as Klin | null;
		klinS = !!kl;
		klinDlzkaS = kl?.dlzka ?? '';
		klinSirkaS = kl?.sirka ?? '';
		klinV1S = kl?.v1 ?? '';
		klinV2S = kl?.v2 ?? '';
		klinKsS = kl?.ks ?? 1;
		const p = prim();
		system = p?.system ?? 'Robust';
		styl = p?.styl ?? '2K';
		otvaranie = p?.otvaranie ?? 'P - L';
		kovanieLS = p?.kovanieL ?? '';
		kovaniePS = p?.kovanieP ?? '';
		sirka = (p?.s as number | string) ?? '';
		vyska = (p?.v as number | string) ?? '';
		posuvyExtra = (form?.multiVstup?.posuvy ?? []).slice(1).map((x) => ({
			...x,
			klin: !!x.klin,
			klinDlzka: x.klin?.dlzka ?? '',
			klinSirka: x.klin?.sirka ?? '',
			klinV1: x.klin?.v1 ?? '',
			klinV2: x.klin?.v2 ?? '',
			klinKs: x.klin?.ks ?? 1
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
	$effect(() => {
		if (!jeRobust) {
			kovanieLS = '';
			kovaniePS = '';
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
				klin: klinS ? '1' : '',
				klinDlzka: klinDlzkaS,
				klinSirka: klinSirkaS,
				klinV1: klinV1S,
				klinV2: klinV2S,
				klinKs: klinKsS
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
				klin: p.klin ? '1' : '',
				klinDlzka: p.klinDlzka,
				klinSirka: p.klinSirka,
				klinV1: p.klinV1,
				klinV2: p.klinV2,
				klinKs: p.klinKs
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
				klin: false,
				klinDlzka: '',
				klinSirka: '',
				klinV1: '',
				klinV2: '',
				klinKs: 1
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
		return s === null ? null : checkB2BWidth(data.styly, sysStylPre(system, styl, sklo, existuje), s);
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
			return s === null ? null : checkB2BWidth(data.styly, sysStylPre(p.system, p.styl, p.sklo, existuje), s);
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
	<input type="hidden" name="vrtanieZamku" value={vstup.vrtanieZamku} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	<input type="hidden" name="ral" value={vstup.ral} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
	{#if vstup.pridavnaKolajnica}<input type="hidden" name="pridavnaKolajnica" value="1" />{/if}
	{#if vstup.klin}
		<input type="hidden" name="klin" value="1" />
		<input type="hidden" name="klinDlzka" value={vstup.klin.dlzka} />
		<input type="hidden" name="klinSirka" value={vstup.klin.sirka} />
		<input type="hidden" name="klinV1" value={vstup.klin.v1} />
		<input type="hidden" name="klinV2" value={vstup.klin.v2} />
		<input type="hidden" name="klinKs" value={vstup.klin.ks} />
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

{#snippet planKarty(p: NonNullable<typeof plan>)}
	{@render poznamkaRal()}
	<div class="card">
		<div class="sec">Rozmery</div>
		<div class="g">
			<div><span>Šírka</span><b>{p.S} mm</b></div>
			<div><span>Výška</span><b>{p.V} mm</b></div>
			<div><span>Plocha</span><b>{fmtM(p.m2)} m²</b></div>
		</div>
	</div>

	<div class="card">
		<div class="sec">Náhľad</div>
		<Nahlad2D S={p.S} V={p.V} N={p.N} skloS={p.sklo.sirka} skloV={p.sklo.vyska} otvaranie={vstup.otvaranie} system={p.system} vrtanieZamku={vstup.vrtanieZamku} kovanieL={vstup.kovanieL} kovanieP={vstup.kovanieP} klin={vstup.klin} />
	</div>

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

	<div class="card">
		<div class="sec">Sklo (mm)</div>
		<div class="g">
			<div><span>Šírka</span><b data-testid="sklo-sirka">{fmtM(p.sklo.sirka)}</b></div>
			<div><span>Výška</span><b data-testid="sklo-vyska">{fmtM(p.sklo.vyska)}</b></div>
			<div><span>Počet</span><b>{p.sklo.pocet} ks</b></div>
			<div><span>Typ</span><b style="font-size:13px">{vstup.skloPresne || vstup.sklo}</b></div>
			<div><span>Rozmer (na objednávku skla)</span><b data-testid="sklo-rozmer">{fmtSkloRozmer(p.sklo.sirka, p.sklo.vyska)}</b></div>
		</div>
	</div>

	<div class="card">
		<div class="sec">Zoznam materiálu — profily</div>
		<table>
			<thead><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead>
			<tbody>
				{#each p.material as m (m.kod)}
					<tr>
						<td style="width:52px"><ProfilObrazok kod={m.kod} nazov={m.nazov} /></td>
						<td>{m.nazov}</td>
						<td class="c">{m.kod}</td>
						<td>{m.rezy.filter((x) => x.ks > 0).map((x) => `${x.ks}×${x.rozmer} mm`).join(' + ') || '—'}</td>
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

	<div class="card">
		<div class="sec">Rozpis rezov na tyče — pre pílu</div>
		<p class="sub" style="margin-bottom:14px">
			Každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci (dĺžka tyče je pri každom profile — Deluxe má kratšie: kladka/klzný 3600, 5K horná 6000 mm).
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
{/snippet}

{#snippet planKartyMulti(m: NonNullable<typeof multi>)}
	{@render poznamkaRal()}
	<div class="card">
		<div class="sec">Posuvy ({m.posuvy.length}) — spolu {fmtM(m.m2)} m²</div>
		<table>
			<thead><tr><th></th><th>Systém</th><th>Rozmer</th><th>Sklo (mm)</th><th>Otváranie</th></tr></thead>
			<tbody>
				{#each m.posuvy as pv, i (i)}
					<tr>
						<td class="c"><b>Posuv {i + 1}</b></td>
						<td>{pv.system} {pv.styl}</td>
						<td>{pv.S} × {pv.V} mm</td>
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
					<Nahlad2D S={pv.S} V={pv.V} N={pv.N} skloS={pv.sklo.sirka} skloV={pv.sklo.vyska} otvaranie={pv.otvaranie ?? 'Opona'} system={pv.system} kovanieL={pv.kovanieL ?? ''} kovanieP={pv.kovanieP ?? ''} klin={pv.klin ?? null} />
				</div>
			{/each}
		</div>
	</div>

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

	<div class="card">
		<div class="sec">Zoznam materiálu — spoločný (naprieč posuvmi)</div>
		<table>
			<thead><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead>
			<tbody>
				{#each m.material as mt (mt.kod)}
					<tr>
						<td style="width:52px"><ProfilObrazok kod={mt.kod} nazov={mt.nazov} /></td>
						<td>{mt.nazov}</td>
						<td class="c">{mt.kod}</td>
						<td>{mt.rezy.filter((x) => x.ks > 0).map((x) => `${x.ks}×${x.rozmer} mm`).join(' + ') || '—'}</td>
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
	</div>

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
						{#each data.systemy as sys (sys)}<option>{sys}</option>{/each}
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
					<input id="s" name="s" type="number" min="300" max="20000" step="any" bind:value={sirka} required />{#if b2bSirkaErr}<span class="b2b-blok" data-testid="b2b-sirka-err"> ⛔ {b2bSirkaErr}</span>{/if}
				</div>
				<div class="field">
					<label for="v">Výška (mm) *</label>
					<input id="v" name="v" type="number" min="300" max="20000" step="any" bind:value={vyska} required />{#if b2bVyskaWarn}<span class="b2b-upoz" data-testid="b2b-vyska-warn"> {b2bVyskaWarn}</span>{/if}
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
					{#if jeOpona}<span class="hint">Pri 2× štýle je otváranie vždy opona (od stredu).</span>{/if}
				</div>
			</div>
			<!-- Kovanie (kľučka) — LEN Robust; ľavá aj pravá strana zvlášť, pri každom
			     posuve sólo. Display-only: plán/náhľad + detail v histórii, Money NIE. -->
			{#if jeRobust}
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
				<label for="poznamka">Poznámka (viacriadková — vľavo na pláne aj v tlači, píš pod seba)</label>
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
			<!-- 6K nemá väčšiu koľajnicu (7K neexistuje) → checkbox sa skryje -->
			{#if system === 'Štandard +' && !styl.startsWith('6K')}
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
			<!-- Zimná záhrada: ďalšie posuvy sa zoptimalizujú do zdieľaných tyčí -->
			<input type="hidden" name="posuvy" value={posuvyJSON} />
			{#each posuvyExtra as p, i (i)}
				<div class="posuv-box">
					<div class="posuv-hd">
						<b>Posuv {i + 2}</b>
						<button type="button" class="link-del" onclick={() => removePosuv(i)}>✕ odobrať</button>
					</div>
					<div class="grid2">
						<div class="field"><label for={`ps${i}-sys`}>Systém</label>
							<select id={`ps${i}-sys`} bind:value={p.system} onchange={() => fixPosuv(i)}>
								{#each data.systemy as sys (sys)}<option>{sys}</option>{/each}
							</select></div>
						<div class="field"><label for={`ps${i}-styl`}>Štýl</label>
							<select id={`ps${i}-styl`} bind:value={p.styl} onchange={() => fixPosuv(i)}>
								{#each stylyForSystem(p.system) as st (st)}<option>{st}</option>{/each}
							</select></div>
					</div>
					<div class="grid2">
						<div class="field"><label for={`ps${i}-s`}>Šírka (mm) *</label>
							<input id={`ps${i}-s`} type="number" min="300" max="20000" step="any" bind:value={p.s} required />{#if posuvB2bErrs[i]}<span class="b2b-blok" data-testid={`b2b-sirka-err-${i}`}> ⛔ {posuvB2bErrs[i]}</span>{/if}</div>
						<div class="field"><label for={`ps${i}-v`}>Výška (mm) *</label>
							<input id={`ps${i}-v`} type="number" min="300" max="20000" step="any" bind:value={p.v} required />{#if posuvB2bWarns[i]}<span class="b2b-upoz" data-testid={`b2b-vyska-warn-${i}`}> {posuvB2bWarns[i]}</span>{/if}</div>
					</div>
					<div class="grid2">
						<div class="field"><label for={`ps${i}-sklo`}>Sklo</label>
							<select id={`ps${i}-sklo`} bind:value={p.sklo}>
								{#each sklaForSystem(p.system, p.styl) as g (g)}<option>{g}</option>{/each}
							</select></div>
						<div class="field"><label for={`ps${i}-otv`}>Otváranie</label>
							<select id={`ps${i}-otv`} bind:value={p.otvaranie}>
								{#each otvaraniaForStyl(p.styl) as o (o)}<option>{o}</option>{/each}
							</select></div>
					</div>
					{#if p.system === 'Robust'}
						<div class="grid2">
							<div class="field"><label for={`ps${i}-kovl`}>Kovanie — ľavá strana</label>
								<select id={`ps${i}-kovl`} bind:value={p.kovanieL}>
									<option value="">—</option>
									{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
								</select></div>
							<div class="field"><label for={`ps${i}-kovp`}>Kovanie — pravá strana</label>
								<select id={`ps${i}-kovp`} bind:value={p.kovanieP}>
									<option value="">—</option>
									{#each data.kovania as k (k)}<option value={k}>{k}</option>{/each}
								</select></div>
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
				</div>
			{/each}
			<button type="button" class="btn secondary" onclick={addPosuv}>➕ Pridať posuv</button>
			<button class="btn" type="submit" formaction={jeMulti ? '?/nahladMulti' : '?/nahlad'} disabled={b2bBlok} data-testid="spocitat">
				{jeMulti ? `Spočítať spoločný plán (${posuvyExtra.length + 1} posuvy)` : 'Spočítať nárezový plán'}
			</button>
		</form>
	</div>
{:else if step === 'nahlad' && plan}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="plan-badge"
				>Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span
			>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
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
						? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS)' : '✅ Odoslať odpis do Money')
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
				>Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span
			>
		</p>
	</div>

	<div class="okmsg noprint" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS, presuň do
			dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	{@render planKarty(plan)}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href="/zasklenia">➕ Nový nárezový plán</a>
	</div>
{:else if step === 'nahladMulti' && multi}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zimná záhrada · {multi.posuvy.length} posuvy</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
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
						? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS)' : '✅ Odoslať odpis do Money')
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
		<p class="sub"><span class="badge">Zimná záhrada · {multi.posuvy.length} posuvy</span></p>
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
		<a class="btn secondary" href="/zasklenia">➕ Nový nárezový plán</a>
	</div>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href="/zasklenia">← Späť na formulár</a>
		<a class="btn secondary" href="/odpisy">📋 História odpisov</a>
	</div>
{/if}
