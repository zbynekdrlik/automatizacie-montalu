<script lang="ts">
	// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384; #408
	// orientačná cena). JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — geometria zimnej záhrady
	// zatiaľ neexistuje). Konfigurácia (model/rozmery/farba/zasklenie) sa počíta ČISTO klientsky
	// (`$derived`); ORIENTAČNÚ cenu (#408) počíta SERVER na klik (`vypocet` akcia, enhance submit —
	// cenový modul je server-only, do klienta sa nedostane) a všetko tečie do zdieľaného DopytForm
	// (#277) → PDF špecifikácia s orientačnou cenou + Odoo lead. Zdieľané `--k-*` tokeny z
	// `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN client-safe
	// `konfigurator-zimna-zahrada` + DopytForm + LEN typy ceny (guard: konfigurator-money-safety).
	// Žiadne `console.*`.
	import { untrack } from 'svelte';
	import KonfProduktStranka from '$lib/components/konfigurator/KonfProduktStranka.svelte';
	import { enhance } from '$app/forms';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		zzModel,
		zzZasklenie,
		zzVstupPlatny,
		konfigurujZimnaZahradu,
		zimnaZahradaPonukaConfig,
		type ZzVstup
	} from '$lib/konfigurator-zimna-zahrada';
	import type { PonukaConfig } from '$lib/ponuka';
	// #408: typy orientačnej ceny (server-počítanej `vypocet` akciou). LEN typy → žiadny import
	// cenového/Money modulu do klientskeho bundle (leak-guard A ostáva zelený).
	import type { VerejnaCena } from '$lib/konfigurator';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako pergola/bazén +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let model = $state<string>(untrack(() => data.defaulty.model));
	let zasklenie = $state<string>(untrack(() => data.defaulty.zasklenie));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, #385 review 🔵).
	let sirka = $state<number | null>(4000);
	let hlbka = $state<number | null>(3500);
	let vyska = $state<number | null>(2800);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<ZzVstup>({
		model: zzModel(model),
		sirka: sirka ?? 0,
		hlbka: hlbka ?? 0,
		vyska: vyska ?? 0,
		zasklenie: zzZasklenie(zasklenie),
		farba: farbaLabel
	});

	const platny = $derived(zzVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujZimnaZahradu(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? zimnaZahradaPonukaConfig(suhrn) : {});

	// #408: orientačná cena — server-počítaná (`vypocet` akcia, enhance submit, žiadny reload). Zobrazí
	// sa až po kliku „Zobraziť orientačnú cenu" (vzor pergolovej/bazénovej `vypocet`); pri zmene
	// rozmerov/zasklenia/modelu sa výsledok považuje za neaktuálny (`cenaAktualna`), takže sa NIKDY
	// neukáže cena pre iný config.
	let cenaVysledok = $state<{ cena: VerejnaCena } | null>(null);
	let cenaError = $state<string | null>(null);
	let cenaNacitava = $state(false);
	let poslednyKluc = $state<string | null>(null);
	const cenaKluc = $derived(
		`${zzModel(model)}|${hlbka ?? 0}|${sirka ?? 0}|${zzZasklenie(zasklenie)}`
	);
	const cenaAktualna = $derived(cenaVysledok !== null && poslednyKluc === cenaKluc);

	const eur = (n: number) =>
		n.toLocaleString('sk-SK', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<KonfProduktStranka
	titul="Navrhni si zimnú záhradu — Montalu"
	popis="Zostav si hliníkovú zimnú záhradu na mieru — vyber model, rozmery, farbu a typ zasklenia a pošli nezáväzný dopyt so špecifikáciou v PDF."
	foto="zimna-zahrada.webp"
	alt="Hliníková zimná záhrada Montalu"
	label="Konfigurátor zimných záhrad"
	nadpis="Navrhni si zimnú záhradu"
	lead="Vyber model, rozmery a zasklenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s cenovou ponukou po obhliadke. Bez registrácie."
>
	{#snippet ovladacie()}
		<!-- MODEL -->
		<fieldset class="kp-blok">
			<legend>Model</legend>
			<div class="kp-karty dvoj">
				{#each data.modely as m (m.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={model === m.kod}
						aria-pressed={model === m.kod}
						data-testid="zz-model-{m.kod}"
						onclick={() => (model = m.kod)}
					>
						<span class="kp-karta-nazov">{m.kod}</span>
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
					id="zz-sirka"
					testid="zz-sirka"
					name="sirka"
				/>
				<RozmerStepper
					bind:hodnotaMm={hlbka}
					min={r.hlbka.min}
					max={r.hlbka.max}
					krokMm={r.hlbka.krok}
					popis="Hĺbka"
					akuzativ="hĺbku"
					id="zz-hlbka"
					testid="zz-hlbka"
					name="hlbka"
				/>
				<RozmerStepper
					bind:hodnotaMm={vyska}
					min={r.vyska.min}
					max={r.vyska.max}
					krokMm={r.vyska.krok}
					popis="Výška"
					akuzativ="výšku"
					id="zz-vyska"
					testid="zz-vyska"
					name="vyska"
				/>
			</div>
		</fieldset>

		<!-- FARBA + ZASKLENIE -->
		<fieldset class="kp-blok">
			<legend>Vyhotovenie</legend>
			<div class="kp-rozmery">
				<label class="kp-pole">
					<span>Farba konštrukcie</span>
					<select bind:value={farba} data-testid="zz-farba">
						{#each data.farby as f (f.kod)}
							<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
						{/each}
					</select>
				</label>
				<label class="kp-pole">
					<span>Zasklenie</span>
					<select bind:value={zasklenie} data-testid="zz-zasklenie">
						{#each data.zasklenia as z (z.nazov)}
							<option value={z.nazov}>{z.nazov}</option>
						{/each}
					</select>
				</label>
			</div>
		</fieldset>
	{/snippet}

	{#snippet panel()}
		{#if suhrn}
			{@const s = suhrn}
			<section class="kp-suhrn" data-testid="zz-suhrn">
				<h2>Tvoja konfigurácia</h2>
				<dl>
					<div>
						<dt>Model</dt>
						<dd>{s.model}</dd>
					</div>
					<div>
						<dt>Rozmery (š × h)</dt>
						<dd data-testid="zz-suhrn-rozmery">{s.sirka} × {s.hlbka} mm</dd>
					</div>
					<div>
						<dt>Výška</dt>
						<dd>{s.vyska} mm</dd>
					</div>
					<div>
						<dt>Zastavaná plocha</dt>
						<dd>{cislaCiarka(s.plochaM2)} m²</dd>
					</div>
					<div>
						<dt>Farba</dt>
						<dd>{s.farba}</dd>
					</div>
					<div>
						<dt>Zasklenie</dt>
						<dd>{s.zasklenie}</dd>
					</div>
				</dl>
			</section>

			<!-- ORIENTAČNÁ CENA (#408) — server-počítaná maticou montalu.sk (enhance submit) -->
			<section class="kp-cena" data-testid="zz-cena-sekcia">
				{#if cenaAktualna && cenaVysledok}
					{@const c = cenaVysledok.cena}
					<div class="kp-cena-blok" data-testid="zz-cena">
						{#if c.druh === 'cena'}
							<span class="kp-cena-label">Orientačná cena</span>
							{#if c.hladinaLabel}
								<span class="kp-cena-vo" data-testid="zz-cena-hladina">{c.hladinaLabel}</span>
							{/if}
							<div class="kp-cena-hlavne">
								<span class="kp-cena-sdph" data-testid="zz-cena-sdph">{eur(c.sDph)}</span>
								<span class="kp-cena-mena">s DPH</span>
							</div>
							<div class="kp-cena-bezdph" data-testid="zz-cena-bezdph">
								{eur(c.bezDph)} bez DPH
							</div>
							<!-- montalu zaokrúhľuje rozmer NAHOR na katalóg — čestne to doplň, keď sa líši od zadaného -->
							{#if Math.round(c.sirkaGridM * 1000) !== sirka || Math.round(c.hlbkaGridM * 1000) !== hlbka}
								<div class="kp-cena-grid" data-testid="zz-cena-grid">
									Cena platí pre najbližší katalógový rozmer {cislaCiarka(c.sirkaGridM)} × {cislaCiarka(
										c.hlbkaGridM
									)} m.
								</div>
							{/if}
						{:else}
							<span class="kp-cena-label">Cena na vyžiadanie</span>
							{#if c.hladinaLabel}
								<span class="kp-cena-vo" data-testid="zz-cena-hladina">{c.hladinaLabel}</span>
							{/if}
							<p class="kp-cena-dovod" data-testid="zz-cena-individualna">
								{c.dovod} Pripravíme ti individuálnu ponuku.
							</p>
						{/if}
						<p class="kp-cena-pozn">
							Orientačná cena vychádza z rozmerov a zvoleného zasklenia pri základnom vyhotovení
							konštrukcie. Presné vyhotovenie (model, zasklenie stien) a záväznú cenu pripravíme po
							obhliadke miesta.
						</p>
					</div>
				{:else}
					<form
						method="POST"
						action="?/vypocet"
						class="kp-cena-form"
						use:enhance={() => {
							const submitted = cenaKluc;
							cenaNacitava = true;
							cenaError = null;
							return ({ result }) => {
								cenaNacitava = false;
								if (result.type === 'success') {
									const d = result.data as { cena: VerejnaCena } | undefined;
									if (d?.cena) {
										cenaVysledok = { cena: d.cena };
										poslednyKluc = submitted;
									}
								} else if (result.type === 'failure') {
									const d = result.data as { error?: string } | undefined;
									cenaError = d?.error ?? 'Cenu sa nepodarilo spočítať.';
								} else if (result.type === 'error') {
									// sieťová/serverová výnimka — nenechaj tlačidlo „visieť" bez odozvy
									cenaError = 'Cenu sa nepodarilo spočítať, skús to prosím o chvíľu znova.';
								}
							};
						}}
					>
						<input type="hidden" name="model" value={vstup.model} />
						<input type="hidden" name="hlbka" value={hlbka ?? 0} />
						<input type="hidden" name="sirka" value={sirka ?? 0} />
						<input type="hidden" name="zasklenie" value={vstup.zasklenie} />
						<strong>Orientačná cena</strong>
						<p>
							Zobraz si orientačnú cenu pre zvolené rozmery a zasklenie. Presnú, záväznú cenu
							pripravíme po obhliadke miesta.
						</p>
						{#if cenaError}
							<p class="kp-cena-chyba" data-testid="zz-cena-chyba">{cenaError}</p>
						{/if}
						<button
							type="submit"
							class="kp-btn primar"
							data-testid="zz-cena-zobrazit"
							disabled={cenaNacitava}
						>
							{cenaNacitava
								? 'Počítam…'
								: cenaVysledok
									? 'Prepočítať orientačnú cenu →'
									: 'Zobraziť orientačnú cenu →'}
						</button>
					</form>
				{/if}
				<button type="button" class="kp-btn druhotny" onclick={() => scrollNa('dopyt')}>
					Nezáväzný dopyt →
				</button>
			</section>

			<section class="kp-blok-kontakt" id="dopyt" data-testid="dopyt">
				<h2>Máš záujem o túto zimnú záhradu?</h2>
				<p class="kp-uvod">
					Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) s orientačnou cenou na
					stiahnutie. Presnú, záväznú cenu pripravíme po obhliadke miesta.
				</p>
				<DopytForm konfiguracia={ponukaCfg} />
			</section>
		{:else}
			<p class="kp-chyba" data-testid="zz-chyba">
				⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
			</p>
		{/if}
	{/snippet}
</KonfProduktStranka>
