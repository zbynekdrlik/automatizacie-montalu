<script lang="ts">
	// Grafický rozpis rezov na tyče — pre človeka pri píle. Formát podľa
	// optimalizačného výstupu (MB-CAD): pri profile hlavička (počet tyčí, odpad),
	// každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci.
	import type { MaterialRow } from '$lib/server/compute';
	import ProfilObrazok from './ProfilObrazok.svelte';

	let { material, bar = 7500 }: { material: MaterialRow[]; bar?: number } = $props();

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
</script>

<div class="rozpis">
	{#each material.filter((m) => m.tyce > 0) as m (m.kod)}
		<div class="profil">
			<div class="hd">
				<ProfilObrazok kod={m.kod} nazov={m.nazov} velkost={48} />
				<div class="hd-txt">
					<div class="nazov"><b>{m.kod}</b> · {m.nazov}</div>
					<div class="stat">
						Počet tyčí: <b>{m.tyce}</b> · dĺžka tyče {fmt(bar)} mm · odpad
						<b>{fmt(m.odpadMm)} mm</b> ({fmt(m.odpadPct)} %)
					</div>
				</div>
			</div>

			{#each m.bary as tyc, ti (ti)}
				{@const pouzite = tyc.kusy.reduce((s, k) => s + k.dlzka, 0)}
				<div class="tyc">
					<div class="tyc-cislo">/{ti + 1}/</div>
					<div class="tyc-telo">
						{#each tyc.kusy as k, ki (ki)}
							<div class="kus" style="flex:{k.dlzka} 0 0" title="rez {fmt(k.rozmer)} mm">
								<span class="rozmer">{fmt(k.rozmer)}</span>
								<span class="ks-num">1</span>
							</div>
						{/each}
						{#if tyc.zvysok > 1}
							<div class="odpad" style="flex:{tyc.zvysok} 0 0" title="odpad {fmt(tyc.zvysok)} mm">
								<span class="odpad-txt">odpad {fmt(tyc.zvysok)}</span>
							</div>
						{/if}
					</div>
				</div>
			{/each}

			<table class="rezy">
				<thead><tr><th>Dĺžka (mm)</th><th class="c">Kusov</th></tr></thead>
				<tbody>
					{#each m.rezy.filter((r) => r.ks > 0) as r, ri (ri)}
						<tr><td>{fmt(r.rozmer)}</td><td class="c">{r.ks}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/each}
</div>

<style>
	.rozpis {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.profil {
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 14px;
		page-break-inside: avoid;
		break-inside: avoid;
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.hd-txt {
		flex: 1;
		min-width: 0;
	}
	.nazov {
		font-size: 15px;
	}
	.stat {
		color: #64748b;
		font-size: 13px;
		margin-top: 2px;
	}
	.tyc {
		display: flex;
		align-items: stretch;
		gap: 8px;
		margin-bottom: 8px;
	}
	.tyc-cislo {
		width: 34px;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #94a3b8;
		font-size: 12px;
		font-family: ui-monospace, monospace;
	}
	.tyc-telo {
		flex: 1;
		display: flex;
		height: 46px;
		border: 2px solid #334155;
		border-radius: 4px;
		overflow: hidden;
		background: #f8fafc;
	}
	.kus {
		position: relative;
		border-right: 2px solid #334155;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dbeafe;
		min-width: 0;
	}
	.kus:last-child {
		border-right: 0;
	}
	.rozmer {
		font-size: 12.5px;
		font-weight: 700;
		color: #1e3a8a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 3px;
	}
	.ks-num {
		position: absolute;
		bottom: 1px;
		right: 3px;
		font-size: 9px;
		color: #64748b;
	}
	.odpad {
		display: flex;
		align-items: center;
		justify-content: center;
		background: repeating-linear-gradient(
			45deg,
			#f1f5f9,
			#f1f5f9 5px,
			#e2e8f0 5px,
			#e2e8f0 10px
		);
		min-width: 0;
	}
	.odpad-txt {
		font-size: 11px;
		color: #94a3b8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 3px;
	}
	.rezy {
		width: auto;
		margin-top: 10px;
		border-collapse: collapse;
		font-size: 13px;
	}
	.rezy th {
		text-align: left;
		color: #64748b;
		font-size: 11px;
		text-transform: uppercase;
		border-bottom: 1px solid #e2e8f0;
		padding: 3px 12px 3px 0;
	}
	.rezy td {
		padding: 3px 12px 3px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.rezy td.c,
	.rezy th.c {
		text-align: center;
	}
	@media print {
		.tyc-telo {
			height: 38px;
		}
	}
</style>
