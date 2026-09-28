// #579: VÝREZ živého Odoo katalógu `montalu.glass.type` (read-only `search_read` z PROD 28.9.2026,
// 99 aktívnych typov) v DRÔTOVOM tvare JSON-2 (prázdne char polia = boolean `false`, #551).
// Obsahuje všetky typy hrúbok, ktoré nárezák ponúka (6/10/16/24 mm), negatívne hrúbky (4/8/44 mm)
// a dátovú chybu `total_thickness_mm = 0` (ESG Stopsol Classic Clear). POZOR na reálny duplicitný
// `cennik_code` „001" (Izolačné 4/8/4 16 mm AJ IZOS DOUBLE 4-16-4 AL 24 mm).
export interface OdooRow {
	name: string;
	category: string | false;
	cennik_code: string | false;
	composition: string | false;
	total_thickness_mm: number | false;
	pane_count: string | false;
}

const r = (
	total_thickness_mm: number | false,
	pane_count: string,
	category: string,
	name: string,
	cennik_code: string | false,
	composition: string | false
): OdooRow => ({ name, category, cennik_code, composition, total_thickness_mm, pane_count });

export const ODOO_KATALOG_579: OdooRow[] = [
	r(0, 'jednosklo', 'esg', 'ESG Stopsol Classic Clear', 'OP017E', false),
	r(4, 'jednosklo', 'rezane', 'Float čirý 4mm', 'OP001', '4'),
	r(4, 'jednosklo', 'esg', 'ESG Float čirý 4mm', 'OP001E', false),
	r(6, 'jednosklo', 'esg', 'ESG Float bronz/šedý 6mm', 'OP014E', false),
	r(6, 'jednosklo', 'esg', 'ESG Float čirý 6mm', 'OP003E', false),
	r(6, 'jednosklo', 'esg', 'ESG Stopsol Classic Clear 6mm', 'OP018E', false),
	r(6, 'jednosklo', 'rezane', 'Drôtené sklo 6mm', 'OP032', '6 drôtené'),
	r(6, 'jednosklo', 'rezane', 'Float bronz/šedý 6mm', 'OP014', '6 bronz'),
	r(6, 'jednosklo', 'rezane', 'Float čirý 6mm', 'OP003', '6'),
	r(6, 'jednosklo', 'vsg', 'VSG 33.1', 'OP033', '3+3 / 0.38mm PVB'),
	r(6, 'jednosklo', 'vsg', 'VSG 33.2', 'OP035', '3+3 / 0.76mm PVB'),
	r(8, 'jednosklo', 'esg', 'ESG Float čirý 8mm', 'OP004E', false),
	r(8, 'jednosklo', 'vsg', 'VSG 44.2', 'OP040', '4+4 / 0.76mm PVB'),
	r(10, 'jednosklo', 'esg', 'ESG Float bronz/šedý 10mm', 'OP016E', false),
	r(10, 'jednosklo', 'esg', 'ESG Float čirý 10mm', 'OP005E', false),
	r(10, 'jednosklo', 'rezane', 'Float čirý 10mm', 'OP005', '10'),
	r(10, 'jednosklo', 'vsg', 'VSG 55.2', 'OP045', '5+5 / 0.76mm PVB'),
	r(16, 'dvojsklo', 'izolacne', 'IZOS DOUBLE 3.3.1-6-4 (VSG)', false, '3.3.1 - 6 - 4'),
	r(16, 'dvojsklo', 'izolacne', 'IZOS DOUBLE 6-6-4', false, '6 - 6 - 4'),
	r(16, 'dvojsklo', 'izolacne', 'Izolačné sklo 4/8/4- číre (Ug=1,1)', '001', '4/8/4'),
	r(16, 'jednosklo', 'vsg', 'VSG 88.2', 'OP052', '8+8 / 0.76mm PVB'),
	r(24, 'dvojsklo', 'izolacne', 'IZOS DOUBLE 4-16-4 AL', '001', '4 - 16 - 4'),
	r(24, 'dvojsklo', 'izolacne', 'IZOS DOUBLE 4-16-4 TH', '003', '4 - 16 - 4'),
	r(24, 'dvojsklo', 'izolacne', 'IZOS DOUBLE 5ESG-14-5ESG', false, '5 ESG - 14 - 5 ESG'),
	r(44, 'trojsklo', 'izolacne', 'IZOS TRIPLE 4-16-4-16-4 AL', '002', '4 - 16 - 4 - 16 - 4')
];

/** Názvy typov, ktoré má Robust (24 mm) ponúknuť — všetky 24 mm typy z výrezu. */
export const ROBUST_24_MM = [
	'IZOS DOUBLE 4-16-4 AL',
	'IZOS DOUBLE 4-16-4 TH',
	'IZOS DOUBLE 5ESG-14-5ESG'
];
