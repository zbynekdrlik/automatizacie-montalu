// Kódy profilov, ku ktorým máme rez z Money katalógu (static/profil/<KOD>.webp).
// Zoznam vygeneruje sync skript scripts/sync-profil-obrazky.sh; kód, ktorý tu
// nie je, jednoducho nemá obrázok (UI ho vynechá). Nie je runtime závislosť na
// Money — obrázky sú zabudované ako statické súbory.
export const PROFIL_S_OBRAZKOM = new Set<string>([
	'BPP00046', 'BPP00050', 'BPP00054', 'BPP00057', 'BPP00061', 'BPP00064',
	'BPP00068', 'BPP00072', 'BPP00076', 'BPP00079', 'BPP00083', 'BPP00087',
	'BPP00091', 'BPP00092', 'BPP00094', 'BPP00097', 'BPP202410', 'BPP202411',
	'BPP202412', 'BPP202414', 'BPP20245', 'BPP20249', 'BPP20254', 'BPP20255',
	'BPP20256', 'PRP00040', 'PRP00042', 'PRP00044', 'PRP00046', 'PRP00047',
	'PRP202410', 'PRP202411', 'PRP20242', 'PRP20243', 'PRP20244', 'PRP20246',
	'PRP20248', 'PRP202510', 'PRP20252', 'PRP202524', 'PRP202525', 'PRP202526',
	'PRP202528', 'PRP202529', 'PRP202530', 'PRP20254', 'PRP20255', 'PRP20256',
	'PRP20258', 'PRP20259', 'ZASP00002', 'ZASP00006', 'ZASP00010', 'ZASP00014',
	'ZASP00016', 'ZASP00018', 'ZASP00021', 'ZASP00024', 'ZASP00027', 'ZASP00030',
	'ZASP00033', 'ZASP00036', 'ZASP00078', 'ZASP00081', 'ZASP00084', 'ZASP00088',
	'ZASP00091', 'ZASP00097', 'ZASP00100', 'ZASP00104', 'ZASP00107', 'ZASP202410',
	'ZASP202411', 'ZASP202415', 'ZASP202416', 'ZASP202417', 'ZASP202419', 'ZASP202424',
	'ZASP202425', 'ZASP202432', 'ZASP202433', 'ZASP202434', 'ZASP202437', 'ZASP202438',
	'ZASP202439', 'ZASP20244', 'ZASP20249', 'ZASP20254'
]);

export const maObrazok = (kod: string): boolean => PROFIL_S_OBRAZKOM.has(kod);
export const obrazokUrl = (kod: string): string => `/profil/${kod}.webp`;
