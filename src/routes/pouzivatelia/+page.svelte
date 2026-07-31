<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Používatelia — Montalu</title></svelte:head>

<div class="card">
	<h1>Používatelia</h1>
	<p class="sub">
		Interné a veľkoobchodné (B2B) účty. B2B účet vidí len Zasklenia, nemôže odpisovať do Money a má
		rozmerové limity (šírka zablokuje, výška nad limit len upozorní „bez záruky").
	</p>
</div>

{#if form?.error}
	<div class="err" data-testid="pouzivatelia-error">⚠️ {form.error}</div>
{:else if form?.ok}
	<div class="okmsg" data-testid="pouzivatelia-ok">✅ {form.ok}</div>
{/if}

<div class="card">
	<div class="sec">Pridať B2B účet</div>
	<form method="POST" action="?/pridat">
		<div class="field">
			<label for="username">Prihlasovacie meno</label>
			<input id="username" name="username" required />
		</div>
		<div class="field">
			<label for="password">Heslo (min. 6 znakov)</label>
			<input id="password" name="password" type="password" minlength="6" required />
		</div>
		<button class="btn" type="submit">➕ Pridať B2B účet</button>
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
					<td>{u.role === 'b2b' ? 'B2B' : 'Interný'}</td>
					<td>{u.created_at}</td>
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
