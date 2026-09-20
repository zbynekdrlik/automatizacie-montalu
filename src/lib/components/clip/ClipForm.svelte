<script lang="ts">
	// CLIP vstupný formulár (#554) — zjednotený so zaskleniami: prvé zábradlie = základ,
	// tlačidlo „➕ Pridať zábradlie" je VŽDY viditeľné (žiadny prepínač „Viac kusov naraz").
	// Jedno zábradlie → single tok (`?/spocitat`, zachované testidy typ/variant/#sirka…);
	// 2+ → multi tok (`?/spocitatMulti`) so zdieľaným odpisom (vzor ZasklieniaForm
	// `formaction={jeMulti ? … : …}`). computeClipMulti semantika nedotknutá.
	import {
		CLIP_MIN_SIRKA,
		CLIP_MAX_SIRKA,
		CLIP_MIN_VYSKA,
		CLIP_MAX_VYSKA,
		type ClipVstup,
		type ClipTyp
	} from '$lib/clip';

	type MultiEcho = {
		zak: string;
		op: string;
		zakaznik: string;
		caka: boolean;
		kusy: ClipVstup[];
	} | null;

	let { vstup, multiVstup }: { vstup: ClipVstup; multiVstup: MultiEcho } = $props();

	type KusRow = {
		typ: ClipTyp;
		variant: number;
		sirka: number | '';
		vyska: number | '';
		ral: string;
	};

	function kusFrom(v: {
		typ: ClipTyp;
		variant: number;
		sirka: number;
		vyska: number;
		ral: string;
	}): KusRow {
		return {
			typ: v.typ,
			variant: v.variant,
			sirka: (v.sirka || '') as number | '',
			vyska: (v.vyska || '') as number | '',
			ral: v.ral
		};
	}

	// odvodenie počiatočného/echovaného stavu (multi má prednosť) — čítanie propov je
	// v samostatnej funkcii, aby to nebola „reactive-only-initial-value" pasca ($state
	// z propu). `echoKey` slúži na detekciu NOVÉHO echa (POST round-trip).
	function seed() {
		const mv = multiVstup;
		return mv
			? { zak: mv.zak, op: mv.op, zakaznik: mv.zakaznik, caka: mv.caka, kusy: mv.kusy.map(kusFrom) }
			: {
					zak: vstup.zak ?? '',
					op: vstup.op ?? '',
					zakaznik: vstup.zakaznik ?? '',
					caka: vstup.caka ?? false,
					kusy: [kusFrom(vstup)]
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

	// hidden `clipKusy` = VŠETKY zábradlia (základ + ďalšie) pre multi parser
	let kusyJSON = $derived(
		JSON.stringify(
			kusy.map((k) => ({
				typ: k.typ,
				variant: k.variant,
				sirka: k.sirka,
				vyska: k.vyska,
				ral: k.ral
			}))
		)
	);

	function addZabradlie() {
		kusy.push({ typ: 'izo', variant: 1, sirka: '', vyska: '', ral: '' });
	}
	function removeZabradlie(i: number) {
		if (kusy.length > 1) kusy.splice(i, 1);
	}

	const cislOznac = (n: number) => (n === 1 ? 'zábradlie' : n < 5 ? 'zábradlia' : 'zábradlí');
</script>

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
						<!-- základ (i=0) nesie name+testid single toku; ďalšie idú len cez clipKusy JSON -->
						{#if i === 0}
							<select id="typ" name="typ" bind:value={kus.typ} data-testid="typ">
								<option value="izo">IZO (4-8-4)</option>
								<option value="klasika">klasika (3.3.1 číre)</option>
							</select>
						{:else}
							<select id="z{i}-typ" bind:value={kus.typ} data-testid={`z${i}-typ`}>
								<option value="izo">IZO (4-8-4)</option>
								<option value="klasika">klasika (3.3.1 číre)</option>
							</select>
						{/if}
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
							<input
								id="z{i}-ral"
								bind:value={kus.ral}
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
