<script lang="ts">
	// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — mobil-first (zákazník príde
	// z Facebook reklamy na telefóne). Display-only, BEZ CIEN. Používame `use:enhance`
	// (jadro SvelteKit) pre živú kalkulačku bez plného reloadu — vstupné polia ostanú tak,
	// ako ich zákazník zadal (žiadne value={} resetovanie, pasca nova-stranka #3/#4).
	// Názvy skla + farby prídu z `data` (server load) — klientsky bundle neimportuje žiaden
	// katalóg (žiadny Money kód na klientovi). Súčasť #280.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { KonfiguratorSuhrn } from '$lib/konfigurator';

	let { data } = $props();

	// rozmedzia z data (min/max hinty pre inputy) — $derived, aby Svelte nevarovalo
	// state_referenced_locally (data sa pre túto route aj tak nemení)
	const r = $derived(data.rozmedzia);

	// vstupné polia = $state + bind: (rozumné východiskové hodnoty v rámci rozmedzí)
	let sirka = $state<number | null>(4000);
	let hlbka = $state<number | null>(3500);
	let vyskaVpredu = $state<number | null>(2500);
	let sklonDeg = $state<number | null>(6);
	// jednorazový default zo servera (data pre túto route bez parametrov = nemenné) —
	// čítané cez untrack(), aby state initializer nevaroval state_referenced_locally
	let sklo = $state<string>(untrack(() => data.sklaTypy[0] ?? ''));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));

	// výsledok napĺňa use:enhance callback (živá kalkulačka); žiadne value={} echo
	let suhrn = $state<KonfiguratorSuhrn | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
</script>

<svelte:head>
	<title>Navrhni si pergolu — Montalu</title>
	<meta
		name="description"
		content="Zostav si pergolu na mieru — zadaj rozmery, sklon strechy, typ strešného skla a farbu a hneď uvidíš súhrn svojej konfigurácie."
	/>
</svelte:head>

<div class="konf">
	<header class="hero">
		<h1>Navrhni si svoju pergolu</h1>
		<p class="lead">
			Zadaj rozmery a vzhľad — hneď uvidíš prehľadný súhrn svojej pergoly. Nezáväzné, bez
			registrácie.
		</p>
	</header>

	<form
		method="POST"
		class="karta"
		use:enhance={() => {
			spracuva = true;
			return async ({ result }) => {
				spracuva = false;
				if (result.type === 'success') {
					suhrn = (result.data?.vysledok as KonfiguratorSuhrn | null) ?? null;
					chyba = '';
				} else if (result.type === 'failure') {
					suhrn = null;
					chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
				} else if (result.type === 'error') {
					suhrn = null;
					chyba = 'Nastala chyba pri výpočte. Skús to prosím znova.';
				}
				// zámerne NEvoláme update() — vstupy necháme tak, ako ich zákazník zadal
			};
		}}
	>
		<div class="pole-mriezka">
			<label>
				<span>Šírka (mm)</span>
				<input
					name="sirka"
					type="number"
					inputmode="numeric"
					min={r.sirka.min}
					max={r.sirka.max}
					step="10"
					bind:value={sirka}
					data-testid="sirka"
					required
				/>
			</label>
			<label>
				<span>Hĺbka (mm)</span>
				<input
					name="hlbka"
					type="number"
					inputmode="numeric"
					min={r.hlbka.min}
					max={r.hlbka.max}
					step="10"
					bind:value={hlbka}
					data-testid="hlbka"
					required
				/>
			</label>
			<label>
				<span>Výška vpredu (mm)</span>
				<input
					name="vyskaVpredu"
					type="number"
					inputmode="numeric"
					min={r.vyskaVpredu.min}
					max={r.vyskaVpredu.max}
					step="10"
					bind:value={vyskaVpredu}
					data-testid="vyskaVpredu"
					required
				/>
			</label>
			<label>
				<span>Sklon strechy (°)</span>
				<input
					name="sklonDeg"
					type="number"
					inputmode="numeric"
					min={r.sklon.min}
					max={r.sklon.max}
					step="1"
					bind:value={sklonDeg}
					data-testid="sklonDeg"
					required
				/>
			</label>
			<label>
				<span>Strešné sklo</span>
				<select name="sklo" bind:value={sklo} data-testid="sklo">
					{#each data.sklaTypy as t (t)}
						<option value={t}>{t}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Farba konštrukcie</span>
				<select name="farba" bind:value={farba} data-testid="farba">
					{#each data.farby as f (f.kod)}
						<option value={f.kod}>RAL {f.kod} {f.nazov}</option>
					{/each}
				</select>
			</label>
		</div>

		<button type="submit" class="zobrazit" data-testid="zobrazit" disabled={spracuva}>
			{spracuva ? 'Počítam…' : 'Zobraziť moju pergolu'}
		</button>
	</form>

	{#if chyba}
		<p class="chyba" data-testid="chyba">⚠ {chyba}</p>
	{/if}

	{#if suhrn}
		{@const s = suhrn}
		<section class="suhrn" data-testid="suhrn">
			<h2>Súhrn tvojej pergoly</h2>
			<dl>
				<div>
					<dt>Šírka</dt>
					<dd data-testid="s-sirka">{fmt(s.sirka)} mm</dd>
				</div>
				<div>
					<dt>Hĺbka</dt>
					<dd data-testid="s-hlbka">{fmt(s.hlbka)} mm</dd>
				</div>
				<div>
					<dt>Výška vpredu</dt>
					<dd data-testid="s-vyska-vpredu">{fmt(s.vyskaVpredu)} mm</dd>
				</div>
				<div>
					<dt>Výška pri stene</dt>
					<dd data-testid="s-vyska-stena">{fmt(s.vyskaPriStene)} mm</dd>
				</div>
				<div>
					<dt>Sklon strechy</dt>
					<dd data-testid="s-sklon">{fmt(s.sklonDeg)}°</dd>
				</div>
				<div>
					<dt>Svetlá výška vpredu</dt>
					<dd data-testid="s-svetla">{fmt(s.svetlaVyska)} mm</dd>
				</div>
				<div>
					<dt>Zastrešená plocha</dt>
					<dd data-testid="s-plocha">{fmt(s.zastresenaPlochaM2)} m²</dd>
				</div>
				<div>
					<dt>Strešné sklo</dt>
					<dd data-testid="s-sklo">{s.sklo}</dd>
				</div>
				<div>
					<dt>Farba konštrukcie</dt>
					<dd data-testid="s-farba">{s.farba}</dd>
				</div>
			</dl>
			<p class="pozn">
				Toto je nezáväzný náhľad konfigurácie. Cenovú ponuku pripravíme na základe tvojich
				požiadaviek.
			</p>
		</section>
	{/if}
</div>

<style>
	.konf {
		max-width: 720px;
		margin: 0 auto;
	}
	.hero {
		text-align: center;
		margin: 8px 0 20px;
	}
	.hero h1 {
		font-size: clamp(22px, 5vw, 30px);
		margin: 0 0 8px;
		color: #0f172a;
	}
	.lead {
		color: #64748b;
		font-size: 15px;
		margin: 0 auto;
		max-width: 520px;
	}
	.karta {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 18px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
	}
	.pole-mriezka {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.pole-mriezka label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13.5px;
		color: #475569;
		font-weight: 500;
	}
	.pole-mriezka input,
	.pole-mriezka select {
		width: 100%;
		box-sizing: border-box;
		padding: 11px 12px;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		font-size: 16px; /* 16px = žiadny auto-zoom na iOS pri fokuse */
		background: #fff;
		color: #0f172a;
	}
	.pole-mriezka input:focus,
	.pole-mriezka select:focus {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
		border-color: #2563eb;
	}
	.zobrazit {
		width: 100%;
		background: #2563eb;
		color: #fff;
		border: 0;
		border-radius: 10px;
		padding: 14px 18px;
		cursor: pointer;
		font-size: 16px;
		font-weight: 600;
	}
	.zobrazit:hover {
		background: #1d4ed8;
	}
	.zobrazit:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.chyba {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 10px;
		padding: 12px 14px;
		font-size: 14.5px;
		margin-top: 16px;
	}
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
	@media (min-width: 640px) {
		.pole-mriezka {
			grid-template-columns: repeat(3, 1fr);
		}
		.zobrazit {
			width: auto;
			min-width: 220px;
		}
	}
</style>
