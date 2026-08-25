<script lang="ts">
	// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — mobil-first (zákazník príde
	// z Facebook reklamy na telefóne). Display-only, BEZ CIEN. Používame `use:enhance`
	// (jadro SvelteKit) pre živú kalkulačku bez plného reloadu — vstupné polia ostanú tak,
	// ako ich zákazník zadal (žiadne value={} resetovanie, pasca nova-stranka #3/#4).
	// Názvy skla + farby prídu z `data` (server load) — klientsky bundle neimportuje žiaden
	// katalóg (žiadny Money kód na klientovi). Súčasť #280.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		typSkla3D,
		type KonfiguratorSuhrn,
		type VerejnaCena,
		type CenaModelu
	} from '$lib/konfigurator';
	// #276: typ odtieňa 3D náhľadu (mapovaný z názvu skla cez typSkla3D). `import type`
	// je pri builde zmazaný — žiadny runtime import vizuál/Money vrstvy z tohto klienta.
	import type { PergolaTypSkla } from '$lib/vizual/pergola-sklo';
	// #277: verejný dopyt (kontaktný formulár → PDF ponuka BEZ CIEN). DopytForm je čistý
	// klientsky komponent (importuje len pure `$lib/dopyt` + `$lib/ponuka`, žiadny katalóg/
	// Money/server) — únik guard tests/konfigurator-money-safety.test.ts prejde jeho graf.
	import DopytForm from '$lib/components/DopytForm.svelte';
	// #319: záväzná objednávka (kontakt + fakturačné údaje + súhlas → uloženie + PDF + Odoo
	// opportunity). Rovnako čistý klientsky komponent ako DopytForm (len pure `$lib/dopyt` +
	// `$lib/ponuka`) — únik guard (A) prejde jeho graf.
	import ObjednavkaForm from '$lib/components/ObjednavkaForm.svelte';
	import type { PonukaConfig } from '$lib/ponuka';

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
	// #279 Fáza C: model konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup (default LIGHT).
	let model = $state<string>(untrack(() => data.modely[0]?.kod ?? 'LIGHT'));

	// výsledok napĺňa use:enhance callback (živá kalkulačka); žiadne value={} echo
	let suhrn = $state<KonfiguratorSuhrn | null>(null);
	// #279 Fáza C: orientačná cena zvoleného modelu (LEN MO — VO server odstráni) + porovnanie
	// všetkých 3 modelov. Napĺňa sa spolu so `suhrn` pri submite (server-autoritatívne).
	let cena = $state<VerejnaCena | null>(null);
	let cenyModely = $state<CenaModelu[] | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	// #276: 3D náhľad pergoly. `viz` je SNAPSHOT vstupov PRI SUBMITE (server-autoritatívny
	// súhrn + odoslaný RAL kód) — 3D je vždy konzistentný so ZOBRAZENÝM súhrnom, aj keď
	// zákazník po submite prepíše input bez re-submitu. Komponent sa načíta LAZY (dynamic
	// import) až pri prvom náhľade — 3D/three.js bundle sa nenačíta pred zobrazením náhľadu.
	// Form ostáva jediný zdroj pravdy (vlastné ovládanie komponentu je skryté).
	type Viz3D = {
		sirkaMm: number;
		hlbkaMm: number;
		vyskaVpreduMm: number;
		vyskaPriSteneMm: number;
		typSkla: PergolaTypSkla;
		ralKod: string;
	};
	let viz = $state<Viz3D | null>(null);
	type VizualKompTyp =
		(typeof import('$lib/components/vizual/VizualPergolaZakaznik.svelte'))['default'];
	let VizualKomp = $state<VizualKompTyp | null>(null);
	// in-flight guard: dva rýchle submity pred vyriešením prvého importu by inak spustili
	// import() dvakrát (benígne — Vite chunk cache, ale zámer je explicitný)
	let vizNacitava = false;

	// #286: AR náhľad (GLB export + model-viewer) — LAZY, rovnaký vzor ako VizualKomp
	// (three/model-viewer bundle sa nenačíta pred zobrazením súhrnu). Používa ten istý
	// `viz` snapshot (rozmery/typ skla/RAL) ako 3D náhľad.
	type ARKompTyp = (typeof import('$lib/components/vizual/PergolaAR.svelte'))['default'];
	let ARKomp = $state<ARKompTyp | null>(null);
	let arNacitava = false;

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
	// #279 Fáza C: katalógový rozmer [m] (bez zaokrúhľovacej straty — 4.25 → „4,25").
	const fmtM = (n: number) => String(n).replace('.', ',');
	// #279 Fáza C: formátovanie orientačnej EUR ceny (sk-SK, napr. „4 452,06 €").
	const eur = (n: number) =>
		n.toLocaleString('sk-SK', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});

	// Konfigurácia pre PDF ponuku — mapovanie súhrnu enginu na PonukaConfig, ktorý DopytForm
	// odošle skrytým JSON poľom. Sklon + svetlá výška + plocha idú do `popis` (PonukaConfig
	// nemá pre ne vlastné pole), nech ich PDF špecifikácia zachová. BEZ CIEN / Money kódov.
	const ponukaCfg = $derived<PonukaConfig>(
		suhrn
			? {
					system: 'Pergola',
					model: suhrn.model,
					sirka: suhrn.sirka,
					hlbka: suhrn.hlbka,
					vyskaVpredu: suhrn.vyskaVpredu,
					vyskaPriStene: suhrn.vyskaPriStene,
					farba: suhrn.farba,
					sklo: suhrn.sklo,
					popis: `Sklon strechy ${fmt(suhrn.sklonDeg)}°, svetlá výška vpredu ${fmt(
						suhrn.svetlaVyska
					)} mm, zastrešená plocha ${fmt(suhrn.zastresenaPlochaM2)} m².`
				}
			: {}
	);
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
			Zadaj rozmery, model a vzhľad — hneď uvidíš súhrn a orientačnú cenu svojej pergoly. Nezáväzné,
			bez registrácie.
		</p>
	</header>

	<!-- kalkulačka POSTuje na pomenovanú akciu ?/vypocet (nie default — #277 pridal ?/dopyt,
	     SvelteKit nedovolí default + pomenované naraz) -->
	<form
		method="POST"
		action="?/vypocet"
		class="karta"
		use:enhance={() => {
			spracuva = true;
			// zachyť odoslaný RAL kód PRI submite (`suhrn.farba` nesie len display label
			// „RAL 7016 ANTRACIT", 3D náhľad potrebuje samotný kód „7016")
			const odoslanaFarba = farba;
			return async ({ result }) => {
				spracuva = false;
				if (result.type === 'success') {
					suhrn = (result.data?.vysledok as KonfiguratorSuhrn | null) ?? null;
					cena = (result.data?.cena as VerejnaCena | null) ?? null;
					cenyModely = (result.data?.cenyModely as CenaModelu[] | null) ?? null;
					chyba = '';
					if (suhrn) {
						viz = {
							sirkaMm: suhrn.sirka,
							hlbkaMm: suhrn.hlbka,
							vyskaVpreduMm: suhrn.vyskaVpredu,
							vyskaPriSteneMm: suhrn.vyskaPriStene,
							typSkla: typSkla3D(suhrn.sklo),
							ralKod: odoslanaFarba
						};
						// lazy-load komponentu až pri PRVOM náhľade (3D/three.js bundle
						// sa nenačíta skôr); ďalšie submity už používajú načítaný modul
						if (!VizualKomp && !vizNacitava) {
							vizNacitava = true;
							void import('$lib/components/vizual/VizualPergolaZakaznik.svelte')
								.then((m) => (VizualKomp = m.default))
								.finally(() => (vizNacitava = false));
						}
						// #286: lazy AR komponent (rovnako len pri prvom náhľade)
						if (!ARKomp && !arNacitava) {
							arNacitava = true;
							void import('$lib/components/vizual/PergolaAR.svelte')
								.then((m) => (ARKomp = m.default))
								.finally(() => (arNacitava = false));
						}
					} else {
						viz = null;
					}
				} else if (result.type === 'failure') {
					suhrn = null;
					cena = null;
					cenyModely = null;
					viz = null;
					chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
				} else if (result.type === 'error') {
					suhrn = null;
					cena = null;
					cenyModely = null;
					viz = null;
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

		<!-- #279 Fáza C: výber modelu konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup
		     zrkadlený z montalu.sk. Radio-karty s krátkym popisom rozdielu; cena je rozmerovo
		     závislá a zobrazí sa po submite (súhrn + porovnanie modelov). -->
		<fieldset class="modely" data-testid="modely">
			<legend>Model konštrukcie</legend>
			<div class="modely-mriezka">
				{#each data.modely as m (m.kod)}
					<label class="model-karta" class:vybrana={model === m.kod}>
						<input
							type="radio"
							name="model"
							value={m.kod}
							bind:group={model}
							data-testid="model-{m.kod}"
						/>
						<span class="model-nazov">{m.kod}</span>
						<span class="model-popis">{m.popis}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<button type="submit" class="zobrazit" data-testid="zobrazit" disabled={spracuva}>
			{spracuva ? 'Počítam…' : 'Zobraziť moju pergolu'}
		</button>
	</form>

	{#if chyba}
		<p class="chyba" data-testid="chyba">⚠ {chyba}</p>
	{/if}

	{#if suhrn}
		{@const s = suhrn}

		<!-- #279 Fáza C: ORIENTAČNÁ CENA zvoleného modelu (MO s DPH primárne, bez DPH sekundárne)
		     + porovnanie všetkých 3 modelov (zrkadlo montalu.sk). LEN maloobchod — žiadna VO
		     cena, žiadny Money kód, žiadny nárez. Mimo katalógu ⇒ „cena na vyžiadanie". -->
		{#if cena}
			<section class="cena-blok" data-testid="cena" aria-label="Orientačná cena pergoly">
				{#if cena.druh === 'cena'}
					<div class="cena-hlavne">
						<span class="cena-label">Orientačná cena — model {cena.model}</span>
						{#if cena.hladinaLabel}
							<!-- #318: VO hladina — text prichádza zo SERVERA (`hladinaLabel`), komponent nenesie
							     žiadny VO literál; odznak (a teda náznak VO hladiny) vidí LEN prihlásený veľkoobchodný
							     (b2b) účet — neprihlásený/MO návštevník ho v DOM ani v bundle NIKDY nevidí. -->
							<span class="cena-vo" data-testid="cena-hladina">{cena.hladinaLabel}</span>
						{/if}
						<span class="cena-sdph" data-testid="cena-sdph">{eur(cena.sDph)}</span>
						<span class="cena-mena">s DPH</span>
					</div>
					<div class="cena-bezdph" data-testid="cena-bezdph">{eur(cena.bezDph)} bez DPH</div>
					<!-- #279 Fáza C: rozmer sa cení na najbližší katalógový rozmer (mriežka) —
					     ak sa líši od zadaného, čestne to zobraz (inak by cena „nesedela" s rozmermi). -->
					{#if Math.round(cena.sirkaGridM * 1000) !== s.sirka || Math.round(cena.hlbkaGridM * 1000) !== s.hlbka}
						<div class="cena-grid" data-testid="cena-grid">
							Cena platí pre najbližší katalógový rozmer {fmtM(cena.sirkaGridM)} × {fmtM(
								cena.hlbkaGridM
							)} m.
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
					Orientačná cena vychádza z aktuálneho cenníka pre zvolený model a rozmery (základná
					výplň). Presnú, záväznú cenu pripravíme po obhliadke.
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
		{/if}

		<!-- #276: predajný 3D náhľad konfigurovanej pergoly — „hero" súhrnu. Lazy-loaded,
		     form-driven (vlastné ovládanie komponentu skryté), previazaný na rozmery/sklo/RAL
		     zo submitnutého súhrnu. `{#key}` na rozmeroch remountne 3D pri zmene rozmerov,
		     aby sa scénický rig (kamera/tiene/dekal, dimenzované raz pri mounte) prefitoval. -->
		{#if viz}
			{@const v = viz}
			<section class="viz3d" data-testid="konf-viz" aria-label="3D náhľad pergoly">
				{#if VizualKomp}
					{@const Komp = VizualKomp}
					{#key `${v.sirkaMm}|${v.hlbkaMm}|${v.vyskaVpreduMm}|${v.vyskaPriSteneMm}`}
						<Komp
							sirkaMm={v.sirkaMm}
							hlbkaMm={v.hlbkaMm}
							vyskaVpreduMm={v.vyskaVpreduMm}
							vyskaPriSteneMm={v.vyskaPriSteneMm}
							typSkla={v.typSkla}
							ralKod={v.ralKod}
							zobrazOvladanie={false}
						/>
					{/key}
				{:else}
					<div class="viz3d-loading" data-testid="konf-viz-loading">Načítavam 3D náhľad…</div>
				{/if}
			</section>

			<!-- #286: AR náhľad — „pergola u teba na záhrade" cez telefón. Lazy, mobil-first
			     (mobil ukáže model-viewer + AR tlačidlo, desktop QR na presun na telefón). -->
			<section class="ar-sekcia" data-testid="konf-ar" aria-label="AR náhľad pergoly">
				{#if ARKomp}
					{@const A = ARKomp}
					<A
						sirkaMm={v.sirkaMm}
						hlbkaMm={v.hlbkaMm}
						vyskaVpreduMm={v.vyskaVpreduMm}
						vyskaPriSteneMm={v.vyskaPriSteneMm}
						typSkla={v.typSkla}
						ralKod={v.ralKod}
					/>
				{:else}
					<div class="ar-loading" data-testid="konf-ar-loading">Načítavam AR náhľad…</div>
				{/if}
			</section>
		{/if}

		<section class="suhrn" data-testid="suhrn">
			<h2>Súhrn tvojej pergoly</h2>
			<dl>
				<div>
					<dt>Model</dt>
					<dd data-testid="s-model">{s.model}</dd>
				</div>
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
				Toto je nezáväzný náhľad konfigurácie s orientačnou cenou. Presnú, záväznú cenu pripravíme
				po obhliadke.
			</p>
		</section>

		<!-- #277: kontaktný formulár → PDF ponuka BEZ CIEN (download-first) -->
		<section class="kontakt" data-testid="dopyt">
			<h2>Máš záujem o túto pergolu?</h2>
			<p class="kontakt-uvod">
				Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) s orientačnou cenou na
				stiahnutie. Presnú cenu pripravíme po obhliadke.
			</p>
			<DopytForm konfiguracia={ponukaCfg} />
		</section>

		<!-- #319: voliteľný krok — ZÁVÄZNÁ OBJEDNÁVKA (kontakt + fakturačné údaje + súhlas).
		     Money-neutrálne, žiadna platobná brána; objednaná cena sa zapečatí. -->
		<section class="objednavka" data-testid="objednavka">
			<h2>Chceš si túto pergolu záväzne objednať?</h2>
			<p class="kontakt-uvod">
				Vyplň kontakt a fakturačné údaje a odošli firme <strong>záväznú objednávku</strong>. Bez
				online platby — ozveme sa ti, dohodneme obhliadku a presné podmienky. Orientačná cena z
				konfigurátora sa stane súčasťou objednávky.
			</p>
			<ObjednavkaForm konfiguracia={ponukaCfg} />
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
	.viz3d {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 12px;
		margin-top: 18px;
	}
	.viz3d-loading {
		width: 100%;
		aspect-ratio: 16 / 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dfe7ee;
		border-radius: 10px;
		color: #64748b;
		font-size: 14px;
	}
	.ar-sekcia {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 12px;
		margin-top: 18px;
	}
	.ar-loading {
		width: 100%;
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dfe7ee;
		border-radius: 10px;
		color: #64748b;
		font-size: 14px;
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
	.kontakt {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.kontakt h2 {
		font-size: 18px;
		margin: 0 0 8px;
		color: #0f172a;
	}
	.kontakt-uvod {
		color: #64748b;
		font-size: 14px;
		margin: 0 0 14px;
	}
	/* #319: záväzná objednávka — rovnaká karta ako kontakt, zelený akcent (predajná akcia) */
	.objednavka {
		background: #fff;
		border: 1px solid #bbf7d0;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.objednavka h2 {
		font-size: 18px;
		margin: 0 0 8px;
		color: #14532d;
	}
	/* #279 Fáza C: výber modelu (radio-karty) */
	.modely {
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 12px 14px 14px;
		margin: 0 0 18px;
	}
	.modely legend {
		font-size: 13.5px;
		font-weight: 600;
		color: #475569;
		padding: 0 6px;
	}
	.modely-mriezka {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
	}
	.model-karta {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		align-items: center;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		padding: 10px 12px;
		cursor: pointer;
	}
	.model-karta.vybrana {
		border-color: #2563eb;
		background: #eff6ff;
	}
	.model-karta input {
		grid-row: 1 / span 2;
		width: 18px;
		height: 18px;
		accent-color: #2563eb;
	}
	.model-nazov {
		font-weight: 700;
		color: #0f172a;
		font-size: 15px;
	}
	.model-popis {
		grid-column: 2;
		color: #64748b;
		font-size: 13px;
	}
	/* #279 Fáza C: orientačná cena + porovnanie modelov */
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
	/* #318: odznak veľkoobchodnej (VO) hladiny — LEN pre prihláseného veľkoobchodného účtu. */
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
	@media (min-width: 640px) {
		.pole-mriezka {
			grid-template-columns: repeat(3, 1fr);
		}
		.modely-mriezka {
			grid-template-columns: repeat(3, 1fr);
		}
		.zobrazit {
			width: auto;
			min-width: 220px;
		}
	}
</style>
