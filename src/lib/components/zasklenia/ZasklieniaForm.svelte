<script lang="ts">
	// Krok „form" — zadanie nárezového plánu (primárny posuv + ďalšie posuvy zimnej záhrady).
	// Vyčlenené z routes/zasklenia/+page.svelte (#250, vzor #239). Editovateľné polia sú
	// `$bindable` (rodič ostáva jedinou autoritou stavu + `$effect` echa + serializácie —
	// `zasklenia-form-reactivity.md`); derivované hodnoty + pure helpery
	// (`stylyForSystem`/`sklaForSystem`/`otvaraniaForStyl`/`kolajnicaPre`, uzávery nad `data`)
	// + mutátory (`addPosuv`/`removePosuv`/`fixPosuv`) prídu ako propy — rovnaké MENÁ ako v
	// rodičovi, aby markup ostal 1:1 (jediná zmena: `data.systemy`→`systemy`,
	// `data.kovania`→`kovania`). `posuvyJSON` hidden input serializuje ďalšie posuvy.
	import { nazovSystemu } from '$lib/system-nazvy';
	import { posuvySlovom } from '$lib/popis';
	import { standardPlusRailEligible } from '$lib/styl';
	import { sietkaStrana, maSietkaSystem, type SietkaUchyt } from '$lib/sietka';
	import type { Farba } from '$lib/komponenty';
	import { S_MIN, S_MAX, V_MIN, V_MAX } from '$lib/zasklenia-navrh';
	import { KOLAJNICA_MAX, KOLAJNICA_MIN } from '$lib/kolajnica';
	import KlinPolia from '$lib/components/KlinPolia.svelte';
	import SietkaPolia from '$lib/components/SietkaPolia.svelte';
	import type { PosuvRow } from '$lib/zasklenia-form';

	let {
		// ponuky z konfigurácie (jediné, čo z `data` formulár potrebuje)
		systemy,
		kovania,
		// editovateľné polia primárneho posuvu — `$bindable`, rodič je zdroj (echo `$effect`)
		zakS = $bindable(''),
		opS = $bindable(''),
		zakaznikS = $bindable(''),
		system = $bindable('Robust'),
		styl = $bindable('2K'),
		sklo = $bindable(''),
		otvaranie = $bindable('P - L'),
		sirka = $bindable(''),
		vyska = $bindable(''),
		kovanieLS = $bindable(''),
		kovaniePS = $bindable(''),
		kovanieStredS = $bindable(''),
		kovanieStredOknoS = $bindable('L'),
		vrtanieZamkuS = $bindable(1050),
		skloPresneS = $bindable(''),
		poznamkaS = $bindable(''),
		ralS = $bindable(''),
		cakaS = $bindable(false),
		pridavnaKolajnicaS = $bindable(false),
		jednostrannaFabS = $bindable(false),
		farbaKovaniaS = $bindable(''),
		kolHS = $bindable(''),
		kolSS = $bindable(''),
		klinS = $bindable(false),
		klinDlzkaS = $bindable(''),
		klinSirkaS = $bindable(''),
		klinV1S = $bindable(''),
		klinV2S = $bindable(''),
		klinKsS = $bindable(1),
		sietkaS = $bindable(false),
		sietkaUchytS = $bindable('ziadny'),
		sietkaSystemS = $bindable(''),
		posuvyExtra = $bindable([]),
		// derivované hodnoty (read-only) — rodič je compute hub
		stylyPre,
		sklaPre,
		otvaraniaPre,
		b2bSirkaErr,
		b2bVyskaWarn,
		narezakHint,
		jeOpona,
		jeRobust,
		maKovanie,
		maFarbu,
		maKolajnicu,
		maSietka,
		sietkaStranaVal,
		posuvB2bErrs,
		posuvB2bWarns,
		posuvyJSON,
		jeMulti,
		b2bBlok,
		// pure helpery (uzávery nad `data`/`existuje` v rodičovi) + mutátory stavu rodiča
		stylyForSystem,
		sklaForSystem,
		otvaraniaForStyl,
		kolajnicaPre,
		addPosuv,
		removePosuv,
		fixPosuv
	}: {
		systemy: string[];
		kovania: string[];
		zakS?: string;
		opS?: string;
		zakaznikS?: string;
		system?: string;
		styl?: string;
		sklo?: string;
		otvaranie?: string;
		sirka?: number | string;
		vyska?: number | string;
		kovanieLS?: string;
		kovaniePS?: string;
		kovanieStredS?: string;
		kovanieStredOknoS?: 'L' | 'P';
		vrtanieZamkuS?: number | string;
		skloPresneS?: string;
		poznamkaS?: string;
		ralS?: string;
		cakaS?: boolean;
		pridavnaKolajnicaS?: boolean;
		jednostrannaFabS?: boolean;
		farbaKovaniaS?: '' | Farba;
		kolHS?: number | string;
		kolSS?: number | string;
		klinS?: boolean;
		klinDlzkaS?: number | string;
		klinSirkaS?: number | string;
		klinV1S?: number | string;
		klinV2S?: number | string;
		klinKsS?: number | string;
		sietkaS?: boolean;
		sietkaUchytS?: SietkaUchyt;
		sietkaSystemS?: string;
		posuvyExtra?: PosuvRow[];
		stylyPre: string[];
		sklaPre: string[];
		otvaraniaPre: string[];
		b2bSirkaErr: string | null;
		b2bVyskaWarn: string | null;
		narezakHint: string;
		jeOpona: boolean;
		jeRobust: boolean;
		maKovanie: boolean;
		maFarbu: boolean;
		maKolajnicu: boolean;
		maSietka: boolean;
		sietkaStranaVal: 'ľavá' | 'pravá' | null;
		posuvB2bErrs: (string | null)[];
		posuvB2bWarns: (string | null)[];
		posuvyJSON: string;
		jeMulti: boolean;
		b2bBlok: boolean;
		stylyForSystem: (sys: string) => string[];
		sklaForSystem: (sys: string, styl: string) => string[];
		otvaraniaForStyl: (st: string) => string[];
		kolajnicaPre: (sys: string) => boolean;
		addPosuv: () => void;
		removePosuv: (i: number) => void;
		fixPosuv: (i: number) => void;
	} = $props();
</script>

<div class="card">
	<form method="POST" action="?/nahlad">
		<div class="grid3">
			<div class="field">
				<label for="zak">Číslo objednávky (ZAK) *</label>
				<input id="zak" name="zak" bind:value={zakS} required />
			</div>
			<div class="field">
				<label for="op">OP/OPDL číslo *</label>
				<input id="op" name="op" bind:value={opS} required />
			</div>
			<div class="field">
				<label for="zakaznik">Zákazník *</label>
				<input id="zakaznik" name="zakaznik" bind:value={zakaznikS} required />
			</div>
		</div>
		<div class="grid2">
			<div class="field">
				<label for="system">Systém</label>
				<select id="system" name="system" bind:value={system}>
					{#each systemy as sys (sys)}<option value={sys}>{nazovSystemu(sys)}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="styl">Štýl</label>
				<select id="styl" name="styl" bind:value={styl}>
					{#each stylyPre as st (st)}<option>{st}</option>{/each}
				</select>
			</div>
		</div>
		<div class="grid2">
			<div class="field">
				<label for="s">Šírka (mm) *</label>
				<input
					id="s"
					name="s"
					type="number"
					min={S_MIN}
					max={S_MAX}
					step="any"
					bind:value={sirka}
					required
				/>{#if b2bSirkaErr}<span class="b2b-blok" data-testid="b2b-sirka-err">
						⛔ {b2bSirkaErr}</span
					>{/if}
			</div>
			<div class="field">
				<label for="v">Výška (mm) *</label>
				<input
					id="v"
					name="v"
					type="number"
					min={V_MIN}
					max={V_MAX}
					step="any"
					bind:value={vyska}
					required
				/>{#if b2bVyskaWarn}<span class="b2b-upoz" data-testid="b2b-vyska-warn">
						{b2bVyskaWarn}</span
					>{/if}
			</div>
		</div>
		<div class="grid2">
			<div class="field">
				<label for="sklo">Sklo (základ — určuje vzorec)</label>
				<select id="sklo" name="sklo" bind:value={sklo}>
					{#each sklaPre as g (g)}<option>{g}</option>{/each}
				</select>
				{#if narezakHint}<span class="hint" data-testid="narezak-hint">{narezakHint}</span>{/if}
			</div>
			<div class="field">
				<label for="otvaranie">Otváranie</label>
				<select id="otvaranie" name="otvaranie" bind:value={otvaranie}>
					{#each otvaraniaPre as o (o)}<option>{o}</option>{/each}
				</select>
				{#if jeOpona}<span class="hint">Pri 2× štýle je otváranie vždy opona (od stredu).</span
					>{/if}
			</div>
		</div>
		<!-- Kovanie (kľučka) — LEN Robust; ľavá aj pravá strana zvlášť, pri každom
		     posuve sólo. Display-only: plán/náhľad + detail v histórii, Money NIE.
		     #88: pri sieťke sa kľučka NEPONÚKA (namiesto nej úchyt v SietkaPolia). -->
		{#if jeRobust && !sietkaS}
			<div class="grid2">
				<div class="field">
					<label for="kovanieL">Kovanie — ľavá strana</label>
					<select id="kovanieL" name="kovanieL" bind:value={kovanieLS}>
						<option value="">—</option>
						{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="kovanieP">Kovanie — pravá strana</label>
					<select id="kovanieP" name="kovanieP" bind:value={kovaniePS}>
						<option value="">—</option>
						{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
					</select>
				</div>
			</div>
			<!-- Opona má kľučku NAVYŠE na jednom z dvoch krídel v strede (Patrik
			     2026-07-31: „ak máme 2x3, kľučka bude okno 1, okno 6 a potom buď
			     okno 3 alebo 4"). Money sa tým nemení — opony majú 3 uzávery
			     (a teda 3 kľučky) v tabuľke komponentov už teraz. -->
			{#if jeOpona}
				<div class="grid2" data-testid="kovanie-stred-polia">
					<div class="field">
						<label for="kovanieStred">Kovanie — stredové okno</label>
						<select id="kovanieStred" name="kovanieStred" bind:value={kovanieStredS}>
							<option value="">—</option>
							{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for="kovanieStredOkno">Ktoré okno v strede</label>
						<select id="kovanieStredOkno" name="kovanieStredOkno" bind:value={kovanieStredOknoS}>
							<option value="L">ľavé zo stredovej dvojice</option>
							<option value="P">pravé zo stredovej dvojice</option>
						</select>
					</div>
				</div>
			{/if}
		{/if}
		{#if system === 'Deluxe'}
			<div class="field">
				<label for="vrtanieZamku">Výška vŕtania zámku (mm) — otvory ⌀46 na krajných sklách</label>
				<input
					id="vrtanieZamku"
					name="vrtanieZamku"
					type="number"
					min="0"
					max="20000"
					step="any"
					bind:value={vrtanieZamkuS}
				/>
			</div>
		{/if}
		<div class="field">
			<label for="skloPresne">Presné zloženie skla (nepovinné — nemení vzorec)</label>
			<input
				id="skloPresne"
				name="skloPresne"
				bind:value={skloPresneS}
				maxlength="120"
				placeholder="napr. Stopsol Classic Grey, dubová kôra…"
			/>
		</div>
		<div class="field">
			<label for="poznamka">Poznámka (viacriadková — vľavo na pláne aj v tlači, píš pod seba)</label
			>
			<textarea
				id="poznamka"
				name="poznamka"
				rows="4"
				bind:value={poznamkaS}
				maxlength="300"
				placeholder="napr. pozor na ľavé krídlo&#10;dodať do piatku&#10;montáž 5.8."
				style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"
			></textarea>
		</div>
		<div class="field">
			<label for="ral">RAL (farba) — zobrazí sa veľkým vpravo na pláne aj v tlači</label>
			<input
				id="ral"
				name="ral"
				bind:value={ralS}
				maxlength="40"
				placeholder="napr. 7016 / RAL 9005…"
			/>
		</div>
		<div class="field">
			<label style="display:flex;align-items:center;gap:8px;font-weight:400">
				<input type="checkbox" name="caka" value="1" bind:checked={cakaS} style="width:auto" />
				⏳ Čaká na materiál (odloží import do priečinka NA ODPIS)
			</label>
		</div>
		<!-- 6K nemá väčšiu koľajnicu (7K neexistuje) → checkbox sa skryje. Zdieľaný
		     predikát `standardPlusRailEligible` (styl.ts) — rovnaký gate ako
		     `pridavnaKolajnicaDefault` aj `railUpsize` v compute.ts (#134). -->
		{#if standardPlusRailEligible(system, styl)}
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input
						type="checkbox"
						name="pridavnaKolajnica"
						value="1"
						bind:checked={pridavnaKolajnicaS}
						style="width:auto"
					/>
					➕ Prídavná koľajnica (spodná koľajnica o veľkosť väčšia)
				</label>
			</div>
		{/if}
		<!-- Jednostranná FAB (Dominik 2026-07-28: „chodí jeden zo 100") — MENÍ Money
		     odpis: kľučka a krytka vložky idú 1 ks namiesto 2 ks na uzáver. -->
		{#if maKovanie}
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input
						type="checkbox"
						name="jednostrannaFab"
						value="1"
						bind:checked={jednostrannaFabS}
						style="width:auto"
						data-testid="jednostranna-fab"
					/>
					🔑 Jednostranná FAB (menej kľučiek a krytiek vložky v odpise)
				</label>
			</div>
		{/if}
		<!-- RAL farba kovania (#338) — vyberá Money kód farebného variantu (kľučka/
		     krytka vložky / Štandard zámok R9005 vs R7016). Bez voľby engine vyhlási
		     chybu, aby sa do Money nedostal zlý/žiadny farebný variant. -->
		{#if maFarbu}
			<div class="field">
				<label for="farbaKovania">🎨 Farba kovania (RAL) — MENÍ Money kód</label>
				<select
					id="farbaKovania"
					name="farbaKovania"
					bind:value={farbaKovaniaS}
					data-testid="farba-kovania"
					required
				>
					<option value="">— vyber farbu kovania —</option>
					<option value="R9005">R9005 (čierna)</option>
					<option value="R7016">R7016 (antracit)</option>
				</select>
			</div>
		{/if}
		<!-- Ručná dĺžka koľajnice (Patrik 2026-07-28): dielňa občas reže hornú a spodnú
		     inak než na šírku otvoru (napr. 2690 / 2695 mm). MENÍ Money odpis — prázdne
		     pole = pôvodný výpočet zo šírky. Len systémy s oddelenou hornou/spodnou. -->
		{#if maKolajnicu}
			<div class="grid2" data-testid="kolajnica-polia">
				<div class="field">
					<label for="kolajnicaHorna">Koľajnica horná (mm) — prázdne = podľa šírky</label>
					<input
						id="kolajnicaHorna"
						name="kolajnicaHorna"
						type="number"
						min={KOLAJNICA_MIN}
						max={KOLAJNICA_MAX}
						step="any"
						bind:value={kolHS}
						placeholder={String(sirka || '')}
					/>
				</div>
				<div class="field">
					<label for="kolajnicaSpodna">Koľajnica spodná (mm) — prázdne = podľa šírky</label>
					<input
						id="kolajnicaSpodna"
						name="kolajnicaSpodna"
						type="number"
						min={KOLAJNICA_MIN}
						max={KOLAJNICA_MAX}
						step="any"
						bind:value={kolSS}
						placeholder={String(sirka || '')}
					/>
				</div>
			</div>
		{/if}
		<!-- Klín nad posuvom (Patrik): zapínač + dĺžka/šírka/výška 1/výška 2 + ks.
		     Display-only — kreslí sa v náhľade, do Money odpisu nevstupuje. -->
		<KlinPolia
			idPrefix="klin"
			names={true}
			bind:on={klinS}
			bind:dlzka={klinDlzkaS}
			bind:sirka={klinSirkaS}
			bind:v1={klinV1S}
			bind:v2={klinV2S}
			bind:ks={klinKsS}
		/>
		<!-- Sieťka (#86–#90, KOREKCIA 2026-08-02, #110 systém sieťky): zapínač + úchyt.
		     Len na systémoch, kde ju appka ponúka (Robust/Slide/Štandard/Štandard +).
		     Rám/nos/redukcia IDE do Money odpisu (úchyt display-only). -->
		{#if maSietka}
			<SietkaPolia
				idPrefix="sietka"
				names={true}
				{system}
				{styl}
				strana={sietkaStranaVal}
				pridavna={pridavnaKolajnicaS}
				bind:on={sietkaS}
				bind:uchyt={sietkaUchytS}
				bind:sietkaSystem={sietkaSystemS}
			/>
		{/if}
		<!-- Zimná záhrada: ďalšie posuvy sa zoptimalizujú do zdieľaných tyčí -->
		<input type="hidden" name="posuvy" value={posuvyJSON} />
		{#each posuvyExtra as p, i (i)}
			<div class="posuv-box">
				<div class="posuv-hd">
					<b>Posuv {i + 2}</b>
					<button type="button" class="link-del" onclick={() => removePosuv(i)}>✕ odobrať</button>
				</div>
				<div class="grid2">
					<div class="field">
						<label for={`ps${i}-sys`}>Systém</label>
						<select id={`ps${i}-sys`} bind:value={p.system} onchange={() => fixPosuv(i)}>
							{#each systemy as sys (sys)}<option value={sys}>{nazovSystemu(sys)}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for={`ps${i}-styl`}>Štýl</label>
						<select id={`ps${i}-styl`} bind:value={p.styl} onchange={() => fixPosuv(i)}>
							{#each stylyForSystem(p.system) as st (st)}<option>{st}</option>{/each}
						</select>
					</div>
				</div>
				<div class="grid2">
					<div class="field">
						<label for={`ps${i}-s`}>Šírka (mm) *</label>
						<input
							id={`ps${i}-s`}
							type="number"
							min={S_MIN}
							max={S_MAX}
							step="any"
							bind:value={p.s}
							required
						/>{#if posuvB2bErrs[i]}<span class="b2b-blok" data-testid={`b2b-sirka-err-${i}`}>
								⛔ {posuvB2bErrs[i]}</span
							>{/if}
					</div>
					<div class="field">
						<label for={`ps${i}-v`}>Výška (mm) *</label>
						<input
							id={`ps${i}-v`}
							type="number"
							min={V_MIN}
							max={V_MAX}
							step="any"
							bind:value={p.v}
							required
						/>{#if posuvB2bWarns[i]}<span class="b2b-upoz" data-testid={`b2b-vyska-warn-${i}`}>
								{posuvB2bWarns[i]}</span
							>{/if}
					</div>
				</div>
				<div class="grid2">
					<div class="field">
						<label for={`ps${i}-sklo`}>Sklo</label>
						<select id={`ps${i}-sklo`} bind:value={p.sklo}>
							{#each sklaForSystem(p.system, p.styl) as g (g)}<option>{g}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for={`ps${i}-otv`}>Otváranie</label>
						<select id={`ps${i}-otv`} bind:value={p.otvaranie}>
							{#each otvaraniaForStyl(p.styl) as o (o)}<option>{o}</option>{/each}
						</select>
					</div>
				</div>
				{#if p.system === 'Robust' && !p.sietka}
					<div class="grid2">
						<div class="field">
							<label for={`ps${i}-kovl`}>Kovanie — ľavá strana</label>
							<select id={`ps${i}-kovl`} bind:value={p.kovanieL}>
								<option value="">—</option>
								{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
							</select>
						</div>
						<div class="field">
							<label for={`ps${i}-kovp`}>Kovanie — pravá strana</label>
							<select id={`ps${i}-kovp`} bind:value={p.kovanieP}>
								<option value="">—</option>
								{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
							</select>
						</div>
					</div>
					{#if p.styl.startsWith('2x')}
						<div class="grid2" data-testid={`kovanie-stred-polia-${i}`}>
							<div class="field">
								<label for={`ps${i}-kovs`}>Kovanie — stredové okno</label>
								<select id={`ps${i}-kovs`} bind:value={p.kovanieStred}>
									<option value="">—</option>
									{#each kovania as k (k)}<option value={k}>{k}</option>{/each}
								</select>
							</div>
							<div class="field">
								<label for={`ps${i}-kovso`}>Ktoré okno v strede</label>
								<select id={`ps${i}-kovso`} bind:value={p.kovanieStredOkno}>
									<option value="L">ľavé zo stredovej dvojice</option>
									<option value="P">pravé zo stredovej dvojice</option>
								</select>
							</div>
						</div>
					{/if}
				{/if}
				{#if kolajnicaPre(p.system)}
					<div class="grid2" data-testid={`kolajnica-polia-${i}`}>
						<div class="field">
							<label for={`ps${i}-kolh`}>Koľajnica horná (mm) — prázdne = podľa šírky</label>
							<input
								id={`ps${i}-kolh`}
								type="number"
								min={KOLAJNICA_MIN}
								max={KOLAJNICA_MAX}
								step="any"
								bind:value={p.kolajnicaHorna}
								placeholder={String(p.s || '')}
							/>
						</div>
						<div class="field">
							<label for={`ps${i}-kols`}>Koľajnica spodná (mm) — prázdne = podľa šírky</label>
							<input
								id={`ps${i}-kols`}
								type="number"
								min={KOLAJNICA_MIN}
								max={KOLAJNICA_MAX}
								step="any"
								bind:value={p.kolajnicaSpodna}
								placeholder={String(p.s || '')}
							/>
						</div>
					</div>
				{/if}
				<KlinPolia
					idPrefix={`ps${i}-klin`}
					bind:on={p.klin}
					bind:dlzka={p.klinDlzka}
					bind:sirka={p.klinSirka}
					bind:v1={p.klinV1}
					bind:v2={p.klinV2}
					bind:ks={p.klinKs}
				/>
				{#if maSietkaSystem(p.system)}
					<SietkaPolia
						idPrefix={`ps${i}-sietka`}
						system={p.system}
						styl={p.styl}
						strana={sietkaStrana(p.otvaranie)}
						pridavna={pridavnaKolajnicaS}
						bind:on={p.sietka}
						bind:uchyt={p.sietkaUchyt}
						bind:sietkaSystem={p.sietkaSystem}
						onZmena={(on) => {
							if (on) {
								p.kovanieL = '';
								p.kovanieP = '';
								p.kovanieStred = '';
							}
						}}
					/>
				{/if}
			</div>
		{/each}
		<button type="button" class="btn secondary" onclick={addPosuv}>➕ Pridať posuv</button>
		<button
			class="btn"
			type="submit"
			formaction={jeMulti ? '?/nahladMulti' : '?/nahlad'}
			disabled={b2bBlok}
			data-testid="spocitat"
		>
			{jeMulti
				? `Spočítať spoločný plán (${posuvySlovom(posuvyExtra.length + 1)})`
				: 'Spočítať nárezový plán'}
		</button>
	</form>
</div>
