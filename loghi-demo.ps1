# Prende il logo dal sito vero di ogni ristorante e lo mette nella sua demo.
#
#   .\loghi-demo.ps1                 tutte le demo che non hanno ancora un logo
#   .\loghi-demo.ps1 -Limite 20      prova su poche
#   .\loghi-demo.ps1 -Slug al-aseel  una sola
#   .\loghi-demo.ps1 -Rifai          rifà anche quelle che un logo ce l'hanno già
#
param(
    [int]$Limite,
    [string]$Slug = "",
    [switch]$Rifai
)
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

$argomenti = @()
if ($Limite) { $argomenti += @('--limite', "$Limite") }
if ($Slug)   { $argomenti += @('--slug', $Slug) }
if ($Rifai)  { $argomenti += '--rifai' }

node prospezione/loghi-demo.mjs @argomenti
