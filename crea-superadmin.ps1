# Crea (o reimposta) l'accesso superadmin: quello che vede TUTTI i ristoranti.
#
#   .\crea-superadmin.ps1 -Email tua@email.com -Password LaTuaPassword
#
param(
    [Parameter(Mandatory=$true)][string]$Email,
    [Parameter(Mandatory=$true)][string]$Password
)
npm run crea-superadmin --workspace=packages/api -- $Email $Password
