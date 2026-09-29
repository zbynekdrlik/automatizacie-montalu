<script lang="ts">
	// CLIP vstupný formulár (#554) — zjednotený so zaskleniami: prvé zábradlie = základ,
	// tlačidlo „➕ Pridať zábradlie" je VŽDY viditeľné (žiadny prepínač „Viac kusov naraz").
	// Jedno zábradlie → single tok (`?/spocitat`, zachované testidy typ/variant/#sirka…);
	// 2+ → multi tok (`?/spocitatMulti`) so zdieľaným odpisom (vzor ZasklieniaForm
	// `formaction={jeMulti ? … : …}`). computeClipMulti semantika nedotknutá.
	//
	// #593: select „Výplň" ponúka Odoo sklá 6/16 mm (`ponukaSkiel` zo servera; pri nedostupnom
	// Odoo dnešné izo/klasika). Voľba je ODVODENÁ z dvoch polí kusu — `typ` (šablóna, Money) a
	// `skloOdoo` (Odoo typ → objednávka skla) — cez `$lib/sklo-odoo` (`volbaSkla`/`rozlozVolbu`),
	// žiadny ďalší stav ani `$effect`. RAL: ďalšie zábradlie preberá farbu prvého, kým ju obsluha
	// ručne nezmení (`ralZabradlia`, `ralVlastna`).
	import {
		CLIP_MIN_SIRKA,
		CLIP_MAX_SIRKA,
		CLIP_MIN_VYSKA,
		CLIP_MAX_VYSKA,
		jeClipTyp,
		ralZabradlia,
		bezZabradlia,
		type ClipVstup,
		type ClipTyp
	} from '$lib/clip';
	import { volbaSkla, rozlozVolbu, type PonukaSkiel } from '$lib/sklo-odoo';

	type MultiEcho = {
		zak: string;
		op: string;
		zakaznik: string;
		caka: boolean;
		kusy: ClipVstup[];
	} | null;

	let {
		vstup,
		multiVstup,
		ponukaSkiel
	}: { vstup: ClipVstup; multiVstup: MultiEcho; ponukaSkiel: PonukaSkiel } = $props();

	type KusRow = {
		typ: ClipTyp;
		skloOdoo: string;
		variant: number;
		sirka: number | '';
		vyska: number | '';
		ral: string;
		/** #593: farbu obsluha ručne zmenila → nepreberá farbu prvého zábradlia */
		ralVlastna: boolean;
	};

	function kusFrom(
		v: {
			typ: ClipTyp;
			skloOdoo?: string;
			variant: number;
			sirka: number;
			vyska: number;
			ral: string;
		},
		ralPrveho: string | null
	): KusRow {
		return {
			typ: v.typ,
			skloOdoo: v.skloOdoo ?? '',
			variant: v.variant,
			sirka: (v.sirka || '') as number | '',
			vyska: (v.vyska || '') as number | '',
			ral: v.ral,
			// echo zo servera: iná farba než prvé zábradlie = ručne zmenená
			ralVlastna: ralPrveho !== null && v.ral !== ralPrveho
		};
	}

	// odvodenie počiatočného/echovaného stavu (multi má prednosť) — čítanie propov je
	// v samostatnej funkcii, aby to nebola „reactive-only-initial-value" pasca ($state
	// z propu). `echoKey` slúži na detekciu NOVÉHO echa (POST round-trip).
	function seed() {
		const mv = multiVstup;
		return mv
			? {
					zak: mv.zak,
					op: mv.op,
					zakaznik: mv.zakaznik,
					caka: mv.caka,
					kusy: mv.kusy.map((k, i) => kusFrom(k, i === 0 ? null : (mv.kusy[0]?.ral ?? '')))
				}
			: {
					zak: vstup.zak ?? '',
					op: vstup.op ?? '',
					zakaznik: vstup.zakaznik ?? '',
					caka: vstup.caka ?? false,
					kusy: [kusFrom(vstup, null)]
				};
	}
	function echoKey(): unknown {
		return multiVstup ?? vstup;
	}

	const init0 = seed();
	let zak = $state(init0.zak);
	let op = $state(init0.op);
	let zakaznik = $state(init0.zakaznik);
	let caka = $state(init0.caka);
	let kusy = $state<KusRow[]>(init0.kusy);

	// keď server vráti NOVÝ echo (POST round-trip), presynchronizuj stav
	let lastEcho: unknown = echoKey();
	$effect(() => {
		const echo = echoKey();
		if (echo === lastEcho) return;
		lastEcho = echo;
		const s = seed();
		zak = s.zak;
		op = s.op;
		zakaznik = s.zakaznik;
		caka = s.caka;
		kusy = s.kusy;
	});

	let jeMulti = $derived(kusy.length > 1);
	let skupiny = $derived(ponukaSkiel.skupiny);

	// #593: voľba selectu výplne je odvodená z (typ, skloOdoo); výber ju rozloží späť
	const volbaKusu = (k: KusRow) => volbaSkla(k.typ, k.skloOdoo, skupiny);
	/** Odoo typ, ktorý select naozaj ukazuje ('' pri zálohe izo/klasika) — ten sa posiela. */
	const skloOdooKusu = (k: KusRow) => rozlozVolbu(volbaKusu(k), skupiny).skloOdoo;
	function zvolVypln(k: KusRow, v: string) {
		const r = rozlozVolbu(v, skupiny);
		if (jeClipTyp(r.sklo)) k.typ = r.sklo;
		k.skloOdoo = r.skloOdoo;
	}
	function zmenRal(i: number, v: string) {
		const k = kusy[i];
		if (!k) return;
		k.ral = v;
		if (i > 0) k.ralVlastna = true;
	}

	// hidden `clipKusy` = VŠETKY zábradlia (základ + ďalšie) pre multi parser
	let kusyJSON = $derived(
		JSON.stringify(
			kusy.map((k, i) => ({
				typ: k.typ,
				variant: k.variant,
				sirka: k.sirka,
				vyska: k.vyska,
				ral: ralZabradlia(kusy, i),
				skloOdoo: skloOdooKusu(k)
			}))
		)
	);

	function addZabradlie() {
		// #593: farba sa preberá z prvého zábradlia (ralZabradlia), kým ju obsluha nezmení
		kusy.push({
			typ: 'izo',
			skloOdoo: '',
			variant: 1,
			sirka: '',
			vyska: '',
			ral: '',
			ralVlastna: false
		});
	}
	function removeZabradlie(i: number) {
		// #593: odstránenie PRVÉHO zábradlia nesmie zhodiť farbu preberajúcim (bezZabradlia)
		kusy = bezZabradlia(kusy, i);
	}

	const cislOznac = (n: number) => (n === 1 ? 'zábradlie' : n < 5 ? 'zábradlia' : 'zábradlí');
</script>

{#snippet volbyVyplne()}
	{#each skupiny as g (g.label)}
		{#if g.label}
			<optgroup label={g.label}>
				{#each g.items as o (o.value)}<option
						value={o.value}
						data-vypocet={o.vypocet}
						data-naprotivok={o.naprotivok}>{o.label}</option
					>{/each}
			</optgroup>
		{:else}
			{#each g.items as o (o.value)}<option
					value={o.value}
					data-vypocet={o.vypocet}
					data-naprotivok={o.naprotivok}>{o.label}</option
				>{/each}
		{/if}
	{/each}
{/snippet}

<div class="card">
	<form method="POST" action="?/spocitat">
		<div class="grid3">
			<div class="field">
				<label for="zak">Číslo objednávky (ZAK) *</label>
				<input id="zak" name="zak" bind:value={zak} required />
			</div>
			<div class="field">
				<label for="op">OP/OPDL číslo *</label>
				<input id="op" name="op" bind:value={op} required />
			</div>
			<div class="field">
				<label for="zakaznik">Zákazník *</label>
				<input id="zakaznik" name="zakaznik" bind:value={zakaznik} required />
			</div>
		</div>
		<div class="field" style="margin:8px 0">
			<label class="opt opt-grid">
				<input type="checkbox" name="caka" value="1" bind:checked={caka} />
				Čaká na materiál (odloží do NA ODPIS/Clip)
			</label>
		</div>

		<!-- clipKusy = základ + ďalšie zábradlia (multi parser); pri single sa ignoruje -->
		<input type="hidden" name="clipKusy" value={kusyJSON} />
		<!-- #593: single tok — šablóna + Odoo typ prvého zábradlia (select výplne nesie voľbu) -->
		<input type="hidden" name="typ" value={kusy[0]?.typ ?? 'izo'} />
		<input type="hidden" name="skloOdoo" value={kusy[0] ? skloOdooKusu(kusy[0]) : ''} />

		{#each kusy as kus, i (i)}
			<div
				class="card zabradlie-karta"
				data-testid={i === 0 ? 'zabradlie-zaklad' : `zabradlie-${i}`}
				style="margin:8px 0;padding:12px;border-left:3px solid var(--m-primary)"
			>
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
					<b>Zábradlie {i + 1}</b>
					{#if kusy.length > 1}
						<button
							type="button"
							class="btn secondary"
							style="padding:2px 8px;font-size:12px"
							data-testid={`zabradlie-remove-${i}`}
							onclick={() => removeZabradlie(i)}>✕ Odstrániť</button
						>
					{/if}
				</div>
				<div class="grid3">
					<div class="field">
						<label for={i === 0 ? 'typ' : `z${i}-typ`}>Výplň</label>
						<!-- #593: voľba = Odoo typ (`odoo:` prefix) alebo šablóna (záloha); bez `name` —
						     formulár nesie `typ` + `skloOdoo` (hidden vyššie / clipKusy JSON) -->
						<select
							id={i === 0 ? 'typ' : `z${i}-typ`}
							data-testid={i === 0 ? 'typ' : `z${i}-typ`}
							bind:value={() => volbaKusu(kus), (v) => zvolVypln(kus, v)}
						>
							{@render volbyVyplne()}
						</select>
					</div>
					<div class="field">
						<label for={i === 0 ? 'variant' : `z${i}-variant`}>Počet výplní</label>
						{#if i === 0}
							<!-- native (non-enhance) `?/spocitat` POST — Svelte serializuje `value={1}`
							     na atribút "1", `parseClipVstup` ho číta cez Math.round(num); rovnaký
							     vzor ako pôvodný multi formulár (bind:value + číselné option) -->
							<select id="variant" name="variant" bind:value={kus.variant} data-testid="variant">
								<option value={1}>B0 — 1 výplň</option>
								<option value={2}>B1 — 2 výplne</option>
								<option value={3}>B2 — 3 výplne</option>
								<option value={4}>B3 — 4 výplne</option>
							</select>
						{:else}
							<select id="z{i}-variant" bind:value={kus.variant} data-testid={`z${i}-variant`}>
								<option value={1}>B0 — 1 výplň</option>
								<option value={2}>B1 — 2 výplne</option>
								<option value={3}>B2 — 3 výplne</option>
								<option value={4}>B3 — 4 výplne</option>
							</select>
						{/if}
					</div>
					<div class="field">
						<label for={i === 0 ? 'ral' : `z${i}-ral`}>RAL farba (informačná)</label>
						{#if i === 0}
							<input
								id="ral"
								name="ral"
								bind:value={kus.ral}
								maxlength="40"
								placeholder="napr. RAL 7016"
							/>
						{:else}
							<!-- #593: predvyplnené farbou prvého zábradlia, ručná zmena sa neprepíše -->
							<input
								id="z{i}-ral"
								bind:value={() => ralZabradlia(kusy, i), (v) => zmenRal(i, v)}
								maxlength="40"
								placeholder="napr. RAL 7016"
							/>
						{/if}
					</div>
				</div>
				<div class="grid3">
					<div class="field">
						<label for={i === 0 ? 'sirka' : `z${i}-sirka`}>Šírka zábradlia (mm) *</label>
						<input
							id={i === 0 ? 'sirka' : `z${i}-sirka`}
							name={i === 0 ? 'sirka' : undefined}
							type="number"
							min={CLIP_MIN_SIRKA}
							max={CLIP_MAX_SIRKA}
							step="any"
							bind:value={kus.sirka}
							required
						/>
					</div>
					<div class="field">
						<label for={i === 0 ? 'vyska' : `z${i}-vyska`}>Výška zábradlia (mm) *</label>
						<input
							id={i === 0 ? 'vyska' : `z${i}-vyska`}
							name={i === 0 ? 'vyska' : undefined}
							type="number"
							min={CLIP_MIN_VYSKA}
							max={CLIP_MAX_VYSKA}
							step="any"
							bind:value={kus.vyska}
							required
						/>
					</div>
				</div>
			</div>
		{/each}

		<button
			type="button"
			class="btn secondary btn-block"
			data-testid="clip-add-zabradlie"
			onclick={addZabradlie}>➕ Pridať zábradlie</button
		>
		<button
			class="btn"
			type="submit"
			data-testid="clip-spocitat"
			style="margin-top:8px"
			formaction={jeMulti ? '?/spocitatMulti' : '?/spocitat'}
		>
			{jeMulti
				? `Spočítať spoločný rozpis (${kusy.length} ${cislOznac(kusy.length)})`
				: 'Spočítať rozpis'}
		</button>
	</form>
</div>

<style>
	.btn-block {
		width: 100%;
		margin-top: 6px;
	}
</style>
