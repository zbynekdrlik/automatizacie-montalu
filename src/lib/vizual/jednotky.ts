// Zákaznícky 3D náhľad (#170) — jednotková hranica. `DielSpec` (spec.ts) a
// `geo/**` sú VŽDY v mm (rovnaká jednotka ako appka všade inde — S_MIN/S_MAX,
// KolajnicaRucne, Klin…), three.js scéna je VŽDY v metroch. `mm()` je JEDINÉ
// miesto v celom `src/lib/vizual/**`, kde sa toto delenie robí — builder.ts ho
// volá pri stavbe geometrie, nič iné. Držať to na jednom mieste je to, čo robí
// `geo/**` testovateľné bez three.js a bez rizika, že niekde omylom zostane
// nezdelená mm hodnota v THREE priestore (alebo naopak).
export const mm = (v: number): number => v / 1000;
