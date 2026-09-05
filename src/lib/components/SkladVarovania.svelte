<script lang="ts">
	// #448 — predodpisové SKLADOVÉ VAROVANIE (honest signál, NIE tvrdý blok).
	// #451 — rozšírené na VÝRAZNÉ upozornenie s akciou „Odobrať z odpisu" (owner directive 5.9.2026:
	// „upozorni velkym upozornenim ze toto nie je mozne odpisat lebo je na to nejaky dovod a nech
	// ma moznost ten produkt odobrat a dat to odpisat do skladu bez toho produktu").
	// Zdieľané pri tlačidle odpisu naprieč modulmi (zasklenia/pergola/bazén/FIX/clip/sietka).
	// Money pri jedinej položke s nedostatočným skladom TICHO zahodí CELÝ doklad — žiadna chyba,
	// doklad jednoducho nevznikne (ZAK2026493 — 57 položiek zahodených kvôli 1 krytke so skladom 0).
	import type { SkladVarovanie } from '$lib/server/ceny';

	let {
		varovania,
		snapshotDatum,
		testid = 'sklad-varovania',
		vyluceneKody = $bindable('')
	}: {
		varovania: SkladVarovanie[] | undefined;
		/** dátum generovania denného Money snapshotu (ISO string, napr. '2026-09-05T05:30:00Z') —
		 *  zobrazí sa v upozornení pre transparentnosť čerstvosti dát. */
		snapshotDatum?: string | null;
		testid?: string;
		/** Zoznam odobratých kódov (comma-separated) — bindable, rodič ho vloží do
		 *  hidden inputu vo formulári. Synced z interného `odobrate` Setu cez $effect. */
		vyluceneKody?: string;
	} = $props();

	/** Sformátuje snapshot dátum na „D.M.YYYY" (slovenský formát). */
	function fmtDatum(iso: string | null | undefined): string {
		if (!iso) return '?';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '?';
		return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
	}

	/** Kód, ktorý bol v tejto session odobraný (klient-side, len vizuálny stav). */
	let odobrate = $state<Set<string>>(new Set());

	// #461: sync odobrate → vyluceneKody (bindable pre rodičovský hidden input)
	$effect(() => {
		vyluceneKody = [...odobrate].join(',');
	});

	/** Odobrať položku z odpisu — nastaví qty input na 0 a vizuálne označí ako odobratú. */
	function odobrat(kod: string) {
		const input = document.querySelector<HTMLInputElement>(`input[name="qty_${kod}"]`);
		if (input) {
			// natívny setter — Svelte 5 input bindingy reagujú na setter + event
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
			if (setter) {
				setter.call(input, '0');
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				input.value = '0';
			}
			// vizuálny feedback — krátky flash na input
			input.style.background = '#fecaca';
			setTimeout(() => {
				input.style.background = '';
			}, 1200);
		}
		odobrate = new Set([...odobrate, kod]);
	}
</script>

{#if varovania && varovania.length}
	<div class="sklad-blok noprint" data-testid={testid} role="alert">
		<div class="sklad-blok-hlavicka">
			<span class="sklad-blok-ikona">⛔</span>
			<div>
				<b>Money pri chýbajúcom materiáli TICHO ZAHODÍ CELÝ odpis</b>
				{#if varovania.length === 1}
					— 1 položka má nedostatočný sklad
				{:else if varovania.length >= 2 && varovania.length <= 4}
					— {varovania.length} položky majú nedostatočný sklad
				{:else}
					— {varovania.length} položiek má nedostatočný sklad
				{/if}
				<span class="sklad-blok-datum">(sklad k {fmtDatum(snapshotDatum)})</span>
			</div>
		</div>
		<p class="sklad-blok-popis">
			Tieto položky majú v Money nižší sklad než požadované množstvo. Ak odpis odošleš s nimi, Money
			ho <b>celý</b> ticho zahodí — žiadna chybová hláška, doklad nevznikne. Môžeš ich odobrať a odpísať
			bez nich.
		</p>
		<ul class="sklad-blok-zoznam">
			{#each varovania as v (v.kod)}
				<li data-testid={`${testid}-${v.kod}`} class:odobrata={odobrate.has(v.kod)}>
					<div class="sklad-blok-polozka">
						<div class="sklad-blok-info">
							<b class="mono">{v.kod}</b>
							<span class="sklad-blok-nazov">{v.nazov}</span>
							<span class="sklad-blok-cisla">
								sklad <b>{v.sklad}</b>, požadované <b>{v.mnozstvo}</b>
							</span>
						</div>
						{#if odobrate.has(v.kod)}
							<span class="sklad-blok-odobrata" data-testid={`${testid}-${v.kod}-odobrata`}
								>✓ Odobraná (qty → 0)</span
							>
						{:else}
							<button
								type="button"
								class="btn danger outline sm"
								data-testid={`${testid}-${v.kod}-odobrat`}
								onclick={() => odobrat(v.kod)}
							>
								Odobrať z odpisu
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.sklad-blok {
		background: var(--m-err-bg);
		border: 2px solid var(--m-err-border);
		color: var(--m-err-ink);
		border-radius: var(--m-radius-sm);
		padding: 18px 20px;
		margin-bottom: 16px;
	}
	.sklad-blok-hlavicka {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 17px;
		line-height: 1.35;
	}
	.sklad-blok-ikona {
		font-size: 26px;
		flex-shrink: 0;
		line-height: 1;
	}
	.sklad-blok-datum {
		font-size: 13px;
		opacity: 0.7;
	}
	.sklad-blok-popis {
		margin: 10px 0 14px 36px;
		font-size: 14px;
		line-height: 1.5;
		color: var(--m-ink);
	}
	.sklad-blok-zoznam {
		list-style: none;
		margin: 0 0 0 36px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sklad-blok-polozka {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--m-surface);
		border: 1px solid var(--m-err-border);
		border-radius: var(--m-radius-sm);
		padding: 10px 14px;
	}
	.sklad-blok-info {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 10px;
	}
	.sklad-blok-nazov {
		color: var(--m-ink);
		font-size: 14px;
	}
	.sklad-blok-cisla {
		font-size: 13px;
		color: var(--m-muted-ink);
	}
	.sklad-blok-odobrata {
		color: var(--m-ok);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}
	.odobrata {
		opacity: 0.55;
	}
	.odobrata .sklad-blok-polozka {
		border-style: dashed;
	}
</style>
