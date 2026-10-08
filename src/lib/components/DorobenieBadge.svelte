<script lang="ts">
	// #608 — odznak „dorobenie N" pri odpise s poradím > 1 (vedomý druhý/ďalší odpis tej istej
	// zákazky/OP v module, napr. zlé zameranie). JEDINÁ implementácia — /odpisy, detail odpisu aj
	// zoznam zákazky ju zdieľajú (vzor ReadbackBadge). Prvý odpis (poradie 1) nevykreslí nič.
	let { poradie, testid }: { poradie: number; testid: string } = $props();
</script>

{#if poradie > 1}
	<span
		class="badge dorobenie"
		data-testid={testid}
		title={`Dorobenie č. ${poradie} — vedome odoslaný ďalší odpis tej istej zákazky (prvý odpis ostáva). Do Money išiel samostatný doklad.`}
		>🔁 dorobenie {poradie}</span
	>
{/if}
