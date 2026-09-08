# Traduce i menu di TUTTE le demo caricate, una per volta, con il traduttore
# del prodotto (le traduzioni finiscono nella tabella dish_translations).
# Si puo' fermare e rilanciare: salta cio' che e' gia' tradotto.
#
#   .\traduci-demo.ps1                       tutte le demo (Groq gratis / MyMemory, lento)
#   .\traduci-demo.ps1 -Claude              tutte le demo con Claude: veloce, ~5-8 cent a menu
#   .\traduci-demo.ps1 -Slug al-aseel        una sola
#   .\traduci-demo.ps1 -Lingue "zh,ja,ar"    solo alcune lingue
#
param(
    [string]$Slug = "",
    [string]$Lingue = "",
    [switch]$Claude
)
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"

if ($Slug) {
    $slugs = @($Slug)
} else {
    $slugs = npm run carica-demo --workspace=packages/api -- --slug-list 2>$null |
             Where-Object { $_ -match '^[a-z0-9][a-z0-9-]*$' }
}

if (-not $slugs) {
    Write-Host "Nessuna demo da tradurre. Lancia prima .\carica-demo.ps1" -ForegroundColor Yellow
    return
}

Write-Host ""
Write-Host "$($slugs.Count) demo da tradurre. L'originale e' l'inglese." -ForegroundColor Cyan
if ($Claude) { Write-Host "Motore: Claude" -ForegroundColor Cyan }
Write-Host ""

$i = 0
foreach ($s in $slugs) {
    $i++
    Write-Host "[$i/$($slugs.Count)] -- $s" -ForegroundColor DarkGray
    $extra = @($s, 'en')
    if ($Lingue) { $extra += $Lingue } else { $extra += '' }
    if ($Claude) { $extra += '--claude' }
    npm run translate --workspace=packages/api -- @extra
}

Write-Host ""
Write-Host "Fatto. I link sono gia' vivi: .\carica-demo.ps1 -Elenco" -ForegroundColor Yellow
