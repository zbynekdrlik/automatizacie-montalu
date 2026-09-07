// Parser + validácia vstupu „Plán rezov" (#482) — univerzálny optimalizátor rezov
// z CAD tabuľky. Žije mimo +page.server.ts (nova-stranka §1). Čistý, Money-neutrálny.

/** Jeden riadok CAD plánu rezov — voľný profil, žiadne Money kódy. */
export interface PlanRezovRiadok {
	/** voľný názov profilu (napr. "10001 STABILIZAČNÝ PROFIL 100X50", "lat 80x19") */
	nazov: string;
	/** počet kusov */
	ks: number;
	/** dĺžka rezu (mm) */
	rezMm: number;
}

export interface PlanRezovVstup {
	/** dĺžka tyče (mm) — 6000 alebo 7500 */
	dlzkaTyce: number;
	/** rezná medzera (mm) — default 4 */
	reznaMedzera: number;
	/** parsované riadky z CAD tabuľky */
	riadky: PlanRezovRiadok[];
}

// Horné stropy — prevencia OOM (ffdPack rozbaľuje ks na kusy, O(n^2))
const MAX_RIADKOV = 5_000;
const MAX_KUSOV_SPOLU = 20_000; // rovnaký strop ako /optimalizator (ffdPack O(n^2))
const MAX_DLZKA_REZU = 1_000_000; // mm (1 km)

/** Číslo z textu: čiarka → bodka, medzery preč (napr. "6 000" → 6000, "2834,5" → 2834.5). */
function cislo(s: string): number {
	return Number(s.replace(',', '.').replace(/\s/g, ''));
}

/**
 * Parsuje voľný CAD plán rezov — tolerantný na poradie stĺpcov a rôzne formáty.
 *
 * Vstup: tab-separovaná alebo space-separovaná tabuľka, riadky:
 *   [číslo] <názov profilu> <ks> <rez mm> [ďalšie stĺpce ignorované]
 *
 * Tolerancie (vzor parseCad z pergola.ts):
 * - prvý stĺpec môže byť číslo profilu zlúčené s názvom (napr. "10001 STABILIZAČNÝ PROFIL")
 * - tab aj viacnásobný space ako oddeľovač
 * - medzery v názvoch zachované
 * - hlavičkové riadky (text bez čísiel) preskočené
 * - rezy aj ks akceptujú desatinnú čiarku
 */
export function parsePlanRezov(text: string): { riadky: PlanRezovRiadok[]; preskocene: string[] } {
	const riadky: PlanRezovRiadok[] = [];
	const preskocene: string[] = [];

	for (const raw of String(text).split('\n')) {
		const line = raw.replace('\r', '').trim();
		if (!line) continue;

		// tab-separovaný riadok
		if (line.includes('\t')) {
			const p = line.split(/\t+/).map((s) => s.trim());
			const parsed = parseTsvRiadok(p);
			if (parsed) {
				riadky.push(parsed);
			} else {
				preskocene.push(line);
			}
			continue;
		}

		// space-separovaný riadok — extrahuj čísla od konca
		const parsed = parseSpaceRiadok(line);
		if (parsed) {
			riadky.push(parsed);
		} else {
			preskocene.push(line);
		}
	}

	return { riadky, preskocene };
}

/**
 * Tab-separovaný riadok. Stĺpce môžu byť:
 *   Číslo Názov | ks | Rez [mm] | výdaj (m) — extra stĺpce ignorované
 *   Číslo | Názov | ks | Rez [mm] | ...
 * Heuristika: skenujeme od indexu 1 (index 0 = názov, môže obsahovať číslo ako
 * "10001 STABILIZAČNÝ PROFIL 100X50") a hľadáme PRVÝ pár susedných stĺpcov, kde
 * oba sú kladné čísla a prvý (ks) je celý. Stĺpce za rezom (výdaj materiálu) sa
 * ignorujú. Všetko pred ks stĺpcom je názov.
 */
function parseTsvRiadok(parts: string[]): PlanRezovRiadok | null {
	if (parts.length < 2) return null;

	// Hľadaj PRVÝ pár susedných číselných stĺpcov (ks, rez) skenovaním od indexu 1
	// (index 0 môže byť názov s číslom, napr. "10001 STABILIZAČNÝ PROFIL 100X50").
	// "ks" stĺpec musí byť pred "rez" stĺpcom (ks index = i, rez index = i+1).
	// Stĺpce ZA rezom (výdaj materiálu apod.) sa ignorujú.
	for (let i = 1; i < parts.length - 1; i++) {
		const ksRaw = parts[i]!.trim();
		const rezRaw = parts[i + 1]!.trim();
		if (!ksRaw || !rezRaw) continue;

		const ksVal = cislo(ksRaw);
		const rezVal = cislo(rezRaw);

		if (!Number.isFinite(ksVal) || ksVal <= 0) continue;
		if (!Number.isFinite(rezVal) || rezVal <= 0) continue;
		// ks musí byť celé číslo (počet kusov)
		if (Math.round(ksVal) !== ksVal) continue;

		const ks = Math.round(ksVal);
		const rezMm = rezVal;

		// Názov = všetko PRED stĺpcom ks, spojené medzerami
		const nazovParts: string[] = [];
		for (let j = 0; j < i; j++) {
			const s = parts[j]!.trim();
			if (s) nazovParts.push(s);
		}
		const nazov = nazovParts.join(' ').trim();
		if (!nazov) continue;

		return { nazov, ks, rezMm };
	}

	return null;
}

/**
 * Space-separovaný riadok. Posledné 2 tokeny musia byť čísla (ks, rez).
 * Všetko pred nimi je názov.
 */
function parseSpaceRiadok(line: string): PlanRezovRiadok | null {
	const tokens = line.split(/\s+/);
	if (tokens.length < 3) return null;

	const last = tokens[tokens.length - 1]!;
	const penultimate = tokens[tokens.length - 2]!;

	const rezMm = cislo(last);
	const ks = Math.round(cislo(penultimate));

	if (!Number.isFinite(rezMm) || rezMm <= 0) return null;
	if (!Number.isFinite(ks) || ks <= 0) return null;

	const nazov = tokens
		.slice(0, tokens.length - 2)
		.join(' ')
		.trim();
	if (!nazov) return null;

	return { nazov, ks, rezMm };
}

/** Validácia FormData → PlanRezovVstup + preskočené riadky, alebo chybová hláška. */
export function parsePlanRezovFormData(
	fd: FormData
): { vstup: PlanRezovVstup; preskocene: string[] } | { error: string } {
	const dlzkaTyceRaw = String(fd.get('dlzkaTyce') ?? '').trim();
	const dlzkaTyce = cislo(dlzkaTyceRaw);
	if (!Number.isFinite(dlzkaTyce) || dlzkaTyce <= 0) {
		return { error: 'Zadaj platnú dĺžku tyče (mm).' };
	}
	if (dlzkaTyce > MAX_DLZKA_REZU) {
		return { error: `Dĺžka tyče je príliš veľká (max ${MAX_DLZKA_REZU} mm).` };
	}

	const rmRaw = fd.get('reznaMedzera');
	const reznaMedzera = rmRaw === null || String(rmRaw).trim() === '' ? 4 : cislo(String(rmRaw));
	if (!Number.isFinite(reznaMedzera) || reznaMedzera < 0) {
		return { error: 'Rezná medzera musí byť číslo ≥ 0 (mm).' };
	}

	const cadText = String(fd.get('cad') ?? '').trim();
	if (!cadText) {
		return { error: 'Vlož CAD tabuľku (plán rezov).' };
	}
	if (cadText.length > 500_000) {
		return { error: 'Vstup je príliš veľký (max 500 000 znakov).' };
	}

	const { riadky, preskocene } = parsePlanRezov(cadText);

	if (riadky.length === 0) {
		const hint =
			preskocene.length > 0 ? ` Preskočené riadky: ${preskocene.slice(0, 3).join('; ')}` : '';
		return { error: `Nepodarilo sa nájsť žiadne platné riadky v tabuľke.${hint}` };
	}

	if (riadky.length > MAX_RIADKOV) {
		return { error: `Príliš veľa riadkov (max ${MAX_RIADKOV}).` };
	}

	// strop na celkový počet kusov (rozbalených)
	let spolu = 0;
	for (const r of riadky) {
		if (r.rezMm > MAX_DLZKA_REZU) {
			return {
				error: `Rez ${r.rezMm} mm profilu "${r.nazov}" je príliš veľký (max ${MAX_DLZKA_REZU} mm).`
			};
		}
		spolu += r.ks;
		if (spolu > MAX_KUSOV_SPOLU) {
			return { error: `Spolu príliš veľa kusov na výpočet (max ${MAX_KUSOV_SPOLU}).` };
		}
	}

	return { vstup: { dlzkaTyce, reznaMedzera, riadky }, preskocene };
}
