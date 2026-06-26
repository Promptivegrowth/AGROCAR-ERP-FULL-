'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Package, Search, Loader2, TrendingUp, TrendingDown, FileSpreadsheet, Printer } from 'lucide-react'

/**
 * Reporte VALORIZADO de inventario.
 *
 * Para cada producto en stock muestra:
 * - Stock actual + valor a costo
 * - Costo promedio compra (promedio ponderado de compras del rango)
 * - Precio promedio venta (promedio ponderado de ventas del rango)
 * - Margen unitario = precio venta − costo compra
 * - % Utilidad real (no la del 18% IGV)
 * - Utilidad potencial = stock × margen
 *
 * Agrupado por familia con totales por familia y total general.
 *
 * Fuente del costo: compras_items + compras (promedio ponderado).
 * Si un producto no tiene compras en el rango → "Sin costo" (no genera utilidad).
 * Fuente de venta: comprobantes_items con comprobantes no anulados en el rango.
 */

interface ProductoValorizado {
  producto_id: string
  codigo: string
  nombre: string
  descripcion_completa: string
  familia_id: string | null
  familia_nombre: string
  stock: number
  unidades_compradas: number
  unidades_vendidas: number
  costo_promedio: number | null
  precio_venta_promedio: number | null
  margen_unitario: number | null
  utilidad_pct: number | null
  valor_inventario: number
  utilidad_potencial: number
}

interface FamiliaResumen {
  familia_id: string | null
  familia_nombre: string
  productos: number
  valor_inventario: number
  utilidad_potencial: number
  utilidad_pct_promedio: number | null
}

export default function ValorizadoPage() {
  const supabase = createClient()

  const hoy = hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(d.getDate() - 89)
    return d.toISOString().slice(0, 10)
  })()

  const [desde, setDesde] = useState(desdeDefault)
  const [hasta, setHasta] = useState(hoy)
  const [familiaFiltro, setFamiliaFiltro] = useState<string>('todas')
  const [soloStock, setSoloStock] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [familias, setFamilias] = useState<{ id: string; nombre: string }[]>([])
  const [productos, setProductos] = useState<ProductoValorizado[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await (supabase as any).from('familias').select('id, nombre').eq('activo', true).order('nombre')
      setFamilias((data ?? []) as any)
    })()
  }, [supabase])

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // 1) Productos con stock + familia + descripción
      const { data: prods } = await (supabase as any)
        .from('productos')
        .select(`
          id, codigo, nombre, descripcion, activo,
          familias(id, nombre),
          stock(cantidad)
        `)
        .order('codigo')

      // 2) Compras del rango con join a fecha
      const { data: comprasItems } = await (supabase as any)
        .from('compras_items')
        .select(`
          producto_id, cantidad, precio_unitario,
          compras!inner(fecha, estado)
        `)
        .gte('compras.fecha', desde)
        .lte('compras.fecha', hasta)
        .neq('compras.estado', 'anulado')

      // 3) Ventas del rango (comprobantes_items con join a comprobantes)
      const { data: ventasItems } = await (supabase as any)
        .from('comprobantes_items')
        .select(`
          producto_id, cantidad, precio_unitario,
          comprobantes!inner(fecha_emision, estado)
        `)
        .gte('comprobantes.fecha_emision', desde)
        .lte('comprobantes.fecha_emision', hasta)
        .neq('comprobantes.estado', 'anulado')

      // Calcular promedios ponderados por producto
      type Promedio = { total_cant: number; total_monto: number }
      const compraPorProd = new Map<string, Promedio>()
      ;(comprasItems ?? []).forEach((it: any) => {
        if (!it.producto_id) return
        const acc = compraPorProd.get(it.producto_id) ?? { total_cant: 0, total_monto: 0 }
        const cant = Number(it.cantidad ?? 0)
        acc.total_cant += cant
        acc.total_monto += cant * Number(it.precio_unitario ?? 0)
        compraPorProd.set(it.producto_id, acc)
      })

      const ventaPorProd = new Map<string, Promedio>()
      ;(ventasItems ?? []).forEach((it: any) => {
        if (!it.producto_id) return
        const acc = ventaPorProd.get(it.producto_id) ?? { total_cant: 0, total_monto: 0 }
        const cant = Number(it.cantidad ?? 0)
        acc.total_cant += cant
        acc.total_monto += Number(it.cantidad ?? 0) * Number(it.precio_unitario ?? 0)
        ventaPorProd.set(it.producto_id, acc)
      })

      // Armar productos valorizados
      const resultado: ProductoValorizado[] = (prods ?? []).map((p: any) => {
        const compra = compraPorProd.get(p.id)
        const venta = ventaPorProd.get(p.id)
        const costo = compra && compra.total_cant > 0 ? compra.total_monto / compra.total_cant : null
        const precioVenta = venta && venta.total_cant > 0 ? venta.total_monto / venta.total_cant : null
        const margen = (costo !== null && precioVenta !== null) ? precioVenta - costo : null
        const utilidadPct = (costo !== null && costo > 0 && margen !== null) ? (margen / costo) * 100 : null
        const stock = Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0)
        const valorInv = costo !== null ? stock * costo : 0
        const utilPotencial = margen !== null ? stock * margen : 0
        const descripcionCompleta = (p.descripcion?.trim() || p.nombre || '—')
        return {
          producto_id: p.id,
          codigo: p.codigo ?? '—',
          nombre: p.nombre ?? '—',
          descripcion_completa: descripcionCompleta,
          familia_id: p.familias?.id ?? null,
          familia_nombre: p.familias?.nombre ?? '— Sin familia —',
          stock,
          unidades_compradas: compra?.total_cant ?? 0,
          unidades_vendidas: venta?.total_cant ?? 0,
          costo_promedio: costo,
          precio_venta_promedio: precioVenta,
          margen_unitario: margen,
          utilidad_pct: utilidadPct,
          valor_inventario: valorInv,
          utilidad_potencial: utilPotencial,
        }
      })

      setProductos(resultado)
    } finally {
      setLoading(false)
    }
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (soloStock && p.stock <= 0) return false
      if (familiaFiltro !== 'todas' && p.familia_id !== familiaFiltro) return false
      if (q.length > 0 && !p.codigo.toLowerCase().includes(q) && !p.descripcion_completa.toLowerCase().includes(q)) return false
      return true
    })
  }, [productos, busqueda, familiaFiltro, soloStock])

  // Agrupado por familia
  const porFamilia = useMemo<FamiliaResumen[]>(() => {
    const map = new Map<string, FamiliaResumen & { suma_pct: number; con_utilidad: number }>()
    filtrados.forEach((p) => {
      const key = p.familia_id ?? '_sin_'
      const acc = map.get(key) ?? {
        familia_id: p.familia_id,
        familia_nombre: p.familia_nombre,
        productos: 0,
        valor_inventario: 0,
        utilidad_potencial: 0,
        utilidad_pct_promedio: 0,
        suma_pct: 0,
        con_utilidad: 0,
      }
      acc.productos++
      acc.valor_inventario += p.valor_inventario
      acc.utilidad_potencial += p.utilidad_potencial
      if (p.utilidad_pct !== null) {
        acc.suma_pct += p.utilidad_pct
        acc.con_utilidad++
      }
      map.set(key, acc)
    })
    return Array.from(map.values()).map((f) => ({
      familia_id: f.familia_id,
      familia_nombre: f.familia_nombre,
      productos: f.productos,
      valor_inventario: f.valor_inventario,
      utilidad_potencial: f.utilidad_potencial,
      utilidad_pct_promedio: f.con_utilidad > 0 ? f.suma_pct / f.con_utilidad : null,
    })).sort((a, b) => b.valor_inventario - a.valor_inventario)
  }, [filtrados])

  const totales = useMemo(() => ({
    productos: filtrados.length,
    sin_costo: filtrados.filter((p) => p.costo_promedio === null).length,
    valor_inventario: filtrados.reduce((a, p) => a + p.valor_inventario, 0),
    utilidad_potencial: filtrados.reduce((a, p) => a + p.utilidad_potencial, 0),
  }), [filtrados])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-600" />
            Inventario Valorizado
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Stock × costo promedio · utilidad real por producto y familia
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/almacen/valorizado/excel?desde=${desde}&hasta=${hasta}&familia=${familiaFiltro}&solo_stock=${soloStock ? '1' : '0'}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-700 hover:bg-green-800 rounded-md"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] hover:bg-[#E5D100] rounded-md"
          >
            <Printer className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* KPIs grandes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-700 font-semibold">PRODUCTOS</p>
          <p className="text-lg font-bold text-blue-900">{totales.productos}</p>
          {totales.sin_costo > 0 && (
            <p className="text-[10px] text-amber-700">⚠ {totales.sin_costo} sin costo de compra</p>
          )}
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs text-emerald-700 font-semibold">VALOR INVENTARIO</p>
          <p className="text-lg font-bold text-emerald-900">{formatCurrency(totales.valor_inventario)}</p>
          <p className="text-[10px] text-emerald-600">a costo de compra</p>
        </div>
        <div className="bg-[#FBE600] border border-yellow-400 rounded-lg p-3">
          <p className="text-xs text-black font-semibold">UTILIDAD POTENCIAL</p>
          <p className="text-lg font-bold">{formatCurrency(totales.utilidad_potencial)}</p>
          <p className="text-[10px]">si todo se vende</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-700 font-semibold">MARGEN PROMEDIO</p>
          <p className="text-lg font-bold">
            {totales.valor_inventario > 0
              ? `${((totales.utilidad_potencial / totales.valor_inventario) * 100).toFixed(1)}%`
              : '—'}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] text-gray-500">Desde</Label>
          <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Hasta</Label>
          <Input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="w-36 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Familia</Label>
          <Select value={familiaFiltro} onValueChange={setFamiliaFiltro}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las familias</SelectItem>
              {familias.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-[10px] text-gray-500">Buscar producto</Label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código o nombre..." className="pl-7 h-8 text-xs" />
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer h-8">
          <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
          Solo con stock
        </label>
      </div>

      {/* Resumen por familia */}
      {porFamilia.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <h2 className="text-sm font-bold text-gray-700 uppercase px-3 py-2 bg-gray-50 border-b border-gray-200">
            Resumen por familia ({porFamilia.length})
          </h2>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2">Familia</th>
                <th className="text-right p-2">Productos</th>
                <th className="text-right p-2">Valor Inv.</th>
                <th className="text-right p-2">Utilidad pot.</th>
                <th className="text-right p-2">% Margen</th>
              </tr>
            </thead>
            <tbody>
              {porFamilia.map((f) => (
                <tr key={f.familia_id ?? 'sin'} className="border-b border-gray-100">
                  <td className="p-2 font-semibold">{f.familia_nombre}</td>
                  <td className="p-2 text-right">{f.productos}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(f.valor_inventario)}</td>
                  <td className="p-2 text-right font-mono font-bold">{formatCurrency(f.utilidad_potencial)}</td>
                  <td className="p-2 text-right">
                    {f.utilidad_pct_promedio !== null ? (
                      <span className={`font-mono font-bold ${f.utilidad_pct_promedio >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {f.utilidad_pct_promedio.toFixed(1)}%
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle por producto */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <h2 className="text-sm font-bold text-gray-700 uppercase px-3 py-2 bg-gray-50 border-b border-gray-200">
          Detalle por producto ({filtrados.length})
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtrados.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin productos que coincidan.</p>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="border-b border-gray-200">
                  <th className="text-left p-2 font-semibold text-gray-600 w-20">Cód.</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Producto</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-16">Stock</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-20">Costo prom.</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-20">Vta prom.</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-16">Margen</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-16">% Util.</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-24">Valor Inv.</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-24">Util. pot.</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.producto_id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2 font-mono text-[10px]">{p.codigo}</td>
                    <td className="p-2">
                      <div className="font-medium text-gray-900 truncate max-w-[260px]">{p.descripcion_completa}</div>
                      <div className="text-[10px] text-gray-500">{p.familia_nombre}</div>
                    </td>
                    <td className="p-2 text-right font-mono">{p.stock.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">
                      {p.costo_promedio !== null ? formatCurrency(p.costo_promedio) :
                        <span className="text-amber-600 text-[10px]">Sin costo</span>}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {p.precio_venta_promedio !== null ? formatCurrency(p.precio_venta_promedio) :
                        <span className="text-gray-400 text-[10px]">Sin venta</span>}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {p.margen_unitario !== null ? formatCurrency(p.margen_unitario) : '—'}
                    </td>
                    <td className="p-2 text-right font-mono font-bold">
                      {p.utilidad_pct !== null ? (
                        <span className={p.utilidad_pct >= 0 ? 'text-green-700' : 'text-red-700'}>
                          {p.utilidad_pct >= 0
                            ? <TrendingUp className="w-3 h-3 inline mr-0.5" />
                            : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                          {p.utilidad_pct.toFixed(1)}%
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-2 text-right font-mono">{formatCurrency(p.valor_inventario)}</td>
                    <td className="p-2 text-right font-mono font-bold">{formatCurrency(p.utilidad_potencial)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-gray-100 z-10">
                <tr className="border-t-2 border-gray-300 font-bold">
                  <td colSpan={7} className="p-2 text-right">TOTALES</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(totales.valor_inventario)}</td>
                  <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(totales.utilidad_potencial)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
