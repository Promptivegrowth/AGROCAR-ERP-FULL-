/**
 * Registros de ventas y de compras para gerencia (Daniel, 07/10/2026).
 *
 * Los datos los trae la base (registro_ventas / registro_compras, migración
 * 135), una fila por documento. Acá se filtran y se suman, y lo usan igual la
 * pantalla y el Excel: así los dos dicen lo mismo.
 *
 * Criterios:
 *   - Lo anulado no suma (se puede listar aparte, tachado).
 *   - Las notas de crédito restan.
 *   - El IGV que cuenta es el de facturas y boletas (lo que se declara). El
 *     documento interno guarda un desglose, pero no va a SUNAT: se suma por su
 *     total.
 */

export type TipoVenta = 'factura' | 'boleta' | 'nota_pedido_interna' | 'nota_credito'
export interface FilaVenta {
  id: string; tipo: TipoVenta; serie: string; numero: string; fecha: string; estado: string
  cliente: string; doc: string; vendedor: string; condicion: string
  base: number; igv: number; total: number; cobrado: number
  sunat_estado: string | null; motivo_anulacion: string | null
}
export type TipoCompra = 'factura' | 'interno' | 'regulariza'
export interface FilaCompra {
  id: string; fecha: string; documento: string; tipo: TipoCompra; estado: string
  proveedor: string; ruc: string; base: number; igv: number; total: number; lineas: number
}

export const TIPO_VENTA: Record<TipoVenta, string> = {
  factura: 'Factura', boleta: 'Boleta', nota_pedido_interna: 'Doc. interno', nota_credito: 'Nota de crédito',
}
export const TIPO_COMPRA: Record<TipoCompra, string> = {
  factura: 'Factura', interno: 'Doc. interno', regulariza: 'Factura (regulariza internos)',
}

const n = (v: unknown) => Number(v ?? 0)
const r2 = (v: number) => Math.round(v * 100) / 100

export function normalizarVentas(data: any[]): FilaVenta[] {
  return (data ?? []).map((f) => ({ ...f, base: n(f.base), igv: n(f.igv), total: n(f.total), cobrado: n(f.cobrado) }))
}
export function normalizarCompras(data: any[]): FilaCompra[] {
  return (data ?? []).map((f) => ({ ...f, base: n(f.base), igv: n(f.igv), total: n(f.total), lineas: n(f.lineas) }))
}

export const anuladaVenta = (f: FilaVenta) => f.estado === 'anulado'
export const anuladaCompra = (f: FilaCompra) => f.estado === 'anulada'
/** Signo con que suma: las notas de crédito restan. */
export const signo = (f: FilaVenta) => (f.tipo === 'nota_credito' ? -1 : 1)

// ── Filtros ────────────────────────────────────────────────────────────────
export interface FiltrosVentas {
  tipo?: string; condicion?: string; vendedor?: string; anulados?: boolean; buscar?: string
}
export function filtrarVentas(filas: FilaVenta[], f: FiltrosVentas): FilaVenta[] {
  const q = (f.buscar ?? '').trim().toLowerCase()
  return filas.filter((x) => {
    if (!f.anulados && anuladaVenta(x)) return false
    if (f.tipo && f.tipo !== 'todos' && x.tipo !== f.tipo) return false
    if (f.condicion && f.condicion !== 'todas' && x.condicion !== f.condicion) return false
    if (f.vendedor && f.vendedor !== 'todos' && (x.vendedor || 'Sin vendedor') !== f.vendedor) return false
    if (q && !`${x.serie}-${x.numero} ${x.serie}-${Number(x.numero)} ${x.cliente} ${x.doc}`.toLowerCase().includes(q)) return false
    return true
  })
}
export interface FiltrosCompras { tipo?: string; proveedor?: string; anuladas?: boolean; buscar?: string }
export function filtrarCompras(filas: FilaCompra[], f: FiltrosCompras): FilaCompra[] {
  const q = (f.buscar ?? '').trim().toLowerCase()
  return filas.filter((x) => {
    if (!f.anuladas && anuladaCompra(x)) return false
    if (f.tipo && f.tipo !== 'todos' && x.tipo !== f.tipo) return false
    if (f.proveedor && f.proveedor !== 'todos' && x.proveedor !== f.proveedor) return false
    if (q && !`${x.documento} ${x.proveedor} ${x.ruc}`.toLowerCase().includes(q)) return false
    return true
  })
}

// ── Totales ventas ─────────────────────────────────────────────────────────
export interface TotalTipo { cantidad: number; total: number; base: number; igv: number }
const vacio = (): TotalTipo => ({ cantidad: 0, total: 0, base: 0, igv: 0 })

export function totalesVentas(filas: FilaVenta[]) {
  const porTipo: Record<TipoVenta, TotalTipo> = {
    factura: vacio(), boleta: vacio(), nota_pedido_interna: vacio(), nota_credito: vacio(),
  }
  // Por cobrar, comprobante por comprobante, como en Cuentas por cobrar: un
  // comprobante cobrado de más no descuenta la deuda de otro (Daniel, 09/10).
  let total = 0, cobrado = 0, contado = 0, credito = 0, vigentes = 0, porCobrar = 0
  const anulados = { cantidad: 0, total: 0 }
  for (const f of filas) {
    if (anuladaVenta(f)) { anulados.cantidad++; anulados.total += f.total; continue }
    const t = porTipo[f.tipo] ?? (porTipo[f.tipo] = vacio())
    t.cantidad++; t.total += f.total; t.base += f.base; t.igv += f.igv
    total += signo(f) * f.total
    if (f.tipo !== 'nota_credito') {
      vigentes++
      cobrado += f.cobrado
      porCobrar += Math.max(0, f.total - f.cobrado)
      if (f.condicion === 'credito') credito += f.total; else contado += f.total
    }
  }
  const declarable = porTipo.factura.base + porTipo.boleta.base - porTipo.nota_credito.base
  const igv = porTipo.factura.igv + porTipo.boleta.igv - porTipo.nota_credito.igv
  const ventasBrutas = porTipo.factura.total + porTipo.boleta.total + porTipo.nota_pedido_interna.total
  return {
    porTipo, total: r2(total), vigentes, anulados,
    valorVentaDeclarable: r2(declarable), igvDeclarable: r2(igv),
    cobrado: r2(cobrado), porCobrar: r2(porCobrar),
    contado: r2(contado), credito: r2(credito),
    ticketPromedio: vigentes > 0 ? r2(ventasBrutas / vigentes) : 0,
  }
}

export interface DiaVentas { fecha: string; factura: number; boleta: number; interno: number; nc: number; total: number; documentos: number }
export function ventasPorDia(filas: FilaVenta[]): DiaVentas[] {
  const m = new Map<string, DiaVentas>()
  for (const f of filas) {
    if (anuladaVenta(f)) continue
    const d = m.get(f.fecha) ?? { fecha: f.fecha, factura: 0, boleta: 0, interno: 0, nc: 0, total: 0, documentos: 0 }
    if (f.tipo === 'factura') d.factura += f.total
    else if (f.tipo === 'boleta') d.boleta += f.total
    else if (f.tipo === 'nota_pedido_interna') d.interno += f.total
    else if (f.tipo === 'nota_credito') d.nc += f.total
    d.total += signo(f) * f.total
    d.documentos++
    m.set(f.fecha, d)
  }
  return Array.from(m.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

export interface GrupoVentas { nombre: string; documentos: number; factura: number; boleta: number; interno: number; total: number; porCobrar: number }
export function ventasPor(filas: FilaVenta[], clave: (f: FilaVenta) => string): GrupoVentas[] {
  const m = new Map<string, GrupoVentas>()
  for (const f of filas) {
    if (anuladaVenta(f)) continue
    const k = clave(f) || 'Sin asignar'
    const g = m.get(k) ?? { nombre: k, documentos: 0, factura: 0, boleta: 0, interno: 0, total: 0, porCobrar: 0 }
    if (f.tipo === 'factura') g.factura += f.total
    else if (f.tipo === 'boleta') g.boleta += f.total
    else if (f.tipo === 'nota_pedido_interna') g.interno += f.total
    g.total += signo(f) * f.total
    if (f.tipo !== 'nota_credito') g.porCobrar += Math.max(0, f.total - f.cobrado)
    g.documentos++
    m.set(k, g)
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total)
}

// ── Totales compras ────────────────────────────────────────────────────────
export function totalesCompras(filas: FilaCompra[]) {
  const porTipo: Record<TipoCompra, TotalTipo> = { factura: vacio(), interno: vacio(), regulariza: vacio() }
  const anuladas = { cantidad: 0, total: 0 }
  let total = 0
  for (const f of filas) {
    if (anuladaCompra(f)) { anuladas.cantidad++; anuladas.total += f.total; continue }
    const t = porTipo[f.tipo]
    t.cantidad++; t.total += f.total; t.base += f.base; t.igv += f.igv
    total += f.total
  }
  return {
    porTipo, total: r2(total), anuladas,
    // Con comprobante: facturas (incluidas las que regularizan internos).
    conComprobante: r2(porTipo.factura.total + porTipo.regulariza.total),
    valorCompra: r2(porTipo.factura.base + porTipo.regulariza.base),
    creditoFiscal: r2(porTipo.factura.igv + porTipo.regulariza.igv),
    sinComprobante: r2(porTipo.interno.total),
  }
}

export interface GrupoCompras { nombre: string; ruc: string; documentos: number; factura: number; interno: number; regulariza: number; igv: number; total: number }
export function comprasPorProveedor(filas: FilaCompra[]): GrupoCompras[] {
  const m = new Map<string, GrupoCompras>()
  for (const f of filas) {
    if (anuladaCompra(f)) continue
    const g = m.get(f.proveedor) ?? { nombre: f.proveedor, ruc: f.ruc, documentos: 0, factura: 0, interno: 0, regulariza: 0, igv: 0, total: 0 }
    g[f.tipo] += f.total
    g.igv += f.igv
    g.total += f.total
    g.documentos++
    m.set(f.proveedor, g)
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total)
}

export interface DiaCompras { fecha: string; factura: number; interno: number; regulariza: number; total: number; documentos: number }
export function comprasPorDia(filas: FilaCompra[]): DiaCompras[] {
  const m = new Map<string, DiaCompras>()
  for (const f of filas) {
    if (anuladaCompra(f)) continue
    const d = m.get(f.fecha) ?? { fecha: f.fecha, factura: 0, interno: 0, regulariza: 0, total: 0, documentos: 0 }
    d[f.tipo] += f.total
    d.total += f.total
    d.documentos++
    m.set(f.fecha, d)
  }
  return Array.from(m.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

// ── Fechas ─────────────────────────────────────────────────────────────────
export function restarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}
export function mesAnterior(hoy: string): [string, string] {
  const d = new Date(`${hoy.slice(0, 8)}01T12:00:00Z`)
  d.setUTCDate(0)
  const fin = d.toISOString().slice(0, 10)
  return [`${fin.slice(0, 8)}01`, fin]
}
