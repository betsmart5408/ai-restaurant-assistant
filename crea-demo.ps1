# Costruisce la demo di un ristorante partendo dal menu gia' estratto.
#
#   .\crea-demo.ps1                              elenca i menu pronti
#   .\crea-demo.ps1 -Menu amalfi-restaurant-bondi-beach
#   .\crea-demo.ps1 -Menu amalfi-... -Rifai      la rifa' da capo
#
param(
    [string]$Menu,
    [switch]$Rifai,
    [string]$Sfondo,
    [string]$Primario
)
$argomenti = @()
if ($Menu)     { $argomenti += $Menu } else { $argomenti += '--elenco' }
if ($Rifai)    { $argomenti += '--rifai' }
if ($Sfondo)   { $argomenti += @('--sfondo', $Sfondo) }
if ($Primario) { $argomenti += @('--primario', $Primario) }
node prospezione/crea-demo.mjs @argomenti
