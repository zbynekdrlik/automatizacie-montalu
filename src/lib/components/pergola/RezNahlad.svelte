<script lang="ts">
	// Krok „rez-nahlad" — Money rozpis pred odoslaním rezervácie (posledné potvrdenie).
	// Vyčlenené z pergola/narez/+page.svelte (#239). Serializačné snippety `hidden`/
	// `hiddenIdent` prichádzajú ako propy z rodiča (single source of truth serializácie);
	// renderované cez `{@render}` v <form> = DOM potomkovia formulára → submit ich zahrnie.
	import type { Snippet } from 'svelte';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	import type { RezervaciaIdent, RezervaciaRozpis } from '$lib/server/pergola-rezervacia';
	import type { CenyResult } from '$lib/server/ceny';

	let {
		rozpis,
		ceny,
		ident,
		rezError,
		live,
		hidden,
		hiddenIdent
	}: {
		rozpis: RezervaciaRozpis;
		ceny: CenyResult | null;
		ident: RezervaciaIdent;
		rezError: string | null;
		live: boolean;
		hidden: Snippet;
		hiddenIdent: Snippet;
	} = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
</script>

<div class="card">
	<h1 data-testid="rez-nadpis">Rezervačný odpis — {ident.zak} · {ident.zakaznik}</h1>
	<p class="sub">
		<span class="badge">Pergola · {rozpis.pocetPolozok} položiek</span>
		{#if !live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
	</p>
</div>

{#if rezError}
	<div class="err" data-testid="rez-nahlad-error">⚠️ {rezError}</div>
{/if}

{#if rozpis.longNotes.length}
	<div class="warn">
		<b>⚠ Dlhé profily (rez &gt; tyč)</b> — riešené kombináciou tyčí. Pri <b>žľabe</b> over, že spoj vyjde
		nad nohu pergoly.
	</div>
{/if}

{#if rozpis.manualWarnings.length}
	<div class="warn" data-testid="rez-rucne-varovanie">
		{#each rozpis.manualWarnings as w (w)}<div>⚠️ {w}</div>{/each}
	</div>
{/if}

<div class="card">
	<div class="sec">Money rozpis — {rozpis.nonzero.length} položiek</div>
	<p class="sub noprint">
		Spočítané množstvá sú metre surových tyčí (bin-packing, presne ako klasický CAD odpis); ručne
		pridané riadky nesú svoje množstvo v MJ položky. Do Money sa po potvrdení pošle presne toto.
	</p>
	<table class="narez" data-testid="rez-rozpis">
		<thead><tr><th>Money kód</th><th>Názov</th><th>Množstvo</th></tr></thead>
		<tbody>
			{#each rozpis.nonzero as o, i (o.kod + '·' + i)}
				<tr data-testid={o.rucne ? 'rez-rucne-riadok' : 'rez-spocitany-riadok'}>
					<td
						>{o.kod}{#if o.rucne}
							<span class="badge rucne">✍️ ručne pridané</span>{/if}</td
					>
					<td>{o.nazov}</td>
					<td><b>{fmtM(o.qty)} {o.mj ?? 'm'}</b></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- ceny materiálu (#232, display-only) — LEN interní; b2b nikdy nedostane
     `form.ceny` (viď cenyPre v +page.server.ts). NOPRINT: náklady nikdy do
     dielenskej tlače (rovnaký .noprint vzor ako SkloCena — výkres/rozpis sa tlačí,
     cenový blok nie). -->
{#if ceny}
	<div class="noprint">
		<CenyTabulka {ceny} />
	</div>
{/if}

{#if rozpis.vylucene.length}
	<div class="card">
		<div class="sec">Zatiaľ nepočítané — NIE sú v odpise ({rozpis.vylucene.length})</div>
		<p class="sub">
			Počet je istý, dĺžku rezu ešte nemáme (napr. priečka = horná hrana krovu). Do rezervácie sa
			<b>NEZAHŔŇAJÚ</b> — nikdy vymyslené číslo. Doplní ich neskôr aktualizácia na reálne čísla.
		</p>
		<ul data-testid="rez-vylucene" style="margin:6px 0 0;padding-left:18px">
			{#each rozpis.vylucene as v (v.kod + v.nazov)}
				<li style="margin:4px 0" class="sub">{v.kod} · {v.nazov} — {v.dovod}</li>
			{/each}
		</ul>
	</div>
{/if}

{#if rozpis.tesnenia.length}
	<div class="card">
		<div class="sec">Tesnenia (gumy) — {rozpis.tesnenia.length}</div>
		<div class="warn" data-testid="rez-tesnenia-banner">
			⚠️ Čaká na Money kódy od Dominika — tesnenia sa <b>NEODOSIELAJÚ</b> do odpisu. Dĺžky sú podľa pravidiel
			od Dominika; doplnia sa, keď príde zoznam kódov.
		</div>
		<table class="narez" data-testid="rez-tesnenia">
			<thead><tr><th>Tesnenie</th><th>Vzorec</th><th>Dĺžka</th></tr></thead>
			<tbody>
				{#each rozpis.tesnenia as t (t.id)}
					<tr>
						<td>{t.nazov}</td>
						<td class="sub">{t.vzorec}</td>
						<td>
							{#if t.stav === 'ok' && t.dlzkaMm != null}
								<b>{fmtM(t.dlzkaMm / 1000)} m</b>
							{:else}
								<span class="sub">⏳ {t.dovod ?? 'čaká na potvrdenie'}</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<div class="card noprint">
	<form method="POST" action="?/odoslat" style="display:inline">
		{@render hidden()}
		{@render hiddenIdent()}
		<button class="btn" type="submit" data-testid="odoslat-rezervaciu">
			{live
				? '✅ Odoslať rezervačný odpis do Money'
				: '🧪 Odoslať rezervačný odpis (TEST priečinok)'}
		</button>
	</form>
	<form method="POST" action="?/upravit" style="display:inline">
		{@render hidden()}
		{@render hiddenIdent()}
		<button class="btn secondary" type="submit">← Upraviť zadanie</button>
	</form>
</div>
