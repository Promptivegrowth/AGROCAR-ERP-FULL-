'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Truck, Printer, Send, RefreshCw, Loader2, Search, CheckCircle2, AlertTriangle, FileCheck2, ListOrdered,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginar'
import { formatDate, formatDatetime } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * Las guías de remisión: su correlatividad, su estado en SUNAT y reimprimirlas.
 *
 * Daniel, 01/10: "las guías de remisión no están sincronizadas con la SUNAT
 * según el fiscalizador del control móvil… y para ver la correlatividad de las
 * guías y para volver a imprimir también".
 *
 * Una guía se declara al emitirla, antes de que salga el camión. Acá se ve si
 * cada una quedó aceptada, se declara la que no, y se revisa que la numeración
 * de cada serie corra sin saltos.
 */

interface Guia {
  id: string
  serie: string
  numero: number
  fecha_emision: string
  fecha_inicio_traslado: string
  estado: string | null
  enviado_sunat: boolean | null
  sunat_estado: string | null
  sunat_codigo: string | null
  sunat_mensaje: string | null
  sunat_ticket: string | null
  vehiculo_placa: string | null
  conductor_nombre: string | null
  ubigeo_llegada: string | null
  punto_llegada: string | null
  peso_bruto_total: number | null
  clientes: { razon_social: string | null; ruc: string | null; dni: string | null } | null
  comprobantes: { serie: string; numero: string; tipo: string } | null
}

const COLUMNAS = `
  id, serie, numero, fecha_emision, fecha_inicio_traslado, estado, enviado_sunat,
  sunat_estado, sunat_codigo, sunat_mensaje, sunat_ticket, vehiculo_placa, conductor_nombre,
  ubigeo_llegada, punto_llegada, peso_bruto_total,
  clientes(razon_social, ruc, dni), comprobantes(serie, numero, tipo)
`

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const finMes = (p: string) => {
  const [a, m] = p.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}
const numeroGuia = (g: { serie: string; numero: number }) => `${g.serie}-${String(g.numero).padStart(8, '0')}`

type Clave = 'aceptada' | 'procesando' | 'rechazada' | 'sin_declarar' | 'anulada'
const ESTILO: Record<Clave, { label: string; className: string }> = {
  aceptada: { label: 'Aceptada por SUNAT', className: 'bg-emerald-100 text-emerald-800' },
  procesando: { label: 'SUNAT procesando', className: 'bg-sky-100 text-sky-800' },
  rechazada: { label: 'Rechazada / error', className: 'bg-red-100 text-red-800' },
  sin_declarar: { label: 'Sin declarar', className: 'bg-amber-100 text-amber-800' },
  anulada: { label: 'Anulada', className: 'bg-gray-100 text-gray-500' },
}
function claveDe(g: Guia): Clave {
  if (g.estado === 'anulada') return 'anulada'
  if (g.enviado_sunat && g.sunat_estado === 'aceptado') return 'aceptada'
  if (g.sunat_estado === 'procesando') return 'procesando'
  if (g.sunat_estado === 'rechazado' || g.sunat_estado === 'error') return 'rechazada'
  return 'sin_declarar'
}

/** La numeración de una serie: desde, hasta y los números que faltan. */
function correlatividad(numeros: number[]) {
  const orden = [...numeros].sort((a, b) => a - b)
  const desde = orden[0]
  const hasta = orden.at(-1)!
  const hay = new Set(orden)
  const faltan: number[] = []
  for (let n = desde; n <= hasta && faltan.length < 50; n++) if (!hay.has(n)) faltan.push(n)
  const repetidos = orden.filter((n, i) => i > 0 && orden[i - 1] === n)
  return { desde, hasta, cantidad: orden.length, faltan, repetidos }
}

export default function GuiasPage() {
  const supabase = useMemo(() => createClient(), [])
  const [periodo, setPeriodo] = useState(() => hoyLima().slice(0, 7))
  const [guias, setGuias] = useState<Guia[]>([])
  const [series, setSeries] = useState<{ serie: string; numeros: number[] }[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [ocupado, setOcupado] = useState<Set<string>>(new Set())
  const ultima = useRef(0)

  const cargar = useCallback(async () => {
    const esta = ++ultima.current
    setCargando(true)
    try {
      const [filas, todas] = await Promise.all([
        traerTodo<Guia>((d, h) => (supabase as any).from('guias_remision').select(COLUMNAS)
          .gte('fecha_inicio_traslado', `${periodo}-01`).lte('fecha_inicio_traslado', finMes(periodo))
          .order('serie').order('numero', { ascending: false }).range(d, h)),
        // La correlatividad se mira sobre TODA la serie, no solo el mes.
        traerTodo<{ serie: string; numero: number }>((d, h) => (supabase as any).from('guias_remision')
          .select('serie, numero').order('serie').order('numero').range(d, h)),
      ])
      if (esta !== ultima.current) return
      setGuias(filas)
      const porSerie = new Map<string, number[]>()
      todas.forEach((g) => porSerie.set(g.serie, [...(porSerie.get(g.serie) ?? []), Number(g.numero)]))
      setSeries(Array.from(porSerie.entries()).map(([serie, numeros]) => ({ serie, numeros })))
    } catch (e) {
      toast.error('No se pudieron cargar las guías', { description: e instanceof Error ? e.message : undefined })
    } finally {
      if (esta === ultima.current) setCargando(false)
    }
  }, [supabase, periodo])

  useEffect(() => { cargar() }, [cargar])

  const periodos = useMemo(() => {
    const lista: string[] = []
    const d = new Date(`${hoyLima().slice(0, 7)}-15T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + 1)
    for (let i = 0; i < 14; i++) {
      lista.push(d.toISOString().slice(0, 7))
      d.setUTCMonth(d.getUTCMonth() - 1)
    }
    return lista
  }, [])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return guias
    return guias.filter((g) => numeroGuia(g).toLowerCase().includes(q)
      || `${g.serie}-${g.numero}`.toLowerCase().includes(q)
      || (g.clientes?.razon_social ?? '').toLowerCase().includes(q)
      || (g.vehiculo_placa ?? '').toLowerCase().includes(q)
      || (g.comprobantes ? `${g.comprobantes.serie}-${g.comprobantes.numero}`.toLowerCase().includes(q) : false))
  }, [guias, busqueda])

  const conteo = useMemo(() => {
    const n: Partial<Record<Clave, number>> = {}
    guias.forEach((g) => { const k = claveDe(g); n[k] = (n[k] ?? 0) + 1 })
    return n
  }, [guias])

  const declarar = useCallback(async (g: Guia, accion: 'enviar' | 'consultar') => {
    if (accion === 'enviar' && !confirm(`¿Declarar la guía ${numeroGuia(g)} a SUNAT?\n\nUna vez aceptada queda declarada: para dejarla sin efecto hay que darla de baja.`)) return
    setOcupado((s) => new Set(s).add(g.id))
    try {
      const res = await fetch('/api/sunat/gre/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guia_id: g.id, accion }),
      })
      const r = await res.json()
      if (res.ok && r.ok) toast.success(`${numeroGuia(g)} aceptada por SUNAT`)
      else if (r.estado === 'procesando') toast.warning(`${numeroGuia(g)}: SUNAT todavía la está procesando`, { description: 'Volvé a consultar en unos segundos.' })
      else toast.error(`${numeroGuia(g)} no quedó aceptada`, { description: r.error ?? r.mensaje ?? 'Sin detalle', duration: 15000 })
    } catch (e) {
      toast.error('No se pudo contactar al servidor', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setOcupado((s) => { const n = new Set(s); n.delete(g.id); return n })
      await cargar()
    }
  }, [cargar])

  const pendientesHoy = guias.filter((g) => claveDe(g) !== 'aceptada' && claveDe(g) !== 'anulada'
    && g.fecha_inicio_traslado >= hoyLima())

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="w-6 h-6 text-emerald-600" /> Guías de remisión
        </h1>
        <p className="text-sm text-gray-500">
          Cada guía se declara a SUNAT al emitirla, antes de que salga el camión. Acá se ve su estado, la numeración y se reimprime.
        </p>
      </div>

      {pendientesHoy.length > 0 && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-900" data-alerta-guias>
          <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />
            {pendientesHoy.length} guía{pendientesHoy.length === 1 ? '' : 's'} sin aceptar por SUNAT para traslados de hoy o en adelante
          </p>
          <p>Sin la aceptación de SUNAT la guía no sustenta el traslado: declarala antes de que salga el camión.</p>
        </div>
      )}

      {/* Correlatividad por serie */}
      <Card>
        <CardContent className="pt-4">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <ListOrdered className="w-4 h-4" /> Correlatividad por serie (todas las guías)
          </p>
          <div className="flex flex-wrap gap-2">
            {series.length === 0 && <p className="text-sm text-gray-400">Todavía no hay guías.</p>}
            {series.map(({ serie, numeros }) => {
              const c = correlatividad(numeros)
              const bien = c.faltan.length === 0 && c.repetidos.length === 0
              return (
                <div key={serie} data-serie={serie} className={`rounded-lg border px-3 py-2 text-sm ${bien ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                  <p className="font-mono font-bold">{serie}</p>
                  <p className="text-xs text-gray-700">
                    {String(c.desde).padStart(8, '0')} → {String(c.hasta).padStart(8, '0')} · {c.cantidad} guía{c.cantidad === 1 ? '' : 's'}
                  </p>
                  {bien ? (
                    <p className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Sin saltos</p>
                  ) : (
                    <p className="text-xs font-semibold text-red-700">
                      {c.faltan.length ? `Faltan: ${c.faltan.join(', ')}` : ''}{c.repetidos.length ? ` Repetidos: ${c.repetidos.join(', ')}` : ''}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">Mes del traslado</label>
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm capitalize">
                {periodos.map((p) => <option key={p} value={p}>{nombreMes(p)}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
              <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar T002-5, cliente, placa o factura" className="pl-8 h-9" />
            </div>
            <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1 h-9">
              <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
            <p className="text-xs text-gray-500">
              {guias.length} guía{guias.length === 1 ? '' : 's'} · {conteo.aceptada ?? 0} aceptadas
              {conteo.sin_declarar ? ` · ${conteo.sin_declarar} sin declarar` : ''}
              {conteo.rechazada ? ` · ${conteo.rechazada} rechazadas` : ''}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Guía</th>
                  <th className="py-2 pr-3">Traslado</th>
                  <th className="py-2 pr-3">Destinatario</th>
                  <th className="py-2 pr-3">Comprobante</th>
                  <th className="py-2 pr-3">Vehículo / conductor</th>
                  <th className="py-2 pr-3">SUNAT</th>
                  <th className="py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargando && (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
                )}
                {!cargando && visibles.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">No hay guías en {nombreMes(periodo)}.</td></tr>
                )}
                {!cargando && visibles.map((g) => {
                  const clave = claveDe(g)
                  const est = ESTILO[clave]
                  const trabajando = ocupado.has(g.id)
                  return (
                    <tr key={g.id} data-guia={numeroGuia(g)} className="border-b border-gray-100 align-top hover:bg-gray-50">
                      <td className="py-2 pr-3">
                        <p className="font-mono font-semibold">{numeroGuia(g)}</p>
                        <p className="text-[11px] text-gray-500">emitida {formatDatetime(g.fecha_emision)}</p>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDate(g.fecha_inicio_traslado)}
                        <p className="text-[11px] text-gray-500">{g.ubigeo_llegada === '230101' ? 'Tacna' : g.ubigeo_llegada === '180101' ? 'Moquegua' : g.ubigeo_llegada ?? ''}</p>
                      </td>
                      <td className="py-2 pr-3 max-w-[220px]">
                        <p className="truncate">{g.clientes?.razon_social ?? '—'}</p>
                        <p className="text-[11px] text-gray-500 truncate">{g.punto_llegada ?? ''}</p>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {g.comprobantes ? `${g.comprobantes.serie}-${g.comprobantes.numero}` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <p className="font-mono">{g.vehiculo_placa ?? '—'}</p>
                        <p className="text-gray-500 truncate max-w-[160px]">{g.conductor_nombre ?? ''}</p>
                      </td>
                      <td className="py-2 pr-3 max-w-[240px]">
                        <span data-estado={clave} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${est.className}`}>
                          {est.label}
                        </span>
                        {clave === 'rechazada' && g.sunat_mensaje && (
                          <p className="mt-0.5 text-[10px] text-red-700 line-clamp-2" title={g.sunat_mensaje}>
                            {g.sunat_codigo ? `[${g.sunat_codigo}] ` : ''}{g.sunat_mensaje}
                          </p>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          <a href={`/guia/${g.id}`} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1">
                              <Printer className="w-3 h-3" /> {clave === 'aceptada' ? 'Reimprimir' : 'Ver'}
                            </Button>
                          </a>
                          {(clave === 'sin_declarar' || clave === 'rechazada') && (
                            <Button size="sm" disabled={trabajando} onClick={() => declarar(g, 'enviar')}
                              className="h-7 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                              {trabajando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Declarar
                            </Button>
                          )}
                          {clave === 'procesando' && (
                            <Button size="sm" variant="outline" disabled={trabajando} onClick={() => declarar(g, 'consultar')}
                              className="h-7 px-2 text-xs gap-1">
                              {trabajando ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck2 className="w-3 h-3" />} Consultar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
