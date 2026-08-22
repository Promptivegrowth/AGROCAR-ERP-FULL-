<#
    HABILITAR LA CONEXIÓN DEL NAVEGADOR CON EL AGENTE — AGROCAR ERP
    Promptive

    Para qué es:

    Chrome y Edge bloquean que una página de internet —el ERP en vercel.app—
    se comunique con un programa que corre en la propia computadora. Es una
    protección razonable: evita que cualquier web ande hurgando en la red
    interna de quien la visita.

    El agente de impresión es justamente eso: un programa local. Por eso el
    navegador corta la conexión y el ERP termina imprimiendo por el camino
    viejo, con la ventana de Windows y desperdiciando papel.

    Este script agrega una excepción SOLO para el sistema de AGROCAR. El resto
    de las páginas siguen bloqueadas igual que antes.

    Cómo se usa: clic derecho → "Ejecutar con PowerShell", COMO ADMINISTRADOR.
    Después hay que cerrar por completo el navegador y volver a abrirlo.
#>

$ErrorActionPreference = 'Continue'

$ORIGEN = 'https://agrocar-erp-full.vercel.app'

function Bien($t)  { Write-Host "  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Malo($t)  { Write-Host "  $t" -ForegroundColor Red }

Write-Host ""
Write-Host "  Habilitar impresion directa  -  AGROCAR ERP" -ForegroundColor White
Write-Host "  Promptive" -ForegroundColor DarkGray
Write-Host ""

# ── Comprobar permisos ──────────────────────────────────────────────────────
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Malo "Hay que ejecutarlo como administrador."
    Write-Host ""
    Write-Host "  Clic derecho sobre el archivo -> Ejecutar con PowerShell," -ForegroundColor Yellow
    Write-Host "  o abrir Terminal (Administrador) y correr:" -ForegroundColor Yellow
    Write-Host "    powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -ForegroundColor Gray
    Read-Host "`nEnter para cerrar"
    exit 1
}

# ── Aplicar la excepción en los dos navegadores ─────────────────────────────
#
# Se usan dos políticas porque cambiaron de nombre entre versiones y conviene
# cubrir ambas: la vieja permite el pedido, la nueva lo permite por origen.
$politicas = @(
    @{ Nombre = 'Microsoft Edge'; Ruta = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' },
    @{ Nombre = 'Google Chrome';  Ruta = 'HKLM:\SOFTWARE\Policies\Google\Chrome'  }
)

foreach ($p in $politicas) {
    try {
        if (-not (Test-Path $p.Ruta)) { New-Item -Path $p.Ruta -Force | Out-Null }

        # Permitir que este origen hable con programas de la computadora
        $lista = Join-Path $p.Ruta 'InsecurePrivateNetworkRequestsAllowedForUrls'
        if (-not (Test-Path $lista)) { New-Item -Path $lista -Force | Out-Null }
        New-ItemProperty -Path $lista -Name '1' -Value $ORIGEN -PropertyType String -Force | Out-Null

        # Y permitir contenido no seguro solo para este origen: el agente
        # atiende en http porque un programa local no puede tener certificado.
        $mixto = Join-Path $p.Ruta 'InsecureContentAllowedForUrls'
        if (-not (Test-Path $mixto)) { New-Item -Path $mixto -Force | Out-Null }
        New-ItemProperty -Path $mixto -Name '1' -Value $ORIGEN -PropertyType String -Force | Out-Null

        Bien "$($p.Nombre): habilitado para $ORIGEN"
    } catch {
        Aviso "$($p.Nombre): no se pudo aplicar ($($_.Exception.Message))"
    }
}

Write-Host ""
Write-Host "  Listo. Ahora:" -ForegroundColor Cyan
Write-Host "   1. Cerrar POR COMPLETO el navegador y la aplicacion de AGROCAR."
Write-Host "      (que no quede ninguna ventana abierta)"
Write-Host "   2. Volver a abrir el sistema."
Write-Host "   3. Entrar a Configuracion > Impresion de tickets y probar."
Write-Host ""
Write-Host "  Si sigue sin funcionar, revisar en el navegador la direccion" -ForegroundColor Gray
Write-Host "  edge://policy (o chrome://policy) que la politica figure aplicada." -ForegroundColor Gray
Read-Host "`nEnter para cerrar"
