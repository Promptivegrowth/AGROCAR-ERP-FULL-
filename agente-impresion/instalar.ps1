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
$URL_ERP   = 'https://agrocar-erp-full.vercel.app'

Write-Host ""
Write-Host "   ____                      _   _           " -ForegroundColor Yellow
Write-Host "  |  _ \ _ __ ___  _ __ ___ | |_(_)_   _____ " -ForegroundColor Yellow
Write-Host "  | |_) | '__/ _ \| '_ \` _ \| __| \ \ / / _ \" -ForegroundColor Yellow
Write-Host "  |  __/| | | (_) | | | | | | |_| |\ V /  __/" -ForegroundColor Yellow
Write-Host "  |_|   |_|  \___/|_| |_| |_|\__|_| \_/ \___|" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Agente de impresion  -  AGROCAR ERP" -ForegroundColor White
Write-Host "  Promptive - Luciernaga y Asociados S.A.C." -ForegroundColor DarkGray

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

$icono = Join-Path $aqui 'promptive.ico'
$argsCsc = @('/nologo', '/target:winexe', "/out:$exe",
             '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll')
if (Test-Path $icono) { $argsCsc += "/win32icon:$icono" }
$argsCsc += $fuente
& $csc @argsCsc | Out-Null
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

# ── 3. Codigo de esta computadora ───────────────────────────────────────────
#
# El agente pregunta al ERP si hay tickets para ESTA computadora, y para eso
# necesita su codigo. Se saca del sistema, en Configuracion > Impresion de
# tickets, agregando la computadora y copiando el codigo.
Titulo '3. Codigo de esta computadora'

$config = Join-Path $destino 'agente.config'
$tokenActual = $null
if (Test-Path $config) {
    foreach ($l in Get-Content $config) {
        if ($l -match '^\s*token\s*=\s*(.+)$') { $tokenActual = $Matches[1].Trim() }
    }
}

if ($tokenActual) {
    Bien "ya estaba configurada (codigo $($tokenActual.Substring(0,8))...)"
} else {
    Write-Host "  Falta el codigo. Se obtiene asi:" -ForegroundColor Yellow
    Write-Host "    1. En el ERP: Configuracion > Impresion de tickets"
    Write-Host "    2. Agregar esta computadora con un nombre"
    Write-Host "    3. Copiar el codigo que aparece"
    Write-Host ""
    $tk = Read-Host "  Pegar el codigo aca (Enter para hacerlo despues)"
    if ($tk) {
        $tokenActual = $tk.Trim()
        # Si pegaron el bloque completo (url=...
token=...), se rescata el token
        if ($tokenActual -match 'token\s*=\s*([0-9a-fA-F-]{36})') { $tokenActual = $Matches[1] }
    }
}

if ($tokenActual) {
    $contenido = "# Agente de impresion AGROCAR - Promptive`r`n"
    $contenido += "url=$URL_ERP`r`n"
    $contenido += "token=$tokenActual`r`n"
    $contenido += "# impresora= (opcional: nombre exacto si hay mas de una ticketera)`r`n"
    Set-Content -Path $config -Value $contenido -Encoding UTF8
    Bien "configuracion guardada en $config"
}

# ── 4. Iniciarlo ────────────────────────────────────────────────────────────
Titulo '4. Iniciando'
Get-Process -Name 'AgenteImpresionAgrocar' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process -FilePath $exe -WindowStyle Hidden
Start-Sleep -Seconds 3

$ok = $false
$p = Get-Process -Name 'AgenteImpresionAgrocar' -ErrorAction SilentlyContinue
if ($p) { $ok = $true; Bien "corriendo (PID $($p.Id))" }
else { Malo "no se pudo iniciar"; Aviso "revisar que ningun antivirus lo haya bloqueado" }

# ── 5. Ajustes de la ticketera ──────────────────────────────────────────────
Titulo '5. Ajustando la ticketera'
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
    Write-Host "En el ERP, Configuracion > Impresion de tickets, esta computadora"
    Write-Host "deberia aparecer con un punto verde en menos de un minuto."
    Write-Host ""
    Write-Host "Desde ahi en adelante los tickets salen solos al facturar." -ForegroundColor White
    Write-Host ""
    Write-Host "El agente queda con su icono al lado del reloj. Doble clic ahi para" -ForegroundColor Gray
    Write-Host "ver su estado o cerrarlo." -ForegroundColor Gray
    Write-Host ""
    Write-Host "Soporte: Promptive" -ForegroundColor DarkGray
} else {
    Write-Host "== Termino con problemas ==" -ForegroundColor Yellow
    Write-Host "El agente no respondio. Probar ejecutando a mano:"
    Write-Host "  $exe"
}
Read-Host "`nEnter para cerrar"
