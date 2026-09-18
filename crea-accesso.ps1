# Crea (o reimposta) un accesso alla dashboard.
#
#   .\crea-accesso.ps1 <slug> <email> <password> [ruolo]
#
# Esempi:
#   .\crea-accesso.ps1 gusto-alcazabilla titolare@gusto.es MiaPassword123
#   .\crea-accesso.ps1 gusto-alcazabilla io@miamail.com MiaPassword123 superadmin
#
# Ruoli: owner (predefinito, vede solo il suo ristorante)
#        superadmin (vede tutti i ristoranti e ne crea di nuovi)
param(
    [Parameter(Mandatory=$true)][string]$Slug,
    [Parameter(Mandatory=$true)][string]$Email,
    [Parameter(Mandatory=$true)][string]$Password,
    [string]$Ruolo = "owner"
)
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\pippo\Desktop\AI Restaurant Assistant"
npm run crea-utente --workspace=packages/api -- $Slug $Email $Password $Ruolo
Read-Host "Premi INVIO per chiudere"
