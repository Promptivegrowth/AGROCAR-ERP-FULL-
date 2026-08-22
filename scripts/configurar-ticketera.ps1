<#
    CONFIGURAR TICKETERA POS-80 (driver ZJiang) — AGROCAR ERP

    Ejecutar UNA VEZ por computadora que tenga ticketera, con PowerShell
    ABIERTO COMO ADMINISTRADOR:

        powershell -ExecutionPolicy Bypass -File .\configurar-ticketera.ps1

    Qué corrige:

    1. El puerto. El driver puede quedar apuntando a un puerto que ya no
       existe (POS-80 PORT:) mientras la impresora responde en USB001. Cuando
       pasa, todo trabajo entra en "Error" y traba la cola, sin mensaje útil.

    2. El margen final. Estas ticketeras traen 30 mm de avance después de cada
       ticket, configurados dentro del driver y sin forma de verlos desde
       Windows. Ese es el papel en blanco que sobra.

       El valor se baja a 15 mm y NO menos: la cuchilla está unos 15 mm más
       arriba que el cabezal, así que por debajo de eso el papel se corta
       antes de terminar de imprimir y se pierde el pie del ticket. Se probó
       con 3 mm y cortaba el contenido.

    3. El corte entre documentos.

    Al final imprime cómo quedó todo para poder comparar entre máquinas.
#>

$ErrorActionPreference = 'Continue'
$nombre = 'POS-80-Series'   # cambiar si la impresora se llama distinto

Write-Host "== Configurando $nombre ==" -ForegroundColor Cyan

$impresora = Get-Printer -Name $nombre -ErrorAction SilentlyContinue
if (-not $impresora) {
    Write-Host "No se encontro una impresora llamada '$nombre'." -ForegroundColor Red
    Write-Host "Impresoras instaladas:" -ForegroundColor Yellow
    Get-Printer | Select-Object Name, PortName, PrinterStatus | Format-Table -AutoSize
    Write-Host "Edita la variable \$nombre al inicio de este archivo y volve a correrlo."
    exit 1
}

# ── 1. Puerto: apuntar al USB donde de verdad responde la impresora
$puertoUsb = Get-PrinterPort | Where-Object { $_.Name -match '^USB\d+$' } | Select-Object -First 1
if ($puertoUsb -and $impresora.PortName -ne $puertoUsb.Name) {
    Write-Host ("Puerto: {0} -> {1}" -f $impresora.PortName, $puertoUsb.Name) -ForegroundColor Yellow
    try {
        Get-PrintJob -PrinterName $nombre -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
        Set-Printer -Name $nombre -PortName $puertoUsb.Name -ErrorAction Stop
        Write-Host "  puerto corregido" -ForegroundColor Green
    } catch {
        Write-Host ("  no se pudo cambiar el puerto: " + $_.Exception.Message) -ForegroundColor Red
    }
} else {
    Write-Host ("Puerto: {0} (sin cambios)" -f $impresora.PortName)
}

# ── 2 y 3. Propiedades internas del driver
#
# El margen solo acepta esta lista cerrada: zj3mm, zj12mm, zj15mm, zj18mm,
# zj30mm. El corte acepta Option1, Option2 y Option4.
$ajustes = @{
    'Config:zjTrailingMargin'           = 'zj15mm'
    'Config:zjPrintTrailingMarginOrNot' = 'zjNotPrintTrailingMargin'
    'Config:zjPaperCutting'             = 'Option2'
}

foreach ($clave in $ajustes.Keys) {
    $valor = $ajustes[$clave]
    try {
        $antes = (Get-PrinterProperty -PrinterName $nombre -PropertyName $clave -ErrorAction Stop).Value
        if ($antes -eq $valor) {
            Write-Host ("{0}: {1} (sin cambios)" -f $clave, $valor)
        } else {
            Set-PrinterProperty -PrinterName $nombre -PropertyName $clave -Value $valor -ErrorAction Stop
            Write-Host ("{0}: {1} -> {2}" -f $clave, $antes, $valor) -ForegroundColor Green
        }
    } catch {
        Write-Host ("{0}: no disponible en este driver" -f $clave) -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "== Como quedo ==" -ForegroundColor Cyan
Get-Printer -Name $nombre | Format-List Name, PortName, PrinterStatus, JobCount
Get-PrinterProperty -PrinterName $nombre -ErrorAction SilentlyContinue |
    Format-Table PropertyName, Value -AutoSize

Write-Host "En el dialogo de impresion: Tamano de papel = Thermal Paper(80 x 210)," -ForegroundColor Cyan
Write-Host "Escala = 100 y Margenes = Predeterminado. No usar el de 3276." -ForegroundColor Cyan
