<#
    REVISAR Y REPARAR LAS IMPRESORAS DE ESTA COMPUTADORA
    Promptive - AGROCAR ERP

    Por que existe:

    Una version anterior del instalador del agente intentaba "arreglar" la
    ticketera: buscaba una impresora cuyo nombre tuviera "POS" u "80" y le
    cambiaba el puerto al primer USB que encontrara.

    Ese filtro era demasiado ancho. Una HP Smart Tank 580-590, por ejemplo,
    tiene "80" en el nombre: si aparecia primero, el instalador le cambiaba el
    puerto a una impresora A4 que estaba funcionando bien y la dejaba sin
    imprimir. El instalador ya no hace nada de eso.

    Este script no cambia nada por su cuenta. Muestra como esta cada impresora
    y, si encuentra alguna sospechosa, ofrece devolverla a su puerto original
    preguntando primero.

    Como se usa: clic derecho -> "Ejecutar con PowerShell".
#>

$ErrorActionPreference = 'Stop'

function Titulo($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Bien($t)   { Write-Host "  OK  $t" -ForegroundColor Green }
function Ojo($t)    { Write-Host "  !   $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Revision de impresoras  -  AGROCAR ERP" -ForegroundColor White
Write-Host "  Promptive" -ForegroundColor DarkGray

Titulo 'Impresoras instaladas'
$impresoras = Get-Printer
$impresoras | Select-Object Name, PortName, DriverName, PrinterStatus |
    Format-Table -AutoSize | Out-String -Width 200 | Write-Host

Titulo 'Revision'

# Una impresora de red o WSD que quedo apuntando a un puerto USB es la marca
# de lo que hacia el instalador viejo: esas nunca usan USB.
$sospechosas = $impresoras | Where-Object {
    $_.PortName -match '^USB\d+$' -and
    ($_.DriverName -match 'IPP|WSD|Network' -or $_.Name -match 'HP|EPSON|Canon|Brother|Samsung|Xerox')
}

if (-not $sospechosas) {
    Bien "ninguna impresora quedo apuntando a un puerto que no le corresponde"
} else {
    foreach ($p in $sospechosas) {
        Ojo "$($p.Name) esta en el puerto $($p.PortName), y por su driver no deberia"
        $candidatos = Get-PrinterPort | Where-Object {
            $_.Name -match '^WSD-' -or $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -or $_.Name -match '_'
        }
        if (-not $candidatos) {
            Write-Host "      No se encontro un puerto de red para devolverla." -ForegroundColor DarkGray
            Write-Host "      Se arregla desde Windows: Configuracion > Impresoras > $($p.Name)" -ForegroundColor DarkGray
            Write-Host "      > Propiedades de impresora > Puertos." -ForegroundColor DarkGray
            continue
        }
        Write-Host ""
        Write-Host "      Puertos disponibles para devolverla:" -ForegroundColor Gray
        $i = 1
        foreach ($c in $candidatos) { Write-Host "        $i) $($c.Name)"; $i++ }
        Write-Host "        0) dejarla como esta"
        $r = Read-Host "      Cual le corresponde"
        if ($r -match '^\d+$' -and [int]$r -ge 1 -and [int]$r -le $candidatos.Count) {
            $elegido = $candidatos[[int]$r - 1].Name
            try {
                Set-Printer -Name $p.Name -PortName $elegido -ErrorAction Stop
                Bien "$($p.Name) devuelta a $elegido"
            } catch {
                Ojo "no se pudo cambiar (hace falta ejecutar como administrador)"
            }
        }
    }
}

Titulo 'Trabajos atascados'
foreach ($p in $impresoras) {
    $t = @(Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue)
    if ($t.Count -gt 0) {
        Ojo "$($p.Name): $($t.Count) trabajo(s) en cola"
        $r = Read-Host "      Vaciar la cola de esta impresora? (s/n)"
        if ($r -eq 's') {
            $t | Remove-PrintJob -ErrorAction SilentlyContinue
            Bien "cola vaciada"
        }
    }
}

Write-Host ""
Write-Host "Listo. Si alguna impresora sigue sin funcionar, probar imprimir una" -ForegroundColor White
Write-Host "pagina de prueba desde Windows: eso separa el problema del ERP." -ForegroundColor White
Write-Host ""
Read-Host "Enter para salir"
