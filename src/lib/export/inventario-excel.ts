import ExcelJS from 'exceljs'

export interface InventarioRow {
  codigo: string
  nombre: string
  descripcion: string | null
  familia: string | null
  unidad: string | null
  stock_fisico: number
  stock_reservado: number
  stock_disponible: number
  stock_minimo: number | null
  stock_maximo: number | null
  costo_promedio: number
  // Calculados del rango de fechas de ventas (pueden ser null si no hubo ventas)
  precio_venta_promedio: number | null
  unidades_vendidas: number
  ingreso_vendido: number
  valor_total: number
  alerta: 'bajo' | 'sobre' | 'ok' | 'sin'
  ultima_actualizacion: string | null
}

export interface InventarioExportData {
  empresa: {
    razon_social: string
    ruc: string
    direccion: string
  }
  almacen: {
    nombre: string
    direccion: string
  }
  fecha: string
  generadoPor: string
  rango: { desde: string; hasta: string; label: string }
  rows: InventarioRow[]
  filtros: { familia: string | null; estado: string | null; busqueda: string | null }
}

const AGROCAR_AMARILLO = 'FFFBE600'
const AGROCAR_NEGRO = 'FF000000'
const GRIS_CLARO = 'FFF3F4F6'
const ROJO_BAJO = 'FFFECACA'
const VERDE_OK = 'FFD1FAE5'
const AMBAR_SOBRE = 'FFFEF3C7'
const AZUL_VENTAS = 'FFDBEAFE'

export async function generarExcelInventario(data: InventarioExportData): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AGROCAR ERP'
  wb.created = new Date()
  wb.title = `Inventario AGROCAR ${data.fecha}`

  const sheet = wb.addWorksheet('Inventario', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { defaultRowHeight: 15 },
  })

  // 15 columnas: A..O
  const LAST = 'O'

  // ── Cabecera (filas 1-6)
  sheet.mergeCells(`A1:${LAST}1`)
  const titulo = sheet.getCell('A1')
  titulo.value = 'AGROCAR S.R.L.'
  titulo.font = { name: 'Arial', size: 22, bold: true, color: { argb: AGROCAR_NEGRO } }
  titulo.alignment = { vertical: 'middle', horizontal: 'center' }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGROCAR_AMARILLO } }
  sheet.getRow(1).height = 32

  sheet.mergeCells(`A2:${LAST}2`)
  const sub = sheet.getCell('A2')
  sub.value = 'REPORTE DE INVENTARIO Y VENTAS'
  sub.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  sub.alignment = { vertical: 'middle', horizontal: 'center' }
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGROCAR_NEGRO } }
  sheet.getRow(2).height = 22

  // Empresa + fecha (fila 3)
  sheet.mergeCells('A3:H3')
  sheet.getCell('A3').value = `RUC: ${data.empresa.ruc}  ·  ${data.empresa.razon_social}`
  sheet.getCell('A3').font = { name: 'Arial', size: 10, italic: true }

  sheet.mergeCells(`I3:${LAST}3`)
  sheet.getCell('I3').value = `Fecha de emisión: ${data.fecha}`
  sheet.getCell('I3').font = { name: 'Arial', size: 10, italic: true }
  sheet.getCell('I3').alignment = { horizontal: 'right' }

  // Dirección + generador (fila 4)
  sheet.mergeCells('A4:H4')
  sheet.getCell('A4').value = data.empresa.direccion
  sheet.getCell('A4').font = { name: 'Arial', size: 9, color: { argb: 'FF6B7280' } }

  sheet.mergeCells(`I4:${LAST}4`)
  sheet.getCell('I4').value = `Generado por: ${data.generadoPor}`
  sheet.getCell('I4').font = { name: 'Arial', size: 9, color: { argb: 'FF6B7280' } }
  sheet.getCell('I4').alignment = { horizontal: 'right' }

  // Almacén (fila 5)
  sheet.mergeCells(`A5:${LAST}5`)
  sheet.getCell('A5').value = `Almacén: ${data.almacen.nombre}${data.almacen.direccion ? ' — ' + data.almacen.direccion : ''}`
  sheet.getCell('A5').font = { name: 'Arial', size: 10, bold: true }
  sheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } }
  sheet.getRow(5).height = 20

  // Rango de ventas (fila 6) — destacado en azul porque es el dato clave
  sheet.mergeCells(`A6:${LAST}6`)
  sheet.getCell('A6').value = `Precio de venta promedio calculado en base a las ventas reales del período: ${data.rango.label}`
  sheet.getCell('A6').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E40AF' } }
  sheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_VENTAS } }
  sheet.getCell('A6').alignment = { horizontal: 'center' }
  sheet.getRow(6).height = 20

  // Filtros aplicados (fila 7)
  const filtros: string[] = []
  if (data.filtros.familia) filtros.push(`Familia: ${data.filtros.familia}`)
  if (data.filtros.estado) filtros.push(`Estado: ${data.filtros.estado}`)
  if (data.filtros.busqueda) filtros.push(`Búsqueda: "${data.filtros.busqueda}"`)
  sheet.mergeCells(`A7:${LAST}7`)
  sheet.getCell('A7').value = filtros.length > 0 ? `Filtros: ${filtros.join('  ·  ')}` : 'Sin filtros aplicados'
  sheet.getCell('A7').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } }
  sheet.getRow(7).height = 16

  // Fila vacía (8)
  sheet.getRow(8).height = 6

  // ── Encabezado de tabla (fila 9)
  const headerRow = sheet.getRow(9)
  const headers = [
    { col: 'A', label: 'CÓDIGO', width: 14 },
    { col: 'B', label: 'PRODUCTO', width: 36 },
    { col: 'C', label: 'FAMILIA', width: 18 },
    { col: 'D', label: 'UM', width: 8 },
    { col: 'E', label: 'STOCK FÍSICO', width: 13 },
    { col: 'F', label: 'RESERVADO', width: 12 },
    { col: 'G', label: 'DISPONIBLE', width: 13 },
    { col: 'H', label: 'MÍN.', width: 8 },
    { col: 'I', label: 'MÁX.', width: 8 },
    { col: 'J', label: 'COSTO PROM.', width: 13 },
    { col: 'K', label: 'PRECIO VENTA PROM.', width: 16 },
    { col: 'L', label: 'UNID. VENDIDAS', width: 13 },
    { col: 'M', label: 'INGRESO PERÍODO', width: 15 },
    { col: 'N', label: 'VALOR INVENTARIO', width: 16 },
    { col: 'O', label: 'ESTADO', width: 14 },
  ]
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h.label
    sheet.getColumn(i + 1).width = h.width
  })
  headerRow.height = 32
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: AGROCAR_NEGRO } }
    // K, L, M (precio venta prom, unidades, ingreso) → azul claro para diferenciar
    const isVentas = colNumber === 11 || colNumber === 12 || colNumber === 13
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isVentas ? AZUL_VENTAS : AGROCAR_AMARILLO },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'medium', color: { argb: AGROCAR_NEGRO } },
      bottom: { style: 'medium', color: { argb: AGROCAR_NEGRO } },
      left: { style: 'thin', color: { argb: AGROCAR_NEGRO } },
      right: { style: 'thin', color: { argb: AGROCAR_NEGRO } },
    }
  })

  // ── Datos
  let totalValor = 0
  let totalStockFisico = 0
  let totalReservado = 0
  let totalDisponible = 0
  let totalUnidadesVendidas = 0
  let totalIngresoVendido = 0
  let bajos = 0
  let sobres = 0
  let sinStock = 0
  let sinVentas = 0

  data.rows.forEach((r, idx) => {
    const row = sheet.getRow(10 + idx)
    row.getCell(1).value = r.codigo
    row.getCell(2).value = r.descripcion?.trim() || r.nombre
    row.getCell(3).value = r.familia ?? '—'
    row.getCell(4).value = r.unidad ?? '—'
    row.getCell(5).value = r.stock_fisico
    row.getCell(6).value = r.stock_reservado
    row.getCell(7).value = r.stock_disponible
    row.getCell(8).value = r.stock_minimo ?? '—'
    row.getCell(9).value = r.stock_maximo ?? '—'
    row.getCell(10).value = r.costo_promedio
    // Precio venta promedio del rango
    if (r.precio_venta_promedio != null && r.precio_venta_promedio > 0) {
      row.getCell(11).value = r.precio_venta_promedio
    } else {
      row.getCell(11).value = 'Sin ventas'
      sinVentas++
    }
    row.getCell(12).value = r.unidades_vendidas
    row.getCell(13).value = r.ingreso_vendido
    row.getCell(14).value = r.valor_total
    row.getCell(15).value = (
      r.alerta === 'bajo' ? 'BAJO MÍNIMO' :
      r.alerta === 'sobre' ? 'SOBRE MÁXIMO' :
      r.alerta === 'sin' ? 'SIN STOCK' : 'OK'
    )

    totalValor += r.valor_total
    totalStockFisico += r.stock_fisico
    totalReservado += r.stock_reservado
    totalDisponible += r.stock_disponible
    totalUnidadesVendidas += r.unidades_vendidas
    totalIngresoVendido += r.ingreso_vendido
    if (r.alerta === 'bajo') bajos++
    if (r.alerta === 'sobre') sobres++
    if (r.alerta === 'sin') sinStock++

    // Formato
    row.getCell(1).font = { name: 'Arial', size: 9, color: { argb: 'FF6B7280' } }
    row.getCell(2).font = { name: 'Arial', size: 10 }
    row.getCell(3).font = { name: 'Arial', size: 9, color: { argb: 'FF6B7280' } }
    ;[5, 6, 7, 8, 9].forEach((c) => {
      row.getCell(c).numFmt = '#,##0.00'
      row.getCell(c).alignment = { horizontal: 'right' }
      row.getCell(c).font = { name: 'Arial', size: 10 }
    })
    row.getCell(10).numFmt = '"S/" #,##0.0000'
    row.getCell(10).alignment = { horizontal: 'right' }
    // K: precio venta prom — solo si es número
    if (typeof row.getCell(11).value === 'number') {
      row.getCell(11).numFmt = '"S/" #,##0.0000'
    } else {
      row.getCell(11).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF9CA3AF' } }
    }
    row.getCell(11).alignment = { horizontal: 'right' }
    row.getCell(11).font = { ...(row.getCell(11).font ?? {}), bold: typeof row.getCell(11).value === 'number' }
    // L: unidades vendidas
    row.getCell(12).numFmt = '#,##0.00'
    row.getCell(12).alignment = { horizontal: 'right' }
    // M: ingreso del período
    row.getCell(13).numFmt = '"S/" #,##0.00'
    row.getCell(13).alignment = { horizontal: 'right' }
    row.getCell(13).font = { name: 'Arial', size: 10, color: { argb: 'FF1E40AF' } }
    // N: valor inventario
    row.getCell(14).numFmt = '"S/" #,##0.00'
    row.getCell(14).alignment = { horizontal: 'right' }
    row.getCell(14).font = { name: 'Arial', size: 10, bold: true }

    // Color de estado (col 15)
    const stateCell = row.getCell(15)
    stateCell.alignment = { horizontal: 'center' }
    stateCell.font = { name: 'Arial', size: 9, bold: true }
    if (r.alerta === 'bajo' || r.alerta === 'sin') {
      stateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BAJO } }
      stateCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFB91C1C' } }
    } else if (r.alerta === 'sobre') {
      stateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBAR_SOBRE } }
      stateCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF92400E' } }
    } else {
      stateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_OK } }
      stateCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF065F46' } }
    }

    // Bordes y alternancia
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
    if (idx % 2 === 1) {
      ;[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].forEach((c) => {
        if (!row.getCell(c).fill) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
        }
      })
    }
  })

  // ── Totales
  const totalRowIdx = 10 + data.rows.length
  const totalRow = sheet.getRow(totalRowIdx)
  totalRow.getCell(1).value = 'TOTALES'
  sheet.mergeCells(`A${totalRowIdx}:D${totalRowIdx}`)
  totalRow.getCell(1).font = { name: 'Arial', size: 11, bold: true }
  totalRow.getCell(1).alignment = { horizontal: 'right' }
  totalRow.getCell(5).value = totalStockFisico
  totalRow.getCell(6).value = totalReservado
  totalRow.getCell(7).value = totalDisponible
  totalRow.getCell(12).value = totalUnidadesVendidas
  totalRow.getCell(13).value = totalIngresoVendido
  totalRow.getCell(14).value = totalValor
  ;[5, 6, 7, 12].forEach((c) => {
    totalRow.getCell(c).numFmt = '#,##0.00'
    totalRow.getCell(c).alignment = { horizontal: 'right' }
    totalRow.getCell(c).font = { name: 'Arial', size: 11, bold: true }
  })
  totalRow.getCell(13).numFmt = '"S/" #,##0.00'
  totalRow.getCell(13).alignment = { horizontal: 'right' }
  totalRow.getCell(13).font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1E40AF' } }
  totalRow.getCell(14).numFmt = '"S/" #,##0.00'
  totalRow.getCell(14).alignment = { horizontal: 'right' }
  totalRow.getCell(14).font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF065F46' } }
  totalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGROCAR_AMARILLO } }
    cell.border = {
      top: { style: 'medium', color: { argb: AGROCAR_NEGRO } },
      bottom: { style: 'medium', color: { argb: AGROCAR_NEGRO } },
      left: { style: 'thin', color: { argb: AGROCAR_NEGRO } },
      right: { style: 'thin', color: { argb: AGROCAR_NEGRO } },
    }
  })
  totalRow.height = 24

  // ── Resumen final
  const resumenIdx = totalRowIdx + 2
  sheet.mergeCells(`A${resumenIdx}:${LAST}${resumenIdx}`)
  const resCell = sheet.getCell(`A${resumenIdx}`)
  resCell.value = 'RESUMEN'
  resCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } }
  resCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AGROCAR_NEGRO } }
  resCell.alignment = { horizontal: 'center' }
  sheet.getRow(resumenIdx).height = 22

  const stats: Array<[string, string | number, string, string]> = [
    ['Productos totales', data.rows.length, 'FFFFFFFF', AGROCAR_NEGRO],
    ['Sin stock', sinStock, 'FFB91C1C', ROJO_BAJO],
    ['Bajo mínimo', bajos, 'FFB91C1C', ROJO_BAJO],
    ['Sobre máximo', sobres, 'FF92400E', AMBAR_SOBRE],
    ['Sin ventas en el período', sinVentas, 'FF6B7280', GRIS_CLARO],
    ['Ingreso por ventas del período', `S/ ${totalIngresoVendido.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`, 'FF1E40AF', AZUL_VENTAS],
    ['Valor total inventario', `S/ ${totalValor.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`, 'FF065F46', VERDE_OK],
  ]
  stats.forEach(([label, value, txtColor, bgColor], i) => {
    const r = sheet.getRow(resumenIdx + 1 + i)
    sheet.mergeCells(`A${resumenIdx + 1 + i}:H${resumenIdx + 1 + i}`)
    sheet.mergeCells(`I${resumenIdx + 1 + i}:${LAST}${resumenIdx + 1 + i}`)
    r.getCell(1).value = label
    r.getCell(1).font = { name: 'Arial', size: 10 }
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
    r.getCell(1).alignment = { horizontal: 'left', indent: 1 }
    r.getCell(9).value = value
    r.getCell(9).font = { name: 'Arial', size: 10, bold: true, color: { argb: txtColor } }
    r.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
    r.getCell(9).alignment = { horizontal: 'right', indent: 1 }
    r.height = 18
  })

  // Freeze panes (header + 9 first rows)
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 9 }]

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
