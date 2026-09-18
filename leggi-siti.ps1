# Visita i siti dei ristoranti trovati al passo 1 e cerca email, menu e lingue.
#
#   .\leggi-siti.ps1                        legge tutti quelli non ancora letti
#   .\leggi-siti.ps1 -Limite 30             prova su 30, per vedere come va
#   .\leggi-siti.ps1 -Riprova               ritenta solo quelli falliti
#   .\leggi-siti.ps1 -Rifai                 rilegge tutti da capo
#   .\leggi-siti.ps1 -Citta barcellona -MaxLingue 2 -Rifai
#                                            in paesi bilingui (Spagna) un sito
#                                            in 2 lingue e' comunque candidato
#
param(
    [int]$Limite,
    [switch]$Riprova,
    [switch]$Rifai,
    [string]$Citta = "sydney",
    [int]$MaxLingue
)
$argomenti = @('--citta', $Citta)
if ($Limite)    { $argomenti += @('--limite', "$Limite") }
if ($Riprova)   { $argomenti += '--riprova' }
if ($Rifai)     { $argomenti += '--rifai' }
if ($MaxLingue) { $argomenti += @('--max-lingue', "$MaxLingue") }
node prospezione/leggi-siti.mjs @argomenti
