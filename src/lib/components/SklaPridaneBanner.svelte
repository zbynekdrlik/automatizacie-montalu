<script lang="ts">
	// Potvrdenie „Pridať sklá do objednávky" producenta objednávky skla, ktorý NEpresmeruje na
	// podklad (zasklenia #514, CLIP #593): výsledok + odkaz na podklad zákazky + poloha otvoru
	// (#587, len zasklenia) + upozornenie na riadky iného používateľa (#571 — nič neblokuje).
	// JEDEN komponent pre všetkých takých producentov (testidy sú kontrakt E2E).
	import { resolve } from '$app/paths';

	let {
		sklaPridane,
		pridaneText,
		nicText
	}: {
		sklaPridane: {
			pridane: number;
			zak: string;
			upozornenieCudzie: string | null;
			polohaZmenena?: number;
		};
		/** text pri pridaní (napr. „✅ Sklá pridané do objednávky (2 riadky).") */
		pridaneText: string;
		/** text, keď už všetko v objednávke je */
		nicText: string;
	} = $props();

	let poloha = $derived(sklaPridane.polohaZmenena ?? 0);
</script>

<div class="okmsg noprint" data-testid="skla-pridane">
	{sklaPridane.pridane > 0 ? pridaneText : nicText}
	<a
		data-testid="skla-pridane-odkaz"
		href={resolve(`/objednavka-skla/${encodeURIComponent(sklaPridane.zak)}`)}
		>Otvoriť objednávku skla →</a
	>
</div>
<!-- #587: existujúcim riadkom sa zmenila poloha otvoru (výška vŕtania) — nič nové sa nepridalo -->
{#if poloha > 0}
	<div class="warn noprint" data-testid="skla-poloha-zmenena">
		Poloha otvoru aktualizovaná ({poloha}
		{poloha === 1 ? 'riadok' : 'riadky'}) — ak už bola objednávka skla odoslaná do Odoo, odošli ju
		znova.
	</div>
{/if}
<!-- #571: podklad zákazky už má riadky od iného používateľa — len upozornenie, nič neblokuje -->
{#if sklaPridane.upozornenieCudzie}
	<div class="warn noprint" data-testid="skla-pridane-cudzie">
		⚠️ {sklaPridane.upozornenieCudzie}
	</div>
{/if}
