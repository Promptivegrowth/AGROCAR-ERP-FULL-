'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Target, TrendingUp, TrendingDown, Loader2, Award, Package } from 'lucide-react'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const BRAND = '#FBE600'
const GRAY = '#94a3b8'

export default function CuotasTab() {
  const supabase = createClient()
  const now = new Date()
  const [loading, setLoading] = useState(true)
  const [anio, setAnio] = useState<number>(now.getFullYear())
  const [mes, setMes] = useState<number>(now.getMonth() + 1)
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
      const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
      const hasta = new Date(anio, mes, 0).toISOString().split('T')[0]
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
        (supabase as any)
          .from('metas_vendedor')
          .select('vendedor_id, monto_meta')
          .eq('anio', anio).eq('mes', mes).eq('periodo', 'mensual'),
        (supabase as any)
          .from('cuotas_producto')
          .select('vendedor_id, producto_id, cant_cuota, valor_cuota')
          .eq('anio', anio).eq('mes', mes),
      ])
      setPedidos(peds ?? [])
      setCobros(cobs ?? [])
      setCuotasMonto(m ?? [])
      setCuotasProducto(cp ?? [])
      setLoading(false)
    })()
  }, [anio, mes])

  // Filtro por vendedor/familia
  const pedidosFiltrados = useMemo(() => {
    if (vendedorSel === 'todos') return pedidos
    return pedidos.filter((p) => p.vendedor_id === vendedorSel)
  }, [pedidos, vendedorSel])

  // Ventas por vendedor + cobranzas
  const perVendedor = useMemo(() => {
    return vendedores.map((v) => {
      const ventas = pedidos.filter((p) => p.vendedor_id === v.id).reduce((a, p) => a + Number(p.total ?? 0), 0)
      const cobrado = cobros.filter((c) => c.cobrador_id === v.id).reduce((a, c) => a + Number(c.total ?? 0), 0)
      const metas = cuotasMonto.filter((m) => m.vendedor_id === v.id).reduce((a, m) => a + Number(m.monto_meta ?? 0), 0)
      return {
        id: v.id,
        nombre: v.full_name.split(' ').slice(0, 2).join(' '),
        ventas: Math.round(ventas),
        cuota: Math.round(metas),
        cobrado: Math.round(cobrado),
      }
    })
  }, [vendedores, pedidos, cobros, cuotasMonto])

  const totalVenta = perVendedor.reduce((a, v) => a + v.ventas, 0)
  const totalCuota = perVendedor.reduce((a, v) => a + v.cuota, 0)
  const totalCobrado = perVendedor.reduce((a, v) => a + v.cobrado, 0)
  const pctCumplimiento = totalCuota > 0 ? (totalVenta / totalCuota) * 100 : 0

  // Proyección predictiva: promedio diario × días restantes + ventas hasta hoy
  const diasDelMes = new Date(anio, mes, 0).getDate()
  const diaHoy = (anio === now.getFullYear() && mes === now.getMonth() + 1) ? now.getDate() : diasDelMes
  const promedioDiario = diaHoy > 0 ? totalVenta / diaHoy : 0
  const proyeccion = promedioDiario * diasDelMes
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

    // Cuota filtrada por vendedor si aplica, sino la general (vendedor_id=null)
    const cuotaKey = (producto_id: string) => {
      if (vendedorSel !== 'todos') {
        const c = cuotasProducto.find((c) => c.vendedor_id === vendedorSel && c.producto_id === producto_id)
        return c ?? null
      }
      // Suma de cuotas de todos los vendedores O cuotas a nivel empresa (vendedor_id null)
      const porVend = cuotasProducto.filter((c) => c.vendedor_id && c.producto_id === producto_id)
      if (porVend.length > 0) {
        return {
          cant_cuota: porVend.reduce((a, c) => a + Number(c.cant_cuota), 0),
          valor_cuota: porVend.reduce((a, c) => a + Number(c.valor_cuota), 0),
        }
      }
      const general = cuotasProducto.find((c) => !c.vendedor_id && c.producto_id === producto_id)
      return general ?? null
    }

    const result = Array.from(map.values()).map((r) => {
      const c = cuotaKey(r.prod?.id)
      const cantCuota = c ? Number(c.cant_cuota) : 0
      const valorCuota = c ? Number(c.valor_cuota) : 0
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
  }, [pedidosFiltrados, cuotasProducto, vendedorSel, familiaSel])

  return (
    <div className="space-y-5">
      {/* Filtros header */}
      <div className="bg-black text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-gray-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MESES.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
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
        </div>
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
                    <XAxis dataKey="nombre" fontSize={11} />
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
              label="Proyección Fin de Mes"
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
