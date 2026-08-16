'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
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
  const [cuotasProducto, setCuotasProducto] = useState<any[]>([])
  const [productos, setProductos] = useState<any[]>([])

  useEffect(() => {
    ;(async () => {
      const [{ data: v }, { data: f }, { data: p }] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'vendedor').eq('activo', true).order('full_name'),
        supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('productos').select('id, codigo, nombre, descripcion, familia_id').eq('activo', true),
      ])
      setVendedores(v ?? [])
      setFamilias(f ?? [])
      setProductos(p ?? [])
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
          .select(`
            id, vendedor_id, fecha_pedido, total, subtotal,
            pedidos_items(producto_id, cantidad, subtotal, productos(id, codigo, nombre, descripcion, familia_id))
          `)
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
        (supabase as any)
          .from('cuotas_vendedor_producto')
          .select('vendedor_id, producto_id, anio, mes, cuota_cantidad, cuota_valor'),
      ])
      setPedidos(peds ?? [])
      setCobros(cobs ?? [])
      setCuotasMonto(m ?? [])
      setCuotasProducto(cp ?? [])
      setLoading(false)
    })()
  }, [desdeFecha, hastaFecha])

  // Filtro por vendedor/familia
  const pedidosFiltrados = useMemo(() => {
    if (vendedorSel === 'todos') return pedidos
    return pedidos.filter((p) => p.vendedor_id === vendedorSel)
  }, [pedidos, vendedorSel])

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

  // Tabla detalle por producto (real vs cuota)
  const porProducto = useMemo(() => {
    const map = new Map<string, { prod: any; cantReal: number; valorReal: number }>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const pid = it.producto_id
        const prev = map.get(pid) ?? { prod: it.productos, cantReal: 0, valorReal: 0 }
        prev.cantReal += Number(it.cantidad ?? 0)
        prev.valorReal += Number(it.subtotal ?? 0)
        map.set(pid, prev)
      })
    })

    /**
     * Cuota del producto dentro del rango. Igual que la cuota de monto, cada
     * fila mes/año aporta solo la parte proporcional a los días que el rango
     * cubre de ese mes: sin esto la tabla sumaba TODOS los meses cargados y la
     * meta salía inflada apenas hubiera más de un mes en la base.
     */
    const cuotaProd = new Map<string, { cant: number; valor: number }>()
    cuotasProducto.forEach((c: any) => {
      if (vendedorSel !== 'todos' && c.vendedor_id !== vendedorSel) return
      const f = factorMes(Number(c.anio), Number(c.mes))
      if (f === 0) return
      const prev = cuotaProd.get(c.producto_id) ?? { cant: 0, valor: 0 }
      prev.cant += Number(c.cuota_cantidad ?? 0) * f
      prev.valor += Number(c.cuota_valor ?? 0) * f
      cuotaProd.set(c.producto_id, prev)
    })

    const result = Array.from(map.values()).map((r) => {
      const c = cuotaProd.get(r.prod?.id)
      const cantCuota = c?.cant ?? 0
      const valorCuota = c?.valor ?? 0
      return {
        codigo: r.prod?.codigo ?? '—',
        nombre: r.prod?.descripcion?.trim() || r.prod?.nombre || '—',
        familia_id: r.prod?.familia_id,
        cantReal: Math.round(r.cantReal * 100) / 100,
        cantCuota: Math.round(cantCuota * 100) / 100,
        margenCant: cantCuota > 0 ? (r.cantReal / cantCuota) * 100 : 0,
        valorReal: Math.round(r.valorReal * 100) / 100,
        valorCuota: Math.round(valorCuota * 100) / 100,
        margenValor: valorCuota > 0 ? (r.valorReal / valorCuota) * 100 : 0,
      }
    })

    if (familiaSel !== 'todas') return result.filter((r) => r.familia_id === familiaSel)
    return result.sort((a, b) => b.valorReal - a.valorReal)
  }, [pedidosFiltrados, cuotasProducto, vendedorSel, familiaSel, factorMes])

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
    f.push('POR PRODUCTO')
    f.push('Codigo;Producto;Cant. real;Cant. cuota;Alc. cant %;Valor real;Valor cuota;Alc. valor %')
    porProducto.forEach((r: any) => {
      f.push([
        r.codigo, `"${String(r.nombre).replace(/"/g, "'")}"`,
        r.cantReal, r.cantCuota, (r.margenCant ?? 0).toFixed(1),
        r.valorReal, r.valorCuota, (r.margenValor ?? 0).toFixed(1),
      ].join(';'))
    })
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

          {/* Tabla detallada por producto */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 bg-black text-white rounded-t-xl">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Descripción detallada de las cuotas por producto
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      {['Código', 'Descripción', 'Cant. Real', 'Cant. Cuota', 'Margen Cant.', 'Valor Real', 'Valor Cuota', 'Margen Valor'].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {porProducto.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-gray-400 text-xs">Sin datos en el período</td></tr>
                    ) : porProducto.map((p, i) => {
                      const cantColor = p.margenCant >= 100 ? 'bg-green-50 text-green-700' : p.margenCant >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                      const valColor = p.margenValor >= 100 ? 'bg-green-50 text-green-700' : p.margenValor >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-2 px-3 text-xs font-mono text-gray-600">{p.codigo}</td>
                          <td className="py-2 px-3 text-xs font-medium text-gray-800">{p.nombre}</td>
                          <td className="py-2 px-3 text-xs text-gray-700 text-center">{p.cantReal}</td>
                          <td className="py-2 px-3 text-xs text-gray-500 text-center">{p.cantCuota || '—'}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${cantColor}`}>
                              {p.cantCuota > 0 ? `${p.margenCant.toFixed(0)}%` : '—'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs font-semibold text-gray-800">{formatCurrency(p.valorReal)}</td>
                          <td className="py-2 px-3 text-xs text-gray-500">{p.valorCuota > 0 ? formatCurrency(p.valorCuota) : '—'}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${valColor}`}>
                              {p.valorCuota > 0 ? `${p.margenValor.toFixed(0)}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
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
