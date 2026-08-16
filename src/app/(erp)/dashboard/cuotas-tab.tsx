'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Target, TrendingUp, TrendingDown, Loader2, Award, Package, FileSpreadsheet } from 'lucide-react'

const BRAND = '#FBE600'
const GRAY = '#94a3b8'

export default function CuotasTab() {
  const supabase = createClient()
  const now = new Date()
  const [loading, setLoading] = useState(true)
  // Rango de fechas, igual que el Análisis zonificado (pedido de Christopher)
  const primeroDelMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const [desdeFecha, setDesdeFecha] = useState(primeroDelMes.toISOString().split('T')[0])
  const [hastaFecha, setHastaFecha] = useState(now.toISOString().split('T')[0])
  const [vendedorSel, setVendedorSel] = useState<string>('todos')
  const [familiaSel, setFamiliaSel] = useState<string>('todas')

  const [vendedores, setVendedores] = useState<any[]>([])
  const [familias, setFamilias] = useState<any[]>([])
  const [pedidos, setPedidos] = useState<any[]>([])
  const [cobros, setCobros] = useState<any[]>([])
  const [cuotasMonto, setCuotasMonto] = useState<any[]>([])
  // Alcance de objetivos del rango: es la MISMA fuente que el reporte de
  // Gestión de Vendedores, agrupado por línea (familia). Christopher: "la
  // información debe provenir de la gestión de vendedor dentro de alcance de
  // objetivos" y con el mismo modelo.
  const [alcance, setAlcance] = useState<any>(null)

  useEffect(() => {
    ;(async () => {
      const [{ data: v }, { data: f }] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'vendedor').eq('activo', true).order('full_name'),
        supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre'),
      ])
      setVendedores(v ?? [])
      setFamilias(f ?? [])
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const desde = desdeFecha
      const hasta = hastaFecha
      const [{ data: peds }, { data: cobs }, { data: m }, { data: cp }] = await Promise.all([
        (supabase as any)
          .from('pedidos')
          .select('id, vendedor_id, fecha_pedido, total, subtotal')
          .gte('fecha_pedido', desde)
          .lte('fecha_pedido', hasta)
          .in('estado', ['facturado','despachado','entregado']),
        (supabase as any)
          .from('cobros')
          .select('cobrador_id, fecha, total')
          .gte('fecha', desde)
          .lte('fecha', hasta),
        // La cuota del vendedor sale del rollup por familia de las cuotas por
        // producto. Antes se leía `metas_vendedor` y `cuotas_producto`, dos
        // tablas que están VACÍAS: por eso todo el tablero mostraba cero
        // aunque Daniel ya tenía sus cuotas cargadas.
        (supabase as any)
          .from('cuotas_vendedor_familia')
          .select('vendedor_id, anio, mes, cuota_monto')
          .gt('cuota_monto', 0),
        (supabase as any).rpc('alcance_objetivos_rango', {
          p_desde: desde,
          p_hasta: hasta,
          p_vendedor_id: vendedorSel === 'todos' ? null : vendedorSel,
          p_familia_id: familiaSel === 'todas' ? null : familiaSel,
        }),
      ])
      setPedidos(peds ?? [])
      setCobros(cobs ?? [])
      setCuotasMonto(m ?? [])
      setAlcance(cp ?? null)
      setLoading(false)
    })()
  }, [desdeFecha, hastaFecha, vendedorSel, familiaSel])

  /**
   * Cuota que le corresponde al rango elegido.
   *
   * La cuota se asigna por MES, pero el filtro es un rango libre. Sumar los
   * meses completos que toca el rango inflaría la meta: un rango del 16/07 al
   * 15/08 sumaría julio y agosto enteros cuando solo cubre media parte de cada
   * uno. Por eso cada mes aporta en proporción a los días que el rango cubre
   * de ese mes, y el porcentaje de cumplimiento queda comparable.
   */
  const factorMes = useMemo(() => {
    const ini = new Date(desdeFecha + 'T12:00:00')
    const fin = new Date(hastaFecha + 'T12:00:00')
    return (anio: number, mes: number) => {
      const primero = new Date(anio, mes - 1, 1)
      const ultimo = new Date(anio, mes, 0)
      const desdeEfec = ini > primero ? ini : primero
      const hastaEfec = fin < ultimo ? fin : ultimo
      if (hastaEfec < desdeEfec) return 0
      const dias = Math.floor((hastaEfec.getTime() - desdeEfec.getTime()) / 86400000) + 1
      return dias / ultimo.getDate()
    }
  }, [desdeFecha, hastaFecha])

  const cuotaDelRango = useMemo(() => {
    const porVendedor = new Map<string, number>()
    cuotasMonto.forEach((c: any) => {
      const f = factorMes(Number(c.anio), Number(c.mes))
      if (f === 0) return
      const parte = Number(c.cuota_monto ?? 0) * f
      porVendedor.set(c.vendedor_id, (porVendedor.get(c.vendedor_id) ?? 0) + parte)
    })
    return porVendedor
  }, [cuotasMonto, factorMes])

  // Ventas por vendedor + cobranzas
  const perVendedor = useMemo(() => {
    const lista = vendedorSel === 'todos'
      ? vendedores
      : vendedores.filter((v) => v.id === vendedorSel)
    return lista.map((v) => {
      const ventas = pedidos.filter((p) => p.vendedor_id === v.id).reduce((a, p) => a + Number(p.total ?? 0), 0)
      const cobrado = cobros.filter((c) => c.cobrador_id === v.id).reduce((a, c) => a + Number(c.total ?? 0), 0)
      return {
        id: v.id,
        // Solo el primer nombre y el primer apellido: con el nombre completo
        // las etiquetas del eje no entran y el gráfico oculta algunas —por eso
        // Daniel Caichihua aparecía sin nombre.
        nombre: v.full_name.split(' ').slice(0, 2).join(' '),
        ventas: Math.round(ventas),
        cuota: Math.round(cuotaDelRango.get(v.id) ?? 0),
        cobrado: Math.round(cobrado),
      }
    })
  }, [vendedores, pedidos, cobros, cuotaDelRango, vendedorSel])

  const totalVenta = perVendedor.reduce((a, v) => a + v.ventas, 0)
  const totalCuota = perVendedor.reduce((a, v) => a + v.cuota, 0)
  const totalCobrado = perVendedor.reduce((a, v) => a + v.cobrado, 0)
  const pctCumplimiento = totalCuota > 0 ? (totalVenta / totalCuota) * 100 : 0

  // Proyección: se toma el ritmo diario de lo vendido hasta hoy dentro del
  // rango y se extiende al rango completo. Si el rango ya terminó, la
  // proyección es lo vendido: no hay nada que proyectar.
  const diasRango = Math.max(1,
    Math.floor((new Date(hastaFecha + 'T12:00:00').getTime()
              - new Date(desdeFecha + 'T12:00:00').getTime()) / 86400000) + 1)
  const diasTranscurridos = (() => {
    const fin = new Date(hastaFecha + 'T12:00:00')
    const hoyD = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
    const corte = hoyD < fin ? hoyD : fin
    const d = Math.floor((corte.getTime() - new Date(desdeFecha + 'T12:00:00').getTime()) / 86400000) + 1
    return Math.max(1, Math.min(d, diasRango))
  })()
  const promedioDiario = totalVenta / diasTranscurridos
  const proyeccion = promedioDiario * diasRango
  const pctProyectado = totalCuota > 0 ? (proyeccion / totalCuota) * 100 : 0

  const lineas: any[] = alcance?.lineas ?? []

  /**
   * Exporta los montos y valores del tablero de cuotas. Christopher pidió las
   * cifras, no una copia de los gráficos: con esto arma los suyos en Excel.
   */
  const exportarExcel = () => {
    const f: string[] = []
    const vendedorNombre = vendedorSel === 'todos'
      ? 'Todos los vendedores'
      : (vendedores.find((v: any) => v.id === vendedorSel)?.full_name ?? '')
    f.push(`DASHBOARD DE CUOTAS;${desdeFecha} a ${hastaFecha};${vendedorNombre}`)
    f.push('')
    f.push('RESUMEN')
    f.push('Concepto;Valor')
    f.push(`Total venta;${totalVenta.toFixed(2)}`)
    f.push(`Total cuota;${totalCuota.toFixed(2)}`)
    f.push(`Cumplimiento %;${pctCumplimiento.toFixed(1)}`)
    f.push(`Total cobrado;${totalCobrado.toFixed(2)}`)
    f.push(`Proyeccion fin de rango;${proyeccion.toFixed(2)}`)
    f.push(`Proyeccion %;${pctProyectado.toFixed(1)}`)
    f.push('')
    f.push('POR VENDEDOR')
    f.push('Vendedor;Cuota;Ventas;Cumplimiento %;Cobrado')
    perVendedor.forEach((v) => {
      const pct = v.cuota > 0 ? (v.ventas / v.cuota) * 100 : 0
      f.push(`"${v.nombre}";${v.cuota.toFixed(2)};${v.ventas.toFixed(2)};${pct.toFixed(1)};${v.cobrado.toFixed(2)}`)
    })
    f.push('')
    f.push('ALCANCE DE OBJETIVOS POR LINEA Y PRODUCTO')
    f.push('Linea;Codigo;Descripcion;Cant. real;Cant. cuota;Alc. cant %;Valor real;Valor cuota;Alc. valor %')
    lineas.forEach((l: any) => {
      const linea = `LINEA ${l.codigo} - ${l.nombre}`
      ;(l.productos ?? []).forEach((r: any) => {
        f.push([
          `"${linea}"`, r.codigo, `"${String(r.descripcion ?? '').replace(/"/g, "'")}"`,
          r.cant_real, r.cant_cuota, r.alc_cant ?? '',
          r.valor_real, r.valor_cuota, r.alc_valor ?? '',
        ].join(';'))
      })
      f.push([
        `"TOTAL ${linea}"`, '', '',
        l.tot_cant_real, l.tot_cant_cuota, l.alc_cant ?? '',
        l.tot_valor_real, l.tot_valor_cuota, l.alc_valor ?? '',
      ].join(';'))
    })
    if (alcance) {
      f.push([
        '"TOTAL GENERAL"', '', '',
        alcance.total_cant_real, alcance.total_cant_cuota, '',
        alcance.total_valor_real, alcance.total_valor_cuota, alcance.alc_total ?? '',
      ].join(';'))
    }
    const blob = new Blob([String.fromCharCode(65279) + f.join(String.fromCharCode(13, 10))],
      { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dashboard_cuotas_${desdeFecha}_a_${hastaFecha}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      {/* Filtros header */}
      <div className="bg-black text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-gray-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div>
            <p className="text-[9px] uppercase text-gray-400 mb-0.5">Desde</p>
            <input type="date" value={desdeFecha} max={hastaFecha}
              onChange={(e) => setDesdeFecha(e.target.value)}
              className="h-9 w-full px-2 rounded-md bg-white text-gray-900 text-xs border-0" />
          </div>
          <div>
            <p className="text-[9px] uppercase text-gray-400 mb-0.5">Hasta</p>
            <input type="date" value={hastaFecha} min={desdeFecha}
              onChange={(e) => setHastaFecha(e.target.value)}
              className="h-9 w-full px-2 rounded-md bg-white text-gray-900 text-xs border-0" />
          </div>
          <Select value={vendedorSel} onValueChange={setVendedorSel}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los vendedores</SelectItem>
              {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>)}
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
            className="h-9 self-end inline-flex items-center justify-center gap-1.5 px-3 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
        <p className="text-[10px] text-gray-400 text-center mt-2">
          La cuota es mensual: cuando el rango cubre parte de un mes, se cuenta
          la parte proporcional a los días para que el % sea comparable.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-amber-500 animate-spin" /></div>
      ) : (
        <>
          {/* Gráficos principales */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                  Ventas x Cuotas de Vendedor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={perVendedor}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    {/* interval={0} obliga a dibujar TODAS las etiquetas: con
                        el automático el gráfico saltaba una y Daniel Caichihua
                        aparecía sin nombre. */}
                    <XAxis dataKey="nombre" fontSize={9} interval={0}
                      angle={-20} textAnchor="end" height={60} />
                    <YAxis tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="ventas" fill={GRAY} name="Ventas" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cuota" fill={BRAND} name="Cuota" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                  Ventas x Cobranzas de Vendedor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={perVendedor} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                    <YAxis type="category" dataKey="nombre" fontSize={11} width={90} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="cobrado" fill={GRAY} name="Cobranza" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="ventas" fill={BRAND} name="Ventas" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* KPIs totales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCuota label="Total Venta" value={formatCurrency(totalVenta)} icon={TrendingUp} color="bg-green-50 text-green-700" />
            <KpiCuota label="Total Cuota" value={formatCurrency(totalCuota)} icon={Target} color="bg-amber-50 text-amber-700" />
            <KpiCuota
              label="Cumplimiento Real"
              value={`${pctCumplimiento.toFixed(1)}%`}
              icon={pctCumplimiento >= 100 ? Award : TrendingDown}
              color={pctCumplimiento >= 100 ? 'bg-green-100 text-green-800' : pctCumplimiento >= 70 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}
            />
            <KpiCuota
              label="Proyección Fin de Rango"
              value={`${pctProyectado.toFixed(1)}%`}
              desc={`≈ ${formatCurrency(proyeccion)}`}
              icon={TrendingUp}
              color="bg-blue-50 text-blue-700"
            />
          </div>

          {/* Alcance de objetivos: mismo modelo del reporte de Gestión de
              Vendedores — productos clasificados por línea (familia), total por
              línea y total general. */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 bg-black text-white rounded-t-xl">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Descripción detallada de las cuotas por producto
              </CardTitle>
              <p className="text-[11px] text-gray-300 font-normal">
                Alcance de objetivos del rango · {alcance?.vendedor_nombre ?? '—'}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase tracking-wide">Código</th>
                      <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase tracking-wide">Descripción</th>
                      {['Cant. Real', 'Cant. Cuota', 'Alc. Cant.', 'Valor Real', 'Valor Cuota', 'Alc. Valor'].map((h) => (
                        <th key={h} className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-gray-400 text-xs">Sin cuotas ni ventas en el rango</td></tr>
                    ) : lineas.map((l: any) => (
                      <Fragment key={l.codigo + l.nombre}>
                        <tr className="bg-gray-800 text-white">
                          <td colSpan={8} className="py-1.5 px-3 text-[11px] font-bold tracking-wide">
                            LÍNEA {l.codigo} - {l.nombre}
                          </td>
                        </tr>
                        {(l.productos ?? []).map((r: any, i: number) => (
                          <tr key={r.codigo + i} className="border-b border-gray-100 hover:bg-amber-50/40">
                            <td className="py-1.5 px-3 text-xs font-mono text-gray-600 whitespace-nowrap">{r.codigo}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-800">{r.descripcion}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-700 text-right tabular-nums">{num(r.cant_real)}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-700 text-right tabular-nums">{num(r.cant_cuota)}</td>
                            <td className={`py-1.5 px-3 text-xs text-right tabular-nums font-semibold ${colorAlc(r.alc_cant)}`}>{pct(r.alc_cant)}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-800 text-right tabular-nums">{num(r.valor_real)}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-700 text-right tabular-nums">{num(r.valor_cuota)}</td>
                            <td className={`py-1.5 px-3 text-xs text-right tabular-nums font-semibold ${colorAlc(r.alc_valor)}`}>{pct(r.alc_valor)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-100 border-b-2 border-gray-300">
                          <td colSpan={2} className="py-1.5 px-3 text-[11px] font-bold text-gray-800 text-right">
                            TOTAL LÍNEA {l.codigo} - {l.nombre}
                          </td>
                          <td className="py-1.5 px-3 text-xs font-bold text-gray-800 text-right tabular-nums">{num(l.tot_cant_real)}</td>
                          <td className="py-1.5 px-3 text-xs font-bold text-gray-800 text-right tabular-nums">{num(l.tot_cant_cuota)}</td>
                          <td className={`py-1.5 px-3 text-xs text-right tabular-nums font-bold ${colorAlc(l.alc_cant)}`}>{pct(l.alc_cant)}</td>
                          <td className="py-1.5 px-3 text-xs font-bold text-gray-800 text-right tabular-nums">{num(l.tot_valor_real)}</td>
                          <td className="py-1.5 px-3 text-xs font-bold text-gray-800 text-right tabular-nums">{num(l.tot_valor_cuota)}</td>
                          <td className={`py-1.5 px-3 text-xs text-right tabular-nums font-bold ${colorAlc(l.alc_valor)}`}>{pct(l.alc_valor)}</td>
                        </tr>
                      </Fragment>
                    ))}
                    {lineas.length > 0 && (
                      <tr className="bg-[#FBE600]">
                        <td colSpan={2} className="py-2 px-3 text-[11px] font-bold text-gray-900 text-right">TOTAL GENERAL</td>
                        <td className="py-2 px-3 text-xs font-bold text-gray-900 text-right tabular-nums">{num(alcance?.total_cant_real)}</td>
                        <td className="py-2 px-3 text-xs font-bold text-gray-900 text-right tabular-nums">{num(alcance?.total_cant_cuota)}</td>
                        <td className="py-2 px-3" />
                        <td className="py-2 px-3 text-xs font-bold text-gray-900 text-right tabular-nums">{num(alcance?.total_valor_real)}</td>
                        <td className="py-2 px-3 text-xs font-bold text-gray-900 text-right tabular-nums">{num(alcance?.total_valor_cuota)}</td>
                        <td className="py-2 px-3 text-xs font-bold text-gray-900 text-right tabular-nums">{pct(alcance?.alc_total)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-500 px-3 py-2 border-t">
                Venta facturada del rango: comprobantes emitidos con las notas
                de crédito restando, igual que el reporte Alcance de objetivos
                de Gestión de Vendedores. Puede no coincidir con «Total Venta»
                de arriba, que cuenta los pedidos por su fecha de pedido y no
                por la fecha de emisión del comprobante.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

/** Miles con dos decimales, como en el reporte impreso. */
function num(v: any) {
  const n = Number(v ?? 0)
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(v: any) {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`
}

function colorAlc(v: any) {
  if (v === null || v === undefined) return 'text-gray-400'
  const n = Number(v)
  return n >= 100 ? 'text-green-600' : n >= 70 ? 'text-amber-600' : 'text-red-600'
}

function KpiCuota({ label, value, icon: Icon, color, desc }: { label: string; value: string; icon: any; color: string; desc?: string }) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1 truncate">{value}</p>
            {desc && <p className="text-[10px] text-gray-500 mt-0.5">{desc}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
