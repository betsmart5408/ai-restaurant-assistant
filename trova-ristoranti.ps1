# Cerca i ristoranti delle zone turistiche elencate in prospezione/zone.json
# e li salva in prospezione/dati/ (CSV apribile con Excel + JSON per il passo dopo).
#
#   .\trova-ristoranti.ps1                                tutte le zone non ancora fatte (Sydney)
#   .\trova-ristoranti.ps1 -Zona bondi-beach              solo una zona
#   .\trova-ristoranti.ps1 -Tutto                         rifa' tutto da capo
#   .\trova-ristoranti.ps1 -Config zone-barcellona.json   un'altra citta'
#
param(
    [string]$Zona,
    [switch]$Tutto,
    [string]$Config
)
$argomenti = @()
if ($Zona)   { $argomenti += @('--zona', $Zona) }
if ($Tutto)  { $argomenti += '--tutto' }
if ($Config) { $argomenti += @('--config', $Config) }
node prospezione/trova-ristoranti.mjs @argomenti
