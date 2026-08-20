// Zasklenia — výpočet nárezového plánu a odpisu do Money.
// Port 1:1 z n8n verzie (n8n/zasklenia/zasklenia_node_body_v2.js), overenej proti
// pôvodným odpisovým Excelom (robust_slide.xlsm). Čísla sa NESMÚ zmeniť bez
// zmeny testovacích vektorov v tests/compute.test.ts.
//
// FASÁDA (#249): implementácia je rozdelená do compute-model.ts (zdieľané typy +
// jadro helperov), compute-profily.ts (profilové rezy + guardy + rail),
// compute-sietka.ts (moskytiéra) a compute-odpis.ts (computeFlat/Multi + safe*).
// Tento súbor iba re-exportuje verejné API, takže importy v routes/testoch
// (`$lib/server/compute`) sa nemenia. Layering: model ← profily ← sietka ← odpis.

export { BAR, KOTUC, buildCFG, ffdPack, validSys, inBounds, BOUNDS } from './compute-model';
export type {
	SysRow,
	RezRow,
	CfgGroup,
	Cfg,
	Kus,
	Tyc,
	MaterialRow,
	OdpisRow,
	ComputeResult
} from './compute-model';

export {
	oversizeCut,
	undersizeCut,
	missingHrubkaProfile,
	RAIL_UPSIZE,
	railUpsize,
	systemyRucnaKolajnica
} from './compute-profily';

export {
	jeSietkaMoneyRelevant,
	sietkaStandardExtra,
	sietkaSlideExtra,
	sietkaChyba,
	sietkaKolajnicaSwap,
	sietkaKolajnicaVzorecChyba,
	sietkaSamostatnaVypocet
} from './compute-sietka';
export type {
	ExtraRez,
	SietkaSamostatnaMaterialRow,
	SietkaSamostatnaOdpis
} from './compute-sietka';

export {
	computeFlat,
	zakladPoctov,
	safeCompute,
	buildPosuvSpec,
	computeMulti,
	safeComputeMulti
} from './compute-odpis';
export type { PosuvSpec, PosuvSpecInput, PosuvInfo, MultiResult } from './compute-odpis';
