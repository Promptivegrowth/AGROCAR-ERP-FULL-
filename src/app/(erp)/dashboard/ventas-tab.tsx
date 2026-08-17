'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Zap, ChevronRight, ChevronDown, TrendingUp, History, FileSpreadsheet } from 'lucide-react'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const COLORS_PIE = ['#FBE600', '#0A0A0A', '#94a3b8', '#1e40af', '#16a34a', '#dc2626', '#7c3aed']

export default function VentasTab() {
  const supabase = createClient()
  const now = new Date()
  const [anio, setAnio] = useState<number>(now.getFullYear())
  const [familiaSel, setFamiliaSel] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [pedidos, setPedidos] = useState<any[]>([])
  const [pedidosAll, setPedidosAll] = useState<any[]>([])
  const [familias, setFamilias] = useState<any[]>([])

  useEffect(() => {
    ;(async () => {
      const { data: f } = await supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre')
      setFamilias(f ?? [])
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [{ data: p }, { data: pAll }] = await Promise.all([
        (supabase as any)
          .from('pedidos')
          .select(`
            id, fecha_pedido, total, subtotal, estado,
            pedidos_items(cantidad, subtotal, costo_unitario, utilidad, productos(id, codigo, nombre, descripcion, costo_promedio, familias(id, nombre)))
          `)
          .gte('fecha_pedido', `${anio}-01-01`)
          .lte('fecha_pedido', `${anio}-12-31`)
          .in('estado', ['facturado','despachado','entregado']),
        (supabase as any)
          .from('pedidos')
          .select('fecha_pedido, total, subtotal, pedidos_items(cantidad, subtotal, costo_unitario, utilidad, productos(costo_promedio))')
          .in('estado', ['facturado','despachado','entregado']),
      ])
      setPedidos(p ?? [])
      setPedidosAll(pAll ?? [])
      setLoading(false)
    })()
  }, [anio])

  // ─── Costo y utilidad reales ───────────────────────────────────────────────
  /**
   * Costo de la línea = precio de compra × cantidad.
   *
   * Christopher: "el precio de compra es el monto ingresado del almacén, el
   * valor del costo por unidad o kilogramo que se compra al proveedor, en otras
   * palabras el costo promedio".
   *
   * Se prefiere el costo que quedó congelado al vender —es el que de verdad
   * costó esa mercadería— y si esa línea no lo tiene se usa el costo promedio
   * que el producto tiene hoy en almacén. Devuelve null cuando el producto
   * todavía no tiene ningún costo cargado: en ese caso no se inventa nada.
   *
   * Antes había un margen fijo del 22% para las líneas sin costo, y encima se
   * confiaba en la utilidad que guardó el trigger aunque se hubiera calculado
   * con costo cero. Por eso el CHORIZO CON ORÉGANO figuraba con 92% de margen
   * y la MORTADELA con 100%: con el costo real son 15% y sin dato.
   */
  const costoDeLinea = (it: any): number | null => {
    const cant = Number(it.cantidad ?? 0)
    const congelado = Number(it.costo_unitario ?? 0)
    if (congelado > 0) return congelado * cant
    const promedio = Number(it.productos?.costo_promedio ?? 0)
    if (promedio > 0) return promedio * cant
    return null
  }
  const utilidadDeLinea = (it: any) => {
    const costo = costoDeLinea(it)
    if (costo === null) return 0
    return Number(it.subtotal ?? 0) - costo
  }
  /** Venta que sí tiene costo conocido: es sobre esta que el margen es honesto. */
  const ventaCosteadaDeLinea = (it: any) =>
    costoDeLinea(it) === null ? 0 : Number(it.subtotal ?? 0)

  const ventaDePedido = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + Number(it.subtotal ?? 0), 0)
  const utilidadDePedido = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + utilidadDeLinea(it), 0)
  const ventaCosteadaDePedido = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + ventaCosteadaDeLinea(it), 0)

  // ─── Filtro por familia ────────────────────────────────────────────────────
  const pedidosFiltrados = useMemo(() => {
    if (familiaSel === 'todas') return pedidos
    return pedidos.map((p: any) => ({
      ...p,
      pedidos_items: (p.pedidos_items ?? []).filter((it: any) => it.productos?.familias?.id === familiaSel),
    })).filter((p: any) => p.pedidos_items.length > 0)
  }, [pedidos, familiaSel])

  const totalVentas = pedidosFiltrados.reduce((a, p) => a + ventaDePedido(p), 0)
  const totalUtilidad = pedidosFiltrados.reduce((a, p) => a + utilidadDePedido(p), 0)
  // El margen se mide contra la venta que tiene costo conocido, no contra la
  // venta total: si no, los productos sin costo lo hunden como si no dejaran nada.
  const totalVentaCosteada = pedidosFiltrados.reduce((a, p) => a + ventaCosteadaDePedido(p), 0)
  const margenPct = totalVentaCosteada > 0 ? (totalUtilidad / totalVentaCosteada) * 100 : 0
  const ventaSinCosto = totalVentas - totalVentaCosteada

  // ─── Predictivo fin de año ─────────────────────────────────────────────────
  const totalDias = now.getFullYear() === anio
    ? Math.max(1, Math.ceil((now.getTime() - new Date(anio, 0, 1).getTime()) / 86400000))
    : 365
  const proyeccionAnual = totalDias > 0 ? (totalVentas / totalDias) * 365 : 0

  // ─── Trimestres ────────────────────────────────────────────────────────────
  const trimestres = useMemo(() => {
    const res = [
      { label: 'TRIM.1', ventas: 0, utilidad: 0 },
      { label: 'TRIM.2', ventas: 0, utilidad: 0 },
      { label: 'TRIM.3', ventas: 0, utilidad: 0 },
      { label: 'TRIM.4', ventas: 0, utilidad: 0 },
    ]
    pedidosFiltrados.forEach((p: any) => {
      const m = new Date(p.fecha_pedido + 'T12:00:00').getMonth()
      const q = Math.floor(m / 3)
      res[q].ventas += ventaDePedido(p)
      res[q].utilidad += utilidadDePedido(p)
    })
    return res.map((r) => ({
      ...r,
      ventas: Math.round(r.ventas),
      utilidad: Math.round(r.utilidad),
      margen: r.ventas > 0 ? Math.round((r.utilidad / r.ventas) * 100) : 0,
    }))
  }, [pedidosFiltrados])

  // ─── Donut por familia ─────────────────────────────────────────────────────
  const porFamilia = useMemo(() => {
    const map = new Map<string, number>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const fam = it.productos?.familias?.nombre ?? 'Sin familia'
        map.set(fam, (map.get(fam) ?? 0) + Number(it.subtotal ?? 0))
      })
    })
    return Array.from(map.entries())
      .map(([nombre, total]) => ({ nombre, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total)
  }, [pedidosFiltrados])

  // ─── Tabla familia → productos (expandible) ────────────────────────────────
  // Además de ventas y utilidad lleva CANTIDAD y PRECIO PROMEDIO, que
  // Christopher pidió a la derecha de la columna de ventas. El precio promedio
  // es ventas ÷ cantidad, tal cual su ejemplo: 14,450.20 / 852 = 16.96.
  type Acum = { ventas: number; costeada: number; utilidad: number; cantidad: number }
  const nuevoAcum = (): Acum => ({ ventas: 0, costeada: 0, utilidad: 0, cantidad: 0 })

  const tablaFamilia = useMemo(() => {
    const map = new Map<string, Acum & { familia: string; productos: Map<string, Acum> }>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const fam = it.productos?.familias?.nombre ?? 'Sin familia'
        const prev = map.get(fam) ?? { familia: fam, ...nuevoAcum(), productos: new Map<string, Acum>() }
        const v = Number(it.subtotal ?? 0)
        const c = Number(it.cantidad ?? 0)
        const u = utilidadDeLinea(it)
        const vc = ventaCosteadaDeLinea(it)
        prev.ventas += v; prev.costeada += vc; prev.utilidad += u; prev.cantidad += c
        const pn = it.productos?.descripcion?.trim() || it.productos?.nombre || '—'
        const pp = prev.productos.get(pn) ?? nuevoAcum()
        pp.ventas += v; pp.costeada += vc; pp.utilidad += u; pp.cantidad += c
        prev.productos.set(pn, pp)
        map.set(fam, prev)
      })
    })

    // El margen se mide sobre la venta con costo conocido; si no hay ninguna,
    // queda en null y la pantalla muestra "—" en vez de un porcentaje falso.
    const armar = (r: Acum) => ({
      ventas: Math.round(r.ventas),
      cantidad: Math.round(r.cantidad * 100) / 100,
      precioProm: r.cantidad > 0 ? r.ventas / r.cantidad : 0,
      utilidad: r.costeada > 0 ? Math.round(r.utilidad) : null,
      margen: r.costeada > 0 ? Math.round((r.utilidad / r.costeada) * 100) : null,
      sinCosto: r.ventas - r.costeada > 0.009,
    })

    return Array.from(map.values()).map((r) => ({
      familia: r.familia,
      ...armar(r),
      productos: Array.from(r.productos.entries())
        .map(([nombre, v]) => ({ nombre, ...armar(v) }))
        .sort((a, b) => b.ventas - a.ventas),
    })).sort((a, b) => b.ventas - a.ventas)
  }, [pedidosFiltrados])

  const maxVentaFamilia = Math.max(1, ...tablaFamilia.map((f) => f.ventas))
  const maxUtilidadFamilia = Math.max(1, ...tablaFamilia.map((f) => f.utilidad ?? 0))

  /**
   * Totales de un grupo de pedidos con el MISMO proceso que la tabla de
   * familia y productos.
   *
   * Christopher: "solo debe seguir el mismo proceso para sacar los valores de
   * total ventas y total utilidad, solo que en esta tabla solo se tendrán las
   * columnas de año, mes, total ventas, total utilidad y margen".
   *
   * O sea: la venta se suma de las líneas (cantidad × precio), no del total de
   * la cabecera del pedido, y la utilidad sale de restarle el costo de compra
   * por cantidad. La cantidad y el precio promedio no se muestran acá, pero el
   * cálculo es el mismo por debajo.
   */
  const totalesDe = (lista: any[]) => {
    let ventas = 0, costeada = 0, utilidad = 0
    lista.forEach((p: any) => {
      ventas += ventaDePedido(p)
      costeada += ventaCosteadaDePedido(p)
      utilidad += utilidadDePedido(p)
    })
    return {
      ventas: Math.round(ventas),
      utilidad: costeada > 0 ? Math.round(utilidad) : null,
      margen: costeada > 0 ? Math.round((utilidad / costeada) * 100) : null,
      sinCosto: ventas - costeada > 0.009,
    }
  }

  // ─── Comparativa anual + ventas por año (línea) ────────────────────────────
  const comparativaAnual = useMemo(() => {
    const map = new Map<number, any[]>()
    pedidosAll.forEach((p: any) => {
      const y = new Date(p.fecha_pedido + 'T12:00:00').getFullYear()
      map.set(y, [...(map.get(y) ?? []), p])
    })
    return Array.from(map.entries())
      .map(([anio, lista]) => {
        const t = totalesDe(lista)
        // Los gráficos necesitan número, no null: sin costo se dibuja en cero
        return { anio, ventas: t.ventas, utilidad: t.utilidad ?? 0, margen: t.margen ?? 0 }
      })
      .sort((a, b) => a.anio - b.anio)
  }, [pedidosAll])

  // ─── Histórico mes/año con barras de progreso ──────────────────────────────
  const historico = useMemo(() => {
    const map = new Map<string, { anio: number; mes: number; lista: any[] }>()
    pedidosAll.forEach((p: any) => {
      const d = new Date(p.fecha_pedido + 'T12:00:00')
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const prev = map.get(key) ?? { anio: d.getFullYear(), mes: d.getMonth(), lista: [] }
      prev.lista.push(p)
      map.set(key, prev)
    })
    return Array.from(map.values())
      .map((r) => {
        const t = totalesDe(r.lista)
        return {
          anio: r.anio, mes: r.mes,
          ventas: t.ventas, utilidad: t.utilidad,
          margenPct: t.margen, sinCosto: t.sinCosto,
        }
      })
      .sort((a, b) => b.anio - a.anio || b.mes - a.mes)
      .slice(0, 18)
  }, [pedidosAll])

  const maxVentaMes = Math.max(1, ...historico.map((h) => h.ventas))
  const maxUtilidadMes = Math.max(1, ...historico.map((h) => h.utilidad ?? 0))

  /**
   * Exporta las cifras del tablero de ventas. Christopher: "sé que no saldrán
   * idénticos como se muestra en el sistema, pero lo que busco es la
   * información de los montos y valores que tienen".
   */
  const exportarExcel = () => {
    const f: string[] = []
    const famNombre = familiaSel === 'todas'
      ? 'Todas las familias'
      : (familias.find((x: any) => x.id === familiaSel)?.nombre ?? '')
    f.push(`DASHBOARD DE VENTAS;Año ${anio};${famNombre}`)
    f.push('')
    f.push('RESUMEN')
    f.push('Concepto;Valor')
    f.push(`Total ventas;${totalVentas.toFixed(2)}`)
    f.push(`Total utilidad;${totalUtilidad.toFixed(2)}`)
    f.push(`Margen %;${margenPct.toFixed(1)}`)
    f.push(`Venta sin costo cargado;${ventaSinCosto.toFixed(2)}`)
    f.push(`Proyeccion fin de año;${proyeccionAnual.toFixed(2)}`)
    f.push('')
    f.push('TRIMESTRES')
    f.push('Trimestre;Ventas;Utilidad;Margen %')
    trimestres.forEach((t) => f.push(`${t.label};${t.ventas};${t.utilidad};${t.margen}`))
    f.push('')
    f.push('VENTAS POR FAMILIA (donut)')
    f.push('Familia;Ventas')
    porFamilia.forEach((r) => f.push(`"${r.nombre}";${r.total}`))
    f.push('')
    f.push('TOTALES POR FAMILIA Y PRODUCTOS')
    f.push('Nivel;Familia;Producto;Ventas;Cantidad;Precio promedio;Utilidad;Margen %')
    tablaFamilia.forEach((fam) => {
      f.push([
        'FAMILIA', `"${fam.familia}"`, '',
        fam.ventas, fam.cantidad, fam.precioProm.toFixed(2),
        fam.utilidad ?? '', fam.margen ?? '',
      ].join(';'))
      fam.productos.forEach((pr: any) => {
        f.push([
          'PRODUCTO', `"${fam.familia}"`, `"${String(pr.nombre).replace(/"/g, "'")}"`,
          pr.ventas, pr.cantidad, pr.precioProm.toFixed(2),
          pr.utilidad ?? '', pr.margen ?? '',
        ].join(';'))
      })
    })
    f.push('')
    f.push('COMPARATIVA ANUAL')
    f.push('Año;Ventas;Utilidad;Margen %')
    comparativaAnual.forEach((r: any) => f.push(`${r.anio};${r.ventas};${r.utilidad};${r.margen}`))
    f.push('')
    f.push('HISTORICO MENSUAL')
    f.push('Periodo;Ventas;Utilidad;Margen %')
    historico.forEach((r: any) => f.push(
      `${r.anio}-${String(r.mes + 1).padStart(2, '0')};${r.ventas};${r.utilidad ?? ''};${r.margenPct ?? ''}`))

    const blob = new Blob([String.fromCharCode(65279) + f.join(String.fromCharCode(13, 10))],
      { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dashboard_ventas_${anio}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-slate-800 text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-slate-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={familiaSel} onValueChange={setFamiliaSel}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las familias</SelectItem>
              {familias.map((f) => <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <button type="button" onClick={exportarExcel}
            className="h-9 inline-flex items-center justify-center gap-1.5 px-3 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-amber-500 animate-spin" /></div>
      ) : (
        <Tabs defaultValue="actual" className="space-y-4">
          <TabsList className="bg-gray-100 p-1 rounded-xl">
            <TabsTrigger value="actual" className="rounded-lg text-xs gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <TrendingUp className="w-3.5 h-3.5" /> Vista Anual ({anio})
            </TabsTrigger>
            <TabsTrigger value="historico" className="rounded-lg text-xs gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <History className="w-3.5 h-3.5" /> Ventas Históricas
            </TabsTrigger>
          </TabsList>

          {/* ────────────── TAB VISTA ANUAL ────────────── */}
          <TabsContent value="actual" className="space-y-4">
            {/* 3 KPI Trimestres grandes */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <KpiVenta titulo={`TOTAL VENTAS: ${formatCurrency(totalVentas)}`} data={trimestres} dataKey="ventas" color="#1e40af" headerClass="bg-slate-800 text-white" />
              <KpiVenta titulo={`TOTAL UTILIDAD: ${formatCurrency(totalUtilidad)}`} data={trimestres} dataKey="utilidad" color="#FBE600" headerClass="bg-[#FBE600] text-gray-900" />
              <KpiVenta titulo={`MARGEN UTILIDAD: ${margenPct.toFixed(1)}%`} data={trimestres} dataKey="margen" color="#0A0A0A" headerClass="bg-gray-200 text-gray-900" esPct />
            </div>

            {/* Predictivo */}
            <Card className="border-amber-200 bg-gradient-to-br from-yellow-50 to-amber-100">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#FBE600] flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-gray-900" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-amber-900 font-bold">Proyección Fin de Año {anio}</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(proyeccionAnual)}</p>
                  <p className="text-xs text-gray-700">
                    Basado en el ritmo diario actual · Utilidad estimada {formatCurrency(proyeccionAnual * (margenPct / 100))}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Donut + tabla familia expandible */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="border-gray-200 shadow-sm lg:col-span-1">
                <CardHeader className="pb-1">
                  <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                    Ventas por familia
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {porFamilia.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin ventas en el período</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={porFamilia} dataKey="total" nameKey="nombre" cx="50%" cy="50%" innerRadius={55} outerRadius={90} label={(e: any) => `${(e.percent * 100).toFixed(0)}%`}>
                          {porFamilia.map((_, idx) => <Cell key={idx} fill={COLORS_PIE[idx % COLORS_PIE.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gray-200 shadow-sm lg:col-span-2">
                <CardHeader className="pb-1">
                  <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                    Totales por familia y productos
                  </CardTitle>
                  <p className="text-[11px] text-gray-500 mt-1">Click sobre una familia para ver el desglose por producto</p>
                </CardHeader>
                <CardContent className="p-0">
                  <TablaFamilia data={tablaFamilia} maxVenta={maxVentaFamilia} maxUtilidad={maxUtilidadFamilia} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ────────────── TAB VENTAS HISTÓRICAS ────────────── */}
          <TabsContent value="historico" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                  <CardTitle className="text-sm font-bold">Comparativa anual: ventas x margen utilidad</CardTitle>
                </CardHeader>
                <CardContent>
                  {comparativaAnual.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin datos históricos aún</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={comparativaAnual}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="anio" fontSize={11} />
                        <YAxis yAxisId="left" tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} fontSize={10} />
                        <Tooltip formatter={(v: any, name: any) => name === 'margen' ? `${v}%` : formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="ventas" fill="#FBE600" name="Ventas" radius={[4,4,0,0]} />
                        <Line yAxisId="right" type="monotone" dataKey="margen" stroke="#0A0A0A" strokeWidth={2} name="Margen %" dot={{ r: 4 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                  <CardTitle className="text-sm font-bold">Ventas x año (línea)</CardTitle>
                </CardHeader>
                <CardContent>
                  {comparativaAnual.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin datos históricos aún</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={comparativaAnual}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="anio" fontSize={11} />
                        <YAxis tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                        <Line type="monotone" dataKey="ventas" stroke="#FBE600" strokeWidth={3} dot={{ fill: '#0A0A0A', r: 5 }} activeDot={{ r: 7 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                <CardTitle className="text-sm font-bold">Histórico por mes y año</CardTitle>
                <p className="text-[11px] text-gray-300">
                  La barra junto a cada monto indica su tamaño relativo al mes
                  pico. Ventas y utilidad se calculan igual que en «Totales por
                  familia y productos»: la venta sale de las líneas del pedido y
                  la utilidad de restarle el costo de compra por cantidad.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0 z-10">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Año</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Mes</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Total Ventas</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Total Utilidad</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historico.length === 0 ? (
                        <tr><td colSpan={5} className="py-12 text-center text-gray-400 text-xs">Sin datos históricos aún. Empieza a registrar pedidos.</td></tr>
                      ) : historico.map((h, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 px-3 text-xs text-gray-600">{h.anio}</td>
                          <td className="py-1.5 px-3 text-xs text-gray-800 capitalize">{MESES[h.mes]}</td>
                          <td className="py-1.5 px-3">
                            <BarraMonto valor={h.ventas} max={maxVentaMes} color="#FBE600" textColor="text-gray-900" />
                          </td>
                          <td className="py-1.5 px-3">
                            {h.utilidad === null
                              ? <span className="text-xs text-gray-400">Sin costo</span>
                              : <BarraMonto valor={h.utilidad} max={maxUtilidadMes} color="#bfdbfe" textColor="text-blue-700" />}
                          </td>
                          <td className="py-1.5 px-3 text-xs text-right">
                            {h.margenPct === null ? (
                              <span className="text-xs text-gray-400">—</span>
                            ) : (
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${h.margenPct >= 20 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {h.margenPct}%{h.sinCosto ? '*' : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historico.some((h) => h.sinCosto) && (
                  <p className="text-[10px] text-gray-500 px-3 py-2 border-t">
                    * Ese mes tiene ventas de productos sin costo de compra
                    cargado en almacén; su venta se cuenta pero queda fuera del
                    margen.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function KpiVenta({ titulo, data, dataKey, color, headerClass, esPct }: any) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className={`pb-1 ${headerClass} rounded-t-xl`}>
        <CardTitle className="text-sm font-bold">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" fontSize={10} />
            <YAxis tickFormatter={(v) => esPct ? `${v}%` : `S/ ${(v/1000).toFixed(0)}k`} fontSize={9} />
            <Tooltip formatter={(v: any) => esPct ? `${v}%` : formatCurrency(Number(v))} />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function TablaFamilia({ data, maxVenta, maxUtilidad }: { data: any[]; maxVenta: number; maxUtilidad: number }) {
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const toggle = (familia: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(familia)) next.delete(familia)
      else next.add(familia)
      return next
    })
  }

  if (data.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-12">Sin ventas en el período</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Familia / Producto</th>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Ventas</th>
            <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase whitespace-nowrap">Cantidad</th>
            <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase whitespace-nowrap">Precio prom.</th>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Utilidad</th>
            <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
          </tr>
        </thead>
        <tbody>
          {data.map((fam, i) => {
            const exp = expandidas.has(fam.familia)
            const maxProdVenta = Math.max(1, ...fam.productos.map((p: any) => p.ventas))
            const maxProdUtil = Math.max(1, ...fam.productos.map((p: any) => p.utilidad ?? 0))
            return (
              <>
                <tr
                  key={`fam-${i}`}
                  className="bg-yellow-50 border-b border-yellow-200 cursor-pointer hover:bg-yellow-100 transition-colors"
                  onClick={() => toggle(fam.familia)}
                >
                  <td className="py-2 px-3 text-xs font-bold text-gray-900">
                    <span className="inline-flex items-center gap-1">
                      {exp ? <ChevronDown className="w-4 h-4 text-gray-600" /> : <ChevronRight className="w-4 h-4 text-gray-600" />}
                      {fam.familia}
                    </span>
                  </td>
                  <td className="py-2 px-3"><BarraMonto valor={fam.ventas} max={maxVenta} color="#FBE600" textColor="text-gray-900 font-semibold" /></td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-gray-800 tabular-nums">{cant(fam.cantidad)}</td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-gray-800 tabular-nums whitespace-nowrap">{formatCurrency(fam.precioProm)}</td>
                  <td className="py-2 px-3">
                    {fam.utilidad === null
                      ? <span className="text-xs text-gray-400">Sin costo</span>
                      : <BarraMonto valor={fam.utilidad} max={maxUtilidad} color="#bfdbfe" textColor="text-blue-700" />}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {fam.margen === null ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${fam.margen >= 20 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {fam.margen}%{fam.sinCosto ? '*' : ''}
                      </span>
                    )}
                  </td>
                </tr>
                {exp && fam.productos.map((pr: any, j: number) => (
                  <tr key={`prod-${i}-${j}`} className="border-b border-gray-50 bg-white">
                    <td className="py-1.5 px-3 text-xs text-gray-600 pl-10">{pr.nombre}</td>
                    <td className="py-1.5 px-3"><BarraMonto valor={pr.ventas} max={maxProdVenta} color="#fde68a" textColor="text-gray-700" small /></td>
                    <td className="py-1.5 px-3 text-xs text-right text-gray-700 tabular-nums">{cant(pr.cantidad)}</td>
                    <td className="py-1.5 px-3 text-xs text-right text-gray-700 tabular-nums whitespace-nowrap">{formatCurrency(pr.precioProm)}</td>
                    <td className="py-1.5 px-3">
                      {pr.utilidad === null
                        ? <span className="text-[10px] text-gray-400">Sin costo cargado</span>
                        : <BarraMonto valor={pr.utilidad} max={maxProdUtil} color="#dbeafe" textColor="text-blue-600" small />}
                    </td>
                    <td className="py-1.5 px-3 text-xs text-right text-gray-500">{pr.margen === null ? '—' : `${pr.margen}%`}</td>
                  </tr>
                ))}
              </>
            )
          })}
        </tbody>
      </table>
      {data.some((f: any) => f.sinCosto) && (
        <p className="text-[10px] text-gray-500 px-3 py-2 border-t">
          * Hay productos sin costo de compra cargado en almacén. Su venta se
          cuenta, pero no entra al margen: se calcula solo sobre la venta con
          costo conocido para no inflarlo.
        </p>
      )}
    </div>
  )
}

/** Cantidades: enteras cuando lo son, con decimales cuando se vende por kilo. */
function cant(v: number) {
  const n = Number(v ?? 0)
  return n.toLocaleString('es-PE', { maximumFractionDigits: 2 })
}

function BarraMonto({ valor, max, color, textColor = '', small = false }: { valor: number; max: number; color: string; textColor?: string; small?: boolean }) {
  const pct = max > 0 ? Math.min(100, (valor / max) * 100) : 0
  return (
    <div className="relative w-full max-w-[180px]">
      <div className={`h-${small ? '4' : '5'} bg-gray-100 rounded relative overflow-hidden`}>
        <div className="absolute inset-y-0 left-0 rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.65 }} />
        <div className={`relative z-10 px-2 ${small ? 'text-[10px] leading-4' : 'text-[11px] leading-5'} font-mono ${textColor}`}>
          {formatCurrency(valor)}
        </div>
      </div>
    </div>
  )
}
