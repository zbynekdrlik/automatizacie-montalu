<script lang="ts">
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import SkladVarovania from '$lib/components/SkladVarovania.svelte';
	import ClipForm from '$lib/components/clip/ClipForm.svelte';
	import ClipNahlad from '$lib/components/ClipNahlad.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import { resolve } from '$app/paths';
	import {
		popisTyp,
		computeClip,
		CLIP_DLZKA_TYCE,
		type ClipVstup,
		type ClipVypocet
	} from '$lib/clip';
	import type { MaterialRow } from '$lib/server/compute';

	let { data, form } = $props();

	const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	// Echo vstupu (single) — hlavička kontroly/hotova + počiatočný stav ClipForm.
	let vstup = $derived(
		(form?.vstup as ClipVstup) ?? {
			zak: '',
			op: '',
			zakaznik: '',
			caka: false,
			typ: 'izo',
			variant: 1,
			sirka: '' as unknown as number,
			vyska: '' as unknown as number,
			ral: ''
		}
	);

	let step = $derived(form?.step ?? 'form');
	// #448/#451 predodpisové skladové varovanie + odobrať (clip — b2b sa na túto route nedostane)
	let skladVarovania = $derived(form && 'skladVarovania' in form ? form.skladVarovania : null);
	let snapshotDatum = $derived(form && 'snapshotDatum' in form ? form.snapshotDatum : null);

	// #461: vylúčené kódy z SkladVarovania — bindable, ide do hidden inputu vo formulári
	let vyluceneKody = $state('');

	// multi vstup z echovaného servera (kontrolaMulti/hotovoMulti + init ClipForm pri chybe)
	let multiVstup = $derived(
		form && 'multiVstup' in form && form.multiVstup
			? (form.multiVstup as {
					zak: string;
					op: string;
					zakaznik: string;
					caka: boolean;
					kusy: ClipVstup[];
				})
			: null
	);

	// #554 pílový plán (MaterialRow[]) zo servera — display-only (odpis nezmenený)
	let narez = $derived(
		form && 'narez' in form && form.narez ? (form.narez as MaterialRow[]) : null
	);
</script>

<svelte:head><title>CLIP zábradlie — odpis materiálu</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="typ" value={vstup.typ} />
	<input type="hidden" name="variant" value={vstup.variant} />
	<input type="hidden" name="sirka" value={vstup.sirka} />
	<input type="hidden" name="vyska" value={vstup.vyska} />
	<input type="hidden" name="ral" value={vstup.ral} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet hiddenMulti()}
	<!-- multi zadanie sa nesie DOPREDU zo servera (echo multiVstup) — clipKusy = všetky kusy -->
	<input type="hidden" name="zak" value={multiVstup?.zak ?? ''} />
	<input type="hidden" name="op" value={multiVstup?.op ?? ''} />
	<input type="hidden" name="zakaznik" value={multiVstup?.zakaznik ?? ''} />
	<input type="hidden" name="clipKusy" value={JSON.stringify(multiVstup?.kusy ?? [])} />
	{#if multiVstup?.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet rozpisRezovSekcia(material: MaterialRow[])}
	<div class="card" data-testid="clip-rozpis-rezov">
		<div class="sec">Rozpis rezov na tyče — pre pílu</div>
		<p class="sub" style="margin-bottom:14px">
			Každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci (dĺžka tyče {fmt(
				CLIP_DLZKA_TYCE
			)} mm, kotúč 4 mm). Počet tyčí v odpise = ROUNDUP podľa Excelu; pílový plán = optimalizované rozloženie.
		</p>
		<RozpisRezov {material} />
	</div>
{/snippet}

{#snippet clipVyrobnySec(v: ClipVypocet, cv: ClipVstup)}
	<div class="card" data-testid="vyrobny-podklad">
		<div class="sec">Výrobný podklad</div>
		<p class="sub">
			<span class="badge"
				>CLIP · {popisTyp(cv.typ)} · B{cv.variant - 1} ({cv.variant}
				{cv.variant === 1 ? 'výplň' : cv.variant < 5 ? 'výplne' : 'výplní'}) · {cv.sirka}×{cv.vyska}
				mm</span
			>
			{#if cv.ral}<span class="badge">RAL: {cv.ral}</span>{/if}
		</p>
		<p class="sub">
			Výplň: {fmt(v.sirkaVyplne)} × {fmt(v.vyskaVyplne)} mm · {v.pocetVyplni}
			{v.pocetVyplni === 1 ? 'ks' : 'ks'} · {fmt(v.m2)} m²
			{#if v.poziciePriecok.length}
				· priečky od kraja: {v.poziciePriecok.map((p) => fmt(p)).join(', ')} mm
			{/if}
		</p>

		<!-- #554 SVG náhľad výplní s priečkami -->
		<ClipNahlad
			sirka={Number(cv.sirka)}
			vyska={Number(cv.vyska)}
			poziciePriecok={v.poziciePriecok}
		/>

		<div class="sec" style="margin-top:14px">
			Nárez — rozloženie na tyče ({CLIP_DLZKA_TYCE} mm)
		</div>
		<table data-testid="hotovo-narez-tabulka">
			<thead
				><tr
					><th>Označenie</th><th>Kód</th><th class="c">Rozmer</th><th class="c">Ks</th><th class="c"
						>Z tyče</th
					><th class="c">Tyče</th><th class="c">Množstvo</th></tr
				></thead
			>
			<tbody>
				{#each v.riadky as r, i (i)}
					<tr class:drobna={r.kod === null}>
						<td>{r.oznacenie}</td>
						<td class="c mono">{r.kod ?? '—'}</td>
						<td class="c mono">{r.rozmer === null ? '—' : `${fmt(r.rozmer)} mm`}</td>
						<td class="c mono">{r.rozmer === null ? '—' : r.pocetKs}</td>
						<td class="c mono">{r.zaokruhlene ?? '—'}</td>
						<td class="c mono">{r.pocetTyci ?? '—'}</td>
						<td class="c">
							<span class="mono">{fmt(r.mnozstvo)} {r.mj}</span>
							{#if r.poznamka}<span class="hint" title={r.poznamka}>· neodpisuje sa</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>CLIP zábradlie — odpis materiálu do Money</h1>
		<p class="sub">
			Zadaj rozmer zábradlia a počet výplní, rozpis si skontroluješ a upravíš pred odoslaním. Viac
			zábradlí naraz pridáš tlačidlom „➕ Pridať zábradlie" — spočíta sa jeden spoločný odpis.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<!-- #554: zjednotený formulár ako zasklenia — prvé zábradlie = základ, „➕ Pridať
	     zábradlie" VŽDY viditeľné (single ↔ multi cez formaction, žiadny prepínač) -->
	<ClipForm {vstup} {multiVstup} />
{:else if step === 'kontrola' && form && 'vypocet' in form && form.vypocet}
	{@const v = form.vypocet}
	<div class="card">
		<h1>Kontrola rozpisu — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge"
				>CLIP · {popisTyp(vstup.typ)} · B{vstup.variant - 1} ({vstup.variant} výplní) · {vstup.sirka}×{vstup.vyska}
				mm</span
			>
			{#if vstup.ral}<span class="badge">RAL: {vstup.ral}</span>{/if}
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
		<p class="sub">
			Šírka výplne {fmt(v.sirkaVyplne)} mm · výška výplne {fmt(v.vyskaVyplne)} mm · {fmt(v.m2)} m²
			{#if v.poziciePriecok.length}
				· priečky od kraja: {v.poziciePriecok.map((p) => fmt(p)).join(', ')} mm
			{/if}
		</p>
		<!-- #554 SVG náhľad výplní s priečkami -->
		<ClipNahlad
			sirka={Number(vstup.sirka)}
			vyska={Number(vstup.vyska)}
			poziciePriecok={v.poziciePriecok}
		/>
		<p class="sub">
			Množstvá (počet tyčí) môžeš upraviť — prázdne pole = automatická hodnota. Záporné a nečíselné
			sa odmietnu.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="kontrola-error">⚠️ {form.error}</div>
	{/if}

	<!-- #448/#451: predodpisové skladové varovanie + odobrať pri odpise -->
	<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
			<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
			<div class="sec">Odpis do Money (počet tyčí 7500 mm)</div>
			<table data-testid="kontrola-tabulka">
				<thead
					><tr
						><th></th><th>Kód</th><th>Položka</th><th class="c" style="width:150px">Počet tyčí</th
						></tr
					></thead
				>
				<tbody>
					{#each v.polozky as o (o.kod)}
						<tr>
							<td style="width:52px"><ProfilObrazok kod={o.kod} nazov={o.nazov} /></td>
							<td class="c mono">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c">
								<!-- bez min/max — rozsahy stráži server (applyEdits) -->
								<input
									name="qty_{o.kod}"
									type="number"
									step="1"
									value={(form && 'editVals' in form && form.editVals?.[o.kod]) || o.qty}
									aria-label="Počet tyčí {o.kod}"
									style="padding:6px 8px;font-size:14px;text-align:center;width:90px"
								/>
								<span style="margin-left:6px;color:var(--m-muted-ink);font-size:13px">ks</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="sec" style="margin-top:18px">Nárez (per profil) — informačný</div>
			<table data-testid="narez-tabulka">
				<thead
					><tr
						><th>Označenie</th><th>Kód</th><th class="c">Rozmer</th><th class="c">Ks</th><th
							class="c">Tyče</th
						><th class="c">Množstvo</th></tr
					></thead
				>
				<tbody>
					{#each v.riadky as r, i (i)}
						<tr class:drobna={r.kod === null}>
							<td>{r.oznacenie}</td>
							<td class="c mono">{r.kod ?? '—'}</td>
							<td class="c mono">{r.rozmer === null ? '—' : `${fmt(r.rozmer)} mm`}</td>
							<td class="c mono">{r.rozmer === null ? '—' : r.pocetKs}</td>
							<td class="c mono">{r.pocetTyci ?? '—'}</td>
							<td class="c">
								<span class="mono">{fmt(r.mnozstvo)} {r.mj}</span>
								{#if r.poznamka}<span class="hint" title={r.poznamka}>· neodpisuje sa</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div style="height:12px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat">
				{data.live
					? vstup.caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Clip)'
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

	<!-- #554 pílový plán (rozpis rezov na tyče) — display-only -->
	{#if narez}
		{@render rozpisRezovSekcia(narez)}
	{/if}
{:else if step === 'kontrolaMulti' && form && 'multi' in form && form.multi}
	{@const multi = form.multi}
	<div class="card">
		<h1>
			Kontrola rozpisu — {(form.multiVstup as { zak: string }).zak} · {(
				form.multiVstup as { zakaznik: string }
			).zakaznik}
		</h1>
		<p class="sub">
			<span class="badge">CLIP multi · {multi.kusy.length} kusov</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="kontrola-error">⚠️ {form.error}</div>
	{/if}
	{#if form && 'warn' in form && form.warn}
		<div class="err" data-testid="kontrola-warn">⚠️ {form.warn}</div>
	{/if}

	<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />

	<!-- per-kus detail (nárez) -->
	{#each multi.kusy as kus, ki (ki)}
		{@const mv = (form.multiVstup as { kusy: ClipVstup[] }).kusy[ki]}
		<div class="card" data-testid="kus-detail-{ki}">
			<div class="sec">
				Zábradlie {ki + 1}: {popisTyp(mv?.typ ?? 'izo')} · B{(mv?.variant ?? 1) - 1} · {mv?.sirka ??
					0}×{mv?.vyska ?? 0} mm
				{#if mv?.ral}
					· RAL: {mv.ral}{/if}
			</div>
			<p class="sub">
				Šírka výplne {fmt(kus.sirkaVyplne)} mm · výška {fmt(kus.vyskaVyplne)} mm · {fmt(kus.m2)} m²
			</p>
			<!-- #554 SVG náhľad zábradlia (per kus) -->
			<ClipNahlad
				sirka={Number(mv?.sirka ?? 0)}
				vyska={Number(mv?.vyska ?? 0)}
				poziciePriecok={kus.poziciePriecok}
			/>
			<table>
				<thead
					><tr
						><th>Označenie</th><th>Kód</th><th class="c">Rozmer</th><th class="c">Ks</th><th
							class="c">Tyče</th
						><th class="c">Množstvo</th></tr
					></thead
				>
				<tbody>
					{#each kus.riadky as r, ri (ri)}
						<tr class:drobna={r.kod === null}>
							<td>{r.oznacenie}</td>
							<td class="c mono">{r.kod ?? '—'}</td>
							<td class="c mono">{r.rozmer === null ? '—' : `${fmt(r.rozmer)} mm`}</td>
							<td class="c mono">{r.rozmer === null ? '—' : r.pocetKs}</td>
							<td class="c mono">{r.pocetTyci ?? '—'}</td>
							<td class="c">
								<span class="mono">{fmt(r.mnozstvo)} {r.mj}</span>
								{#if r.poznamka}<span class="hint" title={r.poznamka}>· neodpisuje sa</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/each}

	<!-- spoločný odpis -->
	<div class="card">
		<form method="POST" action="?/odoslatMulti">
			{@render hiddenMulti()}
			<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
			{#if form && 'planHash' in form}<input
					type="hidden"
					name="planHash"
					value={form.planHash}
				/>{/if}
			<div class="sec">Odpis do Money — spoločný (počet tyčí 7500 mm)</div>
			<table data-testid="kontrola-tabulka">
				<thead
					><tr
						><th></th><th>Kód</th><th>Položka</th><th class="c" style="width:150px">Počet tyčí</th
						></tr
					></thead
				>
				<tbody>
					{#each multi.polozky as o (o.kod)}
						<tr>
							<td style="width:52px"><ProfilObrazok kod={o.kod} nazov={o.nazov} /></td>
							<td class="c mono">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c">
								<input
									name="qty_{o.kod}"
									type="number"
									step="1"
									value={(form && 'editVals' in form && form.editVals?.[o.kod]) || o.qty}
									aria-label="Počet tyčí {o.kod}"
									style="padding:6px 8px;font-size:14px;text-align:center;width:90px"
								/>
								<span style="margin-left:6px;color:var(--m-muted-ink);font-size:13px">ks</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div style="height:12px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat-multi">
				{data.live
					? (form.multiVstup as { caka: boolean }).caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Clip)'
						: '✅ Odoslať odpis do Money'
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary noprint" onclick={() => window.print()}
			>🖨 Tlačiť / uložiť PDF</button
		>
		<form method="POST" action="?/upravitMulti" style="display:inline">
			{@render hiddenMulti()}
			<button class="btn secondary noprint" type="submit">← Späť a upraviť zadanie</button>
		</form>
	</div>

	<!-- #554 spoločný pílový plán (zdieľané tyče naprieč zábradliami) — display-only -->
	{#if narez}
		{@render rozpisRezovSekcia(narez)}
	{/if}
{:else if step === 'hotovo' && form && 'finalOut' in form && form.finalOut && form.outcome}
	{@const hv = computeClip(vstup)}
	<div class="card">
		<h1>Hotovo — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">CLIP · {popisTyp(vstup.typ)} · B{vstup.variant - 1}</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Clip, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	{@render clipVyrobnySec(hv, vstup)}

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
				<b>{fmt(o.qty)} ks</b>
			</div>
		{/each}
	</div>

	<!-- #554 pílový plán -->
	{#if narez}
		{@render rozpisRezovSekcia(narez)}
	{/if}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/clip')}>➕ Nový rozpis</a>
	</div>
{:else if step === 'hotovoMulti' && form && 'multi' in form && form.multi && 'finalOut' in form && form.finalOut && form.outcome}
	{@const mv = form.multiVstup as {
		zak: string;
		zakaznik: string;
		caka: boolean;
		kusy: ClipVstup[];
	}}
	<div class="card">
		<h1>Hotovo — {mv.zak} · {mv.zakaznik}</h1>
		<p class="sub">
			<span class="badge">CLIP multi · {form.multi.kusy.length} kusov</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok-multi">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if mv.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Clip, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	{#each form.multi.kusy as kus, ki (ki)}
		{@const mkv = mv.kusy[ki]}
		{#if mkv}
			{@render clipVyrobnySec(kus, mkv)}
		{/if}
	{/each}

	<div class="card">
		<div class="sec">
			Money rozpis — {form.finalOut.filter((o) => o.qty > 0).length} položiek (spolu)
		</div>
		{#each form.finalOut.filter((o) => o.qty > 0) as o (o.kod)}
			<div class="row" style="align-items:center;gap:12px">
				<ProfilObrazok kod={o.kod} nazov={o.nazov} />
				<span style="flex:1"
					><span class="mono">{o.kod}</span> · {o.nazov}{form.zmenene?.includes(o.kod)
						? ' ✏️'
						: ''}</span
				>
				<b>{fmt(o.qty)} ks</b>
			</div>
		{/each}
	</div>

	<!-- #554 spoločný pílový plán (zdieľané tyče naprieč zábradliami) -->
	{#if narez}
		{@render rozpisRezovSekcia(narez)}
	{/if}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/clip')}>➕ Nový rozpis</a>
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
		<a class="btn secondary" href={resolve('/clip')}>← Späť na formulár</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}

<style>
	.hint {
		display: block;
		margin-top: 4px;
		/* #376 stage 3: WCAG-safe muted na zebra/hover riadkoch (viď app.css .hint) */
		color: var(--m-muted-ink);
		font-size: 12.5px;
	}
	tr.drobna td {
		color: var(--m-muted-ink);
	}
</style>
