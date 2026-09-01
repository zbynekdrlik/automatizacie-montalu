<script lang="ts">
	// #376 stage 1: Archivo je odteraz importované raz v root +layout.svelte (spoločný
	// predok) — tento lokálny import by len duplicoval rovnaké CSS (review finding #8).
	let { form } = $props();
</script>

<svelte:head><title>Prihlásenie — Montalu automatizácie</title></svelte:head>

<div class="split">
	<!-- ľavý panel: technický výkres — profily a kóty ako z nárezového plánu -->
	<aside class="panel">
		<svg
			class="blueprint"
			viewBox="0 0 640 900"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
		>
			<defs>
				<pattern id="mriezka" width="40" height="40" patternUnits="userSpaceOnUse">
					<path
						d="M 40 0 L 0 0 0 40"
						fill="none"
						stroke="rgba(148,163,184,0.09)"
						stroke-width="1"
					/>
				</pattern>
				<marker
					id="sipka"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(96,165,250,0.75)" />
				</marker>
			</defs>
			<rect width="640" height="900" fill="url(#mriezka)" />

			<!-- prierez žľabového profilu -->
			<g class="dwg dwg1" stroke="rgba(148,163,184,0.55)" stroke-width="1.5" fill="none">
				<path d="M 90 170 h 150 v 26 h -18 v 52 h -114 v -52 h -18 z" />
				<path d="M 108 196 v 40 m 114 -40 v 40" stroke-dasharray="4 5" stroke-width="1" />
			</g>
			<g class="dwg dwg1" stroke="rgba(96,165,250,0.6)" stroke-width="1">
				<line
					x1="90"
					y1="140"
					x2="240"
					y2="140"
					marker-start="url(#sipka)"
					marker-end="url(#sipka)"
				/>
			</g>
			<text class="dwg dwg1 kota" x="165" y="132">110</text>

			<!-- prierez stĺpika 110×110 -->
			<g class="dwg dwg2" stroke="rgba(148,163,184,0.55)" stroke-width="1.5" fill="none">
				<rect x="420" y="300" width="110" height="110" rx="6" />
				<rect
					x="436"
					y="316"
					width="78"
					height="78"
					rx="3"
					stroke-dasharray="5 5"
					stroke-width="1"
				/>
			</g>
			<g class="dwg dwg2" stroke="rgba(96,165,250,0.6)" stroke-width="1">
				<line
					x1="550"
					y1="300"
					x2="550"
					y2="410"
					marker-start="url(#sipka)"
					marker-end="url(#sipka)"
				/>
			</g>
			<text class="dwg dwg2 kota" x="562" y="360">110</text>

			<!-- zasklenie: pole so sklom a kótou -->
			<g class="dwg dwg3" stroke="rgba(148,163,184,0.5)" stroke-width="1.5" fill="none">
				<rect x="90" y="380" width="220" height="150" />
				<rect
					x="104"
					y="394"
					width="192"
					height="122"
					fill="rgba(96,165,250,0.07)"
					stroke="rgba(96,165,250,0.35)"
					stroke-width="1"
				/>
				<line
					x1="130"
					y1="496"
					x2="220"
					y2="412"
					stroke="rgba(96,165,250,0.28)"
					stroke-width="4"
					stroke-linecap="round"
				/>
			</g>
			<g class="dwg dwg3" stroke="rgba(96,165,250,0.6)" stroke-width="1">
				<line
					x1="90"
					y1="556"
					x2="310"
					y2="556"
					marker-start="url(#sipka)"
					marker-end="url(#sipka)"
				/>
			</g>
			<text class="dwg dwg3 kota" x="200" y="578">2 374</text>

			<!-- rezné značky -->
			<g class="dwg dwg4" stroke="rgba(245,158,11,0.55)" stroke-width="1.5">
				<path d="M 470 560 l 36 0 m -18 -18 l 0 36" />
				<path d="M 470 170 l 36 0 m -18 -18 l 0 36" />
			</g>
		</svg>

		<div class="brand">
			<div class="logo-line">
				<span class="znacka"></span>
				<h1>MONTALU</h1>
			</div>
			<p class="tagline">Automatizácie výroby</p>
			<ul class="moduly">
				<li><span>01</span> Pergoly</li>
				<li><span>02</span> Bazénové kryty</li>
				<li><span>03</span> Zasklenia</li>
			</ul>
			<p class="motto">Nárezový plán a odpis materiálu do Money — na pár klikov, bez Excelu.</p>
		</div>
	</aside>

	<!-- pravá strana: formulár -->
	<main class="formside">
		<form method="POST" class="loginform">
			<p class="vitaj">Vitaj späť</p>
			<h2>Prihlásenie</h2>

			{#if form?.error}
				<div class="chyba" data-testid="login-error">{form.error}</div>
			{/if}

			<div class="pole">
				<label for="username">Meno</label>
				<input
					id="username"
					name="username"
					value={form?.username ?? ''}
					autocomplete="username"
					maxlength="200"
					required
				/>
			</div>
			<div class="pole">
				<label for="password">Heslo</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					maxlength="200"
					required
				/>
			</div>

			<button type="submit">Prihlásiť <span class="btn-sipka">→</span></button>

			<p class="pata">Interný nástroj Montalu · prístup majú len pozvaní</p>
		</form>
	</main>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(360px, 5fr) 7fr;
		min-height: 100dvh;
		font-family: 'Archivo Variable', 'Segoe UI', sans-serif;
	}

	/* ── ľavý panel ── */
	.panel {
		position: relative;
		background: linear-gradient(160deg, #0b1220 0%, #0f172a 55%, #12203a 100%);
		color: #e2e8f0;
		overflow: hidden;
		display: flex;
		align-items: flex-end;
	}
	.blueprint {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.dwg {
		opacity: 0;
		animation: dokresli 0.9s ease-out forwards;
	}
	.dwg1 {
		animation-delay: 0.25s;
	}
	.dwg2 {
		animation-delay: 0.45s;
	}
	.dwg3 {
		animation-delay: 0.65s;
	}
	.dwg4 {
		animation-delay: 0.9s;
	}
	@keyframes dokresli {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.kota {
		fill: rgba(147, 197, 253, 0.85);
		font-size: 13px;
		font-family: ui-monospace, monospace;
		text-anchor: middle;
	}

	.brand {
		position: relative;
		z-index: 1;
		width: 100%;
		padding: 90px 44px 56px;
		animation: dokresli 0.7s ease-out both;
		/* tmavý prechod — text značky sa nikdy nebije s výkresom nad ním */
		background: linear-gradient(
			to top,
			rgba(9, 14, 26, 0.96) 55%,
			rgba(9, 14, 26, 0.7) 80%,
			transparent
		);
	}
	.logo-line {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.znacka {
		width: 34px;
		height: 34px;
		/* #376 stage 1: jantár → bronz (var(--m-accent), app.css :root) — jeden akcent
		   v celej appke (owner design komentár, architektúra bod 2). Fallback hex pre
		   prípad, že by sa login niekedy vykresľoval bez app.css. */
		border: 3px solid var(--m-accent, #b07a45);
		border-radius: 4px;
		position: relative;
		flex: 0 0 auto;
	}
	.znacka::after {
		content: '';
		position: absolute;
		inset: 6px;
		border: 2px solid rgba(96, 165, 250, 0.9);
		border-radius: 2px;
	}
	.brand h1 {
		margin: 0;
		font-size: clamp(34px, 4.2vw, 52px);
		font-weight: 850;
		letter-spacing: 0.06em;
		line-height: 1;
		font-stretch: 92%;
	}
	.tagline {
		margin: 10px 0 30px;
		color: #93c5fd;
		font-size: 14px;
		letter-spacing: 0.32em;
		text-transform: uppercase;
	}
	.moduly {
		list-style: none;
		margin: 0 0 26px;
		padding: 0;
		display: grid;
		gap: 9px;
		font-size: 15.5px;
		font-weight: 600;
	}
	.moduly span {
		color: var(--m-accent, #b07a45);
		font-family: ui-monospace, monospace;
		font-size: 12px;
		margin-right: 10px;
	}
	.motto {
		margin: 0;
		max-width: 34ch;
		color: #94a3b8;
		font-size: 13.5px;
		line-height: 1.55;
		border-left: 2px solid rgba(96, 165, 250, 0.5);
		padding-left: 14px;
	}

	/* ── formulár ── */
	.formside {
		display: flex;
		align-items: center;
		justify-content: center;
		background:
			radial-gradient(1100px 500px at 85% -10%, rgba(37, 99, 235, 0.07), transparent 60%), #f6f8fb;
		padding: 40px 24px;
	}
	.loginform {
		width: min(400px, 100%);
		animation: dokresli 0.6s ease-out 0.15s both;
	}
	.vitaj {
		margin: 0 0 4px;
		/* #376 stage 1: jeden akcent v celej appke — bronz namiesto modrej (review
		   finding #8, dokončuje architektúra bod 2 z design komentára) */
		color: var(--m-accent, #b07a45);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}
	.loginform h2 {
		margin: 0 0 30px;
		font-size: 34px;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.chyba {
		background: #fef2f2;
		border-left: 3px solid #dc2626;
		color: #b91c1c;
		border-radius: 6px;
		padding: 11px 14px;
		font-size: 14px;
		margin-bottom: 20px;
	}
	.pole {
		margin-bottom: 22px;
	}
	.pole label {
		display: block;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #475569;
		margin-bottom: 7px;
	}
	.pole input {
		width: 100%;
		box-sizing: border-box;
		background: #fff;
		border: 1px solid #cbd5e1;
		border-bottom: 2px solid #94a3b8;
		border-radius: 8px 8px 2px 2px;
		padding: 13px 14px;
		font-size: 16px;
		color: #0f172a;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.pole input:focus {
		outline: none;
		border-color: var(--m-accent, #b07a45);
		border-bottom-color: var(--m-accent, #b07a45);
		box-shadow: 0 6px 18px -8px rgba(176, 122, 69, 0.45);
	}
	.loginform button {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		background: #0f172a;
		color: #fff;
		border: 0;
		border-radius: 10px;
		padding: 15px;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0.03em;
		font-family: inherit;
		cursor: pointer;
		margin-top: 6px;
		transition:
			background 0.15s ease,
			transform 0.1s ease;
	}
	.loginform button:hover {
		background: var(--m-ink-2-hover, #2c3037);
	}
	.loginform button:hover .btn-sipka {
		transform: translateX(4px);
	}
	.loginform button:active {
		transform: translateY(1px);
	}
	.btn-sipka {
		display: inline-block;
		transition: transform 0.15s ease;
	}
	.pata {
		margin: 26px 0 0;
		text-align: center;
		color: #94a3b8;
		font-size: 12.5px;
	}

	/* ── mobil ── */
	@media (max-width: 820px) {
		.split {
			grid-template-columns: 1fr;
		}
		.panel {
			min-height: 220px;
			align-items: center;
		}
		.brand {
			padding: 30px 28px;
		}
		.moduly,
		.motto {
			display: none;
		}
		.tagline {
			margin-bottom: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dwg,
		.brand,
		.loginform {
			animation: none;
			opacity: 1;
		}
	}
</style>
