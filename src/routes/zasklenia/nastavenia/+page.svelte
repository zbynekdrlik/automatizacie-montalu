<script lang="ts">
	import { nazovSysStyl } from '$lib/system-nazvy';
	import { resolve } from '$app/paths';
	import { POZNAMKY } from '$lib/nastavenia-poznamky';

	let { data, form } = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	function vyberStyl(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		window.location.href = `/zasklenia/nastavenia?sysStyl=${encodeURIComponent(v)}`;
	}
</script>

<svelte:head><title>Vzorce — Nastavenia</title></svelte:head>

<div class="card">
	<h1>⚙ Vzorce — nastavenia rezov</h1>
	<p class="sub">
		Odsadenia (mm) v vzorci <i>rez = rozmer + odsadenie</i> (šírkové sa delia počtom polí). Zmeny sa uložia
		naraz, s históriou kto/kedy/čo. Preklepy mimo ±500 mm sa odmietnu.
	</p>
</div>

{#if form?.error}
	<div class="err" data-testid="nastavenia-error">⚠️ {form.error}</div>
{/if}

{#if form?.ulozene}
	<div class="okmsg" data-testid="nastavenia-ulozene">
		✅ Nastavenia uložené — {nazovSysStyl(form.sysStyl)}.
		{#if form.zmeny.length === 0}Žiadna hodnota sa nezmenila.{/if}
	</div>
	{#if form.zmeny.length > 0}
		<div class="card">
			<div class="sec">Zmeny</div>
			{#each form.zmeny as z (z.pole)}
				<div class="row"><span>{z.pole}</span><b>{z.stara} → {z.nova}</b></div>
			{/each}
		</div>
	{/if}
	{#if form.preview?.pred && form.preview?.po}
		<div class="card">
			<div class="sec">Kontrolný odpis pri {form.preview.S}×{form.preview.V} mm (pred → po)</div>
			{#each form.preview.po.odpis as o, i (o.kod)}
				{@const pred = form.preview.pred.odpis[i]}
				<div class="row">
					<span>{o.kod} · {o.nazov}</span>
					<b>{pred && pred.metre !== o.metre ? `${fmtM(pred.metre)} → ` : ''}{fmtM(o.metre)} m</b>
				</div>
			{/each}
			<div class="row">
				<span>Sklo (Š×V)</span>
				<b>
					{#if form.preview.pred.sklo.sirka !== form.preview.po.sklo.sirka || form.preview.pred.sklo.vyska !== form.preview.po.sklo.vyska}
						{fmtM(form.preview.pred.sklo.sirka)}×{fmtM(form.preview.pred.sklo.vyska)} →
					{/if}
					{fmtM(form.preview.po.sklo.sirka)} × {fmtM(form.preview.po.sklo.vyska)} mm · {form.preview
						.po.sklo.pocet} ks
				</b>
			</div>
		</div>
	{/if}
	<div class="card noprint">
		<a
			class="btn secondary"
			href={resolve(`/zasklenia/nastavenia?sysStyl=${encodeURIComponent(form.sysStyl)}`)}
			>➕ Upraviť ďalší štýl</a
		>
		<a class="btn secondary" href={resolve('/zasklenia')}>→ Späť na Zasklenia</a>
	</div>
{:else if data.editable}
	<div class="card">
		<div class="field">
			<label for="vyber">Systém · štýl</label>
			<select id="vyber" onchange={vyberStyl} value={data.sysStyl}>
				{#each data.styly as st (st.sysStyl)}
					<option value={st.sysStyl}>{nazovSysStyl(st.sysStyl)}</option>
				{/each}
			</select>
		</div>

		<form method="POST" action="?/ulozit">
			<input type="hidden" name="sysStyl" value={data.sysStyl} />

			<div class="sec" style="margin-top:16px">Odsadenia profilov (mm)</div>
			{#each data.editable.rows as r (r.id)}
				<div class="field">
					<label for="offset_{r.id}"
						>{r.nazov} · {r.dim === 'S' ? 'Šírka' : 'Výška'} — odsadenie</label
					>
					<input
						id="offset_{r.id}"
						name="offset_{r.id}"
						type="number"
						step="any"
						min="-500"
						max="500"
						value={r.offset}
						required
					/>
				</div>
			{/each}

			<div class="field">
				<label for="skloOffset">Sklo — konečné zmenšenie (mm)</label>
				<input
					id="skloOffset"
					name="skloOffset"
					type="number"
					step="any"
					min="0"
					max="500"
					value={data.editable.skloOffset}
					required
				/>
			</div>

			{#if data.maTrieda6 || data.maTrieda16}
				<div class="sec" style="margin-top:16px">Korekcia skla podľa triedy (6mm / 16mm)</div>
				<p class="pozn">{POZNAMKY.korekcia}</p>
				<p class="sub" style="margin-bottom:10px">
					Nastav RAZ pre celú triedu — platí pre všetky sklá tej triedy v systéme {data.system}.
					<b>Prázdne pole = systémová korekcia</b> („Sklo — konečné zmenšenie" vyššie).
				</p>
				<div class="grid2">
					{#if data.maTrieda6}
						<div class="field">
							<label for="trieda_6">Trieda 6 mm — korekcia rozmeru (mm)</label>
							<input
								id="trieda_6"
								name="trieda_6"
								type="number"
								step="1"
								min="0"
								max="500"
								value={data.trieda6Korekcia ?? ''}
								placeholder="systémová"
							/>
						</div>
					{/if}
					{#if data.maTrieda16}
						<div class="field">
							<label for="trieda_16">Trieda 16 mm — korekcia rozmeru (mm)</label>
							<input
								id="trieda_16"
								name="trieda_16"
								type="number"
								step="1"
								min="0"
								max="500"
								value={data.trieda16Korekcia ?? ''}
								placeholder="systémová"
							/>
						</div>
					{/if}
				</div>
			{/if}

			<div class="sec" style="margin-top:16px">Sklá — nulovanie Redukcie 6mm</div>
			<p class="pozn">{POZNAMKY.redukcia}</p>
			<p class="sub" style="margin-bottom:10px">
				Zaškrtnuté sklo znamená: pri tomto skle sa Redukcia 6mm do odpisu NEpočíta. Platí len pre
				systém {data.system} (Redukcia 6mm má vplyv iba v systéme Slide). Sklá s klasifikovanou triedou
				(6mm/16mm vyššie) tu nie sú — ich redukcia sa odvodzuje z triedy automaticky.
			</p>
			{#each data.glass.filter((g) => g.hrubkaTrieda === null) as g (g.id)}
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							type="checkbox"
							name="glass_{g.id}"
							value="1"
							checked={g.redukciaZero}
							style="width:auto"
						/>
						{g.nazov}
					</label>
				</div>
			{/each}

			{#if data.glass.some((g) => g.skloKorekcia !== null)}
				<div class="sec" style="margin-top:16px">Sklá — per-sklo výnimka korekcie (mm)</div>
				<p class="sub" style="margin-bottom:10px">
					Staršia korekcia pre KONKRÉTNE sklo (#440) — dnes výnimka nad triedovou korekciou vyššie.
					Zobrazujú sa len sklá, ktoré override reálne majú.
					<b>Prázdne pole = zruš výnimku</b> (padne na triedovú/systémovú korekciu).
				</p>
				{#each data.glass.filter((g) => g.skloKorekcia !== null) as g (g.id)}
					<div class="field">
						<label for="korekcia_{g.id}">{g.nazov} — korekcia rozmeru</label>
						<input
							id="korekcia_{g.id}"
							name="korekcia_{g.id}"
							type="number"
							step="1"
							min="0"
							max="500"
							value={g.skloKorekcia ?? ''}
							placeholder="systémová"
						/>
					</div>
				{/each}
			{/if}

			<div class="sec" style="margin-top:16px">Kontrolné rozmery pre náhľad odpisu</div>
			<div class="grid2">
				<div class="field">
					<label for="previewS">Šírka (mm)</label>
					<input id="previewS" name="previewS" type="number" step="any" value="5000" />
				</div>
				<div class="field">
					<label for="previewV">Výška (mm)</label>
					<input id="previewV" name="previewV" type="number" step="any" value="2000" />
				</div>
			</div>

			<button class="btn" type="submit" data-testid="ulozit-vzorce">💾 Uložiť vzorce</button>
		</form>
	</div>

	{#if data.audit.length > 0}
		<div class="card">
			<div class="sec">História zmien</div>
			{#each data.audit as a, i (i)}
				<div class="row" style="flex-direction:column;align-items:flex-start;gap:2px">
					<span><b>{a.ts}</b> · {a.username || '—'} · {a.sys_styl.replace('|', ' ')}</span>
					<span style="color:#64748b">
						{a.zmeny
							.map(
								(z: { pole: string; stara: number | string; nova: number | string }) =>
									`${z.pole}: ${z.stara} → ${z.nova}`
							)
							.join(' · ')}
					</span>
				</div>
			{/each}
		</div>
	{/if}
{:else}
	<div class="err">Neznámy systém/štýl.</div>
{/if}
