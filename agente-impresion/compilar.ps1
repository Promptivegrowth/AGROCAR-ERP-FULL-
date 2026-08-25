<#
    COMPILAR EL AGENTE DE IMPRESION - AGROCAR ERP
    Promptive - Luciernaga y Asociados S.A.C.

    Para que es:

    Produce el unico archivo que se le entrega al cliente:

        AgenteImpresionAgrocar.exe

    Ese archivo es a la vez el instalador y el agente. Quien lo recibe lo abre,
    pega el codigo de su computadora y aprieta Instalar: el programa se copia
    solo a donde corresponde, queda arrancando con Windows, acomoda la
    ticketera y se pone a trabajar al lado del reloj.

    Antes era al reves — se mandaba la carpeta entera y la persona tenia que
    ejecutar un script de PowerShell y editar un archivo de texto a mano.

    Compila con el compilador de C# que ya trae Windows, asi que no hace falta
    instalar nada para generarlo.

    Como se usa: clic derecho -> "Ejecutar con PowerShell".
#>

$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $aqui

function Bien($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Malo($t) { Write-Host "  --  $t" -ForegroundColor Red }

Write-Host ""
Write-Host "  Agente de impresion  -  AGROCAR ERP" -ForegroundColor White
Write-Host "  Promptive" -ForegroundColor DarkGray
Write-Host ""

# ── El compilador que ya viene con Windows ──────────────────────────────────
$csc = Get-ChildItem "$env:SystemRoot\Microsoft.NET\Framework64" -Directory -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending |
       ForEach-Object { Join-Path $_.FullName 'csc.exe' } |
       Where-Object { Test-Path $_ } |
       Select-Object -First 1

if (-not $csc) {
    Malo "No se encontro el compilador de C# de Windows (.NET Framework)."
    Read-Host "`nEnter para salir"
    exit 1
}

$exe = Join-Path $aqui 'AgenteImpresionAgrocar.exe'

# El .ico es para la ventana y la barra de tareas; el .png es el isotipo del
# encabezado. Van por separado porque el icono guarda medidas no cuadradas y
# estirarlo a 48x48 lo deja irreconocible.
$argumentos = @(
    '/nologo', '/target:winexe', "/out:$exe",
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    '/win32icon:promptive.ico',
    '/resource:promptive.ico,icono',
    '/resource:promptive.png,isotipo',
    'AgenteImpresion.cs', 'VentanaInstalacion.cs'
)

if (Test-Path $exe) { Remove-Item $exe -Force }
& $csc @argumentos

if (-not (Test-Path $exe)) {
    Malo "La compilacion fallo."
    Read-Host "`nEnter para salir"
    exit 1
}

$kb = [math]::Round((Get-Item $exe).Length / 1KB)
Bien "generado: AgenteImpresionAgrocar.exe ($kb KB)"

Write-Host ""
Write-Host "== Listo ==" -ForegroundColor Green
Write-Host "Ese es el unico archivo que hay que enviarle al cliente."
Write-Host ""
Write-Host "El cliente lo abre, pega el codigo de su computadora" -ForegroundColor Gray
Write-Host "-Configuracion > Impresion de tickets en el ERP- y listo." -ForegroundColor Gray
Write-Host ""
Read-Host "Enter para salir"
