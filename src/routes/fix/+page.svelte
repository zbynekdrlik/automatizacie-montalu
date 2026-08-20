<script lang="ts">
	// FIX (pevné zasklenie) — zadanie rozmerov → výkres konštrukcie na tlač.
	// Do Money nejde nič. Tvar: šikmý (šikmá horná hrana) alebo rovný (obdĺžnik).
	import FixVykres2D from '$lib/components/FixVykres2D.svelte';
	import {
		rovnomernePolia,
		rozpocitajPodlaPosuvu,
		popisTvaru,
		FIX_SYSTEMY,
		KRAJNY,
		PRIECKA,
		FIX_MAX_POLI,
		FIX_MAX,
		FIX_MIN,
		type FixTvar,
		type FixDelenie,
		type FixSystem
	} from '$lib/fix';
	import { resolve } from '$app/paths';

	let { form } = $props();

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
	/** políčka sú number|string (prázdny input = ''), počítame vždy cez toto */
	const cislo = (x: number | string) => (typeof x === 'number' ? x : parseFloat(String(x)) || 0);

	let step = $derived(form?.step ?? 'form');
	let r = $derived(form && 'r' in form ? form.r : null);
	let vstup = $derived({
		zak: form?.vstup?.zak ?? '',
		op: form?.vstup?.op ?? '',
		zakaznik: form?.vstup?.zakaznik ?? '',
		nazov: form?.vstup?.nazov ?? '',
		tvar: (form?.vstup?.tvar ?? 'sikmy') as FixTvar,
		s: form?.vstup?.s ?? 0,
		v1: form?.vstup?.v1 ?? 0,
		v2: form?.vstup?.v2 ?? 0,
		polia: (form?.vstup?.polia ?? []) as number[],
		delenie: (form?.vstup?.delenie ?? 'rovnomerne') as FixDelenie,
		system: (form?.vstup?.system ?? 'Štandard') as FixSystem,
		zrkadlo: form?.vstup?.zrkadlo ?? false,
		ral: form?.vstup?.ral ?? '',
		sklo: form?.vstup?.sklo ?? '',
		poznamka: form?.vstup?.poznamka ?? ''
	});

	// všetky editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri
	// re-renderi vymazali (pasca, ktorá už raz vynulovala formuláre v iných moduloch)
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');
	let nazovS = $state('');
	let tvarS = $state<FixTvar>('sikmy');
	let sirkaS = $state<number | string>('');
	let v1S = $state<number | string>('');
	let v2S = $state<number | string>('');
	let delenieS = $state<FixDelenie>('rovnomerne');
	let systemS = $state<FixSystem>('Štandard');
	let zrkadloS = $state(false);
	let ralS = $state('');
	let skloS = $state('');
	let poznamkaS = $state('');
	let poliaS = $state<(number | string)[]>([]);
	$effect(() => {
		const v = form?.vstup ?? null;
		zakS = v?.zak ?? '';
		opS = v?.op ?? '';
		zakaznikS = v?.zakaznik ?? '';
		nazovS = v?.nazov ?? '';
		tvarS = (v?.tvar ?? 'sikmy') as FixTvar;
		sirkaS = v?.s || '';
		v1S = v?.v1 || '';
		v2S = v?.v2 || '';
		delenieS = (v?.delenie ?? 'rovnomerne') as FixDelenie;
		systemS = (v?.system ?? 'Štandard') as FixSystem;
		zrkadloS = v?.zrkadlo ?? false;
		ralS = v?.ral ?? '';
		skloS = v?.sklo ?? '';
		poznamkaS = v?.poznamka ?? '';
		poliaS = (v?.polia ?? []).map((x: number) => x);
	});

	let pocetPoli = $derived(poliaS.length || 1);
	let sirkaNum = $derived(cislo(sirkaS));
	let sucetPoli = $derived(poliaS.reduce<number>((a, b) => a + cislo(b), 0));
	let sedíSucet = $derived(!poliaS.length || Math.abs(sucetPoli - sirkaNum) <= 0.5);
	// #85 review (Important): pri "podľa posuvu" môže KRAJNY presiahnuť dostupnú
	// šírku (napr. malé S s viac poľami) — súčet by aj tak sedel na S (krajné pole
	// by len vyšlo záporné), takže samotné `sedíSucet` to nechytí. Ukáž konkrétnu
	// hlášku namiesto len generickej serverovej "Šírka poľa musí byť 59–20000 mm."
	let poleMimoRozsahu = $derived(
		delenieS === 'posuv' && poliaS.some((p) => cislo(p) < FIX_MIN || cislo(p) > FIX_MAX)
	);

	/** rozdelenie šírky na `n` polí PODĽA AKTUÁLNE ZVOLENÉHO režimu (rovnomerne /
	 *  podľa posuvu) — jedno miesto, ktoré používa aj „Počet polí", aj tlačidlo
	 *  „Rozdeliť" nižšie, nech neexistujú dve rôzne cesty k tomu istému výpočtu */
	function vypocitajPolia(n: number): (number | string)[] {
		if (sirkaNum <= 0) return Array.from({ length: n }, () => '');
		return delenieS === 'posuv'
			? rozpocitajPodlaPosuvu(sirkaNum, systemS, n)
			: rovnomernePolia(sirkaNum, n);
	}
	function nastavPocet(n: number) {
		const k = Math.max(1, Math.min(FIX_MAX_POLI, n));
		poliaS = vypocitajPolia(k);
	}
	function rozdelit() {
		poliaS = vypocitajPolia(pocetPoli);
	}
	/** zmena delenia/systému prepočíta UŽ ZADANÉ polia rovno — operátor nemusí
	 *  ručne klikať na „Rozdeliť" po každej zmene voľby (nález pri návrhu #85) */
	function zmenDelenie(d: FixDelenie) {
		delenieS = d;
		if (poliaS.length > 1) poliaS = vypocitajPolia(pocetPoli);
	}
	function zmenSystem(s: FixSystem) {
		systemS = s;
		if (delenieS === 'posuv' && poliaS.length > 1) poliaS = vypocitajPolia(pocetPoli);
	}
	// Jedno pole = celá šírka; drž ho v súlade so zadanou šírkou, nech užívateľ
	// nemusí prepisovať dve políčka naraz. POZOR: efekt zapisuje to, čo aj číta —
	// bez porovnania hodnoty by sa zacyklil (effect_update_depth_exceeded, chytené e2e).
	$effect(() => {
		if (poliaS.length === 1 && sirkaNum > 0 && cislo(poliaS[0]!) !== sirkaNum) poliaS = [sirkaNum];
	});

	let poliaJSON = $derived(JSON.stringify(poliaS.length ? poliaS : sirkaNum ? [sirkaNum] : []));
</script>

<svelte:head><title>Fixy — pevné zasklenie</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="nazov" value={vstup.nazov} />
	<input type="hidden" name="tvar" value={vstup.tvar} />
	<input type="hidden" name="s" value={vstup.s} />
	<input type="hidden" name="v1" value={vstup.v1} />
	<input type="hidden" name="v2" value={vstup.v2} />
	<input type="hidden" name="polia" value={JSON.stringify(vstup.polia)} />
	<input type="hidden" name="delenie" value={vstup.delenie} />
	<input type="hidden" name="system" value={vstup.system} />
	<input type="hidden" name="ral" value={vstup.ral} />
	<input type="hidden" name="sklo" value={vstup.sklo} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	{#if vstup.zrkadlo}<input type="hidden" name="zrkadlo" value="1" />{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Fixy — pevné zasklenie</h1>
		<p class="sub">
			Vyber tvar a zadaj rozmery — vykreslím konštrukciu s kótami, dielňa reže podľa výkresu.
			<b>Šikmý</b> má šikmú hornú hranu (do boku pergoly, dve rôzne výšky),
			<b>rovný (pravouhlý)</b> je obdĺžnik s jednou výškou.
			<b>Do Money sa neposiela nič</b> — tento modul len kreslí.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/vykres">
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
			<div class="field">
				<label for="nazov">Názov kusu na výkrese (nepovinné)</label>
				<input
					id="nazov"
					name="nazov"
					bind:value={nazovS}
					maxlength="60"
					placeholder="napr. FIX bok pergoly"
				/>
			</div>
			<div class="field">
				<label for="tvar">Tvar</label>
				<select id="tvar" name="tvar" bind:value={tvarS}>
					<option value="sikmy">Šikmý (šikmá horná hrana)</option>
					<option value="rovny">Rovný (pravouhlý)</option>
				</select>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="s">Šírka (mm) *</label>
					<input
						id="s"
						name="s"
						type="number"
						min="300"
						max={FIX_MAX}
						step="any"
						bind:value={sirkaS}
						required
					/>
				</div>
				{#if tvarS === 'rovny'}
					<!-- rovný fix má JEDNU výšku; server si ju skopíruje aj do druhej -->
					<div class="field">
						<label for="v1">Výška (mm) *</label>
						<input
							id="v1"
							name="v1"
							type="number"
							min="1"
							max={FIX_MAX}
							step="any"
							bind:value={v1S}
							required
						/>
					</div>
				{:else}
					<div class="field">
						<label for="v1">Výška vľavo (mm) *</label>
						<input
							id="v1"
							name="v1"
							type="number"
							min="0"
							max={FIX_MAX}
							step="any"
							bind:value={v1S}
							required
						/>
					</div>
					<div class="field">
						<label for="v2">Výška vpravo (mm) *</label>
						<input
							id="v2"
							name="v2"
							type="number"
							min="0"
							max={FIX_MAX}
							step="any"
							bind:value={v2S}
							required
						/>
					</div>
				{/if}
			</div>

			<!-- delenie na polia (stĺpiky) — ako L1/L2/L3 na výrobnom výkrese -->
			<div class="field">
				<label for="pocet">Počet polí (stĺpiky medzi nimi)</label>
				<select
					id="pocet"
					value={pocetPoli}
					onchange={(e) => nastavPocet(Number((e.currentTarget as HTMLSelectElement).value))}
				>
					{#each Array(FIX_MAX_POLI) as _, i (i)}<option value={i + 1}>{i + 1}</option>{/each}
				</select>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="delenie">Rozpočítanie polí</label>
					<select
						id="delenie"
						name="delenie"
						value={delenieS}
						onchange={(e) =>
							zmenDelenie((e.currentTarget as HTMLSelectElement).value as FixDelenie)}
					>
						<option value="rovnomerne">Rovnomerne</option>
						<option value="posuv">Podľa posuvu (Robust/Slide/Štandard)</option>
					</select>
				</div>
				{#if delenieS === 'posuv'}
					<div class="field">
						<label for="system">Systém posuvu</label>
						<select
							id="system"
							name="system"
							value={systemS}
							onchange={(e) =>
								zmenSystem((e.currentTarget as HTMLSelectElement).value as FixSystem)}
						>
							{#each FIX_SYSTEMY as s (s)}<option value={s}>{s}</option>{/each}
						</select>
					</div>
				{/if}
			</div>
			{#if delenieS === 'posuv'}
				<p class="sub" data-testid="posuv-info">
					{#if pocetPoli === 2}
						Dve polia: delí sa presne na stred (50/50) — systém posuvu sa pri dvoch poliach
						neuplatňuje.
					{:else}
						Krajné pole {fmt(KRAJNY[systemS])} mm (od každého kraja k stredu priečky posuvu), priečka
						posuvu {fmt(PRIECKA[systemS])} mm — hranica poľa je jej STRED, súčet polí sedí presne na šírku.
					{/if}
				</p>
			{/if}
			{#if poliaS.length > 1}
				<div class="polia-box" data-testid="polia-box">
					<div class="grid3">
						{#each poliaS as _, i (i)}
							<div class="field">
								<label for={`pole${i}`}>Šírka poľa {i + 1} (mm)</label>
								<input
									id={`pole${i}`}
									type="number"
									min={FIX_MIN}
									max={FIX_MAX}
									step="any"
									bind:value={poliaS[i]}
								/>
							</div>
						{/each}
					</div>
					<div class="row">
						<span
							>Súčet polí: <b data-testid="sucet-poli">{fmt(sucetPoli)} mm</b>
							{#if !sedíSucet}<span class="nesedi">
									⛔ nesedí so šírkou {fmt(sirkaNum)} mm</span
								>{/if}
							{#if poleMimoRozsahu}<span class="nesedi" data-testid="pole-mimo-rozsahu">
									{#if pocetPoli === 2}
										⛔ šírka {fmt(sirkaNum)} mm je na 2 polia príliš úzka (minimálna šírka poľa {FIX_MIN}
										mm), uprav šírku alebo počet polí
									{:else}
										⛔ šírka {fmt(sirkaNum)} mm je pre {systemS} a {pocetPoli}
										{pocetPoli === 1 ? 'pole' : pocetPoli < 5 ? 'polia' : 'polí'} nevhodná — krajné pole
										({fmt(KRAJNY[systemS])} mm) sa nezmestí, uprav šírku alebo počet polí
									{/if}</span
								>{/if}
						</span>
						<button
							type="button"
							class="btn secondary"
							onclick={rozdelit}
							data-testid="rozdelit-btn"
							>{delenieS === 'posuv' ? 'Rozdeliť podľa posuvu' : 'Rozdeliť rovnomerne'}</button
						>
					</div>
				</div>
			{/if}

			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input
						type="checkbox"
						name="zrkadlo"
						value="1"
						bind:checked={zrkadloS}
						style="width:auto"
					/>
					🔁 Zrkadlový kus (druhá strana pergoly)
				</label>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="ral">RAL (farba)</label>
					<input id="ral" name="ral" bind:value={ralS} maxlength="40" placeholder="napr. 7016" />
				</div>
				<div class="field">
					<label for="sklo">Sklo (voľný text)</label>
					<input
						id="sklo"
						name="sklo"
						bind:value={skloS}
						maxlength="120"
						placeholder="napr. 4-8-4 IZO číre"
					/>
				</div>
			</div>
			<div class="field">
				<label for="poznamka">Poznámka (viacriadková — ide aj do tlače)</label>
				<textarea
					id="poznamka"
					name="poznamka"
					rows="3"
					bind:value={poznamkaS}
					maxlength="300"
					style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"
				></textarea>
			</div>

			<input type="hidden" name="polia" value={poliaJSON} />
			<button
				class="btn"
				type="submit"
				disabled={!sedíSucet || poleMimoRozsahu}
				data-testid="nakreslit">Nakresliť výkres</button
			>
		</form>
	</div>
{:else if step === 'vykres' && r}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="fix-badge"
				>Fix {popisTvaru(vstup.tvar)}{vstup.nazov ? ` · ${vstup.nazov}` : ''} · {r.polia.length}
				{r.polia.length === 1 ? 'pole' : r.polia.length < 5 ? 'polia' : 'polí'}{vstup.zrkadlo
					? ' · zrkadlový kus'
					: ''}</span
			>
			<span class="badge">ZAK {vstup.zak}</span>
			{#if vstup.delenie === 'posuv'}
				<span class="badge" data-testid="delenie-badge">Podľa posuvu · {vstup.system}</span>
			{/if}
		</p>
	</div>

	{#if vstup.poznamka || vstup.ral || vstup.sklo}
		<div class="card" data-testid="fix-hlavicka">
			{#if vstup.poznamka}<div class="row">
					<span>Poznámka</span><b style="white-space:pre-wrap">{vstup.poznamka}</b>
				</div>{/if}
			{#if vstup.ral}<div class="row"><span>RAL</span><b>{vstup.ral}</b></div>{/if}
			{#if vstup.sklo}<div class="row"><span>Sklo</span><b>{vstup.sklo}</b></div>{/if}
		</div>
	{/if}

	<div class="card">
		<div class="sec">Výkres konštrukcie</div>
		<FixVykres2D {r} zrkadlo={vstup.zrkadlo} oznacenie={vstup.zrkadlo ? 'P' : 'L'} />
	</div>

	<div class="card">
		<div class="sec">Rozmery konštrukcie</div>
		<div class="g">
			<div><span>Šírka</span><b>{fmt(r.S)} mm</b></div>
			{#if vstup.tvar === 'rovny'}
				<div><span>Výška</span><b>{fmt(r.V1)} mm</b></div>
			{:else}
				<div><span>Výška vľavo</span><b>{fmt(r.V1)} mm</b></div>
				<div><span>Výška vpravo</span><b>{fmt(r.V2)} mm</b></div>
				<div><span>Sklon</span><b data-testid="uhol-sklonu">{fmt(r.alfa)}°</b></div>
				<div><span>Šikmá hrana</span><b>{fmt(r.sikmaCelkom)} mm</b></div>
				<div><span>Uhly konštrukcie</span><b>{fmt(r.uholOstry)}° / {fmt(r.uholTupy)}°</b></div>
			{/if}
			<div><span>Plocha</span><b>{String(r.m2).replace('.', ',')} m²</b></div>
		</div>
		{#if vstup.delenie === 'posuv'}
			<p class="sub" data-testid="posuv-info-vykres" style="margin-top:10px">
				{#if vstup.polia.length === 2}
					Delenie polí: podľa posuvu — dve polia sa delia presne na stred (50/50), systém posuvu sa
					neuplatňuje.
				{:else}
					Delenie polí: podľa posuvu ({vstup.system}) — krajné pole {fmt(KRAJNY[vstup.system])} mm, priečka
					posuvu {fmt(PRIECKA[vstup.system])} mm (informatívne, hranica poľa je jej stred).
				{/if}
			</p>
		{/if}
	</div>

	<div class="card">
		<div class="sec">Polia</div>
		<table data-testid="fix-tabulka">
			<thead>
				{#if vstup.tvar === 'rovny'}
					<tr><th>Pole</th><th>Šírka</th><th>Výška</th><th class="c">Plocha</th></tr>
				{:else}
					<tr
						><th>Pole</th><th>Šírka</th><th>Výška vľavo</th><th>Výška vpravo</th><th>Šikmá hrana</th
						><th class="c">Plocha</th></tr
					>
				{/if}
			</thead>
			<tbody>
				{#each r.polia as p, i (i)}
					<tr>
						<td><b>{vstup.zrkadlo ? 'P' : 'L'}{r.V1 >= r.V2 ? i + 1 : r.polia.length - i}</b></td>
						<td>{fmt(p.sirka)} mm</td>
						{#if vstup.tvar === 'rovny'}
							<td>{fmt(p.vLavo)} mm</td>
						{:else}
							<td>{fmt(p.vLavo)} mm</td>
							<td>{fmt(p.vPravo)} mm</td>
							<td>{fmt(p.sikma)} mm</td>
						{/if}
						<td class="c">{String(p.m2).replace('.', ',')} m²</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="sub" style="margin-top:10px">
			Výšky sú VONKAJŠIE rozmery konštrukcie (na výrobnom výkrese sú kótované svetlé rozmery skla,
			ktoré sú o hrúbku rámu menšie).
		</p>
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/fix')}>➕ Nový výkres</a>
	</div>
{/if}

<style>
	.polia-box {
		border: 1px solid #bfdbfe;
		background: #f8fbff;
		border-radius: 10px;
		padding: 10px 12px 2px;
		margin-bottom: 12px;
	}
	.nesedi {
		color: #b91c1c;
		font-weight: 600;
	}
</style>
