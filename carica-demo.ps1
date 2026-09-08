# Carica nel prodotto i menu della prospezione come ristoranti DEMO.
# Da lanciare dopo .\aggiorna-database.ps1 (serve la migrazione 011).
#
#   .\carica-demo.ps1                    tutti i menu con almeno 8 piatti (prezzi non richiesti)
#   .\carica-demo.ps1 -SoloNuovi         SOLO i menu non ancora nel database (non tocca gli esistenti)
#   .\carica-demo.ps1 -SoloConPrezzi     conta solo i piatti che hanno un prezzo
#   .\carica-demo.ps1 -Slug al-aseel     uno solo
#   .\carica-demo.ps1 -Elenco            mostra le demo gia' caricate e i loro link
#   .\carica-demo.ps1 -CancellaTutte     toglie tutte le demo (i clienti veri non si toccano)
#   .\carica-demo.ps1 -Forza             rifa' anche le demo con traduzioni scritte a mano
#                                        (ATTENZIONE: quelle traduzioni vanno perse)
#
param(
    [string]$Slug = "",
    [int]$Minimo = 8,
    [switch]$Elenco,
    [switch]$CancellaTutte,
    [switch]$SoloConPrezzi,
    [switch]$SoloNuovi,
    [switch]$Forza
)
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

$argomenti = @('--minimo', "$Minimo")
if ($Slug)             { $argomenti += @('--slug', $Slug) }
if ($Elenco)           { $argomenti += '--elenco' }
if ($CancellaTutte)    { $argomenti += '--cancella-tutte' }
if ($SoloConPrezzi)    { $argomenti += '--solo-con-prezzi' }
if ($SoloNuovi)        { $argomenti += '--solo-nuovi' }
if ($Forza)            { $argomenti += '--forza' }

npm run carica-demo --workspace=packages/api -- @argomenti
