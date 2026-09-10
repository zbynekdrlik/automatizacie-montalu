<script lang="ts">
	// Plán rezov — univerzálny optimalizátor rezov z CAD tabuľky (#482 + #505 save/print).
	// Dominik vloží tabuľku z CAD (brány, voľné profily), appka zoskupí rovnaké
	// profily, spustí FFD optimalizáciu na 6000/7500 mm tyčiach, ukáže počet
	// tyčí na objednanie + rozpis rezov + odpad. Money-NEUTRÁLNE.
	// #505: uloženie plánu pod názvom, zoznam uložených, tlač.
	//
	// Používame use:enhance (nova-stranka #7, vzor /optimalizator) — živá
	// kalkulačka bez plného reloadu, vstupy ostanú tak, ako ich zadal používateľ.
	// SvelteKit form actions: všetky pomenované (sveltekit-actions.md) — spocitat/ulozit/zmazat.
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import type { PlanRezovVysledok } from '$lib/server/plan-rezov';
	import type { UlozenyPlanPrehlad } from '$lib/server/plan-rezov-ulozene';

	let { data } = $props();

	let dlzkaTyce = $state<number>(6000);
	let reznaMedzera = $state<number>(4);
	let cadText = $state<string>('');

	let vysledok = $state<PlanRezovVysledok | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	// Save form state
	let ulozNazov = $state<string>('');
	let ulozZak = $state<string>('');
	let saveMsg = $state<string>('');
	let saveErr = $state<string>('');
	let uklada = $state(false);

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	const plany = $derived((data.plany ?? []) as UlozenyPlanPrehlad[]);

	const placeholderText =
		'Príklad:\n10001 STABILIZAČNÝ PROFIL 100X50\t1\t5330\n' +
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t1550\n' +
		'18013 PROFIL 110x110 V2\t2\t1700\n' +
		'AL_50x30x2\t4\t1865\nlat 80x19\t22\t1252';
</script>

<svelte:head><title>Plán rezov</title></svelte:head>

<h1 class="noprint">Plán rezov</h1>
<p class="lead noprint">
	Vlož tabuľku rezov z CAD — appka zoskupí rovnaké profily a pre každý spočíta optimálne rozloženie
	na tyče ({dlzkaTyce} mm). Bez väzby na zákazku, bez Money odpisu.
</p>

<form
	method="POST"
	action="?/spocitat"
	class="plan-form noprint"
	use:enhance={() => {
		spracuva = true;
		saveMsg = '';
		saveErr = '';
		return async ({ result }) => {
			spracuva = false;
			if (result.type === 'success') {
				vysledok = (result.data?.vysledok as PlanRezovVysledok | null) ?? null;
				chyba = '';
			} else if (result.type === 'failure') {
				vysledok = null;
				chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
			} else if (result.type === 'error') {
				vysledok = null;
				chyba = 'Nastala chyba pri výpočte.';
			}
		};
	}}
>
	<div class="nastavenia">
		<label>
			<span>Dĺžka tyče (mm)</span>
			<select name="dlzkaTyce" bind:value={dlzkaTyce} data-testid="dlzka-tyce">
				<option value={6000}>6 000 mm</option>
				<option value={7500}>7 500 mm</option>
			</select>
		</label>
		<label>
			<span>Rezná medzera (mm)</span>
			<input
				name="reznaMedzera"
				type="number"
				min="0"
				step="1"
				bind:value={reznaMedzera}
				data-testid="rezna-medzera"
			/>
		</label>
	</div>

	<label class="cad-label">
		<span>CAD tabuľka (vlož / paste plán rezov)</span>
		<textarea
			name="cad"
			bind:value={cadText}
			rows="12"
			placeholder={placeholderText}
			data-testid="cad-input"></textarea>
	</label>

	<div class="akcie">
		<button type="submit" class="spocitaj" data-testid="spocitaj" disabled={spracuva}>
			Optimalizovať nárez
		</button>
	</div>
</form>

{#if chyba}
	<p class="chyba noprint" data-testid="chyba">⚠ {chyba}</p>
{/if}

{#if vysledok}
	{@const v = vysledok}
	<section class="vysledok" data-testid="vysledok">
		<div class="sumar">
			<span>Profilov: <b data-testid="pocet-profilov">{v.profily.length}</b></span>
			<span>Tyčí spolu: <b data-testid="tyce-spolu">{v.tyceSpolu}</b></span>
			<span>Celkový odpad: <b>{fmt(v.odpadMm)} mm</b> ({fmt(v.odpadPct)} %)</span>
			<span>Dĺžka tyče: {fmt(v.dlzkaTyce)} mm</span>
			<span>Rezná medzera: {fmt(v.reznaMedzera)} mm</span>
		</div>

		{#each v.varovania as w (w)}
			<p class="varovanie" data-testid="varovanie">⚠ {w}</p>
		{/each}

		{#if v.material.length > 0}
			<RozpisRezov material={v.material} bar={v.dlzkaTyce} kerf={v.reznaMedzera} />
		{/if}

		<div class="noprint plan-akcie">
			<button class="btn secondary" onclick={() => window.print()} data-testid="tlacit">
				🖨 Tlačiť / uložiť PDF
			</button>
		</div>

		<!-- #505: Uložiť plán -->
		<form
			method="POST"
			action="?/ulozit"
			class="save-form noprint"
			data-testid="save-form"
			use:enhance={() => {
				uklada = true;
				saveMsg = '';
				saveErr = '';
				return async ({ result }) => {
					uklada = false;
					if (result.type === 'success' && result.data?.saved) {
						saveMsg = 'Plán uložený.';
						saveErr = '';
						ulozNazov = '';
						ulozZak = '';
						await invalidateAll();
					} else if (result.type === 'failure') {
						saveErr = (result.data?.saveError as string | undefined) ?? 'Chyba pri ukladaní.';
						saveMsg = '';
					}
				};
			}}
		>
			<h3>Uložiť plán</h3>
			<input type="hidden" name="cad" value={cadText} />
			<input type="hidden" name="dlzkaTyce" value={dlzkaTyce} />
			<input type="hidden" name="reznaMedzera" value={reznaMedzera} />
			<div class="save-fields">
				<label>
					<span>Názov plánu *</span>
					<input
						name="nazov"
						type="text"
						bind:value={ulozNazov}
						placeholder="napr. Brány vstup"
						required
						data-testid="save-nazov"
					/>
				</label>
				<label>
					<span>Zákazka (voliteľné)</span>
					<input
						name="zak"
						type="text"
						bind:value={ulozZak}
						placeholder="napr. ZAK-001"
						data-testid="save-zak"
					/>
				</label>
				<button type="submit" class="btn primary" disabled={uklada} data-testid="save-btn">
					Uložiť
				</button>
			</div>
			{#if saveMsg}
				<p class="save-ok" data-testid="save-msg">{saveMsg}</p>
			{/if}
			{#if saveErr}
				<p class="chyba" data-testid="save-err">{saveErr}</p>
			{/if}
		</form>
	</section>
{/if}

<!-- #505: Zoznam uložených plánov -->
{#if plany.length > 0}
	<section class="ulozene noprint" data-testid="ulozene-plany">
		<h2>Uložené plány</h2>
		<table>
			<thead>
				<tr>
					<th>Názov</th>
					<th>Zákazka</th>
					<th>Tyč</th>
					<th>Medzera</th>
					<th>Dátum</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each plany as p (p.id)}
					<tr>
						<td><a href={resolve(`/plan-rezov/${p.id}`)} data-testid="plan-link">{p.nazov}</a></td>
						<td class="mono">{p.zak || '—'}</td>
						<td class="mono">{fmt(p.dlzkaTyce)} mm</td>
						<td class="mono">{fmt(p.reznaMedzera)} mm</td>
						<td class="mono">{p.createdAt.slice(0, 10)}</td>
						<td>
							<form
								method="POST"
								action="?/zmazat"
								use:enhance={() => {
									return async ({ result }) => {
										if (result.type === 'success') await invalidateAll();
									};
								}}
							>
								<input type="hidden" name="id" value={p.id} />
								<button type="submit" class="btn-remove" title="Zmazať plán">&times;</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}

<style>
	.lead {
		color: var(--m-ink-3, #64748b);
		font-size: 14px;
		max-width: 640px;
		margin: 4px 0 18px;
	}
	.plan-form {
		background: var(--m-surface, #fff);
		border: 1px solid var(--m-border, #e2e8f0);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 20px;
	}
	.nastavenia {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-bottom: 14px;
	}
	.nastavenia label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--m-ink-3, #475569);
	}
	.nastavenia select,
	.nastavenia input[type='number'] {
		padding: 6px 8px;
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		font-size: 14px;
		width: 160px;
	}
	.cad-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--m-ink-3, #475569);
		margin-bottom: 14px;
	}
	textarea {
		width: 100%;
		min-height: 180px;
		padding: 10px;
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		font-family: monospace;
		font-size: 13px;
		resize: vertical;
		box-sizing: border-box;
	}
	.akcie {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.spocitaj {
		background: var(--m-ink-2);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 18px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
	}
	.spocitaj:hover {
		background: var(--m-ink-2-hover);
	}
	.spocitaj:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.chyba {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 14px;
	}
	.sumar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 22px;
		font-size: 14px;
		color: var(--m-ink-1, #334155);
		margin-bottom: 12px;
	}
	.varovanie {
		color: #b45309;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 14px;
		margin: 6px 0;
	}
	.plan-akcie {
		margin: 16px 0;
		display: flex;
		gap: 10px;
	}
	.save-form {
		background: var(--m-surface, #fff);
		border: 1px solid var(--m-border, #e2e8f0);
		border-radius: 12px;
		padding: 16px;
		margin-top: 16px;
	}
	.save-form h3 {
		margin: 0 0 10px;
		font-size: 15px;
		font-weight: 600;
	}
	.save-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
	}
	.save-fields label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--m-ink-3, #475569);
	}
	.save-fields input[type='text'] {
		padding: 6px 8px;
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		font-size: 14px;
		width: 200px;
	}
	.save-ok {
		color: #15803d;
		font-size: 13px;
		margin-top: 8px;
	}
	.ulozene {
		margin-top: 28px;
	}
	.ulozene h2 {
		font-size: 1rem;
		margin-bottom: 10px;
	}
	.ulozene table {
		width: 100%;
		border-collapse: collapse;
	}
	.ulozene th,
	.ulozene td {
		padding: 6px 10px;
		text-align: left;
		border-bottom: 1px solid var(--m-line, #e2e8f0);
	}
	.ulozene th {
		font-size: 0.8rem;
		color: var(--m-muted-ink, #64748b);
		font-weight: 500;
	}
	.mono {
		font-family: monospace;
		font-size: 13px;
	}
	.btn-remove {
		background: none;
		border: none;
		color: var(--m-danger, #dc2626);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0 4px;
	}
	.btn.primary {
		background: var(--m-ink-2);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 8px 16px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
	}
	.btn.primary:hover {
		background: var(--m-ink-2-hover);
	}
	.btn.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.btn.secondary {
		background: var(--m-surface, #fff);
		color: var(--m-ink-1, #334155);
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		padding: 8px 16px;
		cursor: pointer;
		font-size: 14px;
	}
	.btn.secondary:hover {
		background: var(--m-surface-2, #f8fafc);
	}

	@media print {
		.noprint {
			display: none !important;
		}
		@page {
			size: A4 portrait;
			margin: 10mm;
		}
	}
</style>
