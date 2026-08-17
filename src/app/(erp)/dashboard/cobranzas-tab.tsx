'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceDot,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, AlertCircle, XCircle, Loader2, CreditCard, TrendingUp, Zap, HelpCircle, FileSpreadsheet } from 'lucide-react'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

type Cobranza = {
  comprobante_id: string
  tipo: string
  serie: string
  numero: string
  fecha_emision: string
  fecha_vencimiento: string | null
  total: number
  cliente_id: string
  cliente: string
  zona_id: string | null
  zona_nombre: string | null
  cobrado: number
  saldo: number
  dias_credito: number
  dias_transcurridos: number
  status: 'pago' | 'por_vencer' | 'vencido'
}

export default function CobranzasTab() {
  const supabase = createClient()
  const now = new Date()
  const [anio, setAnio] = useState<number>(now.getFullYear())
  // Rango de fechas: solo alcanza al top de clientes y al detalle de facturas
  const hace30 = new Date(now.getTime() - 29 * 86400000)
  const [desdeFecha, setDesdeFecha] = useState(hace30.toISOString().split('T')[0])
  const [hastaFecha, setHastaFecha] = useState(now.toISOString().split('T')[0])
  const [statusSel, setStatusSel] = useState<string>('todos')
  const [zonaSel, setZonaSel] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [zonas, setZonas] = useState<any[]>([])

  useEffect(() => {
    ;(async () => {
      const { data: z } = await supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre')
      setZonas(z ?? [])
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      // Se trae TODA la cartera, no solo el año elegido. Christopher: "el
      // filtro de año se mantiene solo que afectará a los gráficos de líneas".
      // Y tiene sentido: una deuda pendiente no se acaba porque cambie el año,
      // así que los KPIs, el top de clientes y el detalle miran todo.
      const { data } = await (supabase as any)
        .from('v_cobranzas_status')
        .select('*')
        .order('fecha_emision', { ascending: false })
      // Si hay comprobantes emitidos con fecha posterior a hoy, el rango por
      // defecto se estira hasta ahí: si no, saldrían del detalle sin que nadie
      // entienda por qué faltan.
      const maxFecha = (data ?? []).reduce(
        (a: string, c: any) => (c.fecha_emision > a ? c.fecha_emision : a), '')
      if (maxFecha && maxFecha > hastaFecha) setHastaFecha(maxFecha)

      setCobranzas((data ?? []).map((c: any) => ({
        ...c,
        total: Number(c.total ?? 0),
        cobrado: Number(c.cobrado ?? 0),
        saldo: Number(c.saldo ?? 0),
        dias_credito: Number(c.dias_credito ?? 0),
        dias_transcurridos: Number(c.dias_transcurridos ?? 0),
      })))
      setLoading(false)
    })()
  }, [])

  // Años que existen en la cartera, para no ofrecer periodos vacíos
  const anios = useMemo(() => {
    const set = new Set<number>(cobranzas.map((c) => Number(c.fecha_emision.slice(0, 4))))
    set.add(now.getFullYear())
    return Array.from(set).sort((a, b) => b - a)
  }, [cobranzas])

  const filtradas = useMemo(() => {
    return cobranzas.filter((c) => {
      if (statusSel !== 'todos' && c.status !== statusSel) return false
      if (zonaSel !== 'todas' && c.zona_id !== zonaSel) return false
      return true
    })
  }, [cobranzas, statusSel, zonaSel])

  /**
   * Recorte por rango de fechas.
   *
   * Christopher: el desde–hasta "solo afectará a los gráficos de monto
   * facturado por cliente y detalle de facturas". Los indicadores de arriba
   * siguen mirando toda la cartera y los dos gráficos por mes, el año.
   */
  const delRango = useMemo(() => {
    return filtradas.filter((c) =>
      c.fecha_emision >= desdeFecha && c.fecha_emision <= hastaFecha)
  }, [filtradas, desdeFecha, hastaFecha])

  const totalDelRango = delRango.reduce((a, c) => a + c.total, 0)

  // KPIs
  const totalFacturado = filtradas.reduce((a, c) => a + c.total, 0)
  const totalCobrado = filtradas.reduce((a, c) => a + c.cobrado, 0)
  // Suma de saldos, no facturado − cobrado: hay dos comprobantes con sobrepago
  // y ese exceso no cancela la deuda de otras facturas.
  const totalPendiente = filtradas.reduce((a, c) => a + c.saldo, 0)
  const pctCobrado = totalFacturado > 0 ? (totalCobrado / totalFacturado) * 100 : 0
  const countVencidas = filtradas.filter((c) => c.status === 'vencido').length
  const countPagadas = filtradas.filter((c) => c.status === 'pago').length
  const countPorVencer = filtradas.filter((c) => c.status === 'por_vencer').length
  const montoVencido = filtradas.filter((c) => c.status === 'vencido').reduce((a, c) => a + c.saldo, 0)

  // Predictivo: cobranza esperada próximos 7 días (facturas por_vencer con vencimiento ≤ hoy+7)
  const hoy = now.getTime()
  const en7 = hoy + 7 * 86400000
  const cobranzaEsperada = filtradas
    .filter((c) => c.status === 'por_vencer' && c.fecha_vencimiento)
    .filter((c) => {
      const fv = new Date(c.fecha_vencimiento! + 'T23:59:59').getTime()
      return fv <= en7
    })
    .reduce((a, c) => a + c.saldo, 0)

  // Monto facturado mensual — ÚNICO bloque que respeta el filtro de año
  const porMes = useMemo(() => {
    const map = new Map<number, { ventas: number; facturas: number }>()
    for (let m = 0; m < 12; m++) map.set(m, { ventas: 0, facturas: 0 })
    filtradas.forEach((c) => {
      const d = new Date(c.fecha_emision + 'T12:00:00')
      if (d.getFullYear() !== anio) return
      const prev = map.get(d.getMonth())!
      prev.ventas += c.total
      prev.facturas += 1
    })
    return Array.from(map.entries()).map(([m, v]) => ({
      mes: MESES[m],
      monto: Math.round(v.ventas),
      facturas: v.facturas,
    }))
  }, [filtradas, anio])

  // Por cliente top 10 con stacked
  const porCliente = useMemo(() => {
    const map = new Map<string, { cliente: string; pago: number; porVencer: number; vencido: number; total: number }>()
    delRango.forEach((c) => {
      const prev = map.get(c.cliente_id) ?? { cliente: c.cliente, pago: 0, porVencer: 0, vencido: 0, total: 0 }
      if (c.status === 'pago') prev.pago += c.total
      else if (c.status === 'por_vencer') prev.porVencer += c.total
      else prev.vencido += c.total
      prev.total += c.total
      map.set(c.cliente_id, prev)
    })
    // TODOS los clientes, no un top 10: Christopher los quiere en listado para
    // poder verlos completos. El nombre va entero y se recorta con CSS, así el
    // tooltip del navegador puede mostrarlo sin cortar.
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [delRango])

  const pico = useMemo(() => {
    if (porMes.length === 0) return null
    const max = porMes.reduce((a, b) => (b.monto > a.monto ? b : a))
    return max
  }, [porMes])

  // Un solo código de color para el estado en toda la pantalla: el mismo de la
  // barra de cuenta por cliente. Antes los badges iban azul/ámbar/rojo y la
  // barra amarillo/gris/rojo, dos idiomas para lo mismo. El icono acompaña al
  // color para que el estado no dependa solo de ver bien los tonos.
  const statusCfg: Record<string, { label: string; icon: any; cls: string; bg: string }> = {
    pago: { label: 'PAGO', icon: CheckCircle, cls: 'text-yellow-900', bg: 'bg-[#FBE600]' },
    por_vencer: { label: 'POR VENCER', icon: HelpCircle, cls: 'text-slate-700', bg: 'bg-slate-200' },
    vencido: { label: 'VENCIDO', icon: XCircle, cls: 'text-red-700', bg: 'bg-red-100' },
  }

  /**
   * Exporta las cifras del tablero de cobranzas. Christopher pidió los montos
   * y valores, no una copia de los gráficos.
   */
  const exportarExcel = () => {
    const f: string[] = []
    const zonaNombre = zonaSel === 'todas'
      ? 'Todas las zonas'
      : (zonas.find((z: any) => z.id === zonaSel)?.nombre ?? '')
    f.push(`DASHBOARD DE COBRANZAS;${zonaNombre};Estado: ${statusSel}`)
    f.push(`Graficos por mes: año ${anio};Top clientes y detalle: ${desdeFecha} a ${hastaFecha}`)
    f.push('')
    f.push('RESUMEN DE LA CARTERA (todos los años)')
    f.push('Concepto;Valor')
    f.push(`Monto facturado;${totalFacturado.toFixed(2)}`)
    f.push(`Monto cobrado;${totalCobrado.toFixed(2)}`)
    f.push(`Pendiente;${totalPendiente.toFixed(2)}`)
    f.push(`% cobrado;${pctCobrado.toFixed(1)}`)
    f.push(`Facturas pagadas;${countPagadas}`)
    f.push(`Facturas por vencer;${countPorVencer}`)
    f.push(`Facturas vencidas;${countVencidas}`)
    f.push(`Monto vencido;${montoVencido.toFixed(2)}`)
    f.push(`Cobranza esperada prox. 7 dias;${cobranzaEsperada.toFixed(2)}`)
    f.push('')
    f.push(`FACTURACION POR MES (año ${anio})`)
    f.push('Mes;Monto facturado;# Facturas')
    porMes.forEach((r) => f.push(`${r.mes};${r.monto};${r.facturas}`))
    f.push('')
    f.push(`MONTO FACTURADO X CLIENTE (${desdeFecha} a ${hastaFecha})`)
    f.push('Cliente;Pago;Por vencer;Vencido;Total')
    porCliente.forEach((r) => f.push([
      `"${String(r.cliente).replace(/"/g, "'")}"`,
      r.pago.toFixed(2), r.porVencer.toFixed(2), r.vencido.toFixed(2), r.total.toFixed(2),
    ].join(';')))
    f.push('')
    f.push(`DETALLE DE FACTURAS (${desdeFecha} a ${hastaFecha}) - total S/ ${totalDelRango.toFixed(2)}`)
    f.push('Comprobante;Fecha emision;Vencimiento;Dias credito;Dias transcurridos;Cliente;Zona;Total;Cobrado;Saldo;Estado')
    delRango.forEach((c) => f.push([
      `${c.serie}-${c.numero}`, c.fecha_emision, c.fecha_vencimiento ?? '',
      c.dias_credito, c.dias_transcurridos,
      `"${String(c.cliente).replace(/"/g, "'")}"`, `"${c.zona_nombre ?? ''}"`,
      c.total.toFixed(2), c.cobrado.toFixed(2), c.saldo.toFixed(2), c.status,
    ].join(';')))

    const blob = new Blob([String.fromCharCode(65279) + f.join(String.fromCharCode(13, 10))],
      { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dashboard_cobranzas_${anio}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-slate-800 text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-slate-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <div>
            <p className="text-[9px] uppercase text-slate-400 mb-0.5">Año</p>
            <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
              <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {anios.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[9px] uppercase text-slate-400 mb-0.5">Desde</p>
            <input type="date" value={desdeFecha} max={hastaFecha}
              onChange={(e) => setDesdeFecha(e.target.value)}
              className="h-9 w-full px-2 rounded-md bg-white text-gray-900 text-xs border-0" />
          </div>
          <div>
            <p className="text-[9px] uppercase text-slate-400 mb-0.5">Hasta</p>
            <input type="date" value={hastaFecha} min={desdeFecha}
              onChange={(e) => setHastaFecha(e.target.value)}
              className="h-9 w-full px-2 rounded-md bg-white text-gray-900 text-xs border-0" />
          </div>
          <div>
            <p className="text-[9px] uppercase text-slate-400 mb-0.5">Estado</p>
            <Select value={statusSel} onValueChange={setStatusSel}>
              <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="pago">Pagado</SelectItem>
                <SelectItem value="por_vencer">Por vencer</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[9px] uppercase text-slate-400 mb-0.5">Zona</p>
            <Select value={zonaSel} onValueChange={setZonaSel}>
              <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las zonas</SelectItem>
                {zonas.map((z) => <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button type="button" onClick={exportarExcel}
            className="h-9 self-end inline-flex items-center justify-center gap-1.5 px-3 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
        <p className="text-[10px] text-slate-400 text-center mt-2">
          El <b>año</b> afecta solo a los dos gráficos por mes. El rango
          <b> desde–hasta</b>, solo al top de clientes y al detalle de facturas.
          Estado y zona alcanzan a todo. Los indicadores de arriba miran la
          cartera completa: una deuda no se cierra al cambiar de periodo.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-amber-500 animate-spin" /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCob label="Monto Facturado" value={formatCurrency(totalFacturado)} icon={CreditCard} color="bg-blue-50 text-blue-700" />
            <KpiCob label="Monto Cobrado" value={formatCurrency(totalCobrado)} icon={CheckCircle} color="bg-green-50 text-green-700" />
            <KpiCob label="Pendiente" value={formatCurrency(totalPendiente)} icon={AlertCircle} color="bg-amber-50 text-amber-700" />
            <KpiCob label="% Cobrado" value={`${pctCobrado.toFixed(1)}%`} icon={TrendingUp} color="bg-purple-50 text-purple-700" />
          </div>

          {/* Predictivo + contadores */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <Card className="lg:col-span-2 border-amber-200 bg-gradient-to-br from-yellow-50 to-amber-100">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#FBE600] flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-gray-900" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-amber-900 font-bold">Cobranza esperada próx. 7 días</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(cobranzaEsperada)}</p>
                  <p className="text-xs text-gray-700">Facturas por vencer con fecha en 7 días o menos</p>
                </div>
              </CardContent>
            </Card>
            <Mini label="Pagadas" value={countPagadas} color="bg-[#FBE600] text-yellow-900" />
            <Mini label="Vencidas" value={`${countVencidas} · ${formatCurrency(montoVencido)}`} color="bg-red-100 text-red-800" />
          </div>

          {/* Gráficos mensuales */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black text-white rounded-t-xl">
                <CardTitle className="text-sm font-bold">Monto Facturado por mes · {anio}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={porMes}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Line type="monotone" dataKey="monto" stroke="#FBE600" strokeWidth={3} dot={{ fill: '#000', r: 4 }} />
                    {pico && (
                      <ReferenceDot
                        x={pico.mes}
                        y={pico.monto}
                        r={8}
                        fill="#a855f7"
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
                {pico && (
                  <p className="text-xs text-gray-500 mt-1 text-center">
                    Pico: <span className="font-semibold text-purple-700">{pico.mes}</span> · {formatCurrency(pico.monto)}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black text-white rounded-t-xl">
                <CardTitle className="text-sm font-bold"># Facturas por mes · {anio}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={porMes}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Line type="monotone" dataKey="facturas" stroke="#FBE600" strokeWidth={3} dot={{ fill: '#000', r: 4 }} name="# Facturas" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Por cliente stacked + tabla facturas */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="lg:col-span-2 border-gray-200 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="bg-black text-white inline-block px-4 py-1 rounded font-bold text-sm">
                  Monto Facturado x Cliente
                </CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  Del {formatDate(desdeFecha)} al {formatDate(hastaFecha)} ·{' '}
                  {porCliente.length} clientes · facturas y boletas
                </p>
                <div className="flex items-center gap-3 mt-2 text-[11px]">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#FBE600] border border-amber-300" /> Pago</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-slate-400" /> Por vencer</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-600" /> Vencido</span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {porCliente.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-12">Sin facturas en el rango</p>
                ) : (
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                    {porCliente.map((c) => (
                      <BarraCuenta key={c.cliente} {...c} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3 border-gray-200 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Detalle de facturas</span>
                  <span className="text-xs font-normal text-gray-500">Total del rango: {formatCurrency(totalDelRango)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        {['Factura', 'Fecha', 'Días Cred.', 'Días Trans.', 'Cliente', 'Monto', 'Status'].map((h) => (
                          <th key={h} className="text-left py-2 px-2 text-[10px] font-bold text-gray-700 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {delRango.slice(0, 50).map((c) => {
                        const s = statusCfg[c.status]
                        const Icon = s.icon
                        return (
                          <tr key={c.comprobante_id} className="hover:bg-gray-50">
                            <td className="py-1.5 px-2 text-[11px] font-mono font-semibold">{c.serie}-{c.numero}</td>
                            <td className="py-1.5 px-2 text-[11px] text-gray-600">{formatDate(c.fecha_emision)}</td>
                            <td className="py-1.5 px-2 text-[11px] text-center text-gray-600">{c.dias_credito}</td>
                            <td className="py-1.5 px-2 text-[11px] text-center text-gray-800">{c.dias_transcurridos}</td>
                            <td className="py-1.5 px-2 text-[11px] text-gray-800 max-w-[180px] truncate">{c.cliente}</td>
                            <td className="py-1.5 px-2 text-[11px] text-right font-semibold text-gray-900">{formatCurrency(c.total)}</td>
                            <td className="py-1.5 px-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${s.bg} ${s.cls}`}>
                                <Icon className="w-3 h-3" /> {s.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filtradas.length > 50 && (
                  <p className="text-xs text-gray-400 text-center py-2">Mostrando 50 de {delRango.length}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Estado de la cuenta de un cliente como barra de progreso.
 *
 * Christopher: "es una barra completa si se da cuenta, no con un escalado
 * decreciente, sino uno completo donde indica como va el proceso de la cuenta
 * del cliente". Por eso todas las barras miden lo mismo y lo que cambia es el
 * reparto interno: cuánto de su cuenta está pagado, cuánto por vencer y cuánto
 * vencido. Comparar deudas entre clientes es trabajo del detalle, no de acá.
 *
 * El monto va sobre un fondo claro y no pintado del color de la barra: el
 * amarillo de la marca no da contraste suficiente para texto encima.
 */
function BarraCuenta({ cliente, pago, porVencer, vencido, total }: {
  cliente: string; pago: number; porVencer: number; vencido: number; total: number
}) {
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  const tramos = [
    { v: pago, color: '#FBE600', nombre: 'Pago' },
    { v: porVencer, color: '#94a3b8', nombre: 'Por vencer' },
    { v: vencido, color: '#dc2626', nombre: 'Vencido' },
  ].filter((t) => t.v > 0.009)

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 hover:bg-gray-50">
      <p className="w-[42%] shrink-0 text-[11px] text-gray-700 truncate" title={cliente}>
        {cliente}
      </p>
      <div className="flex-1 relative h-6 rounded overflow-hidden bg-gray-100 flex gap-[2px]">
        {tramos.map((t) => (
          <div
            key={t.nombre}
            style={{ width: `${pct(t.v)}%`, backgroundColor: t.color }}
            title={`${t.nombre}: ${formatCurrency(t.v)} (${pct(t.v).toFixed(0)}%)`}
          />
        ))}
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-white/85 px-1.5 rounded text-[11px] font-semibold text-gray-900 tabular-nums">
            {formatCurrency(total)}
          </span>
        </span>
      </div>
    </div>
  )
}

function KpiCob({ label, value, icon: Icon, color }: any) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-bold text-gray-900 mt-1 truncate">{value}</p>
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Mini({ label, value, color }: any) {
  return (
    <div className={`rounded-xl p-4 ${color}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-bold mt-1">{value}</p>
    </div>
  )
}
