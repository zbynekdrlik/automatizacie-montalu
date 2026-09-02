<script lang="ts">
	// Zasklenia — zákaznícky NÁVRHOVÝ výkres (#162) — rozmerový formulár → SVG
	// výkres → tlač. Do Money NIČ nezapisuje (existujúci `/zasklenia` nárezový
	// plán → Money odpis sa touto stránkou nedotýka). Rovnaký vzor ako
	// `/pergola/navrh`: formulár → výkres → tlač, žiadny zápisový krok.
	import ZaskleniaNavrhVykres from '$lib/components/ZaskleniaNavrhVykres.svelte';
	import Vizual3DPanel from '$lib/components/vizual/Vizual3DPanel.svelte';
	import OdpisNavrhNav from '$lib/components/OdpisNavrhNav.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { nazovSystemu } from '$lib/system-nazvy';
	import { RAL_PALETA, RAL_INY_KOD, RAL_FALLBACK_HEX, VYKRES_REZIM_DEFAULT } from '$lib/vykres/ral';
	import type { VykresRezim } from '$lib/vykres/ral';
	import { S_MIN, S_MAX, V_MIN, V_MAX, type ZaskleniaNavrhVstup } from '$lib/zasklenia-navrh';

	let { data, form } = $props();

	const cislo = (x: number | string) => (typeof x === 'number' ? x : parseFloat(String(x)) || 0);
	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	let step = $derived(form?.step ?? 'form');

	// `?viz=low` (e2e determinizmus, #170 §2.12) PRETRVÁ cez POST na `?/vykres`
	// aj cez POST na `/zakaznicky` — `action="?/vykres"` by inak celý pôvodný
	// query string (vrátane `viz`) NAHRADIL len `/vykres` (relatívne `?…`
	// URL referencie nahrádzajú CELÝ query, nie ho dopĺňajú).
	let vizParam = $derived(page.url.searchParams.get('viz'));
	let vykresAction = $derived(vizParam ? `?/vykres&viz=${vizParam}` : '?/vykres');
	let zakaznickyAction = $derived(
		vizParam ? `/zasklenia/navrh/zakaznicky?viz=${vizParam}` : '/zasklenia/navrh/zakaznicky'
	);

	let vstup = $derived({
		system: form?.vstup?.system ?? data.systemy[0] ?? '',
		styl: form?.vstup?.styl ?? '',
		sysStyl: form?.vstup?.sysStyl ?? '',
		n: form?.vstup?.n ?? 0,
		s: form?.vstup?.s ?? 1500,
		v: form?.vstup?.v ?? 1500,
		otvaranie: form?.vstup?.otvaranie ?? data.otvarania[0] ?? '',
		klin: form?.vstup?.klin ?? null,
		kolajnica: form?.vstup?.kolajnica ?? null,
		nazov: form?.vstup?.nazov ?? '',
		ral: form?.vstup?.ral ?? '',
		ralKod: form?.vstup?.ralKod ?? '',
		rezimVykresu: (form?.vstup?.rezimVykresu ?? VYKRES_REZIM_DEFAULT) as VykresRezim
	} satisfies ZaskleniaNavrhVstup);

	const stylyForSystem = (sys: string) =>
		data.styly.filter((x) => x.system === sys).map((x) => x.styl);

	// editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri re-renderi
	// vymazali (rovnaká pasca ako v ostatných moduloch appky)
	let systemS = $state('');
	let stylS = $state('');
	let sS = $state<number | string>(1500);
	let vS = $state<number | string>(1500);
	let otvaranieS = $state('');
	let nazovS = $state('');
	let klinZapnutyS = $state(false);
	let klinDlzkaS = $state<number | string>('');
	let klinSirkaS = $state<number | string>('');
	let klinV1S = $state<number | string>(0);
	let klinV2S = $state<number | string>(0);
	let klinKsS = $state<number | string>(1);
	let kolajnicaHornaS = $state<number | string>('');
	let kolajnicaSpodnaS = $state<number | string>('');
	let rezimVykresuS = $state<VykresRezim>(VYKRES_REZIM_DEFAULT);
	let ralKodS = $state('');
	let ralS = $state('');

	// KRITICKÝ nález pri live post-deploy overení: `stylyForSystem(systemS)` tu
	// PREDTÝM čítalo `systemS` HNEĎ PO tom, čo ho ten istý effect zapísal o dva
	// riadky vyššie — sebareferenčné čítanie effect samo-prihlási na `systemS`,
	// takže KAŽDÁ používateľova zmena selectu "Systém" (bind:value) effect znova
	// spustila a effect (keďže `form` je stále null pred odoslaním) systemS
	// TICHO PREPÍSAL SPÄŤ na `data.systemy[0]` — select sa navonok javil ako
	// funkčný (DOM ukázal zvolenú hodnotu na okamih), ale odoslaný formulár vždy
	// niesol PRVÝ systém v zozname, nie zvolený. Rovnaká trieda chyby ako
	// `zasklenia-form-reactivity.md`'s "smart default" pasca, len tu bez
	// akéhokoľvek smart-default zámeru — čisto náhodný self-loop. Fix: `stylS`
	// tu NEČÍTA `systemS` vôbec — samostatný fixup effect nižšie (`stylyPre`)
	// už rieši "stylS nie je v aktuálnom zozname štýlov" bez tejto slučky.
	$effect(() => {
		const v = form?.vstup ?? null;
		systemS = v?.system || data.systemy[0] || '';
		stylS = v?.styl ?? '';
		sS = v?.s || 1500;
		vS = v?.v || 1500;
		otvaranieS = v?.otvaranie || data.otvarania[0] || '';
		nazovS = v?.nazov ?? '';
		klinZapnutyS = !!v?.klin;
		klinDlzkaS = v?.klin?.dlzka ?? '';
		klinSirkaS = v?.klin?.sirka ?? '';
		klinV1S = v?.klin?.v1 ?? 0;
		klinV2S = v?.klin?.v2 ?? 0;
		klinKsS = v?.klin?.ks ?? 1;
		kolajnicaHornaS = v?.kolajnica?.horna ?? '';
		kolajnicaSpodnaS = v?.kolajnica?.spodna ?? '';
		rezimVykresuS = v?.rezimVykresu === 'farebny' ? 'farebny' : VYKRES_REZIM_DEFAULT;
		ralKodS = v?.ralKod ?? '';
		ralS = v?.ral ?? '';
	});

	let stylyPre = $derived(stylyForSystem(systemS));
	$effect(() => {
		if (!stylyPre.includes(stylS)) stylS = stylyPre[0] ?? '';
	});
</script>

<svelte:head><title>Zasklenia — návrhový výkres</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="system" value={systemS} />
	<input type="hidden" name="styl" value={stylS} />
	<input type="hidden" name="s" value={cislo(sS)} />
	<input type="hidden" name="v" value={cislo(vS)} />
	<input type="hidden" name="otvaranie" value={otvaranieS} />
	<input type="hidden" name="nazov" value={nazovS} />
	<input type="hidden" name="klinZapnuty" value={klinZapnutyS ? '1' : ''} />
	<input type="hidden" name="klinDlzka" value={cislo(klinDlzkaS)} />
	<input type="hidden" name="klinSirka" value={cislo(klinSirkaS)} />
	<input type="hidden" name="klinV1" value={cislo(klinV1S)} />
	<input type="hidden" name="klinV2" value={cislo(klinV2S)} />
	<input type="hidden" name="klinKs" value={cislo(klinKsS)} />
	<input type="hidden" name="kolajnicaHorna" value={kolajnicaHornaS} />
	<input type="hidden" name="kolajnicaSpodna" value={kolajnicaSpodnaS} />
	<input type="hidden" name="rezimVykresu" value={rezimVykresuS} />
	<input type="hidden" name="ralKod" value={ralKodS} />
	<input type="hidden" name="ral" value={ralS} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<OdpisNavrhNav modul="zasklenia" active="navrh" />
	</div>
	<div class="card">
		<h1>Zasklenia — návrhový výkres</h1>
		<p class="sub">
			Zadaj rozmery — vykreslím zákaznícky návrhový výkres v štýle pergolového výkresu (obrysové
			profily, kóty, RAL variant). <b>Do Money sa neposiela nič</b> — tento modul len kreslí; na nárezový
			plán a zápis do Money prepni kachličku „Zápis do Money" hore.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action={vykresAction}>
			<div class="grid3">
				<div class="field">
					<label for="system">Systém</label>
					<select id="system" bind:value={systemS}>
						{#each data.systemy as sys (sys)}<option value={sys}>{nazovSystemu(sys)}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="styl">Štýl</label>
					<select id="styl" bind:value={stylS}>
						{#each stylyPre as st (st)}<option>{st}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="otvaranie">Smer otvárania</label>
					<select id="otvaranie" bind:value={otvaranieS}>
						{#each data.otvarania as o (o)}<option>{o}</option>{/each}
					</select>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="s">Celková šírka (mm) *</label>
					<input id="s" type="number" min={S_MIN} max={S_MAX} step="any" bind:value={sS} required />
				</div>
				<div class="field">
					<label for="v">Celková výška (mm) *</label>
					<input id="v" type="number" min={V_MIN} max={V_MAX} step="any" bind:value={vS} required />
				</div>
				<div class="field">
					<label for="nazov">Názov výkresu (voliteľné)</label>
					<input
						id="nazov"
						bind:value={nazovS}
						maxlength="80"
						placeholder="napr. Ponuka pre Ján Novák"
					/>
				</div>
			</div>

			<div class="field">
				<label class="opt">
					<input type="checkbox" bind:checked={klinZapnutyS} />
					Klín nad posuvom
				</label>
				{#if klinZapnutyS}
					<div class="polia-box" data-testid="klin-box">
						<div class="grid3">
							<div class="field">
								<label for="klinDlzka">Dĺžka (mm)</label>
								<input id="klinDlzka" type="number" step="any" bind:value={klinDlzkaS} />
							</div>
							<div class="field">
								<label for="klinSirka">Šírka (mm)</label>
								<input id="klinSirka" type="number" step="any" bind:value={klinSirkaS} />
							</div>
							<div class="field">
								<label for="klinKs">Počet kusov</label>
								<input id="klinKs" type="number" min="1" step="1" bind:value={klinKsS} />
							</div>
						</div>
						<div class="grid3">
							<div class="field">
								<label for="klinV1">Výška 1 (mm)</label>
								<input id="klinV1" type="number" step="any" bind:value={klinV1S} />
							</div>
							<div class="field">
								<label for="klinV2">Výška 2 (mm)</label>
								<input id="klinV2" type="number" step="any" bind:value={klinV2S} />
							</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="field">
				<span style="font-weight:600;font-size:14px">Ručná dĺžka koľajnice (voliteľné)</span>
				<div class="grid3">
					<div class="field">
						<label for="kolajnicaHorna">Horná (mm)</label>
						<input id="kolajnicaHorna" type="number" step="any" bind:value={kolajnicaHornaS} />
					</div>
					<div class="field">
						<label for="kolajnicaSpodna">Spodná (mm)</label>
						<input id="kolajnicaSpodna" type="number" step="any" bind:value={kolajnicaSpodnaS} />
					</div>
				</div>
			</div>

			<div class="grid2">
				<div class="field">
					<span style="font-weight:600;font-size:14px">Režim výkresu</span>
					<div class="row" style="gap:18px;margin-top:4px">
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="zn-rezim"
								checked={rezimVykresuS === 'technicky'}
								onchange={() => (rezimVykresuS = 'technicky')}
								style="width:auto"
							/>
							Technický (čiernobiely)
						</label>
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="zn-rezim"
								checked={rezimVykresuS === 'farebny'}
								onchange={() => (rezimVykresuS = 'farebny')}
								style="width:auto"
								data-testid="rezim-farebny-radio"
							/>
							Farebný (podľa RAL)
						</label>
					</div>
				</div>
				<div class="field">
					<label for="ralKod">RAL odtieň</label>
					<div class="row" style="gap:8px;align-items:center">
						<!-- #162 review nález (🔵): zámerne value={} + onchange namiesto
						     bind:value — výber RAL kódu musí AJ odvodiť zobrazovaný text
						     `ralS` ako vedľajší účinok (viď nižšie), čo `bind:value` samo
						     osebe neponúka. `ralKodS` je čisto lokálny $state (nie
						     server-odvodený vstup), takže sa sem NEVZŤAHUJE "$state+bind:,
						     nikdy value={}" (nova-stranka §4) — to pravidlo rieši
						     jednosmerné `value={vstup.x}` z formu, ktoré by pri re-renderi
						     vynulovalo POLE ODOSLANÉ SERVEROM; toto pole žiadny server
						     nevracia. -->
						<select
							id="ralKod"
							value={ralKodS}
							onchange={(e) => {
								const kod = (e.currentTarget as HTMLSelectElement).value;
								ralKodS = kod;
								if (kod === '') {
									ralS = '';
									return;
								}
								const vzorka = RAL_PALETA.find((r) => r.kod === kod);
								if (vzorka) ralS = `${vzorka.kod} ${vzorka.nazov}`;
							}}
						>
							<option value="">— nevybraté —</option>
							{#each RAL_PALETA as r (r.kod)}
								<option value={r.kod} style="background:{r.hex}">{r.kod} {r.nazov} ({r.hex})</option
								>
							{/each}
							<option value={RAL_INY_KOD}>iný…</option>
						</select>
						{#if ralKodS}
							{@const vzorka = RAL_PALETA.find((r) => r.kod === ralKodS)}
							<span
								class="ral-swatch"
								style="display:inline-block;width:22px;height:22px;border-radius:4px;border:1px solid #94a3b8;background:{vzorka?.hex ??
									RAL_FALLBACK_HEX}"
								data-testid="ral-swatch"
							></span>
						{/if}
					</div>
					{#if ralKodS === RAL_INY_KOD}
						<label for="ralIny" style="margin-top:6px;display:block">RAL — vlastný text</label>
						<input
							id="ralIny"
							bind:value={ralS}
							maxlength="40"
							placeholder="napr. RAL 7021 matná"
							data-testid="ral-iny-text"
						/>
					{/if}
				</div>
			</div>

			{@render hidden()}
			<button class="btn" type="submit" data-testid="nakreslit">Vykresliť</button>
		</form>
	</div>
{:else if step === 'vykres'}
	<div class="card">
		<h1>{vstup.nazov || nazovSystemu(vstup.system)}</h1>
		<p class="sub">
			<span class="badge">Zasklenia — návrhový výkres</span>
			<span class="badge">{fmt(vstup.s)} × {fmt(vstup.v)} mm</span>
		</p>
	</div>

	<div class="card noprint">
		<h2 class="sekcia-nadpis">Zákaznícky náhľad</h2>
		<Vizual3DPanel {vstup} datum={formatDatumCasSk(data.datumIso)} />
	</div>

	<div class="card" style="overflow:auto;padding:10px">
		<h2 class="sekcia-nadpis noprint">Technický výkres</h2>
		<ZaskleniaNavrhVykres {vstup} datum={formatDatumCasSk(data.datumIso)} />
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}
			>🖨 Tlačiť / uložiť PDF (technický výkres)</button
		>
		<form method="POST" action={zakaznickyAction} style="display:inline">
			{@render hidden()}
			<button class="btn" type="submit" data-testid="zakaznicky-list-btn">📷 Zákaznícky list</button
			>
		</form>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/zasklenia/navrh')}>➕ Nový výkres</a>
	</div>
{/if}

<style>
	.sekcia-nadpis {
		margin: 0 0 10px;
		font-size: 15px;
		font-weight: 700;
		color: #0f172a;
	}

	.polia-box {
		border: 1px solid var(--m-line-2);
		background: var(--m-surface-2);
		border-radius: 10px;
		padding: 10px 12px 2px;
		margin-bottom: 12px;
	}

	/* Landscape tlač LEN pre túto route (route-CSS-splitting, #137 bod 3) —
	   nedotýka sa portrait tlače nárezáku/fixu/pergoly. */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
