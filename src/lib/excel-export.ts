/**
 * Helper para generar archivos Excel branded con AGROCAR.
 *
 * Uso típico en una API route:
 *
 *   const { workbook, sheet } = await crearExcelBranded({ titulo: 'Cierre de Caja' })
 *   sheet.addRow(['Total', 1234.50])
 *   return excelResponse(workbook, 'cierre-2026-06-17.xlsx')
 *
 * Convención: el primer bloque de filas siempre lleva el header empresa
 * (logo + razón social + RUC + dirección + correo). Las funciones helpers
 * `seccionTitulo` y `seccionTabla` te dan formato consistente entre reportes.
 */

import ExcelJS from 'exceljs'
import path from 'node:path'
import fs from 'node:fs/promises'
import { EMPRESA } from '@/lib/empresa'

const COLOR_AMARILLO_AGROCAR = 'FFFBE600'
const COLOR_NEGRO = 'FF000000'
const COLOR_GRIS_CLARO = 'FFF3F4F6'
const COLOR_GRIS_TEXTO = 'FF6B7280'

export interface ExcelBrandedOptions {
  titulo: string
  subtitulo?: string
  sheetName?: string
  /** Si se pasa, agrega "Período: {desde} - {hasta}" debajo del subtitulo */
  periodo?: { desde: string; hasta: string }
}

export interface ExcelBrandedResult {
  workbook: ExcelJS.Workbook
  sheet: ExcelJS.Worksheet
  /** Fila donde puede empezar el cuerpo del reporte (después del header) */
  startRow: number
}

/**
 * Crea un workbook con header AGROCAR (logo + datos empresa + título reporte).
 * Devuelve la sheet lista para escribir el cuerpo a partir de `startRow`.
 */
export async function crearExcelBranded(opts: ExcelBrandedOptions): Promise<ExcelBrandedResult> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AGROCAR ERP'
  workbook.created = new Date()
  workbook.company = EMPRESA.razon_social

  const sheet = workbook.addWorksheet(opts.sheetName ?? 'Reporte', {
    properties: { defaultColWidth: 18 },
    views: [{ showGridLines: false }],
  })

  // Intentar insertar el logo. Si falla (en serverless build sin el archivo)
  // seguimos sin logo — preferimos un Excel sin imagen a romper el endpoint.
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo-agrocar.png')
    const buffer = await fs.readFile(logoPath)
    const imageId = workbook.addImage({
      // @ts-expect-error — exceljs acepta Buffer en runtime aunque su typing exige Buffer básico
      buffer,
      extension: 'png',
    })
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 140, height: 50 },
    })
  } catch {
    // Sin logo, no es bloqueante
  }

  // Filas 1-4 reservadas para logo (visualmente). Datos empresa al lado.
  // Fusionadas: el texto es largo y asi el ancho queda declarado en vez de
  // depender de que las celdas de al lado sigan vacias.
  sheet.mergeCells('C1:H1')
  sheet.mergeCells('C2:H2')
  sheet.mergeCells('C3:H3')
  sheet.mergeCells('C4:H4')
  sheet.getCell('C1').value = EMPRESA.razon_social
  sheet.getCell('C1').font = { bold: true, size: 14, color: { argb: COLOR_NEGRO } }

  sheet.getCell('C2').value = `RUC ${EMPRESA.ruc} · ${EMPRESA.rubro}`
  sheet.getCell('C2').font = { size: 10, color: { argb: COLOR_GRIS_TEXTO } }

  sheet.getCell('C3').value = `${EMPRESA.direccion_comercial}`
  sheet.getCell('C3').font = { size: 10, color: { argb: COLOR_GRIS_TEXTO } }

  sheet.getCell('C4').value = `Tel. ${EMPRESA.telefono} · ${EMPRESA.correo}`
  sheet.getCell('C4').font = { size: 10, color: { argb: COLOR_GRIS_TEXTO } }

  // Banda amarilla con título del reporte (fila 6)
  sheet.mergeCells('A6:G6')
  const tituloCell = sheet.getCell('A6')
  tituloCell.value = opts.titulo.toUpperCase()
  tituloCell.font = { bold: true, size: 13, color: { argb: COLOR_NEGRO } }
  tituloCell.alignment = { horizontal: 'center', vertical: 'middle' }
  tituloCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_AMARILLO_AGROCAR },
  }
  sheet.getRow(6).height = 22

  let startRow = 8
  if (opts.subtitulo) {
    sheet.mergeCells(`A${startRow}:G${startRow}`)
    const sub = sheet.getCell(`A${startRow}`)
    sub.value = opts.subtitulo
    sub.font = { size: 11, color: { argb: COLOR_GRIS_TEXTO } }
    sub.alignment = { horizontal: 'center' }
    startRow++
  }
  if (opts.periodo) {
    sheet.mergeCells(`A${startRow}:G${startRow}`)
    const per = sheet.getCell(`A${startRow}`)
    per.value = `Período: ${opts.periodo.desde} al ${opts.periodo.hasta}`
    per.font = { size: 10, italic: true, color: { argb: COLOR_GRIS_TEXTO } }
    per.alignment = { horizontal: 'center' }
    startRow++
  }
  // Fila vacía de respiro
  startRow++

  return { workbook, sheet, startRow }
}

/**
 * Agrega una fila de título de sección (gris claro de fondo, negrita).
 * Devuelve la siguiente fila libre.
 */
export function seccionTitulo(
  sheet: ExcelJS.Worksheet,
  row: number,
  texto: string,
  span = 7,
): number {
  sheet.mergeCells(`A${row}:${String.fromCharCode(64 + span)}${row}`)
  const cell = sheet.getCell(`A${row}`)
  cell.value = texto
  cell.font = { bold: true, size: 11, color: { argb: COLOR_NEGRO } }
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_GRIS_CLARO },
  }
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  sheet.getRow(row).height = 18
  return row + 1
}

/**
 * Agrega una tabla con headers en negrita y filas de datos.
 * Auto-ajusta el ancho de columnas al contenido.
 */
export function seccionTabla(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  headers: string[],
  rows: (string | number | null)[][],
  opts?: {
    columnasMoneda?: number[] // índices 0-based de columnas con formato moneda
    columnasFecha?: number[]
    /**
     * Columnas de porcentaje, como número: 25.3 se escribe 25.3 y se muestra
     * "25.30%".
     *
     * Antes estos valores se armaban como texto —`${x.toFixed(2)}%`— y en Excel
     * un texto no se ordena por valor, no se promedia y no entra en un gráfico.
     * Se veía bien y no servía para nada.
     */
    columnasPorcentaje?: number[]
    totalsRow?: (string | number | null)[]
  },
): number {
  // Headers
  headers.forEach((h, i) => {
    const cell = sheet.getCell(startRow, i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR_NEGRO },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      top: { style: 'thin', color: { argb: COLOR_NEGRO } },
      bottom: { style: 'thin', color: { argb: COLOR_NEGRO } },
      left: { style: 'thin', color: { argb: COLOR_NEGRO } },
      right: { style: 'thin', color: { argb: COLOR_NEGRO } },
    }
  })
  sheet.getRow(startRow).height = 20

  // Rows
  rows.forEach((row, rowIdx) => {
    row.forEach((val, colIdx) => {
      const cell = sheet.getCell(startRow + 1 + rowIdx, colIdx + 1)
      cell.value = val
      if (opts?.columnasMoneda?.includes(colIdx) && typeof val === 'number') {
        cell.numFmt = '"S/ "#,##0.00'
        cell.alignment = { horizontal: 'right' }
      } else if (opts?.columnasPorcentaje?.includes(colIdx) && typeof val === 'number') {
        // El valor va como número; el "%" lo pone el formato.
        cell.numFmt = '0.00"%"'
        cell.alignment = { horizontal: 'right' }
      } else if (opts?.columnasFecha?.includes(colIdx)) {
        cell.alignment = { horizontal: 'center' }
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
      // Alternar fondo blanco/gris
      if (rowIdx % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFAFAFA' },
        }
      }
    })
  })

  let nextRow = startRow + 1 + rows.length

  // Fila de totales si se pasa
  if (opts?.totalsRow) {
    opts.totalsRow.forEach((val, colIdx) => {
      const cell = sheet.getCell(nextRow, colIdx + 1)
      cell.value = val
      cell.font = { bold: true }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR_AMARILLO_AGROCAR },
      }
      if (opts.columnasMoneda?.includes(colIdx) && typeof val === 'number') {
        cell.numFmt = '"S/ "#,##0.00'
        cell.alignment = { horizontal: 'right' }
      } else if (opts.columnasPorcentaje?.includes(colIdx) && typeof val === 'number') {
        cell.numFmt = '0.00"%"'
        cell.alignment = { horizontal: 'right' }
      }
      cell.border = {
        top: { style: 'medium', color: { argb: COLOR_NEGRO } },
        bottom: { style: 'medium', color: { argb: COLOR_NEGRO } },
      }
    })
    nextRow++
  }

  /*
   * Los anchos crecen, nunca se achican.
   *
   * En Excel el ancho es de la COLUMNA, no de la tabla, y una hoja suele
   * llevar varias tablas: en el inventario valorizado son tres, de 2, 5 y 10
   * columnas. Antes cada llamada hacia `col.width = ...` y pisaba lo que
   * hubiera puesto la anterior, asi que mandaba la ultima tabla: la columna 1
   * quedaba del ancho de "Codigo" y el "Valor del inventario (a costo)" de la
   * tabla de totales —que vive en esa misma columna— salia cortado.
   *
   * Tomando el maximo, cada columna entra la mas larga de todas las tablas que
   * la usan y no se corta nada.
   */
  headers.forEach((h, i) => {
    const col = sheet.getColumn(i + 1)
    let necesario = Math.max(h.length, 10)
    rows.forEach((r) => {
      const v = String(r[i] ?? '')
      if (v.length > necesario) necesario = v.length
    })
    if (opts?.totalsRow) {
      const v = String(opts.totalsRow[i] ?? '')
      if (v.length > necesario) necesario = v.length
    }
    /*
     * Hay un tope: una columna de 120 no se imprime. Lo que se pasa no se
     * corta, se acomoda en varias lineas —`wrapText`—, que es la unica forma
     * de que un nombre largo se lea entero sin romper la hoja.
     */
    const TOPE = 50
    const propuesto = Math.min(necesario + 2, TOPE)
    col.width = Math.max(col.width ?? 0, propuesto)
    if (necesario + 2 > TOPE) {
      col.alignment = { ...(col.alignment ?? {}), wrapText: true, vertical: 'top' }
    }
  })

  return nextRow + 1 // fila vacía después de la tabla
}

/**
 * Convierte el workbook en una Response HTTP de descarga.
 */
export async function excelResponse(
  workbook: ExcelJS.Workbook,
  filename: string,
): Promise<Response> {
  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Footer estándar para reportes (datos del facturador, fecha generación, etc.)
 */
export function footerReporte(
  sheet: ExcelJS.Worksheet,
  row: number,
  generadoPor?: string,
): number {
  const fechaGen = new Date().toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  sheet.mergeCells(`A${row}:G${row}`)
  const cell = sheet.getCell(`A${row}`)
  cell.value = `Generado: ${fechaGen}${generadoPor ? ` · por ${generadoPor}` : ''} · AGROCAR ERP`
  cell.font = { size: 9, italic: true, color: { argb: COLOR_GRIS_TEXTO } }
  cell.alignment = { horizontal: 'center' }
  return row + 1
}
