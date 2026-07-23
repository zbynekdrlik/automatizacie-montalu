<script lang="ts">
	// Grafický rozpis rezov na tyče — pre človeka pri píle. Formát podľa
	// optimalizačného výstupu (MB-CAD): pri profile hlavička (počet tyčí, odpad),
	// každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci.
	// Rezy na 45° (zošikmená čiara) — pri zaskleniach všetko okrem nosového.
	import type { MaterialRow } from '$lib/server/compute';
	import ProfilObrazok from './ProfilObrazok.svelte';

	let {
		material,
		bar = 7500,
		viacPosuvov = false
	}: { material: MaterialRow[]; bar?: number; viacPosuvov?: boolean } = $props();

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
	// uhol rezu (45° vs rovný 90°) rozhoduje server per profil (m.sikmyRez):
	// Deluxe + Štandard + = všetko 90°; Robust/Slide = 90° nosový/oponový, zvyšok 45°

	const H = 100; // výška tyče v SVG jednotkách
	const S = 250; // horizontálny sklon šikmého rezu (v mm-jednotkách viewBoxu)

	interface Seg {
		body: string; // polygon points
		labelPct: number;
		text: string;
		odpad: boolean;
		skryLabel: boolean; // úzky segment → popis skry (aby sa nepretekal)
		posuv?: number; // z ktorého posuvu je kus (pri zimnej záhrade)
	}

	// jedna tyč → polygony rezov + odpad.
	// 45° rez: uhly idú DO VNÚTRA (ľavý zdola doprava, pravý zdola doľava) —
	// kus je lichobežník užší hore (x±s na hornej hrane), ako pri spájaní rámu.
	function segmenty(
		kusy: { rozmer: number; dlzka: number; posuv?: number }[],
		zvysok: number,
		sikmy: boolean,
		bar: number
	) {
		const s = sikmy ? S : 0;
		const segs: Seg[] = [];
		let x = 0;
		for (const k of kusy) {
			const x1 = x + k.dlzka;
			segs.push({
				// horná hrana zúžená z oboch strán o s (rezy do vnútra)
				body: `${x + s},0 ${x1 - s},0 ${x1},${H} ${x},${H}`,
				labelPct: ((x + x1) / 2 / bar) * 100,
				text: fmt(k.rozmer),
				odpad: false,
				skryLabel: (k.dlzka / bar) * 100 < 5,
				posuv: k.posuv
			});
			x = x1;
		}
		if (zvysok > 1) {
			// odpad začína šikmým rezom posledného kusu (ak bol 45°)
			segs.push({
				body: `${x - s},0 ${bar},0 ${bar},${H} ${x},${H}`,
				labelPct: ((x + bar) / 2 / bar) * 100,
				text: 'odpad ' + fmt(zvysok),
				odpad: true,
				// úzky odpad na konci → popis skry (celkový odpad je v hlavičke)
				skryLabel: (zvysok / bar) * 100 < 12
			});
		}
		return segs;
	}
</script>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
	<defs>
		<pattern id="odpad-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
			<rect width="7" height="7" fill="#f1f5f9" />
			<line x1="0" y1="0" x2="0" y2="7" stroke="#cbd5e1" stroke-width="1" />
		</pattern>
	</defs>
</svg>

<div class="rozpis">
	{#each material.filter((m) => m.tyce > 0) as m (m.kod)}
		<!-- m.sikmyRez rozhoduje server per profil; `?? true` je obranný fallback pre
		     prípadné staré dáta bez tohto poľa (45° = historický default väčšiny profilov) -->
		{@const sikmy = m.sikmyRez ?? true}
		<!-- dĺžka tyče je per-profil (Deluxe: kladka/klzný 3600, 5K horná koľajnica
		     6000); staršie výsledky bez m.barLen padnú na fallback prop `bar` -->
		{@const barLen = m.barLen ?? bar}
		<div class="profil">
			<div class="hd">
				<ProfilObrazok kod={m.kod} nazov={m.nazov} velkost={48} />
				<div class="hd-txt">
					<div class="nazov"><b>{m.kod}</b> · {m.nazov}</div>
					<div class="stat">
						Počet tyčí: <b>{m.tyce}</b> · dĺžka tyče {fmt(barLen)} mm · kotúč 4 mm · odpad
						<b>{fmt(m.odpadMm)} mm</b> ({fmt(m.odpadPct)} %) · rez {sikmy ? '45°' : 'rovný'}
					</div>
				</div>
			</div>

			{#each m.bary as tyc, ti (ti)}
				{@const segs = segmenty(tyc.kusy, tyc.zvysok, sikmy, barLen)}
				<div class="tyc">
					<div class="tyc-cislo">/{ti + 1}/</div>
					<div class="tyc-telo">
						<svg
							class="bar-svg"
							viewBox="0 0 {barLen} {H}"
							preserveAspectRatio="none"
							role="img"
							aria-label="Tyč {ti + 1}"
						>
							<!-- podklad celej tyče -->
							<rect x="0" y="0" width={barLen} height={H} fill="#f8fafc" stroke="#475569" stroke-width="1" vector-effect="non-scaling-stroke" />
							{#each segs as seg (seg.body)}
								<polygon
									points={seg.body}
									fill={seg.odpad ? 'url(#odpad-hatch)' : '#dbeafe'}
									stroke="#475569"
									stroke-width="1"
									vector-effect="non-scaling-stroke"
								/>
							{/each}
						</svg>
						{#each segs as seg (seg.body)}
							{#if !seg.skryLabel}
								<span class="lbl" class:odp={seg.odpad} style="left:{seg.labelPct}%"
									>{#if viacPosuvov && seg.posuv}<span class="pbadge">P{seg.posuv}</span> {/if}{seg.text}</span
								>
							{/if}
						{/each}
					</div>
				</div>
			{/each}

			<table class="rezy">
				<thead><tr><th>Dĺžka (mm)</th><th class="c">Kusov</th><th>Rez</th></tr></thead>
				<tbody>
					{#each m.rezy.filter((r) => r.ks > 0) as r, ri (ri)}
						<tr><td>{fmt(r.rozmer)}</td><td class="c">{r.ks}</td><td>{sikmy ? '45° / 45°' : 'rovný'}</td></tr>
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
		position: relative;
		height: 46px;
		overflow: hidden;
	}
	.bar-svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.lbl {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		font-size: 12.5px;
		font-weight: 700;
		color: #1e3a8a;
		white-space: nowrap;
		pointer-events: none;
	}
	.lbl.odp {
		color: #94a3b8;
		font-weight: 400;
		font-size: 11px;
	}
	/* P1/P2 značka pri reze — ČIERNA + medzera pred číslom (Dominik 2026-07-23:
	   modrý badge s bielym textom bol v tlači zle čitateľný). */
	.pbadge {
		color: #000;
		font-weight: 700;
		margin-right: 8px;
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
		padding: 3px 16px 3px 0;
	}
	.rezy td {
		padding: 3px 16px 3px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.rezy td.c,
	.rezy th.c {
		text-align: center;
	}
	@media print {
		.tyc-telo {
			height: 40px;
		}
	}
</style>
