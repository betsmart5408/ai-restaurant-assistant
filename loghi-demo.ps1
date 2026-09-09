# Prende il logo dal sito vero di ogni ristorante e lo mette nella sua demo,
# e adatta i colori della demo al logo.
#
#   .\loghi-demo.ps1                 tutte le demo che non hanno ancora un logo
#   .\loghi-demo.ps1 -Limite 20      prova su poche
#   .\loghi-demo.ps1 -Slug al-aseel  una sola
#   .\loghi-demo.ps1 -Rifai          rifà anche quelle che un logo ce l'hanno già
#   .\loghi-demo.ps1 -Riprendi       riprende un -Rifai interrotto (salta le ultime 36 h)
#   .\loghi-demo.ps1 -NoColori       prende solo il logo, non tocca i colori
#
param(
    [int]$Limite,
    [string]$Slug = "",
    [switch]$Rifai,
    [switch]$Riprendi,
    [switch]$NoColori
)
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

$argomenti = @()
if ($Limite)   { $argomenti += @('--limite', "$Limite") }
if ($Slug)     { $argomenti += @('--slug', $Slug) }
if ($Rifai)    { $argomenti += '--rifai' }
if ($Riprendi) { $argomenti += '--riprendi' }
if ($NoColori) { $argomenti += '--no-colori' }

node prospezione/loghi-demo.mjs @argomenti
