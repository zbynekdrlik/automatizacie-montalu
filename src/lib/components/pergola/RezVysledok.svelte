<script lang="ts">
	// Krok „vysledok" — zobrazenie spočítaného materiálu z rozmerov (#155/#193/#194).
	// Vyčlenené z pergola/narez/+page.svelte (#239): karty nadpis / stav / výkres / krov /
	// materiál / komponenty / informatívne / údaje zákazky / nepodporované. Čistá
	// prezentácia — všetok stav aj výpočty (`vysledok`, `komponenty`, `krov`, počítadlá)
	// prídu ako propy z rodiča (state + compute hub); tu sa nič nemutuje ani nepočíta.
	import PergolaNarezVykres from '$lib/components/PergolaNarezVykres.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import {
		MAX_ROZOSTUP_PRIECOK,
		type PergolaNarezVstup,
		type NarezVysledok,
		type PergolaKomponent
	} from '$lib/pergola-narez';
	import type { KrovUlozenie } from '$lib/pergola-krov';

	let {
		vstup,
		vysledok,
		komponenty,
		krov,
		spocitaneCount,
		cakaCount,
		cakaDlzkaCount,
		cakaPravidloCount,
		datumIso,
		live
	}: {
		vstup: PergolaNarezVstup;
		vysledok: NarezVysledok;
		komponenty: PergolaKomponent[];
		krov: KrovUlozenie | null;
		spocitaneCount: number;
		cakaCount: number;
		cakaDlzkaCount: number;
		cakaPravidloCount: number;
		datumIso: string;
		live: boolean;
	} = $props();

	const mm = (n: number | null) => (n === null ? '— (čaká na výkres)' : `${n} mm`);
</script>

<div class="card">
	<h1 data-testid="narez-nadpis">
		Rezervačný odpis — {vstup.system}
		{vstup.sirka}×{vstup.hlbka} mm
	</h1>
	<p class="sub">
		<span class="badge">{vstup.system}</span>
		<span class="badge">{vstup.uchytenie === 'stena' ? 'na stenu' : 'samostatne stojaca'}</span>
		<span class="badge">{vstup.pocetPrednychNoh} predných nôh</span>
	</p>
</div>

<!-- #222 — stavové zhrnutie navrchu: čo je spočítané (ide do rezervácie) a čo
     čaká, na prvý pohľad, bez čítania celej strany -->
<div class="card" data-testid="narez-stav">
	<div class="sec">Stav výpočtu</div>
	<div class="stav-grid">
		<div class="stav-blok ok">
			<span class="stav-cislo" data-testid="stav-spocitane">{spocitaneCount}</span>
			<span class="stav-popis"
				><span class="badge ok">✅ Spočítané</span> idú do rezervácie v Money</span
			>
		</div>
		<div class="stav-blok wait">
			<span class="stav-cislo" data-testid="stav-caka">{cakaCount}</span>
			<span class="stav-popis"
				><span class="badge wait">⏳ Čaká na vzorec</span> zatiaľ sa nezahŕňa (počet istý, dĺžka
				čaká:
				{cakaDlzkaCount} · čaká na pravidlo: {cakaPravidloCount})</span
			>
		</div>
	</div>
	<p class="sub" style="margin-top:12px">
		Do rezervácie idú LEN spočítané položky (s dĺžkou rezu); „čaká na vzorec" sa NEZAHŔŇA — nikdy
		vymyslené číslo. Odpis sa odošle až po tvojom potvrdení nižšie.
		{#if !live}<b>🧪 TEST režim — do Money nejde nič.</b>{/if}
	</p>
</div>

<div class="card" style="overflow:auto;padding:10px">
	<div class="sec noprint">Technický výkres z rozmerov</div>
	<p class="sub noprint" style="margin:0 0 8px">
		Predný pohľad, bokorys a pôdorys z potvrdených vzorcov. Krov je zjednodušený obrys — detail
		doplní konštruktér.
	</p>
	<PergolaNarezVykres {vstup} datum={formatDatumCasSk(datumIso)} />
</div>

{#if krov}
	<div class="card">
		<div class="sec">
			Krov — uloženie
			{#if krov.podporovane}<span class="badge ok">✅ potvrdené</span>{:else}<span
					class="badge wait">⏳ nepodporované</span
				>{/if}
		</div>
		{#if krov.podporovane}
			<p class="sub">
				Potvrdené uloženie z prahu 7° (číselne overené). Frézovanie drážok (výrobný list) ostáva na
				konštruktérovi.
			</p>
			<div data-testid="krov-ulozenie">
				<div class="row"><span>Sklon strechy</span><b>{krov.sklonStupne}°</b></div>
				<div class="row">
					<span>Rovina uloženia</span>
					<b
						>{krov.rezim === 'rovnobezne'
							? '= 7° — rovnobežne s hranou'
							: '> 7° — dva dotyky + previs'}</b
					>
				</div>
				<div class="row">
					<span>uhol2 / uhol3 (SE model)</span><b>{krov.uhol2} / {krov.uhol3}°</b>
				</div>
				<div class="row">
					<span>Odvesna c = 29 mm → ps = ls</span>
					<b data-testid="krov-ps">{krov.ps} mm</b>
				</div>
				<div class="row">
					<span>Odvesna cc = 37,28 mm → lv = pv</span>
					<b data-testid="krov-lv">{krov.lv} mm</b>
				</div>
			</div>
		{:else}
			<p class="sub" data-testid="krov-nepodporovane">
				Zadaný sklon <b>{krov.sklonStupne}°</b> je pod prahom 7° — bod dotyku sa „prehodí" (trojuholník
				sa otočí), táto vetva nie je potvrdeným vzorcom pokrytá. Uloženie sa nepočíta — nič sa nehádže.
			</p>
		{/if}
		<ul style="margin:6px 0 0;padding-left:18px">
			{#each krov.poznamky as p (p)}
				<li style="margin:4px 0" class="sub">{p}</li>
			{/each}
		</ul>
	</div>
{/if}

<div class="card">
	<div class="sec">
		Materiál <span class="badge ok">✅ {spocitaneCount} spočítané</span>{#if cakaDlzkaCount}<span
				class="badge wait">⏳ {cakaDlzkaCount} čaká na dĺžku</span
			>{/if}
	</div>
	<p class="sub noprint">
		Stĺpec „Stav": <b>✅</b> = dĺžka známa, ide do rezervácie · <b>⏳</b> = počet istý, dĺžka rezu čaká
		na vzorec (kótovaný výkres) a do odpisu sa nezahrnie.
	</p>
	<table class="narez" data-testid="narez-tabulka">
		<thead>
			<tr
				><th class="stav-col">Stav</th><th>Kód</th><th>Názov</th><th>Dĺžka rezu</th><th>Počet ks</th
				><th>Výdaj</th></tr
			>
		</thead>
		<tbody>
			<!-- POZOR: jeden kód môže mať VIAC riadkov (napr. 18016 pod fixom + pod kotviacim;
			     18017 predná + zadná noha pri SS), takže data-testid="polozka-{kód}" NIE JE
			     unikátny — v teste filtruj podľa textu riadku (`.filter({ hasText: '…' })`). -->
			{#each vysledok.vypocitane as p (p.kod + p.nazov)}
				<tr data-testid="polozka-{p.kod}">
					<td class="stav-col">
						<!-- rovnaká podmienka ako spocitaneCount / narezToCadRows (do rezervácie
						     ide `dlzkaRezuMm != null && pocetKs > 0`) — per-riadkový odznak sa tak
						     nikdy nerozíde so zhrnutím ani s Money, aj keby pribudol riadok s
						     dĺžkou ale nulovým počtom (#222 review) -->
						{#if p.dlzkaRezuMm != null && p.pocetKs > 0}<span
								class="badge ok"
								data-testid="stav-{p.kod}"
								title="dĺžka známa → ide do rezervácie">✅ v odpise</span
							>{:else}<span
								class="badge wait"
								data-testid="stav-{p.kod}"
								title="počet istý, dĺžka rezu čaká na vzorec">⏳ čaká</span
							>{/if}
					</td>
					<td>{p.kod}</td>
					<td>
						<!-- #233 — čistý názov + krátka šedá poznámka; dlhé vysvetlenie do
						     rozklikávacieho detailu riadku (default zbalené) -->
						<div class="nazov-hlavny">{p.nazov}</div>
						{#if p.poznamka}<div class="nazov-pozn sub">{p.poznamka}</div>{/if}
						{#if p.poznamkaDetail}
							<details class="nazov-detail">
								<summary>Prečo / detail</summary>
								<p class="sub" style="margin:4px 0 0">{p.poznamkaDetail}</p>
							</details>
						{/if}
					</td>
					<td>{mm(p.dlzkaRezuMm)}</td>
					<td><b>{p.pocetKs}</b></td>
					<td data-testid="vydaj-{p.kod}"
						>{p.vydajTyce
							? `${p.vydajTyce.pocet}×(${String(p.vydajTyce.tycMm / 1000).replace('.', ',')} m)`
							: '—'}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="card">
	<div class="sec">
		Komponenty (spojky, krytky) — {komponenty.length} typov
		<span class="badge wait">⏳ zatiaľ len typy</span>
	</div>
	<p class="sub noprint">
		Vyčítané z výkresov, ale <b>len TYPY</b> — počty a Money kódy čakajú na tabuľky od Dominika („—"
		pri počte). CAD kód je informatívny, <b>NIE</b> Money odpisový.
	</p>
	{#if komponenty.length === 0}
		<p class="sub" data-testid="komponenty-prazdne">
			Pre systém {vstup.system} zatiaľ nemáme vyčítané žiadne komponenty.
		</p>
	{:else}
		<table class="narez" data-testid="komponenty-tabulka">
			<thead>
				<tr><th>Typ</th><th>Kde sa používa</th><th>CAD kód</th><th>Počet ks</th></tr>
			</thead>
			<tbody>
				{#each komponenty as k (k.typ)}
					<tr>
						<td>{k.typ}{k.poznamka ? ` · ${k.poznamka}` : ''}</td>
						<td>{k.kdePouzity}</td>
						<td data-testid="komponent-kod">{k.kodCad ?? '—'}</td>
						<td data-testid="komponent-pocet"><b>{k.pocetKs ?? '—'}</b></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<div class="card">
	<div class="sec">Informatívne výpočty</div>
	<div data-testid="narez-informativne">
		<div class="row">
			<span>Predná svetlosť</span><b>{vysledok.informativne.prednaSvetlost} mm</b>
		</div>
		{#if vysledok.informativne.efektivnaSvetlost !== vysledok.informativne.prednaSvetlost}
			<div class="row" data-testid="info-efektivna-svetlost">
				<span>Efektívna svetlosť (výstuha 200×140: −60)</span>
				<b>{vysledok.informativne.efektivnaSvetlost} mm</b>
			</div>
		{/if}
		{#if vysledok.informativne.vystuhaProfil}
			<div class="row" data-testid="info-vystuha-profil">
				<span>Profil výstuhy</span><b>{vysledok.informativne.vystuhaProfil}</b>
			</div>
		{/if}
		<div class="row">
			<span>Predná noha (svetlosť + 15)</span><b>{vysledok.informativne.prednaNohaDlzka} mm</b>
		</div>
		<div class="row">
			<span>Zadná noha</span>
			<b
				>{vysledok.informativne.zadnaNohaDlzka === null
					? '— (na stenu)'
					: `${vysledok.informativne.zadnaNohaDlzka} mm`}</b
			>
		</div>
		<div class="row">
			<span>Rozostup predných nôh (dopočítaný)</span>
			<b
				>{vysledok.informativne.rozostupPrednychNoh === null
					? '—'
					: `${vysledok.informativne.rozostupPrednychNoh} mm`}</b
			>
		</div>
		<div class="row">
			<span>Počet priečok (max rozostup {MAX_ROZOSTUP_PRIECOK} mm)</span><b
				>{vysledok.informativne.pocetPriecok}</b
			>
		</div>
		<div class="row">
			<span>Výstuha medzi nohami (šírka − 280)</span>
			<b data-testid="vystuha-rez">{vysledok.informativne.vystuhaRezMm} mm</b>
		</div>
	</div>
	<p class="sub">
		Výstuha je informatívna — profil (Robust 250×110/230×110, Massive 200×140) a per-systém varianta
		(šírka − 2×noha) čakajú na potvrdenie.
	</p>
</div>

{#if vstup.strechaSklo || vstup.obvodoveZasklenie || vstup.zvodFrezovat}
	<div class="card">
		<div class="sec">Údaje zákazky (výkres) — informatívne</div>
		<div data-testid="narez-udaje-zakazky">
			{#if vstup.strechaSklo}
				<div class="row"><span>Strecha — sklo</span><b>{vstup.strechaSklo}</b></div>
			{/if}
			{#if vstup.obvodoveZasklenie}
				<div class="row"><span>Obvodové zasklenie</span><b>{vstup.obvodoveZasklenie}</b></div>
			{/if}
			<div class="row">
				<span>ZVOD — frézovanie SH</span>
				<b
					>{vstup.zvodFrezovat && vstup.zvodFrezovanieSHmm != null
						? `${vstup.zvodFrezovanieSHmm} mm`
						: 'nefrézovať'}</b
				>
			</div>
		</div>
		<p class="sub">
			Sklá sú informatívny údaj (Zasklenia má vlastný odpis); frézovanie zvodu je evidencia na
			výkrese, detail dopĺňa konštruktér.
		</p>
	</div>
{/if}

<div class="card">
	<div class="sec">
		Zatiaľ nepodporované (čaká na pravidlá)
		<span class="badge wait">⏳ {cakaPravidloCount}</span>
	</div>
	<!-- #233 — jedna krátka veta na položku; plné odôvodnenie zbalené v <details>
	     (default zbalené), aby to nebola stena textu -->
	<ul data-testid="narez-nepodporovane" class="nepodporovane-zoznam">
		{#each vysledok.nepodporovane as n (n.kratky)}
			<li style="margin:6px 0">
				<span class="nepodp-kratky">{n.kratky}</span>
				<details class="nazov-detail">
					<summary>Prečo</summary>
					<p class="sub" style="margin:4px 0 0">{n.detail}</p>
				</details>
			</li>
		{/each}
	</ul>
</div>

<style>
	/* #222 — stavové zhrnutie + stavový stĺpec (scoped v komponente #239). Reuse tokenov
	   z app.css, žiadny nový dizajnový jazyk. `table.narez` (zdieľaná) je v app.css. */
	.stav-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	@media (max-width: 640px) {
		.stav-grid {
			grid-template-columns: 1fr;
		}
	}
	.stav-blok {
		display: flex;
		align-items: center;
		gap: 12px;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 12px 14px;
	}
	.stav-blok.ok {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.stav-blok.wait {
		background: #fffbeb;
		border-color: #fde68a;
	}
	.stav-cislo {
		font-size: 32px;
		font-weight: 800;
		line-height: 1;
		min-width: 1.4em;
		text-align: center;
	}
	.stav-blok.ok .stav-cislo {
		color: #15803d;
	}
	.stav-blok.wait .stav-cislo {
		color: #b45309;
	}
	.stav-popis {
		font-size: 14px;
		color: #475569;
		line-height: 1.35;
	}
	/* stavové odznaky v nadpise sekcie — .sec je uppercase, badge nechať tak */
	.sec .badge {
		text-transform: none;
		letter-spacing: 0;
		vertical-align: middle;
		margin-left: 6px;
		font-size: 12px;
		font-weight: 700;
	}
	.stav-col {
		width: 96px;
		white-space: nowrap;
	}

	/* #233 — čistá bunka NÁZOV: hlavný názov + krátka šedá poznámka + rozklikávací detail;
	   „zatiaľ nepodporované" ako zoznam krátkych viet s rozklikom. Reuse tokenov, žiadny
	   nový dizajnový jazyk. */
	.nazov-hlavny {
		font-weight: 600;
	}
	.nazov-pozn {
		margin-top: 2px;
		font-size: 12.5px;
	}
	.nazov-detail {
		margin-top: 3px;
	}
	.nazov-detail summary {
		cursor: pointer;
		font-size: 12px;
		color: #64748b;
		width: fit-content;
	}
	.nepodporovane-zoznam {
		list-style: none;
		margin: 6px 0 0;
		padding-left: 0;
	}
	.nepodp-kratky {
		font-weight: 500;
	}
</style>
