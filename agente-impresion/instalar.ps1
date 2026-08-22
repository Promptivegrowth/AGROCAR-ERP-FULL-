<#
    INSTALADOR DEL AGENTE DE IMPRESIÓN — AGROCAR ERP

    Qué hace, en una sola pasada:

      1. Compila el agente con el compilador de C# que ya trae Windows.
         No hay que instalar .NET, Node ni nada.
      2. Lo copia a la carpeta del usuario.
      3. Lo deja arrancando solo con Windows.
      4. Lo inicia y comprueba que responde.
      5. De paso corrige el puerto de la ticketera y su margen de papel.

    Cómo se usa: clic derecho sobre este archivo → "Ejecutar con PowerShell".
    Si Windows bloquea la ejecución, abrir PowerShell y correr:

        powershell -ExecutionPolicy Bypass -File .\instalar.ps1

    NO hace falta ser administrador para el agente. Solo para ajustar la
    impresora; si no se tienen permisos, esa parte se saltea y avisa.
#>

$ErrorActionPreference = 'Stop'

function Titulo($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Bien($t)   { Write-Host "  $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  $t" -ForegroundColor Yellow }
function Malo($t)   { Write-Host "  $t" -ForegroundColor Red }

$aqui     = Split-Path -Parent $MyInvocation.MyCommand.Path
$fuente   = Join-Path $aqui 'AgenteImpresion.cs'
$destino  = Join-Path $env:LOCALAPPDATA 'AgrocarERP'
$exe      = Join-Path $destino 'AgenteImpresionAgrocar.exe'
$impresora = 'POS-80-Series'

Write-Host "== Agente de impresion AGROCAR ==" -ForegroundColor White

# ── 1. Compilar ─────────────────────────────────────────────────────────────
Titulo '1. Compilando el agente'
if (-not (Test-Path $fuente)) { Malo "No se encontro AgenteImpresion.cs junto a este script."; Read-Host "`nEnter para salir"; exit 1 }

$csc = Get-ChildItem "$env:SystemRoot\Microsoft.NET\Framework64" -Directory -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending |
       ForEach-Object { Join-Path $_.FullName 'csc.exe' } |
       Where-Object { Test-Path $_ } |
       Select-Object -First 1

if (-not $csc) { Malo "No se encontro el compilador de C# de Windows."; Read-Host "`nEnter para salir"; exit 1 }

New-Item -ItemType Directory -Force -Path $destino | Out-Null

# Si ya estaba corriendo hay que cerrarlo: el exe queda bloqueado en uso
Get-Process -Name 'AgenteImpresionAgrocar' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

& $csc /nologo /target:winexe /out:"$exe" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "$fuente" | Out-Null
if (-not (Test-Path $exe)) { Malo "La compilacion fallo."; Read-Host "`nEnter para salir"; exit 1 }
Bien "compilado en $exe"

# ── 2. Arranque con Windows ─────────────────────────────────────────────────
Titulo '2. Dejandolo iniciar con Windows'
try {
    $clave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    New-ItemProperty -Path $clave -Name 'AgrocarAgenteImpresion' -Value "`"$exe`"" -PropertyType String -Force | Out-Null
    Bien 'listo: va a arrancar solo al iniciar sesion'
} catch {
    Aviso "no se pudo registrar el inicio automatico: $($_.Exception.Message)"
}

# ── 3. Iniciarlo ────────────────────────────────────────────────────────────
Titulo '3. Iniciando'
Start-Process -FilePath $exe -WindowStyle Hidden
Start-Sleep -Seconds 2

$ok = $false
try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:9123/ping' -TimeoutSec 6
    if ($r.ok) {
        $ok = $true
        Bien "respondiendo (version $($r.version))"
        Write-Host "  impresoras que ve:" -ForegroundColor Gray
        $r.impresoras | ForEach-Object { Write-Host "    - $_" -ForegroundColor Gray }
    }
} catch {
    Malo "el agente no responde en el puerto 9123"
    Aviso "revisar que ningun antivirus lo haya bloqueado"
}

# ── 4. Ajustes de la ticketera ──────────────────────────────────────────────
Titulo '4. Ajustando la ticketera'
$prn = Get-Printer -Name $impresora -ErrorAction SilentlyContinue
if (-not $prn) {
    Aviso "no hay ninguna impresora llamada '$impresora'; se saltea este paso"
} else {
    # El driver puede quedar apuntando a un puerto que ya no existe: cuando pasa,
    # todo trabajo entra en error y traba la cola sin dar un mensaje util.
    $usb = Get-PrinterPort | Where-Object { $_.Name -match '^USB\d+$' } | Select-Object -First 1
    if ($usb -and $prn.PortName -ne $usb.Name) {
        try {
            Set-Printer -Name $impresora -PortName $usb.Name -ErrorAction Stop
            Bien "puerto corregido: $($prn.PortName) -> $($usb.Name)"
        } catch { Aviso "no se pudo cambiar el puerto (hace falta ser administrador)" }
    } else {
        Bien "puerto correcto ($($prn.PortName))"
    }

    # Margen final del driver. Solo aplica cuando se imprime por el navegador;
    # con el agente el corte lo maneja el ticket. 15 mm y no menos: la cuchilla
    # esta unos 15 mm sobre el cabezal y por debajo de eso corta el contenido.
    try {
        Set-PrinterProperty -PrinterName $impresora -PropertyName 'Config:zjTrailingMargin' -Value 'zj15mm' -ErrorAction Stop
        Bien 'margen final del driver en 15 mm'
    } catch { Aviso 'no se pudo ajustar el margen (hace falta ser administrador)' }
}

# ── Cierre ──────────────────────────────────────────────────────────────────
Write-Host ""
if ($ok) {
    Write-Host "== Listo ==" -ForegroundColor Green
    Write-Host "En el ERP, al abrir un comprobante en formato Ticket, aparece el boton"
    Write-Host "'Imprimir en ticketera'. Si no aparece, recargar con Ctrl+F5."
} else {
    Write-Host "== Termino con problemas ==" -ForegroundColor Yellow
    Write-Host "El agente no respondio. Probar ejecutando a mano:"
    Write-Host "  $exe"
}
Read-Host "`nEnter para cerrar"
