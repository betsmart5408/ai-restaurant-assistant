# Unisce l'elenco OpenStreetMap con quello Foursquare in un elenco solo.
#
#   .\unisci-fonti.ps1              solo le zone turistiche (consigliato)
#   .\unisci-fonti.ps1 -Ovunque     anche i locali fuori zona
#
param(
    [switch]$Ovunque,
    [string]$Citta = "sydney"
)
$argomenti = @('--citta', $Citta)
if ($Ovunque) { $argomenti += '--ovunque' }
node prospezione/unisci-fonti.mjs @argomenti
