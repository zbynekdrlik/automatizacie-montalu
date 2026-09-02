<script lang="ts">
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	let vstup = $derived(
		form?.vstup ?? {
			zak: '',
			op: '',
			zakaznik: '',
			model: 'Premier',
			kolaj: 'Jednokolaj',
			pocetSekcii: '' as unknown as number,
			pocetPriecok: 0,
			dvere: false,
			vs4500: 0,
			vs6000: 0,
			ss4500: 0,
			ss6000: 0,
			ms4500: 0,
			ms6000: 0,
			dlzkaKolajnic: 0,
			prieckovy4300: 0,
			prieckovy6000: 0,
			vyklopneCelo: 0,
			caka: false,
			aretaciaTyp: 'manualna',
			aretaciaStrana: 'P',
			uzamykatelna: false,
			ralKrytiek: 'R9006',
			pantFarba: 'ELOX',
			vetraciaKlapka: false
		}
	);

	let step = $derived(form?.step ?? 'form');

	// poradie kvôli grid3 rozloženiu: prvý riadok VS/SS/MS do 4500,
	// druhý riadok to isté do 6000 (Dominik)
	const cisla: [keyof typeof vstup, string][] = [
		['vs4500', 'VS do 4500 (počet sekcií)'],
		['ss4500', 'SS do 4500 (počet sekcií)'],
		['ms4500', 'MS do 4500 (počet sekcií)'],
		['vs6000', 'VS do 6000 (počet sekcií)'],
		['ss6000', 'SS do 6000 (počet sekcií)'],
		['ms6000', 'MS do 6000 (počet sekcií)'],
		['prieckovy4300', 'Priečkový 4300 (počet)'],
		['prieckovy6000', 'Priečkový 6000 (počet)'],
		['vyklopneCelo', 'Výklopné čelo (počet)']
	];
</script>

<svelte:head><title>Bazén — odpis materiálu</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="model" value={vstup.model} />
	<input type="hidden" name="kolaj" value={vstup.kolaj} />
	<input type="hidden" name="pocetSekcii" value={vstup.pocetSekcii} />
	<input type="hidden" name="pocetPriecok" value={vstup.pocetPriecok} />
	{#if vstup.dvere}<input type="hidden" name="dvere" value="1" />{/if}
	{#each cisla as [k] (k)}
		<input type="hidden" name={k} value={vstup[k]} />
	{/each}
	<input type="hidden" name="dlzkaKolajnic" value={vstup.dlzkaKolajnic} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
	<input type="hidden" name="aretaciaTyp" value={vstup.aretaciaTyp} />
	<input type="hidden" name="aretaciaStrana" value={vstup.aretaciaStrana} />
	{#if vstup.uzamykatelna}<input type="hidden" name="uzamykatelna" value="1" />{/if}
	<input type="hidden" name="ralKrytiek" value={vstup.ralKrytiek} />
	<input type="hidden" name="pantFarba" value={vstup.pantFarba} />
	{#if vstup.vetraciaKlapka}<input type="hidden" name="vetraciaKlapka" value="1" />{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Bazén — odpis materiálu do Money</h1>
		<p class="sub">
			Zadaj parametre krytu, rozpis si skontroluješ a upravíš pred odoslaním.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
		<p class="sub">
			📐 Potrebuješ zákaznícky návrhový výkres namiesto Money odpisu?
			<a href={resolve('/bazen/navrh')} data-testid="link-navrh">→ Návrhový výkres</a>
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/spocitat">
			<div class="grid3">
				<div class="field">
					<label for="zak">Číslo objednávky (ZAK) *</label>
					<input id="zak" name="zak" value={vstup.zak} required />
				</div>
				<div class="field">
					<label for="op">OP/OPDL číslo *</label>
					<input id="op" name="op" value={vstup.op} required />
				</div>
				<div class="field">
					<label for="zakaznik">Zákazník *</label>
					<input id="zakaznik" name="zakaznik" value={vstup.zakaznik} required />
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="model">Model</label>
					<select id="model" name="model" value={vstup.model}>
						<option>Premier</option>
						<option>Exclusive</option>
						<option>Star</option>
					</select>
				</div>
				<div class="field">
					<label for="kolaj">Koľaj</label>
					<select id="kolaj" name="kolaj" value={vstup.kolaj}>
						<option>Jednokolaj</option>
						<option>Dvojkolaj</option>
					</select>
				</div>
				<div class="field">
					<label for="pocetSekcii">Počet sekcií *</label>
					<input
						id="pocetSekcii"
						name="pocetSekcii"
						type="number"
						min="1"
						max="100"
						step="1"
						value={vstup.pocetSekcii}
						required
					/>
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="pocetPriecok">Počet priečok</label>
					<input
						id="pocetPriecok"
						name="pocetPriecok"
						type="number"
						min="0"
						max="100"
						step="1"
						value={vstup.pocetPriecok}
					/>
				</div>
				<div class="field">
					<label for="dlzkaKolajnic">Celková dĺžka koľajníc (mm)</label>
					<input
						id="dlzkaKolajnic"
						name="dlzkaKolajnic"
						type="number"
						min="0"
						max="200000"
						step="any"
						value={vstup.dlzkaKolajnic}
					/>
				</div>
				<div class="field">
					<label class="opt opt-grid">
						<input type="checkbox" name="dvere" value="1" checked={vstup.dvere} />
						Dvere
					</label>
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="aretaciaTyp">Aretácia</label>
					<select id="aretaciaTyp" name="aretaciaTyp" value={vstup.aretaciaTyp}>
						<option value="manualna">manuálna</option>
						<option value="automaticka">automatická</option>
					</select>
				</div>
				<div class="field">
					<label for="aretaciaStrana">Strana aretácie</label>
					<select id="aretaciaStrana" name="aretaciaStrana" value={vstup.aretaciaStrana}>
						<option value="P">pravá (P)</option>
						<option value="L">ľavá (L)</option>
					</select>
				</div>
				<div class="field">
					<label class="opt opt-grid">
						<input type="checkbox" name="uzamykatelna" value="1" checked={vstup.uzamykatelna} />
						Uzamykateľná páčka
					</label>
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="ralKrytiek">RAL krytiek</label>
					<select id="ralKrytiek" name="ralKrytiek" value={vstup.ralKrytiek}>
						<option value="R9006">R9006</option>
						<option value="R7016">R7016</option>
					</select>
				</div>
				<div class="field">
					<label for="pantFarba">Pant výklopného čela</label>
					<select id="pantFarba" name="pantFarba" value={vstup.pantFarba}>
						<option value="ELOX">ELOX</option>
						<option value="9005">9005</option>
					</select>
				</div>
				<div class="field">
					<label class="opt opt-grid">
						<input type="checkbox" name="vetraciaKlapka" value="1" checked={vstup.vetraciaKlapka} />
						Vetracia klapka
					</label>
				</div>
			</div>
			<div class="grid3">
				{#each cisla as [k, label] (k)}
					<div class="field">
						<label for={k}>{label}</label>
						<input id={k} name={k} type="number" min="0" max="100" step="1" value={vstup[k]} />
					</div>
				{/each}
			</div>
			<div class="field">
				<label class="opt">
					<input type="checkbox" name="caka" value="1" checked={vstup.caka} />
					Čaká na materiál (odloží import do priečinka NA ODPIS/Bazen)
				</label>
			</div>
			<button class="btn" type="submit">Spočítať rozpis</button>
		</form>
	</div>
{:else if step === 'kontrola' && form && 'out' in form && form.out}
	<div class="card">
		<h1>Kontrola rozpisu — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Bazén · {vstup.model} · {vstup.kolaj} · {vstup.pocetSekcii} sekcií</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
		<p class="sub">
			Množstvá môžeš upraviť — prázdne pole = automatická hodnota. Záporné a nečíselné hodnoty sa
			odmietnu.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="kontrola-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
			<table data-testid="kontrola-tabulka">
				<thead
					><tr
						><th></th><th>Kód</th><th>Položka</th><th class="c" style="width:160px">Množstvo</th
						></tr
					></thead
				>
				<tbody>
					{#each form.out as o (o.kod)}
						<tr>
							<td style="width:52px"><ProfilObrazok kod={o.kod} nazov={o.nazov} /></td>
							<td class="c">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c">
								<!-- bez min/max — rozsahy stráži server (applyEdits), nech typo dostane
								     zrozumiteľnú chybu namiesto tichého browser tooltipu -->
								<input
									name="qty_{o.kod}"
									type="number"
									step="any"
									value={(form && 'editVals' in form && form.editVals?.[o.kod]) || o.qty}
									aria-label="Množstvo {o.kod}"
									style="padding:6px 8px;font-size:14px;text-align:center;width:90px"
								/>
								<span style="margin-left:6px;color:#6b7280;font-size:13px">{o.mj ?? 'm'}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div style="height:12px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat">
				{data.live
					? vstup.caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Bazen)'
						: '✅ Odoslať odpis do Money'
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary noprint" onclick={() => window.print()}
			>🖨 Tlačiť / uložiť PDF</button
		>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hiddenVstup()}
			<button class="btn secondary noprint" type="submit">← Späť a upraviť zadanie</button>
		</form>
	</div>
{:else if step === 'hotovo' && form && 'finalOut' in form && form.finalOut && form.outcome}
	<div class="card">
		<h1>Hotovo — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub"><span class="badge">Bazén · {vstup.model}</span></p>
	</div>

	<div class="okmsg" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Bazen, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	<div class="card">
		<div class="sec">Money rozpis — {form.finalOut.filter((o) => o.qty > 0).length} položiek</div>
		{#each form.finalOut.filter((o) => o.qty > 0) as o (o.kod)}
			<div class="row" style="align-items:center;gap:12px">
				<ProfilObrazok kod={o.kod} nazov={o.nazov} />
				<span style="flex:1"
					><span class="mono">{o.kod}</span> · {o.nazov}{form.zmenene.includes(o.kod)
						? ' ✏️'
						: ''}</span
				>
				<b>{fmtM(o.qty)} {o.mj ?? 'm'}</b>
			</div>
		{/each}
		{#if form.finalOut.some((o) => o.qty <= 0 && form.zmenene.includes(o.kod))}
			<p class="sub" style="margin-top:10px">
				Vynulované úpravou:
				{form.finalOut
					.filter((o) => o.qty <= 0 && form.zmenene.includes(o.kod))
					.map((o) => o.kod)
					.join(', ')}
			</p>
		{/if}
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/bazen')}>➕ Nový rozpis</a>
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
		<a class="btn secondary" href={resolve('/bazen')}>← Späť na formulár</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}
