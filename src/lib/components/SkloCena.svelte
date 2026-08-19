<script lang="ts">
	// Náklad na sklo v nárezáku (#225) — DISPLAY-ONLY, LEN pre interných, NOPRINT
	// (náklady nesmú vytiecť do dielenskej tlače — rovnaký `.noprint` vzor ako iné
	// interné bloky). Ceny sú z DENNÉHO Money snapshotu (appka do Money nezapisuje
	// NIČ); chýbajúca cena = „cena nedostupná", nikdy 0/odhad. Money odpis skiel sa
	// týmto blokom NEMENÍ.
	import type { SkloCenaResult } from '$lib/server/sklo-cena';
	import { formatDatumCasSk } from '$lib/datum';

	let { skloCeny }: { skloCeny: SkloCenaResult } = $props();

	// Súhrn (tfoot) je vždy EUR — cenník IZOS je jednomenový (appka dnes overila LEN
	// EUR price-booky, viď ceny.ts), takže `skloCenaPre` sčítava len EUR riadky.
	// Jednotlivé riadky nesú svoju MENU z Money a zobrazujú sa s ňou. Rovnaký
	// jednomenový predpoklad ako súčty v `CenyTabulka`.
	const eur = (n: number, mena = 'EUR') =>
		n.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
		' ' +
		(mena === 'EUR' ? '€' : mena);
	const m2 = (n: number) =>
		n.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
	const dniSlovo = (n: number) => (n === 1 ? 'deň' : n >= 2 && n <= 4 ? 'dni' : 'dní');
	const viacPlanov = $derived(skloCeny.radky.length > 1);
</script>

<div class="card noprint" data-testid="sklo-cena">
	<div class="sec">Cena skla (náklad — len interné)</div>
	{#if skloCeny.snapshot.generatedAt}
		<p class="sub" data-testid="sklo-cena-vek">
			Ceny zo snapshotu Money k {formatDatumCasSk(skloCeny.snapshot.generatedAt)}, {skloCeny
				.snapshot.daysOld}
			{dniSlovo(skloCeny.snapshot.daysOld ?? 0)} staré.
		</p>
	{:else}
		<p class="sub" data-testid="sklo-cena-vek">
			Snapshot cien z Money zatiaľ nebol naimportovaný — cena skla je „nedostupná".
		</p>
	{/if}
	<table>
		<thead>
			<tr>
				{#if viacPlanov}<th>Plán</th>{/if}
				<th>Sklo</th>
				<th class="c">Plocha</th>
				<th class="c">Cena/m²</th>
				<th class="c">Spolu</th>
			</tr>
		</thead>
		<tbody>
			{#each skloCeny.radky as r, i (i)}
				<tr>
					{#if viacPlanov}<td>{r.label}</td>{/if}
					<td>{r.variant}</td>
					<td class="c">{m2(r.m2)}</td>
					<td class="c" data-testid={`sklo-cena-m2-${i}`}
						>{r.eurM2 === null ? 'cena nedostupná' : eur(r.eurM2, r.mena) + '/m²'}</td
					>
					<td class="c" data-testid={`sklo-cena-spolu-${i}`}
						>{r.spolu === null ? 'cena nedostupná' : eur(r.spolu, r.mena)}</td
					>
				</tr>
			{/each}
		</tbody>
		{#if viacPlanov}
			<tfoot>
				<tr>
					<td colspan={4}><b>Spolu</b></td>
					<td class="c" data-testid="sklo-cena-sucet">
						<b>{eur(skloCeny.spolu)}</b>{#if !skloCeny.kompletne}
							<span class="neuplne" title="Niektoré plány majú nedostupnú cenu — súčet je neúplný"
								>⚠ neúplné</span
							>
						{/if}
					</td>
				</tr>
			</tfoot>
		{/if}
	</table>
</div>

<style>
	.neuplne {
		display: block;
		font-size: 11px;
		color: #b45309;
		font-weight: 600;
	}
</style>
