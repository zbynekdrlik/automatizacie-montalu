<script lang="ts">
	// Verejný zákaznícky konfigurátor tienenia — markízy a screenové rolety (#389, etapa 6 rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch „3D NErob", ako bazén #385) a BEZ
	// ORIENTAČNEJ CENY (honest-null: tienenie nemá overený cenový zdroj — cena sa nevymýšľa). Konfigurácia
	// (typ/rozmery/ovládanie/farba) sa počíta ČISTO klientsky (`$derived`, žiadny server round-trip —
	// netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF špecifikácia (bez ceny) + Odoo
	// lead. Druhý rozmer je VÝSUN (markíza) / VÝŠKA (roleta) — label sa mení podľa druhu zvoleného modelu.
	// Farbu cloniacej látky NEPONÚKAME ako fixný výber (montalu.sk „podľa vzorkovníka") — poznámka nižšie.
	// Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN client-safe
	// `konfigurator-tienenie` + DopytForm (guard: konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import KonfProduktStranka from '$lib/components/konfigurator/KonfProduktStranka.svelte';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import {
		tienenieModel,
		tienenieOvladanie,
		tienenieModelInfo,
		tienenieRanges,
		rozmer2Popis,
		rozmer2Akuzativ,
		tienenieVstupPlatny,
		konfigurujTienenie,
		tieneniePonukaConfig,
		type TienenieVstup
	} from '$lib/konfigurator-tienenie';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (vzor bazén/pergola +page.svelte) — inak Svelte varuje
	// „state_referenced_locally" pri čítaní `data` mimo derived.
	let model = $state<string>(untrack(() => data.defaulty.model));
	let ovladanie = $state<string>(untrack(() => data.defaulty.ovladanie));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak pri
	// editovaní rozmerov nezmizne, vzor #385). `rozmer2` = výsun/výška (label podľa druhu).
	let sirka = $state<number | null>(4000);
	let rozmer2 = $state<number | null>(3000);

	// info + rozmedzia + druh zvoleného modelu. Limity SÚ per model (review #389 🟡 — nič nevymýšľaj):
	// `r` sa mení pri prepnutí typu, RozmerStepper dostane nové min/max. `druh` (markíza/roleta) riadi
	// label druhého rozmeru (výsun/výška) + súhrn.
	const modelInfo = $derived(tienenieModelInfo(tienenieModel(model)));
	const r = $derived(tienenieRanges(tienenieModel(model)));
	const druh = $derived(modelInfo.druh);
	const rozmer2Label = $derived(rozmer2Popis(druh)); // „Výsun" | „Výška"
	const rozmer2Akuz = $derived(rozmer2Akuzativ(druh)); // „výsun" | „výšku"
	// ovládanie dostupné PRE MODEL (montalu.sk: ZIPLINE/XLINE motorické, XLIGHT aj ručné) — katalóg
	// (`data.ovladanie`) prefiltrovaný na to, čo model reálne ponúka.
	const ovladaceModelu = $derived(
		data.ovladanie.filter((o) => modelInfo.ovladanie.includes(o.kod))
	);

	// pri prepnutí typu: clampni rozmery do NOVÝCH per-model limitov (nech súhrn nezmizne) a normalizuj
	// ovládanie na to, čo model ponúka. Zápis rovnakej hodnoty je no-op (žiadna slučka).
	$effect(() => {
		const rng = tienenieRanges(tienenieModel(model));
		if (sirka != null) {
			const c = Math.min(rng.sirka.max, Math.max(rng.sirka.min, sirka));
			if (c !== sirka) sirka = c;
		}
		if (rozmer2 != null) {
			const c = Math.min(rng.rozmer2.max, Math.max(rng.rozmer2.min, rozmer2));
			if (c !== rozmer2) rozmer2 = c;
		}
		ovladanie = tienenieOvladanie(ovladanie, tienenieModel(model));
	});

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<TienenieVstup>({
		model: tienenieModel(model),
		ovladanie: tienenieOvladanie(ovladanie, tienenieModel(model)),
		sirka: sirka ?? 0,
		rozmer2: rozmer2 ?? 0,
		farba: farbaLabel
	});

	const platny = $derived(tienenieVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujTienenie(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? tieneniePonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<KonfProduktStranka
	foto="tienenie.webp"
	alt="Hliníková markíza Montalu"
	label="Konfigurátor tienenia"
	nadpis="Navrhni si markízu alebo roletu"
	lead="Vyber typ, rozmery a ovládanie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s cenovou ponukou po obhliadke. Bez registrácie."
>
	{#snippet ovladacie()}
		<!-- TYP -->
		<fieldset class="kp-blok">
			<legend>Typ tienenia</legend>
			<div class="kp-karty">
				{#each data.modely as m (m.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={model === m.kod}
						aria-pressed={model === m.kod}
						data-testid="tienenie-model-{m.kod}"
						onclick={() => (model = m.kod)}
					>
						<span class="kp-karta-nazov">{m.nazov}</span>
						<span class="kp-karta-popis">{m.popis}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- OVLÁDANIE — len to, čo model reálne ponúka (montalu.sk); testid je ASCII `id`. -->
		<fieldset class="kp-blok">
			<legend>Ovládanie</legend>
			<div class="kp-karty dvoj">
				{#each ovladaceModelu as o (o.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={ovladanie === o.kod}
						aria-pressed={ovladanie === o.kod}
						data-testid="tienenie-ovladanie-{o.id}"
						onclick={() => (ovladanie = o.kod)}
					>
						<span class="kp-karta-nazov">{o.kod}</span>
						<span class="kp-karta-popis">{o.popis}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- ROZMERY — metrové steppery (#333 RozmerStepper). Druhý rozmer = výsun (markíza) / výška
			     (roleta) — popis + akuzatív aria-labelu sa menia podľa druhu zvoleného typu. -->
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
					id="tie-sirka"
					testid="tienenie-sirka"
					name="sirka"
				/>
				<RozmerStepper
					bind:hodnotaMm={rozmer2}
					min={r.rozmer2.min}
					max={r.rozmer2.max}
					krokMm={r.rozmer2.krok}
					popis={rozmer2Label}
					akuzativ={rozmer2Akuz}
					id="tie-rozmer2"
					testid="tienenie-rozmer2"
					name="rozmer2"
				/>
			</div>
		</fieldset>

		<!-- FARBA -->
		<fieldset class="kp-blok">
			<legend>Vyhotovenie</legend>
			<div class="kp-rozmery">
				<label class="kp-pole">
					<span>Farba konštrukcie</span>
					<select bind:value={farba} data-testid="tienenie-farba">
						{#each data.farby as f (f.kod)}
							<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
						{/each}
					</select>
				</label>
			</div>
			<p class="kp-latka-info">
				Farbu cloniacej látky vyberieme spoločne zo vzorkovníka po obhliadke — ponúkame širokú škálu
				odtieňov aj vzorov.
			</p>
		</fieldset>
	{/snippet}

	{#snippet panel()}
		{#if suhrn}
			{@const s = suhrn}
			<section class="kp-suhrn" data-testid="tienenie-suhrn">
				<h2>Tvoja konfigurácia</h2>
				<dl>
					<div>
						<dt>Typ</dt>
						<dd>{s.nazov}</dd>
					</div>
					<div>
						<dt>Ovládanie</dt>
						<dd>{s.ovladanie}</dd>
					</div>
					<div>
						<dt>Šírka</dt>
						<dd data-testid="tienenie-suhrn-sirka">{s.sirka} mm</dd>
					</div>
					<div>
						<dt>{rozmer2Label}</dt>
						<dd data-testid="tienenie-suhrn-rozmer2">{s.rozmer2} mm</dd>
					</div>
					<div>
						<dt>Farba konštrukcie</dt>
						<dd>{s.farba}</dd>
					</div>
				</dl>
			</section>

			<!-- CENA je na DOPYT (honest-null: tienenie nemá orientačný cenník) -->
			<section class="kp-cena-info" data-testid="tienenie-cena-info">
				<strong>Cena na vyžiadanie</strong>
				<p>
					Markízy aj rolety naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku
					po obhliadke miesta.
				</p>
				<button type="button" class="kp-btn primar" onclick={() => scrollNa('dopyt')}>
					Nezáväzný dopyt →
				</button>
			</section>

			<section class="kp-blok-kontakt" id="dopyt" data-testid="dopyt">
				<h2>Máš záujem o toto tienenie?</h2>
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
			<p class="kp-chyba" data-testid="tienenie-chyba">
				⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
			</p>
		{/if}
	{/snippet}
</KonfProduktStranka>

<style>
	.kp-latka-info {
		margin: 12px 0 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--k-muted);
	}
</style>
