<script lang="ts">
	// Serializácia zadania do skrytých polí pre akcie nad VÝSLEDKOM (odoslať / pridať sklá / späť
	// upraviť) — surové vstupy, server všetko prepočíta znova (nikdy neverí klientskym číslam).
	// Vyčlenené z `routes/zasklenia/+page.svelte` (#579, 1000-r. strop; pôvodne snippety
	// `hiddenVstup`/`hiddenMulti` — obsah 1:1). `posuvy` zadané = viac posuvov (zimná záhrada):
	// posuvy idú ako JSON pole, jedno-posuvové polia sa nerenderujú.
	import type { PlanVstup } from '$lib/zasklenia-form';

	let { vstup, posuvy }: { vstup: PlanVstup; posuvy?: unknown[] } = $props();
</script>

<input type="hidden" name="zak" value={vstup.zak} />
<input type="hidden" name="op" value={vstup.op} />
<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
{#if posuvy}
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	<input type="hidden" name="ral" value={vstup.ral} />
	<input type="hidden" name="posuvy" value={JSON.stringify(posuvy)} />
{:else}
	<input type="hidden" name="system" value={vstup.system} />
	<input type="hidden" name="styl" value={vstup.styl} />
	<input type="hidden" name="s" value={vstup.s} />
	<input type="hidden" name="v" value={vstup.v} />
	<input type="hidden" name="sklo" value={vstup.sklo} />
	<!-- #579: zvolený Odoo typ skla (výpočet ide z `sklo`) -->
	{#if vstup.skloOdoo}<input type="hidden" name="skloOdoo" value={vstup.skloOdoo} />{/if}
	<input type="hidden" name="skloPresne" value={vstup.skloPresne} />
	{#if vstup.skloTrieda != null}<input
			type="hidden"
			name="skloTrieda"
			value={vstup.skloTrieda}
		/>{/if}
	<input type="hidden" name="otvaranie" value={vstup.otvaranie} />
	<input type="hidden" name="kovanieL" value={vstup.kovanieL} />
	<input type="hidden" name="kovanieP" value={vstup.kovanieP} />
	<input type="hidden" name="kovanieStred" value={vstup.kovanieStred} />
	<input type="hidden" name="kovanieStredOkno" value={vstup.kovanieStredOkno} />
	<input type="hidden" name="vrtanieZamku" value={vstup.vrtanieZamku} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
	<input type="hidden" name="ral" value={vstup.ral} />
{/if}
{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{#if vstup.pridavnaKolajnica}<input type="hidden" name="pridavnaKolajnica" value="1" />{/if}
{#if vstup.jednostrannaFab}<input type="hidden" name="jednostrannaFab" value="1" />{/if}
{#if vstup.farbaKovania}<input type="hidden" name="farbaKovania" value={vstup.farbaKovania} />{/if}
{#if !posuvy}
	{#if vstup.kolajnica?.horna}
		<input type="hidden" name="kolajnicaHorna" value={vstup.kolajnica.horna} />
	{/if}
	{#if vstup.kolajnica?.spodna}
		<input type="hidden" name="kolajnicaSpodna" value={vstup.kolajnica.spodna} />
	{/if}
	{#if vstup.kliny.length}
		<input type="hidden" name="kliny" value={JSON.stringify(vstup.kliny)} />
	{/if}
	{#if vstup.sietka}
		<input type="hidden" name="sietka" value="1" />
		<input type="hidden" name="sietkaUchyt" value={vstup.sietka.uchyt} />
		{#if vstup.sietka.system}
			<input type="hidden" name="sietkaSystem" value={vstup.sietka.system} />
		{/if}
	{/if}
{/if}
