# Toglie un ristorante doppione (quelli con lo slug vecchio "demo-...").
#
#   .\togli-doppione.ps1                 elenca quelli con lo slug vecchio
#   .\togli-doppione.ps1 -Slug demo-amalfi-restaurant-bondi-beach
#
param([string]$Slug)
if ($Slug) { node prospezione/togli-doppione.mjs $Slug }
else       { node prospezione/togli-doppione.mjs --elenco-demo-vecchie }
