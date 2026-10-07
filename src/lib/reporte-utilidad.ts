/**
 * Utilidad por producto, agrupada por marca o por tipo de producto, entre dos
 * fechas. Reporte gerencial.
 *
 * Marca es la tabla `familias` (Cerdeña, Americana, Dely's…: en este ERP la
 * "familia" es la marca). Tipo es el nombre corto del producto (Salchichas,
 * Jamón, Lácteos…). Daniel pidió verlo por marca (04/10/2026).
 *
 * Todo va SIN IGV: el IGV no es ingreso ni costo de la empresa, y la utilidad
 * neta se mide sin él.
 *
 * Venta: cada línea de los comprobantes no anulados del rango (boletas,
 * facturas y notas internas de venta directa). El monto de la línea está con
 * IGV; se le saca en la misma proporción en que lo hizo su comprobante
 * (`subtotal / total`). Así una nota interna, que no lleva IGV, cuenta entera.
 * Las notas de crédito restan.
 *
 * Costo: promedio ponderado de lo comprado HASTA la fecha final del rango, en
 * compras aplicadas. El precio de cada línea de compra se guarda con IGV
 * cuando la compra lo incluye (la suma de las líneas da el total de la
 * factura), así que se le saca en la proporción de su compra. Si un producto
 * no tiene compras, se usa el costo promedio de su ficha; si tampoco tiene,
 * queda "sin costo" y no entra en la utilidad (si entrara, la inflaría).
 *
 * Los porcentajes de cada grupo y del total son ponderados: utilidad sobre
 * venta del grupo, no el promedio simple de los porcentajes de cada producto.
 * La participación es la parte del grupo en la venta y en la utilidad totales.
 */

import { traerTodo } from '@/lib/supabase/paginar'

export interface FilaUtilidad {
  producto_id: string | null
  codigo: string
  producto: string
  marca: string
  tipo: string
  cantidad: number
  /** Venta sin IGV. */
  venta: number
  /** Precio promedio de venta por unidad, sin IGV. */
  precio_promedio: number
  /** Costo de compra por unidad, sin IGV. Null si no hay de dónde sacarlo. */
  costo_unitario: number | null
  costo_total: number | null
  utilidad: number | null
  /** Utilidad / venta × 100. */
  margen_venta: number | null
  /** Utilidad / costo × 100. */
  margen_costo: number | null
}

export type Agrupacion = 'marca' | 'tipo'

export interface GrupoUtilidad {
  /** La marca o el tipo, según la agrupación. */
  grupo: string
  productos: FilaUtilidad[]
  cantidad: number
  venta: number
  /** Venta de los productos que sí tienen costo: base de la utilidad. */
  venta_con_costo: number
  costo_total: number
  utilidad: number
  margen_venta: number | null
  margen_costo: number | null
  sin_costo: number
  /** Parte del grupo en la venta total, en %. */
  part_venta: number | null
  /** Parte del grupo en la utilidad total, en %. */
  part_utilidad: number | null
}

export interface ReporteUtilidad {
  desde: string
  hasta: string
  por: Agrupacion
  grupos: GrupoUtilidad[]
  total: Omit<GrupoUtilidad, 'grupo' | 'productos' | 'part_venta' | 'part_utilidad'>
}

const r2 = (n: number) => Math.round(n * 100) / 100

function margenes(utilidad: number, venta: number, costo: number) {
  return {
    margen_venta: venta > 0 ? (utilidad / venta) * 100 : null,
    margen_costo: costo > 0 ? (utilidad / costo) * 100 : null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function calcularUtilidad(
  supabase: any, desde: string, hasta: string, por: Agrupacion = 'marca',
): Promise<ReporteUtilidad> {
  const [ventas, compras, fichas] = await Promise.all([
    traerTodo<any>((a, b) => supabase
      .from('comprobantes_items')
      .select(`
        id, cantidad, subtotal, descripcion, producto_id,
        productos(codigo, nombre, descripcion, familias(nombre)),
        comprobantes!inner(tipo, fecha_emision, estado, subtotal, total)
      `)
      .gte('comprobantes.fecha_emision', desde)
      .lte('comprobantes.fecha_emision', hasta)
      .neq('comprobantes.estado', 'anulado')
      .order('id')
      .range(a, b)),
    traerTodo<any>((a, b) => supabase
      .from('compras_items')
      .select('id, producto_id, cantidad, precio_unitario, compras!inner(fecha, estado, subtotal, total, regulariza_internos)')
      .eq('compras.estado', 'aplicada')
      // La factura que regulariza documentos internos no trae mercadería: ya entró con el interno.
      .eq('compras.regulariza_internos', false)
      .lte('compras.fecha', hasta)
      .order('id')
      .range(a, b)),
    traerTodo<any>((a, b) => supabase
      .from('productos')
      .select('id, costo_promedio')
      .order('id')
      .range(a, b)),
  ])

  // Costo promedio ponderado sin IGV, por producto.
  const compra = new Map<string, { cant: number; monto: number }>()
  for (const it of compras) {
    if (!it.producto_id) continue
    const cant = Number(it.cantidad ?? 0)
    if (cant <= 0) continue
    const total = Number(it.compras?.total ?? 0)
    const factor = total > 0 ? Number(it.compras?.subtotal ?? total) / total : 1
    const acc = compra.get(it.producto_id) ?? { cant: 0, monto: 0 }
    acc.cant += cant
    acc.monto += cant * Number(it.precio_unitario ?? 0) * factor
    compra.set(it.producto_id, acc)
  }
  // La ficha guarda el costo como se compró, con IGV.
  const ficha = new Map<string, number>()
  for (const p of fichas) {
    const c = Number(p.costo_promedio ?? 0)
    if (c > 0) ficha.set(p.id, c / 1.18)
  }
  const costoDe = (id: string | null): number | null => {
    if (!id) return null
    const c = compra.get(id)
    if (c && c.cant > 0) return c.monto / c.cant
    return ficha.get(id) ?? null
  }

  // Ventas agrupadas por producto.
  const prod = new Map<string, FilaUtilidad>()
  for (const it of ventas) {
    const comp = it.comprobantes
    const signo = comp?.tipo === 'nota_credito' ? -1 : 1
    const totalComp = Number(comp?.total ?? 0)
    const factor = totalComp > 0 ? Number(comp?.subtotal ?? totalComp) / totalComp : 1
    const clave = it.producto_id ?? `__${it.descripcion}`
    const fila = prod.get(clave) ?? {
      producto_id: it.producto_id,
      codigo: it.productos?.codigo ?? '—',
      producto: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || '—',
      marca: (it.productos?.familias?.nombre ?? '').trim() || 'SIN MARCA',
      tipo: (it.productos?.nombre ?? '').trim() || 'SIN TIPO',
      cantidad: 0, venta: 0, precio_promedio: 0,
      costo_unitario: null, costo_total: null, utilidad: null, margen_venta: null, margen_costo: null,
    }
    fila.cantidad += signo * Number(it.cantidad ?? 0)
    fila.venta += signo * Number(it.subtotal ?? 0) * factor
    prod.set(clave, fila)
  }

  for (const f of Array.from(prod.values())) {
    f.cantidad = Math.round(f.cantidad * 1000) / 1000
    f.venta = r2(f.venta)
    f.precio_promedio = f.cantidad !== 0 ? f.venta / f.cantidad : 0
    f.costo_unitario = costoDe(f.producto_id)
    if (f.costo_unitario !== null) {
      f.costo_total = r2(f.cantidad * f.costo_unitario)
      f.utilidad = r2(f.venta - f.costo_total)
      Object.assign(f, margenes(f.utilidad, f.venta, f.costo_total))
    }
  }

  const sumar = (filas: FilaUtilidad[]) => {
    const conCosto = filas.filter((f) => f.costo_total !== null)
    const venta = r2(filas.reduce((a, f) => a + f.venta, 0))
    const venta_con_costo = r2(conCosto.reduce((a, f) => a + f.venta, 0))
    const costo_total = r2(conCosto.reduce((a, f) => a + (f.costo_total ?? 0), 0))
    const utilidad = r2(venta_con_costo - costo_total)
    return {
      cantidad: filas.reduce((a, f) => a + f.cantidad, 0),
      venta, venta_con_costo, costo_total, utilidad,
      ...margenes(utilidad, venta_con_costo, costo_total),
      sin_costo: filas.length - conCosto.length,
    }
  }

  const total = sumar(Array.from(prod.values()))
  const parte = (n: number, de: number) => (de > 0 ? (n / de) * 100 : null)

  const porGrupo = new Map<string, FilaUtilidad[]>()
  for (const f of Array.from(prod.values())) {
    const clave = por === 'marca' ? f.marca : f.tipo
    const lista = porGrupo.get(clave) ?? []
    lista.push(f)
    porGrupo.set(clave, lista)
  }
  const grupos: GrupoUtilidad[] = Array.from(porGrupo.entries())
    .map(([grupo, filas]) => {
      const s = sumar(filas)
      return {
        grupo,
        productos: filas.sort((a, b) => b.venta - a.venta),
        ...s,
        part_venta: parte(s.venta, total.venta),
        part_utilidad: parte(s.utilidad, total.utilidad),
      }
    })
    .sort((a, b) => b.utilidad - a.utilidad)

  return { desde, hasta, por, grupos, total }
}
