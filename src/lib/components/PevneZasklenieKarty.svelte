<script lang="ts">
	// #592 (ROZHODNUTÉ owner 30.9. „1"): výber režimu „Pevné zasklenie" = TRI veľké karty pod
	// nadpisom stránky — Fix z appky (/fix), Fix z cadu (/fix/cad), Zábradlia (CLIP) (/clip).
	// Zdieľaný na všetkých troch stránkach (nahradil 2-kartový FixModeNav #380), aby sa dalo
	// jedným klikom prepínať odkiaľkoľvek. Aktuálna stránka je non-link karta (`.active`,
	// štítok „… tu si", „Formulár je nižšie ↓"), ostatné sú odkazy „Otvoriť →". Dáta kariet
	// žijú v `$lib/nav-pevne-zasklenie` (nový typ = nový riadok tam). CSS = zdieľaný `.mode-*`
	// blok v app.css (#394) + modifikátor `.pevne-karty` (zlom pod 900px).
	import { resolve } from '$app/paths';
	import { PEVNE_ZASKLENIE_KARTY, type PevneZasklenieHref } from '$lib/nav-pevne-zasklenie';

	let { aktivna }: { aktivna: PevneZasklenieHref } = $props();

	// '/fix' → 'pevne-karta-fix', '/fix/cad' → 'pevne-karta-fix-cad', '/clip' → 'pevne-karta-clip'
	const testid = (href: string) => 'pevne-karta' + href.replaceAll('/', '-');
</script>

<div class="mode-grid pevne-karty" data-testid="pevne-karty">
	{#each PEVNE_ZASKLENIE_KARTY as k (k.href)}
		{#if k.href === aktivna}
			<div class="mode-card active" aria-current="page" data-testid={testid(k.href)}>
				<span class="mode-tag ok">{k.stitok} tu si</span>
				<span class="mode-title">{k.nadpis}</span>
				<span class="mode-desc">{k.popis}</span>
				<span class="mode-foot">Formulár je nižšie ↓</span>
			</div>
		{:else}
			<a class="mode-card" href={resolve(k.href)} data-testid={testid(k.href)}>
				<span class="mode-tag">{k.stitok}</span>
				<span class="mode-title">{k.nadpis}</span>
				<span class="mode-desc">{k.popis}</span>
				<span class="mode-foot">Otvoriť →</span>
			</a>
		{/if}
	{/each}
</div>
