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
									style="background:none;border:1px solid #93c5fd;color:#2563eb;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px"
									>Zmeniť</button
								>
							</form>
						{/if}
					</td>
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
