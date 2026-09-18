# Cerca i ristoranti su Foursquare OS Places (alternativa a OpenStreetMap).
#
#   .\trova-foursquare.ps1 -Prova        prima prova: solo 20 righe
#   .\trova-foursquare.ps1               tutta la zona di Sydney + confronto con OSM
#   .\trova-foursquare.ps1 -Citta melbourne -Riquadro "-38.0,144.8,-37.7,145.1"
#   .\trova-foursquare.ps1 -Citta barcellona -Riquadro "41.37,2.14,41.41,2.20" -Config zone-barcellona.json
#
param(
    [switch]$Prova,
    [string]$Citta = "sydney",
    [string]$Riquadro,
    [string]$Config
)
$argomenti = @('--citta', $Citta)
if ($Prova)    { $argomenti += '--prova' }
if ($Riquadro) { $argomenti += @('--riquadro', $Riquadro) }
if ($Config)   { $argomenti += @('--config', $Config) }
node prospezione/trova-foursquare.mjs @argomenti
