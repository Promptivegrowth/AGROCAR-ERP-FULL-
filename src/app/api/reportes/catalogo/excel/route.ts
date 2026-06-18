import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearExcelBranded, seccionTitulo, seccionTabla, excelResponse, footerReporte,
} from '@/lib/excel-export'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const soloActivos = req.nextUrl.searchParams.get('activos') !== '0'

  const { data: prod } = await (supabase as any)
    .from('productos')
    .select(`
      id, codigo, nombre, descripcion, activo, peso_kg,
      tiene_lote, tiene_vencimiento,
      familias(nombre),
      unidades_medida(simbolo),
      stock(cantidad)
    `)
    .order('codigo')

  let productos = (prod ?? []) as any[]
  if (soloActivos) productos = productos.filter((p) => p.activo)

  const { data: listas } = await (supabase as any).from('listas_precio').select('id, nombre')
  const listaPorNombre: Record<string, string> = {}
  ;(listas ?? []).forEach((l: any) => { listaPorNombre[l.nombre] = l.id })

  const { data: precios } = await (supabase as any)
    .from('lista_precio_items')
    .select('lista_precio_id, producto_id, precio')
    .eq('activo', true)
  const precioMap = new Map<string, { a: number | null; b: number | null; c: number | null }>()
  ;(precios ?? []).forEach((p: any) => {
    const acc = precioMap.get(p.producto_id) ?? { a: null, b: null, c: null }
    if (p.lista_precio_id === listaPorNombre['A']) acc.a = Number(p.precio)
    else if (p.lista_precio_id === listaPorNombre['B']) acc.b = Number(p.precio)
    else if (p.lista_precio_id === listaPorNombre['C']) acc.c = Number(p.precio)
    precioMap.set(p.producto_id, acc)
  })

  const rows = productos.map((p) => {
    const pr = precioMap.get(p.id) ?? { a: null, b: null, c: null }
    return [
      p.codigo ?? '—',
      p.nombre ?? '—',
      p.descripcion ?? '',
      p.familias?.nombre ?? '—',
      p.unidades_medida?.simbolo ?? '',
      Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
      p.peso_kg ?? '',
      pr.a ?? '',
      pr.b ?? '',
      pr.c ?? '',
      [p.tiene_lote ? 'L' : '', p.tiene_vencimiento ? 'V' : ''].filter(Boolean).join(' '),
      p.activo ? 'Activo' : 'Inactivo',
    ]
  })

  const { workbook, sheet, startRow } = await crearExcelBranded({
    titulo: 'Catálogo de productos',
    subtitulo: `${productos.length} productos · listas A / B / C`,
    sheetName: 'Catálogo',
  })
  let row = startRow

  row = seccionTitulo(sheet, row, `Catálogo (${productos.length})`)
  row = seccionTabla(sheet, row,
    ['Código', 'Producto', 'Descripción', 'Familia', 'UDM', 'Stock', 'Peso kg', 'Lista A', 'Lista B', 'Lista C', 'Atrib.', 'Estado'],
    rows,
    { columnasMoneda: [7, 8, 9] },
  )

  footerReporte(sheet, row)
  return excelResponse(workbook, `catalogo-productos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
