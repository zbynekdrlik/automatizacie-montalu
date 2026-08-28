<script lang="ts">
	// #325: orientačná cena + porovnanie modelov (extrahované z +page.svelte do
	// subkomponentu — large-file-split #239 „step subcomponents", pravý panel).
	// LEN maloobchod (MO); VO odznak (`hladinaLabel`) prichádza zo SERVERA a vidí ho
	// len prihlásený b2b. Žiadny Money kód, žiadny nárez — číta iba `cena`/`cenyModely`
	// z `data` (server-autoritatívne pri submite). Money-guard: neimportuje katalóg/server.
	import type { VerejnaCena, CenaModelu } from '$lib/konfigurator';

	let {
		cena,
		cenyModely,
		sirka,
		hlbka
	}: {
		cena: VerejnaCena;
		cenyModely: CenaModelu[] | null;
		/** zadaná šírka [mm] — na čestné zobrazenie „cena platí pre katalógový rozmer" */
		sirka: number;
		/** zadaná hĺbka [mm] */
		hlbka: number;
	} = $props();

	const fmtM = (n: number) => String(n).replace('.', ',');
	const eur = (n: number) =>
		n.toLocaleString('sk-SK', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
</script>

<section class="cena-blok" data-testid="cena" aria-label="Orientačná cena pergoly">
	{#if cena.druh === 'cena'}
		<div class="cena-hlavne">
			<span class="cena-label">Orientačná cena — model {cena.model}</span>
			{#if cena.hladinaLabel}
				<!-- #318: VO hladina — text zo SERVERA; odznak vidí LEN prihlásený b2b -->
				<span class="cena-vo" data-testid="cena-hladina">{cena.hladinaLabel}</span>
			{/if}
			<span class="cena-sdph" data-testid="cena-sdph">{eur(cena.sDph)}</span>
			<span class="cena-mena">s DPH</span>
		</div>
		<div class="cena-bezdph" data-testid="cena-bezdph">{eur(cena.bezDph)} bez DPH</div>
		{#if Math.round(cena.sirkaGridM * 1000) !== sirka || Math.round(cena.hlbkaGridM * 1000) !== hlbka}
			<div class="cena-grid" data-testid="cena-grid">
				Cena platí pre najbližší katalógový rozmer {fmtM(cena.sirkaGridM)} × {fmtM(cena.hlbkaGridM)} m.
			</div>
		{/if}
	{:else}
		<div class="cena-individualna" data-testid="cena-individualna">
			<span class="cena-label">Cena na vyžiadanie — model {cena.model}</span>
			{#if cena.hladinaLabel}
				<span class="cena-vo" data-testid="cena-hladina">{cena.hladinaLabel}</span>
			{/if}
			<p class="cena-dovod">{cena.dovod} Pripravíme ti individuálnu ponuku.</p>
		</div>
	{/if}
	<p class="cena-pozn">
		Orientačná cena vychádza z aktuálneho cenníka pre zvolený model a rozmery (základná výplň).
		Presnú, záväznú cenu pripravíme po obhliadke.
	</p>
</section>

{#if cenyModely}
	<section class="porovnanie" data-testid="porovnanie" aria-label="Porovnanie modelov">
		<h3>Porovnanie modelov (orientačne, s DPH)</h3>
		<ul>
			{#each cenyModely as c (c.model)}
				<li class:vybrany={c.model === cena.model} data-testid="porovnanie-{c.model}">
					<span class="p-model">{c.model}</span>
					<span class="p-cena">
						{c.cena.druh === 'cena' ? eur(c.cena.sDph) : 'na vyžiadanie'}
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.cena-blok {
		background: #0f172a;
		color: #fff;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.cena-hlavne {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
	}
	.cena-label {
		flex-basis: 100%;
		color: #cbd5e1;
		font-size: 13px;
	}
	.cena-sdph {
		font-size: clamp(26px, 7vw, 36px);
		font-weight: 800;
		line-height: 1.1;
	}
	.cena-mena {
		color: #cbd5e1;
		font-size: 14px;
	}
	.cena-vo {
		flex-basis: 100%;
		align-self: flex-start;
		width: fit-content;
		padding: 2px 8px;
		border-radius: 999px;
		background: #1d4ed8;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.cena-bezdph {
		color: #cbd5e1;
		font-size: 14px;
		margin-top: 2px;
	}
	.cena-grid {
		color: #94a3b8;
		font-size: 12px;
		margin-top: 6px;
	}
	.cena-individualna .cena-label {
		font-size: 18px;
		font-weight: 700;
		color: #fff;
	}
	.cena-dovod {
		color: #cbd5e1;
		font-size: 13.5px;
		margin: 6px 0 0;
	}
	.cena-pozn {
		color: #94a3b8;
		font-size: 12px;
		margin: 12px 0 0;
	}
	.porovnanie {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 14px 18px;
		margin-top: 12px;
	}
	.porovnanie h3 {
		font-size: 14px;
		margin: 0 0 10px;
		color: #0f172a;
	}
	.porovnanie ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.porovnanie li {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 8px;
		border-radius: 8px;
		font-size: 15px;
	}
	.porovnanie li.vybrany {
		background: #eff6ff;
		font-weight: 700;
	}
	.porovnanie .p-model {
		color: #334155;
	}
	.porovnanie .p-cena {
		color: #0f172a;
		font-weight: 600;
	}
</style>
