<script lang="ts">
	// #384: root `/konfigurator` = VÝBEROVÁ OBRAZOVKA jednotného verejného konfigurátora.
	// Pergolový konfigurátor sa presunul na podstránku `/konfigurator/pergola`; táto stránka
	// je vstupný bod — grid produktových kariet renderovaný ČISTO z client-safe katalógu
	// `KONF_PRODUKTY` (žiadny `+page.server.ts`: verzia príde z root layoutu, katalóg je dáta).
	// Money-neutrálne (katalóg nenesie Money kód ani cenu) → leak-guard (A) prejde.
	import KonfVyber from '$lib/components/konfigurator/KonfVyber.svelte';
</script>

<svelte:head>
	<title>Konfigurátor Montalu — vyberte výrobok</title>
	<meta
		name="description"
		content="Nakonfigurujte si pergolu, bazénové zastrešenie, zimnú záhradu a ďalšie výrobky Montalu na mieru — s orientačnou cenou a špecifikáciou."
	/>
</svelte:head>

<KonfVyber />
