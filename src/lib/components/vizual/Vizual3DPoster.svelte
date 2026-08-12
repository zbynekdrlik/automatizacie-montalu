<script lang="ts">
	// Zákaznícky 3D náhľad (#170) — T0 fallback (§2.9): keď WebGL nie je alebo
	// dvakrát spadne, zobrazí sa EXISTUJÚCA SVG elevácia (technický výkres) ako
	// poster namiesto 3D scény. Zákazník NIKDY neuvidí prázdne plátno ani chybu.
	import ZaskleniaNavrhVykres from '$lib/components/ZaskleniaNavrhVykres.svelte';
	import type { ZaskleniaNavrhVstup } from '$lib/zasklenia-navrh';

	let { vstup, datum }: { vstup: ZaskleniaNavrhVstup; datum: string } = $props();
</script>

<div class="poster" data-testid="vizual3d-poster">
	<div class="vykres">
		<ZaskleniaNavrhVykres {vstup} {datum} />
	</div>
	<p class="caption">
		3D náhľad nie je na tomto zariadení dostupný — zobrazuje sa technický výkres.
	</p>
</div>

<style>
	.poster {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #fff;
	}

	.vykres {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.caption {
		margin: 0;
		padding: 6px 10px;
		font-size: 12px;
		color: #475569;
		text-align: center;
		background: #f1f5f9;
	}
</style>
