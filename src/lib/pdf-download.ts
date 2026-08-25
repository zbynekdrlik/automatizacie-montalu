// Klientsky helper: stiahnutie PDF v prehliadači (base64 → Blob → programové stiahnutie cez
// dočasný `<a download>`). ČISTO browser (atob/Blob/URL/document) — žiadny server/katalóg/Money
// import, takže je bezpečný pre klientsky bundle (Money-neutralita cez import-graf guard A).
// Zdieľané medzi DopytForm (#277) a ObjednavkaForm (#319) — jeden zdroj tvaru (predtým bol
// byte-identický duplikát v oboch komponentoch, review 🔵 #319). Volajúci dodá konkrétny názov
// (z odpovede akcie); interný fallback je len obranná poistka.
export function stiahniPdf(base64: string, filename: string): void {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	const blob = new Blob([bytes], { type: 'application/pdf' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename || 'Montalu.pdf';
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
