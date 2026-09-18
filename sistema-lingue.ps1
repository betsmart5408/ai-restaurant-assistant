# Allinea le lingue dichiarate da ogni ristorante a quelle davvero tradotte.
#
#   .\sistema-lingue.ps1            mostra cosa cambierebbe, senza toccare niente
#   .\sistema-lingue.ps1 -Applica   lo fa davvero
#
param([switch]$Applica)
if ($Applica) { node prospezione/sistema-lingue.mjs --applica }
else          { node prospezione/sistema-lingue.mjs }
