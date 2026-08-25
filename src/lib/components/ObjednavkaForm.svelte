<script lang="ts">
	// Verejný formulár ZÁVÄZNEJ OBJEDNÁVKY (#319). Escalácia dopytu: kontakt + fakturačné údaje +
	// POVINNÝ súhlas s obchodnými podmienkami. Route /konfigurator ho vloží a namountuje akciu
	// `objednavka` (viď `$lib/server/dopyt-action`). Download-first: po úspechu server vráti PDF
	// (base64) s opečiatkovanou objednanou cenou, komponent spustí stiahnutie. Honeypot + serverový
	// rate-limit = anti-spam. Importuje LEN pure `$lib/dopyt` + `$lib/ponuka` (žiadny katalóg/server
	// — Money-neutralita cez import-graf guard). Žiadne `console.*` (E2E zero-console).
	import { enhance } from '$app/forms';
	import { HONEYPOT_FIELD, type ObjednavkaChyby, type ObjednavkaVstup } from '$lib/dopyt';
	import type { PonukaConfig } from '$lib/ponuka';

	interface Props {
		/** aktuálna konfigurácia z konfigurátora — odošle sa ako skryté JSON pole */
		konfiguracia: PonukaConfig;
		/** voliteľný 3D render (base64/data-URL) */
		renderPngBase64?: string;
		/** SvelteKit akcia, na ktorú sa POSTuje (route mountuje `objednavka`) */
		action?: string;
	}
	let { konfiguracia, renderPngBase64 = '', action = '?/objednavka' }: Props = $props();

	let odosielam = $state(false);
	let hotovo = $state(false);
	let chybaHlavna = $state('');
	let chyby = $state<ObjednavkaChyby>({});
	let hodnoty = $state<Partial<ObjednavkaVstup>>({});

	const konfiguraciaJson = $derived(JSON.stringify(konfiguracia));

	function stiahniPdf(base64: string, filename: string): void {
		const bin = atob(base64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const blob = new Blob([bytes], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename || 'Montalu-objednavka.pdf';
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}
</script>

{#if hotovo}
	<div class="obj-ok" role="status" data-testid="objednavka-ok">
		<h3>Ďakujeme! Objednávku sme prijali.</h3>
		<p>
			Vašu záväznú objednávku (špecifikáciu v PDF) sme pripravili na stiahnutie. Čoskoro sa vám
			ozveme a dohodneme obhliadku a presné podmienky. Objednávka je záväzná (odoslaná firme), nie
			online platba.
		</p>
	</div>
{:else}
	<form
		class="obj-form"
		method="POST"
		{action}
		data-testid="objednavka-form"
		use:enhance={() => {
			odosielam = true;
			chybaHlavna = '';
			chyby = {};
			return async ({ result }) => {
				odosielam = false;
				if (result.type === 'success') {
					const data = result.data as { pdfBase64?: string; filename?: string } | undefined;
					if (data?.pdfBase64)
						stiahniPdf(data.pdfBase64, data.filename ?? 'Montalu-objednavka.pdf');
					hotovo = true;
				} else if (result.type === 'failure') {
					const data = result.data as
						| { errors?: ObjednavkaChyby; chyba?: string; values?: Partial<ObjednavkaVstup> }
						| undefined;
					chyby = data?.errors ?? {};
					hodnoty = data?.values ?? hodnoty;
					chybaHlavna =
						data?.chyba ?? (Object.keys(chyby).length ? '' : 'Objednávku sa nepodarilo odoslať.');
				} else if (result.type === 'error') {
					chybaHlavna = 'Nastala chyba. Skúste to, prosím, znova.';
				}
			};
		}}
	>
		<!-- skryté: konfigurácia + voliteľný render -->
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

		<fieldset>
			<legend>Kontaktné údaje</legend>
			<div class="pole">
				<label for="obj-meno">Meno a priezvisko *</label>
				<input
					id="obj-meno"
					name="meno"
					required
					autocomplete="name"
					value={hodnoty.meno ?? ''}
					aria-invalid={chyby.meno ? 'true' : undefined}
				/>
				{#if chyby.meno}<span class="chyba">{chyby.meno}</span>{/if}
			</div>
			<div class="pole">
				<label for="obj-email">E-mail *</label>
				<input
					id="obj-email"
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
				<label for="obj-telefon">Telefón</label>
				<input
					id="obj-telefon"
					name="telefon"
					type="tel"
					autocomplete="tel"
					value={hodnoty.telefon ?? ''}
					aria-invalid={chyby.telefon ? 'true' : undefined}
				/>
				{#if chyby.telefon}<span class="chyba">{chyby.telefon}</span>{/if}
			</div>
			<div class="pole">
				<label for="obj-miesto">Miesto stavby (PSČ / obec)</label>
				<input id="obj-miesto" name="miesto" value={hodnoty.miesto ?? ''} />
			</div>
		</fieldset>

		<fieldset>
			<legend>Fakturačné údaje</legend>
			<div class="pole">
				<label for="obj-fakt-meno">Meno alebo firma *</label>
				<input
					id="obj-fakt-meno"
					name="faktMeno"
					required
					autocomplete="organization"
					value={hodnoty.faktMeno ?? ''}
					aria-invalid={chyby.faktMeno ? 'true' : undefined}
				/>
				{#if chyby.faktMeno}<span class="chyba">{chyby.faktMeno}</span>{/if}
			</div>
			<div class="pole">
				<label for="obj-fakt-adresa">Fakturačná adresa (ulica, mesto, PSČ) *</label>
				<input
					id="obj-fakt-adresa"
					name="faktAdresa"
					required
					autocomplete="street-address"
					value={hodnoty.faktAdresa ?? ''}
					aria-invalid={chyby.faktAdresa ? 'true' : undefined}
				/>
				{#if chyby.faktAdresa}<span class="chyba">{chyby.faktAdresa}</span>{/if}
			</div>
			<div class="dvojstlpec">
				<div class="pole">
					<label for="obj-ico">IČO</label>
					<input id="obj-ico" name="faktIco" value={hodnoty.faktIco ?? ''} />
				</div>
				<div class="pole">
					<label for="obj-dic">DIČ / IČ DPH</label>
					<input id="obj-dic" name="faktDic" value={hodnoty.faktDic ?? ''} />
				</div>
			</div>
		</fieldset>

		<div class="pole">
			<label for="obj-poznamka">Poznámka</label>
			<textarea id="obj-poznamka" name="poznamka" rows="3">{hodnoty.poznamka ?? ''}</textarea>
		</div>

		<div class="pole suhlas-pole">
			<label class="suhlas">
				<input type="checkbox" name="suhlas" data-testid="objednavka-suhlas" value="on" />
				Súhlasím s obchodnými podmienkami a odoslaním záväznej objednávky. *
			</label>
			{#if chyby.suhlas}<span class="chyba" data-testid="objednavka-suhlas-chyba"
					>{chyby.suhlas}</span
				>{/if}
		</div>

		{#if chybaHlavna}<p class="chyba-hlavna" role="alert">{chybaHlavna}</p>{/if}

		<button type="submit" disabled={odosielam} data-testid="objednavka-odoslat">
			{odosielam ? 'Odosielam…' : 'Odoslať záväznú objednávku'}
		</button>
		<p class="disclaimer">
			Objednávka je záväzná (odoslaná firme), nie online platba. Presnú cenu potvrdíme po obhliadke;
			orientačná cena z konfigurátora je súčasťou objednávky.
		</p>
	</form>
{/if}

<style>
	.obj-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 36rem;
	}
	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		padding: 0.75rem 1rem 1rem;
		margin: 0;
	}
	legend {
		font-weight: 700;
		color: #1e293b;
		padding: 0 0.375rem;
	}
	.dvojstlpec {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
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
	.suhlas {
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5rem;
		font-weight: 500;
		display: flex;
	}
	.suhlas input {
		margin-top: 0.2rem;
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
		background: #15803d;
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
	.obj-ok {
		padding: 1rem 1.25rem;
		background: #dcfce7;
		border: 1px solid #86efac;
		border-radius: 0.5rem;
		color: #15803d;
	}
	.obj-ok h3 {
		margin: 0 0 0.5rem;
	}
	.obj-ok p {
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
