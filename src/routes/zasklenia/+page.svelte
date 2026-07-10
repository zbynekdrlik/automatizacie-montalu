<script lang="ts">
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';

	let { data, form } = $props();

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
			poznamka: zd?.poznamka ?? '',
			caka: zd?.caka ?? false
		};
	});

	// primárny posuv (posuv 1) = ploché polia; ďalšie posuvy (zimná záhrada) v posuvyExtra.
	// po chybe/náhľade obnov primárny z jednoposuvového ALEBO viacposuvového vstupu
	const prim = () => form?.multiVstup?.posuvy?.[0] ?? form?.vstup ?? null;
	const stylyForSystem = (sys: string) =>
		data.styly.filter((x) => x.system === sys).map((x) => x.styl);
	// Deluxe: LEN vlastné sklá (Float kalené 6/10 — hrúbka vyberá kladka/klzný profil);
	// spoločné 'ALL' sklá nemajú Deluxe profil (musí sedieť so serverovým
	// glassTypesForSystem, inak by formulár ponúkol sklo, ktoré server odmietne).
	const sklaForSystem = (sys: string) =>
		data.skla
			.filter((g) => (sys === 'Deluxe' ? g.system === 'Deluxe' : g.system === sys || g.system === 'ALL'))
			.map((g) => g.nazov);
	const otvaraniaForStyl = (st: string) => (st?.startsWith('2x') ? ['Opona'] : data.otvarania);

	type PosuvRow = {
		system: string;
		styl: string;
		s: number | string;
		v: number | string;
		sklo: string;
		otvaranie: string;
	};

	// VŠETKY editovateľné polia sú $state (bind) — nie jednosmerné value={vstup.x}.
	// Jednosmerné by sa pri každom re-renderi (napr. po zmene rozmeru) vymazali.
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');
	let skloPresneS = $state('');
	let poznamkaS = $state('');
	let cakaS = $state(false);
	let system = $state('Robust');
	let styl = $state('2K');
	let sklo = $state('');
	let otvaranie = $state('P - L');
	let sirka = $state<number | string>('');
	let vyska = $state<number | string>('');
	let posuvyExtra = $state<PosuvRow[]>([]);
	$effect(() => {
		const zd = form?.vstup ?? form?.multiVstup ?? null;
		zakS = zd?.zak ?? '';
		opS = zd?.op ?? '';
		zakaznikS = zd?.zakaznik ?? '';
		skloPresneS = form?.vstup?.skloPresne ?? '';
		poznamkaS = zd?.poznamka ?? '';
		cakaS = zd?.caka ?? false;
		const p = prim();
		system = p?.system ?? 'Robust';
		styl = p?.styl ?? '2K';
		otvaranie = p?.otvaranie ?? 'P - L';
		sirka = (p?.s as number | string) ?? '';
		vyska = (p?.v as number | string) ?? '';
		posuvyExtra = (form?.multiVstup?.posuvy ?? []).slice(1).map((x) => ({ ...x }));
	});
	// 2x2K / 2x3K = opona (otváranie od stredu) → povoľ len „Opona" a nastav ju
	let jeOpona = $derived(styl.startsWith('2x'));
	let otvaraniaPre = $derived(otvaraniaForStyl(styl));
	$effect(() => {
		if (jeOpona) otvaranie = 'Opona';
		else if (!otvaraniaPre.includes(otvaranie)) otvaranie = otvaraniaPre[0];
	});
	let stylyPre = $derived(stylyForSystem(system));
	$effect(() => {
		if (!stylyPre.includes(styl)) styl = stylyPre[0];
	});
	// sklá platné pre zvolený systém (jeho vlastné + spoločné ALL)
	let sklaPre = $derived(sklaForSystem(system));
	$effect(() => {
		const chcene = prim()?.sklo;
		sklo = chcene && sklaPre.includes(chcene) ? chcene : sklaPre[0];
	});

	// viac-posuvový režim: aktívny keď je pridaný aspoň jeden ďalší posuv
	let jeMulti = $derived(posuvyExtra.length > 0);
	// celý zoznam posuvov (primárny + ďalšie) → JSON pre multi submit
	let posuvyJSON = $derived(
		JSON.stringify([
			{ system, styl, s: sirka, v: vyska, sklo, otvaranie },
			...posuvyExtra.map((p) => ({
				system: p.system,
				styl: p.styl,
				s: p.s,
				v: p.v,
				sklo: p.sklo,
				otvaranie: p.otvaranie
			}))
		])
	);
	// po zmene systému/štýlu ďalšieho posuvu daj do poriadku jeho štýl/sklo/otváranie
	function fixPosuv(i: number) {
		const p = posuvyExtra[i];
		const st = stylyForSystem(p.system);
		if (!st.includes(p.styl)) p.styl = st[0];
		const sk = sklaForSystem(p.system);
		if (!sk.includes(p.sklo)) p.sklo = sk[0];
		const ot = otvaraniaForStyl(p.styl);
		if (!ot.includes(p.otvaranie)) p.otvaranie = ot[0];
	}
	function addPosuv() {
		posuvyExtra = [...posuvyExtra, { system, styl, s: '', v: '', sklo, otvaranie }];
		fixPosuv(posuvyExtra.length - 1);
	}
	function removePosuv(i: number) {
		posuvyExtra = posuvyExtra.filter((_, j) => j !== i);
	}

	let step = $derived(form?.step ?? 'form');
	let plan = $derived(form && 'plan' in form ? form.plan : null);
	let multi = $derived(form && 'multi' in form ? form.multi : null);
	let multiVstup = $derived(form?.multiVstup ?? null);
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
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet planKarty(p: NonNullable<typeof plan>)}
	{#if vstup.poznamka}
		<div class="poznamka-plan">📝 {vstup.poznamka}</div>
	{/if}
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
		<Nahlad2D S={p.S} V={p.V} N={p.N} skloS={p.sklo.sirka} skloV={p.sklo.vyska} otvaranie={vstup.otvaranie} />
	</div>

	<div class="card">
		<div class="sec">Sklo (mm)</div>
		<div class="g">
			<div><span>Šírka</span><b data-testid="sklo-sirka">{fmtM(p.sklo.sirka)}</b></div>
			<div><span>Výška</span><b data-testid="sklo-vyska">{fmtM(p.sklo.vyska)}</b></div>
			<div><span>Počet</span><b>{p.sklo.pocet} ks</b></div>
			<div><span>Typ</span><b style="font-size:13px">{vstup.skloPresne || vstup.sklo}</b></div>
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
	<input type="hidden" name="posuvy" value={JSON.stringify(multiVstup?.posuvy ?? [])} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet planKartyMulti(m: NonNullable<typeof multi>)}
	{#if vstup.poznamka}<div class="poznamka-plan">📝 {vstup.poznamka}</div>{/if}
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
						<td>{pv.sklo.sirka} × {pv.sklo.vyska}{#if pv.skloNazov} · {pv.skloNazov}{/if}</td>
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
					<Nahlad2D S={pv.S} V={pv.V} N={pv.N} skloS={pv.sklo.sirka} skloV={pv.sklo.vyska} otvaranie={pv.otvaranie ?? 'Opona'} />
				</div>
			{/each}
		</div>
	</div>

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
			Zadaj rozmery, ukážem nárezový plán s náhľadom. Odpis sa do Money odošle až po tvojom
			potvrdení.
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
					<input id="s" name="s" type="number" min="300" max="20000" step="any" bind:value={sirka} required />
				</div>
				<div class="field">
					<label for="v">Výška (mm) *</label>
					<input id="v" name="v" type="number" min="300" max="20000" step="any" bind:value={vyska} required />
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="sklo">Sklo (základ — určuje vzorec)</label>
					<select id="sklo" name="sklo" bind:value={sklo}>
						{#each sklaPre as g (g)}<option>{g}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="otvaranie">Otváranie</label>
					<select id="otvaranie" name="otvaranie" bind:value={otvaranie}>
						{#each otvaraniaPre as o (o)}<option>{o}</option>{/each}
					</select>
					{#if jeOpona}<span class="hint">Pri 2× štýle je otváranie vždy opona (od stredu).</span>{/if}
				</div>
			</div>
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
				<label for="poznamka">Poznámka (zobrazí sa hore vpravo na pláne aj v tlači)</label>
				<input
					id="poznamka"
					name="poznamka"
					bind:value={poznamkaS}
					maxlength="300"
					placeholder="napr. pozor na ľavé krídlo, dodať do piatku…"
				/>
			</div>
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input type="checkbox" name="caka" value="1" bind:checked={cakaS} style="width:auto" />
					⏳ Čaká na materiál (odloží import do priečinka NA ODPIS)
				</label>
			</div>
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
							<input id={`ps${i}-s`} type="number" min="300" max="20000" step="any" bind:value={p.s} required /></div>
						<div class="field"><label for={`ps${i}-v`}>Výška (mm) *</label>
							<input id={`ps${i}-v`} type="number" min="300" max="20000" step="any" bind:value={p.v} required /></div>
					</div>
					<div class="grid2">
						<div class="field"><label for={`ps${i}-sklo`}>Sklo</label>
							<select id={`ps${i}-sklo`} bind:value={p.sklo}>
								{#each sklaForSystem(p.system) as g (g)}<option>{g}</option>{/each}
							</select></div>
						<div class="field"><label for={`ps${i}-otv`}>Otváranie</label>
							<select id={`ps${i}-otv`} bind:value={p.otvaranie}>
								{#each otvaraniaForStyl(p.styl) as o (o)}<option>{o}</option>{/each}
							</select></div>
					</div>
				</div>
			{/each}
			<button type="button" class="btn secondary" onclick={addPosuv}>➕ Pridať posuv (zimná záhrada)</button>
			<button class="btn" type="submit" formaction={jeMulti ? '?/nahladMulti' : '?/nahlad'}>
				{jeMulti ? `Spočítať spoločný plán (${posuvyExtra.length + 1} posuvy)` : 'Spočítať nárezový plán'}
			</button>
		</form>
	</div>
{:else if step === 'nahlad' && plan}
	<div class="card">
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.warn}
		<div class="warn" data-testid="plan-warn">⚠️ {form.warn}</div>
	{/if}

	{@render planKarty(plan)}

	<div class="card noprint">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
			<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
			<button class="btn" type="submit" data-testid="odoslat">
				{data.live
					? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS)' : '✅ Odoslať odpis do Money')
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hiddenVstup()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
	</div>
{:else if step === 'hotovo' && plan && form?.outcome}
	<div class="card">
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok">
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
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zimná záhrada · {multi.posuvy.length} posuvy</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.warn}<div class="warn" data-testid="plan-warn">⚠️ {form.warn}</div>{/if}

	{@render planKartyMulti(multi)}

	<div class="card noprint">
		<form method="POST" action="?/odoslatMulti">
			{@render hiddenMulti()}
			<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
			<button class="btn" type="submit" data-testid="odoslat-multi">
				{data.live
					? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS)' : '✅ Odoslať odpis do Money')
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravitMulti" style="display:inline">
			{@render hiddenMulti()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
	</div>
{:else if step === 'hotovoMulti' && multi && form?.outcome}
	<div class="card">
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub"><span class="badge">Zimná záhrada · {multi.posuvy.length} posuvy</span></p>
	</div>

	<div class="okmsg" data-testid="vysledok">
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
