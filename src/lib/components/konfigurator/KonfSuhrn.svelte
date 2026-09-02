<script lang="ts">
	// #325: súhrn konfigurácie (extrahované z +page.svelte — large-file-split #239).
	// Server-autoritatívny súhrn (dopočítané výšky/plocha/sklon) z akcie `vypocet`.
	// Žiadny Money kód — číta iba `suhrn` (client-safe typ z `$lib/konfigurator`).
	import { fmtMm1, type KonfiguratorSuhrn } from '$lib/konfigurator';
	import { konfSkloKategoriaPreNazov } from '$lib/konfigurator-sklo';

	let { suhrn }: { suhrn: KonfiguratorSuhrn } = $props();

	const fmt = fmtMm1;

	// #329 časť 4: zákazník NIKDY nevidí hrúbky — na PAGE súhrne ukáž ZÁKAZNÍCKY label kategórie
	// (napr. „Izolačné sklo — mliečne"), nie interný katalógový názov s hrúbkou. Pipeline (cena/PDF/
	// dopyt/Odoo) naďalej dostáva KONKRÉTNY `suhrn.sklo` — to sa nemení. Neznámy názov (crafted POST)
	// → fallback na raw názov (robustnosť), stále bez Money kódu.
	const skloLabel = $derived(konfSkloKategoriaPreNazov(suhrn.sklo)?.label ?? suhrn.sklo);
</script>

<section class="suhrn" data-testid="suhrn">
	<h2>Súhrn tvojej pergoly</h2>
	<dl>
		<div>
			<dt>Model</dt>
			<dd data-testid="s-model">{suhrn.model}</dd>
		</div>
		<div>
			<dt>Šírka</dt>
			<dd data-testid="s-sirka" class="mono">{fmt(suhrn.sirka)} mm</dd>
		</div>
		<div>
			<dt>Hĺbka</dt>
			<dd data-testid="s-hlbka" class="mono">{fmt(suhrn.hlbka)} mm</dd>
		</div>
		<div>
			<dt>Výška vpredu</dt>
			<dd data-testid="s-vyska-vpredu" class="mono">{fmt(suhrn.vyskaVpredu)} mm</dd>
		</div>
		<div>
			<dt>Výška pri stene</dt>
			<dd data-testid="s-vyska-stena" class="mono">{fmt(suhrn.vyskaPriStene)} mm</dd>
		</div>
		<div>
			<dt>Sklon strechy</dt>
			<dd data-testid="s-sklon" class="mono">{fmt(suhrn.sklonDeg)}°</dd>
		</div>
		<div>
			<dt>Svetlá výška vpredu</dt>
			<dd data-testid="s-svetla" class="mono">{fmt(suhrn.svetlaVyska)} mm</dd>
		</div>
		<div>
			<dt>Zastrešená plocha</dt>
			<dd data-testid="s-plocha" class="mono">{fmt(suhrn.zastresenaPlochaM2)} m²</dd>
		</div>
		<div>
			<dt>Strešné sklo</dt>
			<dd data-testid="s-sklo">{skloLabel}</dd>
		</div>
		<div>
			<dt>Farba konštrukcie</dt>
			<dd data-testid="s-farba">{suhrn.farba}</dd>
		</div>
	</dl>
	<p class="pozn">
		Toto je nezáväzný náhľad konfigurácie s orientačnou cenou. Presnú, záväznú cenu pripravíme po
		obhliadke.
	</p>
</section>

<style>
	.suhrn {
		background: var(--k-surface, #fff);
		border: 1px solid var(--k-line, #e6e4de);
		border-radius: var(--k-radius, 16px);
		padding: 20px 22px;
		margin-top: 20px;
	}
	.suhrn h2 {
		font-size: 11.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 600;
		margin: 0 0 12px;
		color: var(--k-faint, #9a9ea6);
	}
	.suhrn dl {
		margin: 0;
		display: grid;
		gap: 2px;
	}
	.suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 10px 2px;
		border-bottom: 1px solid var(--k-line, #eee);
		font-size: 14.5px;
	}
	.suhrn dl > div:last-child {
		border-bottom: 0;
	}
	.suhrn dt {
		color: var(--k-muted, #6b7078);
	}
	.suhrn dd {
		margin: 0;
		font-weight: 600;
		color: var(--k-text, #16181c);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.pozn {
		color: var(--k-muted, #6b7078);
		font-size: 13px;
		line-height: 1.5;
		margin: 16px 0 0;
	}
</style>
