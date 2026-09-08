# Legge la pagina del menu dei candidati e ne ricava la lista dei piatti.
#
#   .\estrai-menu.ps1 -Limite 5      prova su 5
#   .\estrai-menu.ps1                tutti i candidati (Groq gratis, ma lento: attese per il limite)
#   .\estrai-menu.ps1 -Claude        usa Claude invece di Groq: molto piu' veloce, ~1-2 cent a menu
#   .\estrai-menu.ps1 -AncheForse    include anche i "forse"
#   .\estrai-menu.ps1 -Rifai         rilegge quelli gia' fatti
#
param(
    [int]$Limite,
    [switch]$AncheForse,
    [switch]$Rifai,
    [switch]$Claude,
    [string]$Citta = "sydney"
)
$argomenti = @('--citta', $Citta)
if ($Limite)     { $argomenti += @('--limite', "$Limite") }
if ($AncheForse) { $argomenti += '--anche-forse' }
if ($Rifai)      { $argomenti += '--rifai' }
if ($Claude)     { $argomenti += '--claude' }
node prospezione/estrai-menu.mjs @argomenti
