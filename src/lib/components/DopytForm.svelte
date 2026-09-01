<script lang="ts">
	// Verejný kontaktný formulár dopytu (#277). Samostatný komponent — route #275 ho vloží a
	// namountuje akciu `dopyt` (viď `$lib/server/dopyt-action`). Download-first: po úspechu
	// server vráti PDF ako base64, komponent spustí stiahnutie v prehliadači. Honeypot pole
	// (skryté) + serverový rate-limit = anti-spam. Žiadne `console.*` (E2E zero-console).
	import { enhance } from '$app/forms';
	import { HONEYPOT_FIELD, type DopytChyby, type DopytVstup } from '$lib/dopyt';
	import { stiahniPdf } from '$lib/pdf-download';
	import type { PonukaConfig } from '$lib/ponuka';
	import type { KonfProduktKod } from '$lib/konfigurator-produkty';

	interface Props {
		/** aktuálna konfigurácia z konfigurátora (#275) — odošle sa ako skryté JSON pole */
		konfiguracia: PonukaConfig;
		/** #384: produktový rad — odošle sa ako skryté pole (produkt-aware PDF titul + názov leadu) */
		produkt?: KonfProduktKod;
		/** voliteľný 3D render (base64/data-URL) — #276 dodá neskôr */
		renderPngBase64?: string;
		/** SvelteKit akcia, na ktorú sa POSTuje (route #275 mountuje `dopyt`) */
		action?: string;
	}
	let {
		konfiguracia,
		produkt = 'pergola',
		renderPngBase64 = '',
		action = '?/dopyt'
	}: Props = $props();

	let odosielam = $state(false);
	let hotovo = $state(false);
	let chybaHlavna = $state('');
	let chyby = $state<DopytChyby>({});
	let hodnoty = $state<Partial<DopytVstup>>({});

	const konfiguraciaJson = $derived(JSON.stringify(konfiguracia));
</script>

{#if hotovo}
	<div class="dopyt-ok" role="status">
		<h3>Ďakujeme! Dopyt sme prijali.</h3>
		<p>
			Vašu špecifikáciu (PDF) sme pripravili na stiahnutie. Ozveme sa vám a cenu pripravíme po
			obhliadke.
		</p>
	</div>
{:else}
	<form
		class="dopyt-form"
		method="POST"
		{action}
		use:enhance={() => {
			odosielam = true;
			chybaHlavna = '';
			chyby = {};
			return async ({ result }) => {
				odosielam = false;
				if (result.type === 'success') {
					const data = result.data as { pdfBase64?: string; filename?: string } | undefined;
					if (data?.pdfBase64) stiahniPdf(data.pdfBase64, data.filename ?? 'Montalu-ponuka.pdf');
					hotovo = true;
				} else if (result.type === 'failure') {
					const data = result.data as
						{ errors?: DopytChyby; chyba?: string; values?: Partial<DopytVstup> } | undefined;
					chyby = data?.errors ?? {};
					hodnoty = data?.values ?? hodnoty;
					chybaHlavna =
						data?.chyba ?? (Object.keys(chyby).length ? '' : 'Formulár sa nepodarilo odoslať.');
				} else if (result.type === 'error') {
					chybaHlavna = 'Nastala chyba. Skúste to, prosím, znova.';
				}
			};
		}}
	>
		<!-- skryté: produkt + konfigurácia + voliteľný render -->
		<input type="hidden" name="produkt" value={produkt} />
		<input type="hidden" name="konfiguracia" value={konfiguraciaJson} />
		{#if renderPngBase64}
			<input type="hidden" name="renderPng" value={renderPngBase64} />
		{/if}

		<!-- honeypot: reálny človek nevyplní; skryté pre používateľa aj čítačky -->
		<div class="hp" aria-hidden="true">
			<label>
				Webová stránka
				<input type="text" name={HONEYPOT_FIELD} tabindex="-1" autocomplete="off" />
			</label>
		</div>

		<div class="pole">
			<label for="dopyt-meno">Meno a priezvisko *</label>
			<input
				id="dopyt-meno"
				name="meno"
				required
				autocomplete="name"
				value={hodnoty.meno ?? ''}
				aria-invalid={chyby.meno ? 'true' : undefined}
			/>
			{#if chyby.meno}<span class="chyba">{chyby.meno}</span>{/if}
		</div>

		<div class="pole">
			<label for="dopyt-email">E-mail *</label>
			<input
				id="dopyt-email"
				name="email"
				type="email"
				required
				autocomplete="email"
				value={hodnoty.email ?? ''}
				aria-invalid={chyby.email ? 'true' : undefined}
			/>
			{#if chyby.email}<span class="chyba">{chyby.email}</span>{/if}
		</div>

		<div class="pole">
			<label for="dopyt-telefon">Telefón</label>
			<input
				id="dopyt-telefon"
				name="telefon"
				type="tel"
				autocomplete="tel"
				value={hodnoty.telefon ?? ''}
				aria-invalid={chyby.telefon ? 'true' : undefined}
			/>
			{#if chyby.telefon}<span class="chyba">{chyby.telefon}</span>{/if}
		</div>

		<div class="pole">
			<label for="dopyt-miesto">Miesto stavby (PSČ / obec)</label>
			<input id="dopyt-miesto" name="miesto" value={hodnoty.miesto ?? ''} />
		</div>

		<div class="pole">
			<label for="dopyt-poznamka">Poznámka</label>
			<textarea id="dopyt-poznamka" name="poznamka" rows="3">{hodnoty.poznamka ?? ''}</textarea>
		</div>

		{#if chybaHlavna}<p class="chyba-hlavna" role="alert">{chybaHlavna}</p>{/if}

		<button type="submit" disabled={odosielam}>
			{odosielam ? 'Odosielam…' : 'Odoslať dopyt a stiahnuť špecifikáciu'}
		</button>
		<p class="disclaimer">
			Špecifikácia je nezáväzná, s orientačnou cenou. Presnú cenu pripravíme po obhliadke.
		</p>
	</form>
{/if}

<style>
	.dopyt-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 32rem;
	}
	.pole {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.pole label {
		font-size: 0.875rem;
		font-weight: 600;
		color: #334155;
	}
	.pole input,
	.pole textarea {
		padding: 0.5rem 0.625rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.375rem;
		font: inherit;
	}
	.pole input[aria-invalid='true'] {
		border-color: #dc2626;
	}
	.chyba {
		font-size: 0.8125rem;
		color: #dc2626;
	}
	.chyba-hlavna {
		color: #dc2626;
		font-weight: 600;
		margin: 0;
	}
	button {
		padding: 0.625rem 1rem;
		background: #1d4ed8;
		color: #fff;
		border: 0;
		border-radius: 0.375rem;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.disclaimer {
		font-size: 0.8125rem;
		color: #64748b;
		margin: 0;
	}
	.dopyt-ok {
		padding: 1rem 1.25rem;
		background: #dcfce7;
		border: 1px solid #86efac;
		border-radius: 0.5rem;
		color: #15803d;
	}
	.dopyt-ok h3 {
		margin: 0 0 0.5rem;
	}
	.dopyt-ok p {
		margin: 0;
	}
	/* honeypot: mimo obrazovky, neviditeľné, ale prítomné v DOM pre boty */
	.hp {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
</style>
