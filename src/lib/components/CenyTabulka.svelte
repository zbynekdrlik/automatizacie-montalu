<script lang="ts">
	// Cenový zoznam materiálu (#154, fáza 1) — LEN pre interných, zdieľané medzi
	// zasklenia náhľadom (nahlad/nahladMulti) a históriou odpisov (/odpisy/[id]).
	// Ceny sú z DENNÉHO Money snapshotu (appka do Money nezapisuje NIČ) — vek
	// snapshotu sa zobrazuje vždy, nikdy sa nepredstiera aktuálnosť.
	import type { CenyResult } from '$lib/server/ceny';
	import { formatDatumCasSk } from '$lib/datum';

	let { ceny }: { ceny: CenyResult } = $props();

	// súčty sú vždy EUR (appka dnes overila LEN EUR price-booky — viď design komentár
	// na #154), jednotlivé riadky nesú svoju MENU z Money a zobrazujú sa s ňou
	const MENA_SYMBOL: Record<string, string> = { EUR: '€' };
	const fmtCena = (n: number, mena = 'EUR') =>
		n.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
		' ' +
		(MENA_SYMBOL[mena] ?? mena);
	const bunka = (n: number | null, mena: string) =>
		n === null ? 'cena neznáma' : fmtCena(n, mena);
	const skladBunka = (n: number | null) => (n === null ? 'neznáme' : String(n));
	const dniSlovo = (n: number) => (n === 1 ? 'deň' : n >= 2 && n <= 4 ? 'dni' : 'dní');
	const riadokSlovo = (n: number) => (n === 1 ? 'riadok' : n >= 2 && n <= 4 ? 'riadky' : 'riadkov');
</script>

<div class="card" data-testid="ceny-tabulka">
	<div class="sec">Ceny materiálu</div>
	{#if ceny.snapshot.generatedAt}
		<p class="sub" data-testid="ceny-snapshot-vek">
			Ceny zo snapshotu Money k {formatDatumCasSk(ceny.snapshot.generatedAt)}, {ceny.snapshot
				.daysOld}
			{dniSlovo(ceny.snapshot.daysOld ?? 0)} staré.
		</p>
	{:else}
		<p class="sub" data-testid="ceny-snapshot-vek">
			Snapshot cien z Money zatiaľ nebol naimportovaný — všetky ceny sú „neznáme".
		</p>
	{/if}
	{#if ceny.snapshot.rejectedCount > 0}
		<p class="sub neuplne" data-testid="ceny-snapshot-odmietnute">
			⚠ Posledný import snapshotu zamietol {ceny.snapshot.rejectedCount}
			{riadokSlovo(ceny.snapshot.rejectedCount)} (chybné dáta z Money) — tie kódy môžu chýbať.
		</p>
	{/if}
	<table>
		<thead>
			<tr>
				<th>Kód</th>
				<th>Názov</th>
				<th class="c">Množstvo</th>
				<th class="c">Nákup (cenník)</th>
				<th class="c">Nákup (posledná faktúra)</th>
				<th class="c">Predaj VO</th>
				<th class="c">Marža</th>
				<th class="c">Na sklade</th>
			</tr>
		</thead>
		<tbody>
			{#each ceny.radky as r (r.kod)}
				<tr>
					<td class="mono">{r.kod}</td>
					<td>{r.nazov}</td>
					<td class="c">{r.qty} {r.mj}</td>
					<td class="c" data-testid={`cena-nakup-cennik-${r.kod}`}
						>{bunka(r.nakupCennik, r.mena)}</td
					>
					<td class="c" data-testid={`cena-nakup-faktura-${r.kod}`}
						>{bunka(r.nakupPoslednaFaktura, r.mena)}</td
					>
					<td class="c" data-testid={`cena-predaj-vo-${r.kod}`}>{bunka(r.predajVo, r.mena)}</td>
					<td class="c">{bunka(r.marza, r.mena)}</td>
					<td class="c">{skladBunka(r.sklad)}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr>
				<td colspan="3"><b>Spolu</b></td>
				<td class="c" data-testid="ceny-sucet-nakup-cennik">
					<b>{fmtCena(ceny.sucty.nakupCennik.suma)}</b>{#if !ceny.sucty.nakupCennik.kompletne}
						<span class="neuplne" title="Niektoré položky majú neznámu cenu — súčet je neúplný"
							>⚠ neúplné</span
						>
					{/if}
				</td>
				<td class="c">
					<b>{fmtCena(ceny.sucty.nakupPoslednaFaktura.suma)}</b
					>{#if !ceny.sucty.nakupPoslednaFaktura.kompletne}
						<span class="neuplne" title="Niektoré položky majú neznámu cenu — súčet je neúplný"
							>⚠ neúplné</span
						>
					{/if}
				</td>
				<td class="c" data-testid="ceny-sucet-predaj-vo">
					<b>{fmtCena(ceny.sucty.predajVo.suma)}</b>{#if !ceny.sucty.predajVo.kompletne}
						<span class="neuplne" title="Niektoré položky majú neznámu cenu — súčet je neúplný"
							>⚠ neúplné</span
						>
					{/if}
				</td>
				<td class="c">
					<b>{fmtCena(ceny.sucty.marza.suma)}</b>{#if !ceny.sucty.marza.kompletne}
						<span class="neuplne" title="Niektoré položky majú neznámu cenu — súčet je neúplný"
							>⚠ neúplné</span
						>
					{/if}
				</td>
				<td></td>
			</tr>
		</tfoot>
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
