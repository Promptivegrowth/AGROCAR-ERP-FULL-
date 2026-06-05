'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Package, TrendingDown, TrendingUp, Eye, Loader2, Search, History, Sliders, Boxes, FileDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { productoLabel, productoSubLabel } from '@/lib/producto-utils'

const TIPO_MOV_CONFIG: Record<string, { label: string; className: string }> = {
  entrada: { label: 'Entrada', className: 'bg-green-100 text-green-700 border-green-200' },
  salida: { label: 'Salida', className: 'bg-red-100 text-red-700 border-red-200' },
  ajuste: { label: 'Ajuste', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  devolucion: { label: 'Devolución', className: 'bg-blue-100 text-blue-700 border-blue-200' },
}

export default function AlmacenPage() {
  const supabase = createClient()

  const [stocks, setStocks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  // Detalle
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [movimientos, setMovimientos] = useState<any[]>([])
  const [loadingMovs, setLoadingMovs] = useState(false)
  const [lotesProducto, setLotesProducto] = useState<any[]>([])
  const [loadingLotes, setLoadingLotes] = useState(false)

  // Ajuste stock
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<any>(null)
  const [adjustTipo, setAdjustTipo] = useState<'entrada' | 'salida'>('entrada')
  const [adjustCantidad, setAdjustCantidad] = useState<string>('')
  const [adjustNotas, setAdjustNotas] = useState<string>('')
  const [adjustPermitirNeg, setAdjustPermitirNeg] = useState(false)
  const [adjustSaving, setAdjustSaving] = useState(false)
  const [adjustLotes, setAdjustLotes] = useState<any[]>([])
  const [adjustLoteId, setAdjustLoteId] = useState<string>('')
  const [adjustLoteNuevo, setAdjustLoteNuevo] = useState({ numero: '', fecha_venc: '' })

  // Movimientos completos
  const [movsOpen, setMovsOpen] = useState(false)
  const [movsTarget, setMovsTarget] = useState<any>(null)
  const [movsData, setMovsData] = useState<any[]>([])
  const [movsLoading, setMovsLoading] = useState(false)

  const loadInventario = useCallback(async () => {
    setLoading(true)
    // Precio venta promedio de los últimos 30 días — ponderado por cantidad
    const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const [{ data, error }, { data: ventas30 }] = await Promise.all([
      supabase
        .from('stock')
        .select(`
          id, producto_id, cantidad, cantidad_reservada, costo_promedio, updated_at,
          productos(id, codigo, nombre, descripcion, activo, familia_id, unidad_medida_id, tiene_lote, tiene_vencimiento,
            stock_minimo, stock_maximo,
            familias(nombre),
            unidades_medida(simbolo, nombre)
          )
        `),
      (supabase as any)
        .from('comprobantes_items')
        .select('producto_id, cantidad, precio_unitario, subtotal, comprobantes!inner(fecha_emision, estado)')
        .gte('comprobantes.fecha_emision', desde30)
        .neq('comprobantes.estado', 'anulado'),
    ])

    if (error) toast.error('Error al cargar inventario', { description: error.message })

    // Agrupar ventas por producto: Σ(cantidad × precio) / Σ(cantidad)
    const precioPromPorProd: Record<string, number> = {}
    const agg: Record<string, { qty: number; total: number }> = {}
    ;(ventas30 ?? []).forEach((it: any) => {
      if (!it.producto_id) return
      const cant = Number(it.cantidad ?? 0)
      const precio = Number(it.precio_unitario ?? 0)
      const subt = Number(it.subtotal ?? cant * precio)
      const cur = agg[it.producto_id] ?? { qty: 0, total: 0 }
      cur.qty += cant
      cur.total += subt
      agg[it.producto_id] = cur
    })
    Object.entries(agg).forEach(([prodId, v]) => {
      if (v.qty > 0) precioPromPorProd[prodId] = v.total / v.qty
    })

    // Orden alfabético por descripción (nombre comercial) o nombre genérico
    const ordenado = (data ?? []).slice().sort((a: any, b: any) => {
      const an = (a.productos?.descripcion?.trim() || a.productos?.nombre || '').toLowerCase()
      const bn = (b.productos?.descripcion?.trim() || b.productos?.nombre || '').toLowerCase()
      return an.localeCompare(bn, 'es')
    }).map((s: any) => ({ ...s, _precio_venta_30d: precioPromPorProd[s.producto_id] ?? null }))

    setStocks(ordenado)
    setLoading(false)
  }, [])

  useEffect(() => { loadInventario() }, [loadInventario])

  const openDetail = async (s: any) => {
    setSelected(s)
    setDetailOpen(true)
    setMovimientos([])
    setLotesProducto([])
    setLoadingMovs(true)
    const producto = s.productos as any
    const tieneLote = producto?.tiene_lote === true || producto?.tiene_vencimiento === true

    const promises: any[] = [
      supabase
        .from('movimientos_stock')
        .select('id, tipo, cantidad, costo_unitario, notas, created_at')
        .eq('producto_id', s.producto_id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]
    if (tieneLote) {
      setLoadingLotes(true)
      promises.push(
        supabase
          .from('lotes')
          .select('id, numero_lote, fecha_vencimiento, cantidad_actual, activo')
          .eq('producto_id', s.producto_id)
          .eq('activo', true)
          .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
      )
    }

    const results = await Promise.all(promises)
    const { data, error } = results[0]
    if (error) {
      toast.error('No se pudieron cargar los movimientos', { description: error.message })
    }
    setMovimientos(data ?? [])
    setLoadingMovs(false)

    if (tieneLote) {
      const { data: lotesData } = results[1]
      setLotesProducto(lotesData ?? [])
      setLoadingLotes(false)
    }
  }

  const openAdjust = async (s: any) => {
    setAdjustTarget(s)
    setAdjustTipo('entrada')
    setAdjustCantidad('')
    setAdjustNotas('')
    setAdjustPermitirNeg(false)
    setAdjustLoteId('')
    setAdjustLoteNuevo({ numero: '', fecha_venc: '' })
    setAdjustLotes([])
    // Si el producto tiene_lote, cargar sus lotes activos
    const tieneLote = !!s?.productos?.tiene_lote
    if (tieneLote && s?.producto_id) {
      const { data: lotes } = await supabase
        .from('lotes')
        .select('id, numero_lote, fecha_vencimiento, cantidad_actual')
        .eq('producto_id', s.producto_id)
        .eq('activo', true)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
      setAdjustLotes(lotes ?? [])
    }
    setAdjustOpen(true)
  }

  const submitAdjust = async () => {
    if (!adjustTarget) return
    const cantidadNum = parseFloat(adjustCantidad)
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
      toast.error('Cantidad inválida', { description: 'Ingresa un número positivo mayor a 0.' })
      return
    }
    const stockActual = Number(adjustTarget.cantidad) ?? 0
    const signo = adjustTipo === 'entrada' ? 1 : -1
    const resultante = stockActual + signo * cantidadNum
    if (resultante < 0 && !adjustPermitirNeg) {
      toast.error('Stock insuficiente', {
        description: `La salida dejaría el stock en ${resultante}. Marca "Permitir negativo" para continuar.`,
      })
      return
    }

    const tieneLote = !!adjustTarget?.productos?.tiene_lote
    // Para productos con lote, validar selección
    let loteIdFinal: string | null = null
    if (tieneLote) {
      if (adjustTipo === 'salida') {
        if (!adjustLoteId) {
          toast.error('Selecciona un lote', { description: 'Este producto requiere indicar de qué lote sale.' })
          return
        }
        loteIdFinal = adjustLoteId
      } else {
        // entrada: seleccionar lote existente O crear uno nuevo
        if (adjustLoteId === '__nuevo__') {
          if (!adjustLoteNuevo.numero.trim()) {
            toast.error('Número de lote requerido')
            return
          }
        } else if (!adjustLoteId) {
          toast.error('Selecciona un lote o crea uno nuevo')
          return
        } else {
          loteIdFinal = adjustLoteId
        }
      }
    }

    setAdjustSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null
      const cantidadSigned = signo * cantidadNum

      // Crear lote nuevo si aplica (solo en entrada)
      if (tieneLote && adjustTipo === 'entrada' && adjustLoteId === '__nuevo__') {
        const { data: loteCreado, error: loteErr } = await (supabase.from('lotes') as any).insert({
          producto_id: adjustTarget.producto_id,
          numero_lote: adjustLoteNuevo.numero.trim(),
          fecha_vencimiento: adjustLoteNuevo.fecha_venc || null,
          cantidad_inicial: cantidadNum,
          cantidad_actual: cantidadNum,
          activo: true,
        }).select('id').single()
        if (loteErr) throw loteErr
        loteIdFinal = loteCreado?.id ?? null
      } else if (tieneLote && loteIdFinal) {
        // Actualizar cantidad_actual del lote existente (+/-)
        const lote = adjustLotes.find((l) => l.id === loteIdFinal)
        if (lote) {
          const nuevaCant = Math.max(0, Number(lote.cantidad_actual ?? 0) + cantidadSigned)
          const { error: loteUpdErr } = await (supabase.from('lotes') as any)
            .update({ cantidad_actual: nuevaCant, updated_at: new Date().toISOString() })
            .eq('id', loteIdFinal)
          if (loteUpdErr) throw loteUpdErr
        }
      }

      const { error: movError } = await (supabase.from('movimientos_stock') as any).insert({
        tipo: 'ajuste',
        producto_id: adjustTarget.producto_id,
        lote_id: loteIdFinal,
        cantidad: cantidadSigned,
        notas: adjustNotas || null,
        created_by: userId,
      })
      if (movError) throw movError

      const { error: stockError } = await (supabase.from('stock') as any)
        .update({ cantidad: resultante, updated_at: new Date().toISOString() })
        .eq('producto_id', adjustTarget.producto_id)
      if (stockError) throw stockError

      toast.success('Ajuste registrado', {
        description: `${adjustTipo === 'entrada' ? 'Entrada' : 'Salida'} de ${cantidadNum}. Stock: ${stockActual} → ${resultante}.`,
      })
      setAdjustOpen(false)
      loadInventario()
      // Si el detalle está abierto del mismo producto, recargar movimientos
      if (detailOpen && selected?.producto_id === adjustTarget.producto_id) {
        openDetail({ ...adjustTarget, cantidad: resultante })
      }
    } catch (err: any) {
      toast.error('No se pudo ajustar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setAdjustSaving(false)
    }
  }

  const openMovs = async (s: any) => {
    setMovsTarget(s)
    setMovsOpen(true)
    setMovsData([])
    setMovsLoading(true)
    const { data, error } = await supabase
      .from('movimientos_stock')
      .select('id, tipo, cantidad, costo_unitario, notas, referencia_tipo, created_at')
      .eq('producto_id', s.producto_id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      toast.error('No se pudieron cargar los movimientos', { description: error.message })
    }
    setMovsData(data ?? [])
    setMovsLoading(false)
  }

  // Filtrado local por código o nombre
  const stocksFiltrados = stocks.filter((s) => {
    if (!debouncedSearch) return true
    const producto = s.productos as any
    const q = debouncedSearch.toLowerCase()
    return (
      (producto?.codigo ?? '').toLowerCase().includes(q) ||
      productoLabel(producto).toLowerCase().includes(q) ||
      (producto?.nombre ?? '').toLowerCase().includes(q) ||
      (producto?.codigo ?? '').toLowerCase().includes(q)
    )
  })

  const stockBajo = stocksFiltrados.filter((s) => (Number(s.cantidad) ?? 0) < 10)
  const valorInventario = stocks.reduce(
    (acc, s) => acc + (Number(s.cantidad) ?? 0) * (Number(s.costo_promedio) ?? 0),
    0,
  )

  // Dialog de exportación con selector de rango de fechas para precio venta promedio
  const [exportando, setExportando] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const hoyISO = hoyLima()
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [rangoDesde, setRangoDesde] = useState<string>(hace30)
  const [rangoHasta, setRangoHasta] = useState<string>(hoyISO)

  function setPresetRango(preset: 'hoy' | '7d' | '30d' | 'mes' | 'mes_anterior' | 'anio') {
    const ahora = new Date()
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    if (preset === 'hoy') {
      setRangoDesde(fmt(ahora))
      setRangoHasta(fmt(ahora))
    } else if (preset === '7d') {
      setRangoDesde(fmt(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
      setRangoHasta(fmt(ahora))
    } else if (preset === '30d') {
      setRangoDesde(fmt(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
      setRangoHasta(fmt(ahora))
    } else if (preset === 'mes') {
      setRangoDesde(fmt(new Date(ahora.getFullYear(), ahora.getMonth(), 1)))
      setRangoHasta(fmt(ahora))
    } else if (preset === 'mes_anterior') {
      const inicioMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)
      const finMesAnt = new Date(ahora.getFullYear(), ahora.getMonth(), 0)
      setRangoDesde(fmt(inicioMesAnt))
      setRangoHasta(fmt(finMesAnt))
    } else if (preset === 'anio') {
      setRangoDesde(fmt(new Date(ahora.getFullYear(), 0, 1)))
      setRangoHasta(fmt(ahora))
    }
  }

  function rangoLabel(desde: string, hasta: string): string {
    const fmt = (d: string) =>
      new Date(d + 'T12:00:00').toLocaleDateString('es-PE', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    return desde === hasta ? fmt(desde) : `${fmt(desde)} al ${fmt(hasta)}`
  }

  async function exportarExcel() {
    if (rangoDesde > rangoHasta) {
      toast.error('Rango inválido', { description: 'La fecha "desde" no puede ser posterior a "hasta".' })
      return
    }
    setExportando(true)
    try {
      const { generarExcelInventario, descargarBlob } = await import('@/lib/export/inventario-excel')

      // 1) Config empresa/almacén
      const { data: confRows } = await (supabase as any)
        .from('configuracion')
        .select('clave, valor')
        .in('clave', ['empresa_razon_social', 'empresa_ruc', 'empresa_direccion', 'almacen_nombre', 'almacen_direccion'])
      const conf: Record<string, string> = {}
      ;(confRows ?? []).forEach((r: any) => { conf[r.clave] = r.valor })

      // 2) Usuario
      const { data: { user } } = await supabase.auth.getUser()
      let generadoPor = 'Sistema'
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
        generadoPor = (prof as any)?.full_name ?? user.email ?? 'Sistema'
      }

      // 3) Ventas reales en el rango — calcular precio promedio ponderado por producto
      // Σ(cantidad × precio_unitario) / Σ(cantidad) — solo comprobantes NO anulados
      const { data: ventasRaw, error: ventasErr } = await (supabase as any)
        .from('comprobantes_items')
        .select(`
          producto_id,
          cantidad,
          precio_unitario,
          subtotal,
          comprobantes!inner(fecha_emision, estado)
        `)
        .gte('comprobantes.fecha_emision', rangoDesde)
        .lte('comprobantes.fecha_emision', rangoHasta)
        .neq('comprobantes.estado', 'anulado')

      if (ventasErr) throw new Error('No se pudieron leer las ventas: ' + ventasErr.message)

      // Agrupar por producto_id
      const ventasPorProd = new Map<string, { qty: number; total: number; count: number }>()
      ;(ventasRaw ?? []).forEach((it: any) => {
        if (!it.producto_id) return
        const cant = Number(it.cantidad ?? 0)
        const precio = Number(it.precio_unitario ?? 0)
        const subt = Number(it.subtotal ?? cant * precio)
        const cur = ventasPorProd.get(it.producto_id) ?? { qty: 0, total: 0, count: 0 }
        cur.qty += cant
        cur.total += subt
        cur.count += 1
        ventasPorProd.set(it.producto_id, cur)
      })

      // 4) Armar filas combinando stock + ventas
      const rows = stocksFiltrados.map((s: any) => {
        const prod = s.productos as any
        const stockFisico = Number(s.cantidad ?? 0)
        const stockReservado = Number(s.cantidad_reservada ?? 0)
        const stockDisponible = Math.max(0, stockFisico - stockReservado)
        const costo = Number(s.costo_promedio ?? 0)
        const min = prod?.stock_minimo
        const max = prod?.stock_maximo
        let alerta: 'bajo' | 'sobre' | 'ok' | 'sin' = 'ok'
        if (stockFisico === 0) alerta = 'sin'
        else if (min != null && stockFisico < Number(min)) alerta = 'bajo'
        else if (max != null && stockFisico > Number(max)) alerta = 'sobre'

        const ventas = ventasPorProd.get(s.producto_id)
        const precioPromedio = ventas && ventas.qty > 0 ? ventas.total / ventas.qty : null

        return {
          codigo: prod?.codigo ?? '—',
          nombre: prod?.nombre ?? '—',
          descripcion: prod?.descripcion ?? null,
          familia: prod?.familias?.nombre ?? null,
          unidad: prod?.unidades_medida?.simbolo ?? null,
          stock_fisico: stockFisico,
          stock_reservado: stockReservado,
          stock_disponible: stockDisponible,
          stock_minimo: min != null ? Number(min) : null,
          stock_maximo: max != null ? Number(max) : null,
          costo_promedio: costo,
          precio_venta_promedio: precioPromedio,
          unidades_vendidas: ventas?.qty ?? 0,
          ingreso_vendido: ventas?.total ?? 0,
          valor_total: stockFisico * costo,
          alerta,
          ultima_actualizacion: s.updated_at,
        }
      })

      const fecha = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })
      const blob = await generarExcelInventario({
        empresa: {
          razon_social: conf.empresa_razon_social ?? 'AGROCAR S.R.L.',
          ruc: conf.empresa_ruc ?? '20XXXXXXXXX',
          direccion: conf.empresa_direccion ?? '',
        },
        almacen: {
          nombre: conf.almacen_nombre ?? 'AGROCAR - Almacén Central',
          direccion: conf.almacen_direccion ?? '',
        },
        fecha,
        generadoPor,
        rango: { desde: rangoDesde, hasta: rangoHasta, label: rangoLabel(rangoDesde, rangoHasta) },
        rows,
        filtros: { familia: null, estado: null, busqueda: debouncedSearch || null },
      })

      const nombreFecha = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      descargarBlob(blob, `Inventario_AGROCAR_${rangoDesde}_a_${rangoHasta}_${nombreFecha}.xlsx`)
      const conVentas = rows.filter((r) => r.precio_venta_promedio != null).length
      toast.success('Inventario exportado', {
        description: `${rows.length} productos · ${conVentas} con ventas en el período.`,
      })
      setExportOpen(false)
    } catch (err: any) {
      toast.error('No se pudo exportar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Almacén e Inventario</h1>
          <p className="text-sm text-gray-500 mt-0.5">Stock actual de productos</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setExportOpen(true)}
            disabled={exportando || stocks.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
            size="sm"
          >
            {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Exportar Excel
          </Button>
          <Link
            href="/almacen/compras"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Compras
          </Link>
          <Link
            href="/almacen/ajustes"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Ajustes
          </Link>
        </div>
      </div>

      {/* Alertas stock bajo */}
      {stockBajo.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {stockBajo.length} producto{stockBajo.length !== 1 ? 's' : ''} con stock bajo (&lt;10 unidades)
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {stockBajo.slice(0, 8).map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 border border-orange-200 rounded-full text-xs text-orange-700"
                  >
                    <TrendingDown className="w-2.5 h-2.5" />
                    {(s.productos as any)?.nombre ?? '—'} ({Number(s.cantidad)})
                  </span>
                ))}
                {stockBajo.length > 8 && (
                  <span className="text-xs text-orange-600">+{stockBajo.length - 8} más</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPIs rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Productos</p>
                <p className="text-xl font-bold text-gray-900">{stocks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Stock Bajo</p>
                <p className="text-xl font-bold text-gray-900">{stockBajo.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Valor Inventario</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(valorInventario)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buscador */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por código o nombre..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stock actual */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">Stock Actual</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : stocksFiltrados.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No hay registros de stock</div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {stocksFiltrados.map((s) => {
                  const producto = s.productos as any
                  const disponible = Number(s.cantidad) ?? 0
                  const reservada = Number(s.cantidad_reservada) ?? 0
                  const esBajo = disponible < 10
                  const simbolo = producto?.unidades_medida?.simbolo ?? ''
                  return (
                    <div
                      key={s.id}
                      className={`p-4 hover:bg-gray-50/50 ${esBajo ? 'bg-orange-50/30' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{productoLabel(producto)}</p>
                          {productoSubLabel(producto) && (
                            <p className="text-[10px] text-gray-400 truncate">{productoSubLabel(producto)}</p>
                          )}
                          <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs">
                            <span className={`font-bold ${esBajo ? 'text-orange-600' : 'text-gray-800'}`}>
                              {disponible.toLocaleString('es-PE')} {simbolo}
                            </span>
                            <span className="text-gray-500">
                              Reserv. {reservada.toLocaleString('es-PE')}
                            </span>
                          </div>
                        </div>
                        {esBajo
                          ? <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 shrink-0">Stock Bajo</Badge>
                          : <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">OK</Badge>}
                      </div>
                      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                        <div className="text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-gray-400">
                            Costo {formatCurrency(Number(s.costo_promedio) ?? 0)}
                          </span>
                          {(s as any)._precio_venta_30d != null ? (
                            <span className="text-blue-600 font-medium">
                              Venta 30d {formatCurrency((s as any)._precio_venta_30d)}
                            </span>
                          ) : (
                            <span className="text-gray-300 italic">Sin ventas 30d</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => openDetail(s)} className="h-7 text-xs gap-1">
                            <Eye className="w-3.5 h-3.5" /> Ver
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openAdjust(s)} className="h-7 text-xs gap-1">
                            <Sliders className="w-3.5 h-3.5" /> Ajustar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openMovs(s)} className="h-7 text-xs gap-1">
                            <History className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {[
                        'Código', 'Producto', 'Disponible', 'Reservado',
                        'Costo Prom.', 'Precio Venta Prom. (30d)',
                        'Última Act.', 'Estado', 'Acciones',
                      ].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stocksFiltrados.map((s) => {
                      const producto = s.productos as any
                      const disponible = Number(s.cantidad) ?? 0
                      const reservada = Number(s.cantidad_reservada) ?? 0
                      const stockMin = producto?.stock_minimo != null ? Number(producto.stock_minimo) : null
                      const stockMax = producto?.stock_maximo != null ? Number(producto.stock_maximo) : null
                      // Estado de stock: bajo_minimo, cerca_minimo, sobrestock, ok (legacy: fallback a <10 si no hay config)
                      let estadoStock: 'bajo_minimo' | 'cerca_minimo' | 'sobrestock' | 'ok' = 'ok'
                      if (stockMin != null && disponible < stockMin) estadoStock = 'bajo_minimo'
                      else if (stockMin != null && disponible < stockMin * 1.2) estadoStock = 'cerca_minimo'
                      else if (stockMax != null && disponible > stockMax) estadoStock = 'sobrestock'
                      else if (stockMin == null && disponible < 10) estadoStock = 'bajo_minimo'
                      const esAlerta = estadoStock !== 'ok'
                      const simbolo = producto?.unidades_medida?.simbolo ?? ''
                      const reorden = stockMax != null && estadoStock === 'bajo_minimo'
                        ? Math.max(0, stockMax - disponible)
                        : null
                      return (
                        <tr key={s.id} className={`hover:bg-gray-50/50 transition-colors ${estadoStock === 'bajo_minimo' ? 'bg-red-50/40' : estadoStock === 'cerca_minimo' ? 'bg-amber-50/30' : estadoStock === 'sobrestock' ? 'bg-purple-50/30' : ''}`}>
                          <td className="py-3 px-4 font-mono text-xs text-gray-500">{producto?.codigo ?? '—'}</td>
                          <td className="py-3 px-4 max-w-[280px]">
                            <div className="font-medium text-gray-900 truncate">{productoLabel(producto)}</div>
                            {productoSubLabel(producto) && (
                              <div className="text-[10px] text-gray-400 truncate">{productoSubLabel(producto)}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`font-bold ${esAlerta ? (estadoStock === 'bajo_minimo' ? 'text-red-600' : estadoStock === 'cerca_minimo' ? 'text-amber-600' : 'text-purple-600') : 'text-gray-800'}`}>
                              {disponible.toLocaleString('es-PE')}
                            </span>
                            <span className="text-xs text-gray-400 ml-1">{simbolo}</span>
                            {(stockMin != null || stockMax != null) && (
                              <div className="text-[10px] text-gray-400 font-mono">
                                {stockMin != null && `min ${stockMin}`}
                                {stockMin != null && stockMax != null && ' · '}
                                {stockMax != null && `max ${stockMax}`}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-gray-600">
                            {reservada.toLocaleString('es-PE')}
                            <span className="text-xs text-gray-400 ml-1">{simbolo}</span>
                          </td>
                          <td className="py-3 px-4 text-gray-700">{formatCurrency(Number(s.costo_promedio) ?? 0)}</td>
                          <td className="py-3 px-4">
                            {(() => {
                              const pv = (s as any)._precio_venta_30d
                              if (pv == null) return <span className="text-xs text-gray-400 italic">Sin ventas</span>
                              const c = Number(s.costo_promedio ?? 0)
                              const margenPct = c > 0 ? ((pv - c) / c) * 100 : null
                              return (
                                <div className="leading-tight">
                                  <div className="font-medium text-blue-700">{formatCurrency(pv)}</div>
                                  {margenPct != null && (
                                    <div className={`text-[10px] ${margenPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {margenPct >= 0 ? '+' : ''}{margenPct.toFixed(1)}% margen
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                          <td className="py-3 px-4 text-gray-500 text-xs">
                            {s.updated_at ? formatDate(s.updated_at) : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {estadoStock === 'bajo_minimo' ? (
                              <div>
                                <Badge className="text-xs bg-red-100 text-red-700 border-red-200">⚠ Bajo mínimo</Badge>
                                {reorden != null && (
                                  <div className="text-[10px] text-red-700 mt-0.5">Reorden: +{reorden} {simbolo}</div>
                                )}
                              </div>
                            ) : estadoStock === 'cerca_minimo' ? (
                              <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Cerca mín.</Badge>
                            ) : estadoStock === 'sobrestock' ? (
                              <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200">Sobrestock</Badge>
                            ) : (
                              <Badge className="text-xs bg-green-100 text-green-700 border-green-200">OK</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openDetail(s)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openAdjust(s)} className="h-7 w-7 p-0" title="Ajustar stock">
                                <Sliders className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openMovs(s)} className="h-7 w-7 p-0" title="Ver movimientos">
                                <History className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog Detalle de Stock */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Stock</DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const producto = selected.productos as any
            const disponible = Number(selected.cantidad) ?? 0
            const reservada = Number(selected.cantidad_reservada) ?? 0
            const libre = disponible - reservada
            const costo = Number(selected.costo_promedio) ?? 0
            const valorTotal = disponible * costo
            const simbolo = producto?.unidades_medida?.simbolo ?? ''
            return (
              <div className="space-y-5 mt-2">
                {/* Cabecera producto */}
                <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{productoLabel(producto)}</p>
                    <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      {producto?.familias?.nombre && (
                        <Badge variant="secondary" className="text-[10px]">
                          {producto.familias.nombre}
                        </Badge>
                      )}
                      {producto?.unidades_medida?.nombre && (
                        <span className="text-gray-500">
                          UM: {producto.unidades_medida.nombre} ({simbolo})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPIs de stock */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Cantidad actual</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {disponible.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Reservada</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {reservada.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 col-span-2 sm:col-span-1">
                    <p className="text-[10px] text-green-700 uppercase tracking-wide">Disponible</p>
                    <p className="text-lg font-bold text-green-800 mt-0.5">
                      {libre.toLocaleString('es-PE')} <span className="text-xs text-green-500">{simbolo}</span>
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Costo promedio</p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(costo)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 col-span-2">
                    <p className="text-[10px] text-blue-700 uppercase tracking-wide">Valor total en stock</p>
                    <p className="text-lg font-bold text-blue-800 mt-0.5">{formatCurrency(valorTotal)}</p>
                  </div>
                </div>

                {/* Lotes activos (solo si el producto maneja lote/vencimiento) */}
                {(producto?.tiene_lote || producto?.tiene_vencimiento) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                        <Boxes className="w-4 h-4 text-amber-600" />
                        Lotes activos
                      </p>
                      <Link
                        href="/almacen/lotes"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Ver todos →
                      </Link>
                    </div>
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      {loadingLotes ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-4 h-4 text-green-600 animate-spin" />
                        </div>
                      ) : lotesProducto.length === 0 ? (
                        <div className="text-center py-5 text-xs text-gray-400">
                          Sin lotes activos registrados
                        </div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50/50 border-b border-gray-100">
                            <tr>
                              {['N° Lote', 'Vencimiento', 'Cant. disp.', 'Estado'].map((h) => (
                                <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {lotesProducto.map((l: any) => {
                              const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
                              let estado: 'vencido' | 'por_vencer' | 'al_dia' = 'al_dia'
                              let dias: number | null = null
                              if (l.fecha_vencimiento) {
                                const venc = new Date(l.fecha_vencimiento + 'T00:00:00')
                                dias = Math.floor((venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
                                if (dias < 0) estado = 'vencido'
                                else if (dias < 30) estado = 'por_vencer'
                              }
                              const estadoCfg = estado === 'vencido'
                                ? { label: 'Vencido', className: 'bg-red-100 text-red-700 border-red-200', row: 'bg-red-50/40' }
                                : estado === 'por_vencer'
                                  ? { label: 'Por vencer', className: 'bg-amber-100 text-amber-700 border-amber-200', row: 'bg-amber-50/30' }
                                  : { label: 'Al día', className: 'bg-green-100 text-green-700 border-green-200', row: '' }
                              return (
                                <tr key={l.id} className={estadoCfg.row}>
                                  <td className="py-2 px-3 font-mono text-gray-700">{l.numero_lote}</td>
                                  <td className="py-2 px-3 text-gray-600">
                                    {l.fecha_vencimiento ? formatDate(l.fecha_vencimiento) : '—'}
                                    {dias !== null && (
                                      <span className="ml-1 text-[10px] text-gray-400">
                                        ({dias < 0 ? `hace ${Math.abs(dias)}d` : `en ${dias}d`})
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 font-semibold text-gray-800">
                                    {Number(l.cantidad_actual ?? 0).toLocaleString('es-PE')} {simbolo}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${estadoCfg.className}`}>
                                      {estadoCfg.label}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {/* Últimos movimientos */}
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">Últimos 10 movimientos</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    {loadingMovs ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                      </div>
                    ) : movimientos.length === 0 ? (
                      <div className="text-center py-6 text-xs text-gray-400">Sin movimientos registrados</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50/50 border-b border-gray-100">
                          <tr>
                            {['Fecha', 'Tipo', 'Cantidad', 'Notas'].map((h) => (
                              <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {movimientos.map((m) => {
                            const tipoCfg = TIPO_MOV_CONFIG[m.tipo] ?? { label: m.tipo, className: 'bg-gray-100 text-gray-700 border-gray-200' }
                            const cantidad = Number(m.cantidad) ?? 0
                            return (
                              <tr key={m.id}>
                                <td className="py-2 px-3 text-gray-500 whitespace-nowrap">
                                  {m.created_at ? formatDatetime(m.created_at) : '—'}
                                </td>
                                <td className="py-2 px-3">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${tipoCfg.className}`}>
                                    {tipoCfg.label}
                                  </span>
                                </td>
                                <td className={`py-2 px-3 font-mono font-semibold ${cantidad < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                  {cantidad > 0 ? '+' : ''}{cantidad.toLocaleString('es-PE')} {simbolo}
                                </td>
                                <td className="py-2 px-3 text-gray-500 max-w-[220px] truncate">{m.notas ?? '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                  <Button variant="outline" onClick={() => openMovs(selected)} className="gap-2">
                    <History className="w-4 h-4" /> Ver movimientos
                  </Button>
                  <Button
                    onClick={() => { setDetailOpen(false); openAdjust(selected) }}
                    className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                  >
                    <Sliders className="w-4 h-4" /> Ajustar stock
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog Ajuste de Stock */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Stock</DialogTitle>
          </DialogHeader>
          {adjustTarget && (() => {
            const producto = adjustTarget.productos as any
            const stockActual = Number(adjustTarget.cantidad) ?? 0
            const cantidadNum = parseFloat(adjustCantidad)
            const valido = Number.isFinite(cantidadNum) && cantidadNum > 0
            const signo = adjustTipo === 'entrada' ? 1 : -1
            const resultante = valido ? stockActual + signo * cantidadNum : stockActual
            const simbolo = producto?.unidades_medida?.simbolo ?? ''
            const negativo = resultante < 0
            return (
              <div className="space-y-4 mt-2">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Producto</p>
                  <p className="font-medium text-gray-900 truncate">{productoLabel(producto)}</p>
                  <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                </div>

                <div>
                  <Label className="text-xs">Tipo de ajuste</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setAdjustTipo('entrada')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        adjustTipo === 'entrada'
                          ? 'bg-green-50 border-green-300 text-green-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <TrendingUp className="w-4 h-4" /> Entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustTipo('salida')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        adjustTipo === 'salida'
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <TrendingDown className="w-4 h-4" /> Salida
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Cantidad ({simbolo || 'unidades'})</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    placeholder="0.000"
                    className="mt-1"
                    value={adjustCantidad}
                    onChange={(e) => setAdjustCantidad(e.target.value)}
                  />
                </div>

                {producto?.tiene_lote && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                    <Label className="text-xs font-semibold">
                      Lote afectado · requerido
                    </Label>
                    <select
                      value={adjustLoteId}
                      onChange={(e) => setAdjustLoteId(e.target.value)}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-[#FBE600]"
                    >
                      <option value="">Selecciona un lote...</option>
                      {adjustLotes.map((l) => {
                        const fv = l.fecha_vencimiento
                          ? new Date(l.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-PE', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                            })
                          : '—'
                        return (
                          <option key={l.id} value={l.id}>
                            {l.numero_lote} · Stock: {l.cantidad_actual} · Vence: {fv}
                          </option>
                        )
                      })}
                      {adjustTipo === 'entrada' && (
                        <option value="__nuevo__">+ Crear nuevo lote</option>
                      )}
                    </select>
                    {adjustTipo === 'entrada' && adjustLoteId === '__nuevo__' && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-yellow-200">
                        <div>
                          <Label className="text-[10px]">Nº lote</Label>
                          <Input
                            placeholder="L-2026-01"
                            className="mt-1 h-9 text-sm"
                            value={adjustLoteNuevo.numero}
                            onChange={(e) => setAdjustLoteNuevo((p) => ({ ...p, numero: e.target.value }))}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Vencimiento</Label>
                          <Input
                            type="date"
                            className="mt-1 h-9 text-sm"
                            value={adjustLoteNuevo.fecha_venc}
                            onChange={(e) => setAdjustLoteNuevo((p) => ({ ...p, fecha_venc: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                    {adjustLotes.length === 0 && adjustTipo === 'salida' && (
                      <p className="text-[11px] text-red-700">
                        No hay lotes activos. Registra una entrada primero.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Label className="text-xs">Notas</Label>
                  <Textarea
                    rows={2}
                    placeholder="Motivo del ajuste (opcional)"
                    className="mt-1"
                    value={adjustNotas}
                    onChange={(e) => setAdjustNotas(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-3">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Stock actual</p>
                    <p className="text-sm font-bold text-gray-900">
                      {stockActual.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Stock resultante</p>
                    <p className={`text-sm font-bold ${negativo ? 'text-red-600' : 'text-green-700'}`}>
                      {resultante.toLocaleString('es-PE')} <span className="text-xs text-gray-400">{simbolo}</span>
                    </p>
                  </div>
                </div>

                {negativo && (
                  <label className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adjustPermitirNeg}
                      onChange={(e) => setAdjustPermitirNeg(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>¿Permitir stock negativo?</strong> La salida dejaría el stock en {resultante}. Marca aquí para confirmar.
                    </span>
                  </label>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustSaving}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={submitAdjust}
                    disabled={adjustSaving || !valido}
                    className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                  >
                    {adjustSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Confirmar ajuste
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog Historial de Movimientos */}
      <Dialog open={movsOpen} onOpenChange={setMovsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Últimos 20 movimientos</DialogTitle>
          </DialogHeader>
          {movsTarget && (() => {
            const producto = movsTarget.productos as any
            const simbolo = producto?.unidades_medida?.simbolo ?? ''
            return (
              <div className="space-y-4 mt-2">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-900 truncate">{productoLabel(producto)}</p>
                  <p className="text-xs text-gray-500 font-mono">{producto?.codigo ?? '—'}</p>
                </div>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  {movsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                    </div>
                  ) : movsData.length === 0 ? (
                    <div className="text-center py-6 text-xs text-gray-400">Sin movimientos registrados</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50/50 border-b border-gray-100">
                        <tr>
                          {['Fecha', 'Tipo', 'Cantidad', 'Referencia', 'Notas'].map((h) => (
                            <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {movsData.map((m) => {
                          const tipoCfg = TIPO_MOV_CONFIG[m.tipo] ?? { label: m.tipo, className: 'bg-gray-100 text-gray-700 border-gray-200' }
                          const cantidad = Number(m.cantidad) ?? 0
                          return (
                            <tr key={m.id}>
                              <td className="py-2 px-3 text-gray-500 whitespace-nowrap">
                                {m.created_at ? formatDatetime(m.created_at) : '—'}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${tipoCfg.className}`}>
                                  {tipoCfg.label}
                                </span>
                              </td>
                              <td className={`py-2 px-3 font-mono font-semibold ${cantidad < 0 ? 'text-red-600' : 'text-green-700'}`}>
                                {cantidad > 0 ? '+' : ''}{cantidad.toLocaleString('es-PE')} {simbolo}
                              </td>
                              <td className="py-2 px-3 text-gray-500">{m.referencia_tipo ?? '—'}</td>
                              <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate">{m.notas ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="flex justify-end pt-3 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setMovsOpen(false)}>Cerrar</Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog: Exportar Excel con rango de fechas */}
      <Dialog open={exportOpen} onOpenChange={(o) => { if (!exportando) setExportOpen(o) }}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="w-5 h-5 text-green-600" />
              Exportar Inventario a Excel
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
              El Excel incluye <strong>inventario actualizado</strong> + <strong>precio venta promedio</strong> calculado de las ventas reales (comprobantes no anulados) del período seleccionado, ponderado por cantidad: <span className="font-mono">Σ(cantidad × precio) ÷ Σ(cantidad)</span>.
            </div>

            <div>
              <Label className="text-sm">Atajos</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[
                  { key: 'hoy', label: 'Hoy' },
                  { key: '7d', label: 'Últimos 7 días' },
                  { key: '30d', label: 'Últimos 30 días' },
                  { key: 'mes', label: 'Mes actual' },
                  { key: 'mes_anterior', label: 'Mes anterior' },
                  { key: 'anio', label: 'Año actual' },
                ].map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPresetRango(p.key as any)}
                    disabled={exportando}
                    className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200 disabled:opacity-50"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Desde</Label>
                <Input
                  type="date"
                  value={rangoDesde}
                  max={rangoHasta}
                  onChange={(e) => setRangoDesde(e.target.value)}
                  disabled={exportando}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm">Hasta</Label>
                <Input
                  type="date"
                  value={rangoHasta}
                  min={rangoDesde}
                  max={hoyISO}
                  onChange={(e) => setRangoHasta(e.target.value)}
                  disabled={exportando}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
              <strong>Período seleccionado:</strong> {rangoLabel(rangoDesde, rangoHasta)}
              <br />
              Productos en inventario: <strong>{stocksFiltrados.length}</strong>
              {debouncedSearch && (
                <>
                  <br />
                  Filtro de búsqueda aplicado: <span className="font-mono">&quot;{debouncedSearch}&quot;</span>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exportando}>
                Cancelar
              </Button>
              <Button
                onClick={exportarExcel}
                disabled={exportando || rangoDesde > rangoHasta}
                className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
              >
                {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                Generar Excel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
