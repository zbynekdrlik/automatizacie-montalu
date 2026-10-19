<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();

	// #613: výsledok „Nastaviť nové heslo" sa ukáže pri riadku účtu (nie hore nad formulárom
	// pridania — pri dlhšom zozname by ho admin nevidel). Neznámy účet (riadok neexistuje,
	// napr. medzitým zmazaný) padne do horného bannera ako ostatné akcie.
	const hesloUcet = $derived(
		form?.ucet && data.users.some((u) => u.username === form.ucet) ? form.ucet : null
	);

	// Nové heslo: vlastný účet → potvrdenie (zrušia sa VŠETKY relácie účtu, aj táto — admin sa
	// prihlási novým heslom). Po úspechu `update()` vyprázdni polia a rozbalenie sa zavrie.
	function noveHesloEnhance(vlastny: boolean): SubmitFunction {
		return ({ cancel }) => {
			if (
				vlastny &&
				!confirm('Nastaviť nové heslo VLASTNÉMU účtu? Budeš odhlásený a prihlásiš sa novým heslom.')
			) {
				cancel();
				return;
			}
			return async ({ result, update, formElement }) => {
				await update();
				if (result.type === 'success') formElement.closest('details')?.removeAttribute('open');
			};
		};
	}
</script>

<svelte:head><title>Používatelia — Montalu</title></svelte:head>

<div class="card">
	<h1>Používatelia</h1>
	<p class="sub">
		Interné a veľkoobchodné (B2B) účty. B2B účet vidí len Zasklenia, nemôže odpisovať do Money a má
		rozmerové limity (šírka zablokuje, výška nad limit len upozorní „bez záruky").
	</p>
</div>

<!-- výsledok nového hesla (#613) je pri riadku účtu nižšie, nie tu -->
{#if form?.error && !hesloUcet}
	<div class="err" data-testid="pouzivatelia-error">⚠️ {form.error}</div>
{:else if form?.ok && !hesloUcet}
	<div class="okmsg" data-testid="pouzivatelia-ok">✅ {form.ok}</div>
{/if}

<div class="card">
	<div class="sec">Pridať účet</div>
	<form method="POST" action="?/pridat">
		<div class="field">
			<label for="username">Prihlasovacie meno</label>
			<input id="username" name="username" required />
		</div>
		<div class="field">
			<label for="password">Heslo (min. 6 znakov)</label>
			<input id="password" name="password" type="password" minlength="6" required />
		</div>
		<div class="field">
			<label for="role">Rola</label>
			<select id="role" name="role">
				<option value="b2b" selected>B2B (veľkoobchod)</option>
				<option value="internal">Interný</option>
			</select>
			<span class="hint">
				B2B vidí len Zasklenia, nemôže odpisovať do Money a má rozmerové limity. Interný má plný
				prístup do appky — voľ len pre zamestnancov.
			</span>
		</div>
		<button class="btn" type="submit">➕ Pridať účet</button>
	</form>
</div>

<div class="card">
	<div class="sec">Účty ({data.users.length})</div>
	<table data-testid="pouzivatelia-tabulka">
		<thead>
			<tr>
				<th>Meno</th>
				<th>Rola</th>
				<th>Vytvorené</th>
				<th>Heslo</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr>
					<td
						>{u.username}{#if u.username === data.me}
							<span class="badge">ja</span>{/if}</td
					>
					<td>
						{#if u.username === data.me}
							{u.role === 'b2b' ? 'B2B' : 'Interný'}
						{:else}
							<form
								method="POST"
								action="?/zmenit_rolu"
								class="rola-form"
								onsubmit={(e) => {
									const form = e.currentTarget as HTMLFormElement;
									const sel = form.elements.namedItem('role') as HTMLSelectElement;
									const label = sel.value === 'b2b' ? 'B2B' : 'Interný';
									if (!confirm(`Zmeniť rolu účtu ${u.username} na ${label}?`)) e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={u.id} />
								<select name="role" style="width:auto;padding:4px 8px;font-size:13px">
									<option value="internal" selected={u.role !== 'b2b'}>Interný</option>
									<option value="b2b" selected={u.role === 'b2b'}>B2B</option>
								</select>
								<button
									type="submit"
									style="background:none;border:1px solid var(--m-line-2);color:var(--m-accent-ink);border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px"
									>Zmeniť</button
								>
							</form>
						{/if}
					</td>
					<td>{u.created_at}</td>
					<td>
						<!-- #613: nové heslo bez znalosti starého (zabudnuté heslo). Polia minlength/maxlength
						     zrkadlia server `chybaHesla` (6 / 200) — rozhoduje server, toto je len UX. -->
						<details class="heslo-det" data-testid="nove-heslo">
							<summary data-testid="nove-heslo-toggle">Nastaviť nové heslo</summary>
							<form
								method="POST"
								action="?/noveHeslo"
								class="heslo-form"
								use:enhance={noveHesloEnhance(u.username === data.me)}
							>
								<input type="hidden" name="username" value={u.username} />
								<label for="nove-heslo-{u.id}">Nové heslo</label>
								<input
									id="nove-heslo-{u.id}"
									name="password"
									type="password"
									autocomplete="new-password"
									minlength="6"
									maxlength="200"
									required
								/>
								<label for="nove-heslo2-{u.id}">Nové heslo znova</label>
								<input
									id="nove-heslo2-{u.id}"
									name="password2"
									type="password"
									autocomplete="new-password"
									minlength="6"
									maxlength="200"
									required
								/>
								<button class="btn sm secondary" type="submit">Uložiť heslo</button>
							</form>
						</details>
						{#if hesloUcet === u.username}
							{#if form?.error}
								<div class="err heslo-stav" data-testid="nove-heslo-stav">⚠️ {form.error}</div>
							{:else if form?.ok}
								<div class="okmsg heslo-stav" data-testid="nove-heslo-stav">✅ {form.ok}</div>
							{/if}
						{/if}
					</td>
					<td class="c">
						{#if u.role === 'b2b'}
							<form
								method="POST"
								action="?/zmazat"
								onsubmit={(e) => {
									if (!confirm(`Zmazať účet ${u.username}?`)) e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={u.id} />
								<button
									type="submit"
									style="background:none;border:1px solid #fecaca;color:#dc2626;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px"
									>Zmazať</button
								>
							</form>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	/* #613 per-riadok „Nastaviť nové heslo" — kompaktné, nie na celú šírku ako hlavný formulár */
	.heslo-det summary {
		cursor: pointer;
		color: var(--m-accent-ink);
		font-size: 13px;
	}
	.heslo-form {
		display: grid;
		gap: 4px;
		margin-top: 8px;
		min-width: 200px;
		max-width: 280px;
	}
	.heslo-form label {
		font-size: 12px;
		margin: 4px 0 0;
	}
	.heslo-form input {
		padding: 6px 8px;
		font-size: 13px;
	}
	.heslo-form button {
		justify-self: start;
		margin-top: 6px;
	}
	.heslo-stav {
		padding: 6px 8px;
		font-size: 13px;
		margin: 6px 0 0;
	}
</style>
