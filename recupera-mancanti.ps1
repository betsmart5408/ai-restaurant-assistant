# Rimette in gioco i ristoranti scartati per poco: usa le email che avevamo
# gia' in OpenStreetMap o Foursquare per chi non la pubblica sul sito.
# Non visita nessun sito e non usa internet.
#
#   .\recupera-mancanti.ps1            recupera e salva
#   .\recupera-mancanti.ps1 -Prova     mostra cosa farebbe, senza salvare
#
param(
    [switch]$Prova,
    [string]$Citta = "sydney"
)
$argomenti = @('--citta', $Citta)
if ($Prova) { $argomenti += '--prova' }
node prospezione/recupera-mancanti.mjs @argomenti
