<script lang="ts">
	// Verejný zákaznícky konfigurátor prístreškov a altánkov (#390, etapa 7/7 jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch „3D NErob"; prístrešky = lead-gen
	// vrstva) a BEZ ORIENTAČNEJ CENY (honest-null: prístrešky nemajú overený cenový zdroj — cena sa
	// nevymýšľa). Konfigurácia (typ/rozmery/krytina/farba) sa počíta ČISTO klientsky (`$derived`,
	// žiadny server round-trip — netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF
	// špecifikácia (bez ceny) + Odoo lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`.
	// Money-neutralita: importuje LEN client-safe `konfigurator-pristresok` + DopytForm (guard:
	// konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		pristresokTyp,
		pristresokKrytina,
		pristresokVstupPlatny,
		konfigurujPristresok,
		pristresokPonukaConfig,
		type PristresokVstup
	} from '$lib/konfigurator-pristresok';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako bazén/pergola +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let typ = $state<string>(untrack(() => data.defaulty.typ));
	let krytina = $state<string>(untrack(() => data.defaulty.krytina));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, vzor #385 review 🔵).
	let dlzka = $state<number | null>(5000);
	let sirka = $state<number | null>(3000);
	let vyska = $state<number | null>(2500);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<PristresokVstup>({
		typ: pristresokTyp(typ),
		krytina: pristresokKrytina(krytina),
		dlzka: dlzka ?? 0,
		sirka: sirka ?? 0,
		vyska: vyska ?? 0,
		farba: farbaLabel
	});

	const platny = $derived(pristresokVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujPristresok(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? pristresokPonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si prístrešok alebo altánok — Montalu</title>
	<meta
		name="description"
		content="Zostav si hliníkový prístrešok, altánok, skleník či vonkajšiu saunu na mieru — vyber typ, rozmery, krytinu strechy a farbu a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="pris">
	<!-- HERO -->
	<section class="kp-hero">
		<div class="kp-hero-foto">
			<img
				src="{base}/konfigurator/vyber/pristresok.webp"
				alt="Hliníkový prístrešok na auto Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="kp-hero-text">
			<span class="kp-label">Konfigurátor prístreškov a altánkov</span>
			<h1>Navrhni si prístrešok alebo altánok</h1>
			<p>
				Vyber typ, rozmery a vyhotovenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s
				cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="kp-grid">
		<!-- OVLÁDANIE -->
		<div class="kp-ovladanie">
			<!-- TYP -->
			<fieldset class="kp-blok">
				<legend>Typ výrobku</legend>
				<div class="kp-karty">
					{#each data.typy as t (t.kod)}
						<button
							type="button"
							class="kp-karta"
							class:vybrana={typ === t.kod}
							aria-pressed={typ === t.kod}
							data-testid="pristresok-typ-{t.kod}"
							onclick={() => (typ = t.kod)}
						>
							<span class="kp-karta-nazov">{t.nazov}</span>
							<span class="kp-karta-popis">{t.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou/bazénom) -->
			<fieldset class="kp-blok">
				<legend>Rozmery</legend>
				<div class="kp-steppery">
					<RozmerStepper
						bind:hodnotaMm={dlzka}
						min={r.dlzka.min}
						max={r.dlzka.max}
						krokMm={r.dlzka.krok}
						popis="Dĺžka"
						akuzativ="dĺžku"
						id="pris-dlzka"
						testid="pristresok-dlzka"
						name="dlzka"
					/>
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="pris-sirka"
						testid="pristresok-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={vyska}
						min={r.vyska.min}
						max={r.vyska.max}
						krokMm={r.vyska.krok}
						popis="Výška"
						akuzativ="výšku"
						id="pris-vyska"
						testid="pristresok-vyska"
						name="vyska"
					/>
				</div>
			</fieldset>

			<!-- KRYTINA + FARBA -->
			<fieldset class="kp-blok">
				<legend>Vyhotovenie</legend>
				<div class="kp-rozmery">
					<label class="kp-pole">
						<span>Krytina / výplň strechy</span>
						<select bind:value={krytina} data-testid="pristresok-krytina">
							{#each data.krytiny as k (k.nazov)}
								<option value={k.nazov}>{k.nazov}</option>
							{/each}
						</select>
					</label>
					<label class="kp-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="pristresok-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="kp-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="kp-suhrn" data-testid="pristresok-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Typ výrobku</dt>
							<dd>{s.typNazov}</dd>
						</div>
						<div>
							<dt>Krytina / strecha</dt>
							<dd>{s.krytina}</dd>
						</div>
						<div>
							<dt>Rozmery (d × š)</dt>
							<dd data-testid="pristresok-suhrn-rozmery">{s.dlzka} × {s.sirka} mm</dd>
						</div>
						<div>
							<dt>Výška</dt>
							<dd>{s.vyska} mm</dd>
						</div>
						<div>
							<dt>Pôdorysná plocha</dt>
							<dd>{cislaCiarka(s.plochaM2)} m²</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: prístrešky nemajú orientačný cenník) -->
				<section class="kp-cena-info" data-testid="pristresok-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Prístrešok ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku
						po obhliadke miesta.
					</p>
					<button type="button" class="kp-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="kp-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o tento prístrešok?</h2>
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
				<p class="kp-chyba" data-testid="pristresok-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.kp-karty {
		--kp-karta-min: 200px;
	}
</style>
