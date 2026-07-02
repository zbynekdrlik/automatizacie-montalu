<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Nahlásiť problém — Montalu</title></svelte:head>

<div class="card">
	<h1>⚠ Nahlásiť problém</h1>
	<p class="sub">Napíš, čo zle prebehlo — hlásenie sa uloží a pozrieme sa naň.</p>
</div>

{#if form?.ulozene}
	<div class="okmsg" data-testid="problem-ulozeny">✅ Ďakujem, hlásenie je uložené.</div>
{:else if form?.error}
	<div class="err">⚠️ {form.error}</div>
{/if}

<div class="card">
	<form method="POST">
		<div class="field">
			<label for="oblast">Čoho sa to týka</label>
			<select id="oblast" name="oblast">
				<option>Pergola</option>
				<option>Bazén</option>
				<option>Zasklenia</option>
				<option>Iné</option>
			</select>
		</div>
		<div class="field">
			<label for="popis">Čo zle prebehlo? *</label>
			<textarea
				id="popis"
				name="popis"
				rows="6"
				required
				style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px"
			></textarea>
		</div>
		<button class="btn" type="submit">Odoslať hlásenie</button>
	</form>
</div>

{#if data.reports.length}
	<div class="card">
		<div class="sec">Posledné hlásenia</div>
		{#each data.reports as r, i (i)}
			<div class="row" style="flex-direction:column;align-items:flex-start;gap:2px">
				<span><b>{r.ts}</b> · {r.username || '—'} · {r.oblast}</span>
				<span style="color:#64748b;white-space:pre-wrap">{r.popis}</span>
			</div>
		{/each}
	</div>
{/if}
