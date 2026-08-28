<script lang="ts">
	// #325: súhrn konfigurácie (extrahované z +page.svelte — large-file-split #239).
	// Server-autoritatívny súhrn (dopočítané výšky/plocha/sklon) z akcie `vypocet`.
	// Žiadny Money kód — číta iba `suhrn` (client-safe typ z `$lib/konfigurator`).
	import type { KonfiguratorSuhrn } from '$lib/konfigurator';

	let { suhrn }: { suhrn: KonfiguratorSuhrn } = $props();

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
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
			<dd data-testid="s-sirka">{fmt(suhrn.sirka)} mm</dd>
		</div>
		<div>
			<dt>Hĺbka</dt>
			<dd data-testid="s-hlbka">{fmt(suhrn.hlbka)} mm</dd>
		</div>
		<div>
			<dt>Výška vpredu</dt>
			<dd data-testid="s-vyska-vpredu">{fmt(suhrn.vyskaVpredu)} mm</dd>
		</div>
		<div>
			<dt>Výška pri stene</dt>
			<dd data-testid="s-vyska-stena">{fmt(suhrn.vyskaPriStene)} mm</dd>
		</div>
		<div>
			<dt>Sklon strechy</dt>
			<dd data-testid="s-sklon">{fmt(suhrn.sklonDeg)}°</dd>
		</div>
		<div>
			<dt>Svetlá výška vpredu</dt>
			<dd data-testid="s-svetla">{fmt(suhrn.svetlaVyska)} mm</dd>
		</div>
		<div>
			<dt>Zastrešená plocha</dt>
			<dd data-testid="s-plocha">{fmt(suhrn.zastresenaPlochaM2)} m²</dd>
		</div>
		<div>
			<dt>Strešné sklo</dt>
			<dd data-testid="s-sklo">{suhrn.sklo}</dd>
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
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.suhrn h2 {
		font-size: 18px;
		margin: 0 0 14px;
		color: #0f172a;
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
		padding: 9px 2px;
		border-bottom: 1px solid #f1f5f9;
		font-size: 15px;
	}
	.suhrn dt {
		color: #64748b;
	}
	.suhrn dd {
		margin: 0;
		font-weight: 600;
		color: #0f172a;
		text-align: right;
	}
	.pozn {
		color: #64748b;
		font-size: 13px;
		margin: 14px 0 0;
	}
</style>
