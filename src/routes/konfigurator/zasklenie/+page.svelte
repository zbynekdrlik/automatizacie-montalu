<script lang="ts">
	// Verejný zákaznícky konfigurátor zasklenia terás a balkónov (#387, etapa jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch + vzor #385) a BEZ ORIENTAČNEJ CENY
	// (honest-null: zasklenie nemá overený cenový zdroj — cena sa nevymýšľa). Konfigurácia
	// (umiestnenie/model/rozmery/počet krídel/farba/výplň) sa počíta ČISTO klientsky (`$derived`,
	// žiadny server round-trip — netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF
	// špecifikácia (bez ceny) + Odoo lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`.
	// Money-neutralita: importuje LEN client-safe `konfigurator-zasklenie` + DopytForm (guard:
	// konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import KonfProduktStranka from '$lib/components/konfigurator/KonfProduktStranka.svelte';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		zaskleniUmiestnenie,
		zaskleniModel,
		zaskleniVypln,
		zaskleniVstupPlatny,
		konfigurujZasklenie,
		zaskleniePonukaConfig,
		type ZaskleniVstup
	} from '$lib/konfigurator-zasklenie';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako pergola/bazén +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let umiestnenie = $state<string>(untrack(() => data.defaulty.umiestnenie));
	let model = $state<string>(untrack(() => data.defaulty.model));
	let vypln = $state<string>(untrack(() => data.defaulty.vypln));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, #385 review 🔵); počet krídel = <select> (2..8, tiež nikdy null).
	let sirka = $state<number | null>(4000);
	let vyska = $state<number | null>(2500);
	let kridla = $state<number>(4);

	// whitelistované umiestnenie (jediný zdroj pravdy pre os umiestnenia — karty aj súhrn ho
	// používajú, takže sa nemôžu rozísť; raw `umiestnenie` je vždy platné z tlačidla/servera).
	const u = $derived(zaskleniUmiestnenie(umiestnenie));

	// modely dostupné pre zvolené umiestnenie (klient si filtruje z client-safe katalógu podľa `u`)
	const modelyPreU = $derived(data.modely.filter((m) => m.umiestnenie === u));

	// zmena umiestnenia RESETUJE model na prvý model daného umiestnenia (žiadny effect → žiadna
	// dead-effect pasca; reset žije priamo v onclick handleri, jedinom mieste zmeny umiestnenia).
	function vyberUmiestnenie(um: string) {
		umiestnenie = um;
		model = data.modely.find((m) => m.umiestnenie === um)?.kod ?? '';
	}

	// možnosti počtu krídel (2..8) — select nikdy nevráti mimo-rozmedzia/null hodnotu
	const kridlaOpts = $derived(
		Array.from(
			{ length: data.rozmedzia.kridla.max - data.rozmedzia.kridla.min + 1 },
			(_, i) => data.rozmedzia.kridla.min + i
		)
	);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<ZaskleniVstup>({
		umiestnenie: u,
		model: zaskleniModel(model, u),
		sirka: sirka ?? 0,
		vyska: vyska ?? 0,
		kridla,
		vypln: zaskleniVypln(vypln),
		farba: farbaLabel
	});

	const platny = $derived(zaskleniVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujZasklenie(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? zaskleniePonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<KonfProduktStranka
	titul="Navrhni si zasklenie terasy alebo balkóna — Montalu"
	popis="Zostav si zasklenie terasy alebo balkóna na mieru — vyber systém, rozmery, počet krídel, farbu a sklo a pošli nezáväzný dopyt so špecifikáciou v PDF."
	foto="zasklenie.webp"
	alt="Zasklenie terasy Montalu"
	label="Konfigurátor zasklenia terás a balkónov"
	nadpis="Navrhni si zasklenie"
	lead="Vyber umiestnenie, systém, rozmery a vyhotovenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s cenovou ponukou po obhliadke. Bez registrácie."
>
	{#snippet ovladacie()}
		<!-- UMIESTNENIE -->
		<fieldset class="kp-blok">
			<legend>Umiestnenie</legend>
			<div class="kp-karty dvoj">
				{#each data.umiestnenia as um (um)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={umiestnenie === um}
						aria-pressed={umiestnenie === um}
						data-testid="zasklenie-umiestnenie-{um}"
						onclick={() => vyberUmiestnenie(um)}
					>
						<span class="kp-karta-nazov">{um}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- MODEL (filtrovaný podľa umiestnenia) -->
		<fieldset class="kp-blok">
			<legend>Systém zasklenia</legend>
			<div class="kp-karty">
				{#each modelyPreU as m (m.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={model === m.kod}
						aria-pressed={model === m.kod}
						data-testid="zasklenie-model-{m.kod}"
						onclick={() => (model = m.kod)}
					>
						<span class="kp-karta-nazov">{m.kod}</span>
						<span class="kp-karta-system">{m.system}</span>
						<span class="kp-karta-popis">{m.popis}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou/bazénom) -->
		<fieldset class="kp-blok">
			<legend>Rozmery</legend>
			<div class="kp-steppery">
				<RozmerStepper
					bind:hodnotaMm={sirka}
					min={r.sirka.min}
					max={r.sirka.max}
					krokMm={r.sirka.krok}
					popis="Šírka"
					akuzativ="šírku"
					id="zas-sirka"
					testid="zasklenie-sirka"
					name="sirka"
				/>
				<RozmerStepper
					bind:hodnotaMm={vyska}
					min={r.vyska.min}
					max={r.vyska.max}
					krokMm={r.vyska.krok}
					popis="Výška"
					akuzativ="výšku"
					id="zas-vyska"
					testid="zasklenie-vyska"
					name="vyska"
				/>
				<label class="kp-pole kp-kridla">
					<span>Počet krídel</span>
					<select bind:value={kridla} data-testid="zasklenie-kridla">
						{#each kridlaOpts as n (n)}
							<option value={n}>{n}</option>
						{/each}
					</select>
				</label>
			</div>
		</fieldset>

		<!-- FARBA + VÝPLŇ -->
		<fieldset class="kp-blok">
			<legend>Vyhotovenie</legend>
			<div class="kp-rozmery">
				<label class="kp-pole">
					<span>Farba konštrukcie</span>
					<select bind:value={farba} data-testid="zasklenie-farba">
						{#each data.farby as f (f.kod)}
							<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
						{/each}
					</select>
				</label>
				<label class="kp-pole">
					<span>Sklo / výplň</span>
					<select bind:value={vypln} data-testid="zasklenie-vypln">
						{#each data.vyplne as v (v.nazov)}
							<option value={v.nazov}>{v.nazov}</option>
						{/each}
					</select>
				</label>
			</div>
		</fieldset>
	{/snippet}

	{#snippet panel()}
		{#if suhrn}
			{@const s = suhrn}
			<section class="kp-suhrn" data-testid="zasklenie-suhrn">
				<h2>Tvoja konfigurácia</h2>
				<dl>
					<div>
						<dt>Umiestnenie</dt>
						<dd>{s.umiestnenie}</dd>
					</div>
					<div>
						<dt>Systém</dt>
						<dd>{s.model} ({s.system})</dd>
					</div>
					<div>
						<dt>Rozmery (š × v)</dt>
						<dd data-testid="zasklenie-suhrn-rozmery">{s.sirka} × {s.vyska} mm</dd>
					</div>
					<div>
						<dt>Počet krídel</dt>
						<dd>{s.kridla}</dd>
					</div>
					<div>
						<dt>Zasklená plocha</dt>
						<dd>{cislaCiarka(s.plochaM2)} m²</dd>
					</div>
					<div>
						<dt>Farba</dt>
						<dd>{s.farba}</dd>
					</div>
					<div>
						<dt>Sklo / výplň</dt>
						<dd>{s.vypln}</dd>
					</div>
				</dl>
			</section>

			<!-- CENA je na DOPYT (honest-null: zasklenie nemá orientačný cenník) -->
			<section class="kp-cena-info" data-testid="zasklenie-cena-info">
				<strong>Cena na vyžiadanie</strong>
				<p>
					Zasklenie ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku po
					obhliadke miesta.
				</p>
				<button type="button" class="kp-btn primar" onclick={() => scrollNa('dopyt')}>
					Nezáväzný dopyt →
				</button>
			</section>

			<section class="kp-blok-kontakt" id="dopyt" data-testid="dopyt">
				<h2>Máš záujem o toto zasklenie?</h2>
				<p class="kp-uvod">
					Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
					pripravíme individuálne po obhliadke.
				</p>
				<DopytForm
					konfiguracia={ponukaCfg}
					disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
				/>
			</section>
		{:else}
			<p class="kp-chyba" data-testid="zasklenie-chyba">
				⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
			</p>
		{/if}
	{/snippet}
</KonfProduktStranka>

<style>
	/* Systém-zasklenia karty ostávajú na 150 px (default); Umiestnenie (.dvoj) je 160 px
	   (nie zdieľaných 200) — pôvodné `.zas-karty` 150 / `.zas-karty.dvoj` 160. */
	.kp-karty {
		--kp-karta-min-dvoj: 160px;
	}
	.kp-karta-system {
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--k-accent);
	}
	.kp-kridla {
		max-width: 220px;
	}
</style>
