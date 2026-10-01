'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2, Clock, CalendarClock, XCircle, AlertTriangle, ShieldCheck,
  Loader2, RefreshCw, Search, FileCode2, FileCheck2, Eye, FlaskConical, Send, Siren,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginar'
import { formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEstadoSunat, BannerSunat, BotonDeclarar, type EstadoSunat } from '../sunat-acciones'
import { diaDeEnvio, venceElPlazo, sumarDias, DIAS_ESPERA_POR_OMISION } from '@/lib/sunat/plazo'

/** Cuándo lo declara el envío automático, con los días de espera configurados. */
const envioDe = (c: { fecha_emision: string }, conf: EstadoSunat | null) =>
  diaDeEnvio(c.fecha_emision, conf?.dias_espera ?? DIAS_ESPERA_POR_OMISION)

/**
 * El estado de cada comprobante ante SUNAT, y la forma de comprobarlo.
 *
 * Daniel: "crear un apartado donde se pueda ver el estado de cada comprobante,
 * y desde ahí se pueda verificar si llegó bien a SUNAT y fue aceptado
 * correctamente".
 *
 * La pantalla de facturación muestra lo que el ERP anotó al enviar. Esta
 * además le pregunta a SUNAT: el botón "Verificar con SUNAT" consulta el
 * servicio de consulta —que solo lee, no declara nada— y abre la constancia
 * (CDR) que SUNAT firmó al recibir el comprobante.
 */

const COLUMNAS = `
  id, serie, numero, tipo, fecha_emision, total, estado,
  enviado_sunat, sunat_estado, sunat_codigo, sunat_mensaje, sunat_observaciones,
  sunat_modo, sunat_enviado_at, sunat_intentos, sunat_verificado_at, sunat_verificacion,
  clientes(razon_social, ruc, dni)
`

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
]
const nombrePeriodo = (p: string) => {
  const [a, m] = p.split('-')
  return `${MESES_ES[Number(m) - 1]} ${a}`
}
const finDePeriodo = (p: string) => {
  const [a, m] = p.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

interface Comp {
  id: string
  serie: string
  numero: string
  tipo: string
  fecha_emision: string
  total: number
  estado: string
  enviado_sunat: boolean | null
  sunat_estado: string | null
  sunat_codigo: string | null
  sunat_mensaje: string | null
  sunat_observaciones: string[] | null
  sunat_modo: string | null
  sunat_enviado_at: string | null
  sunat_intentos: number | null
  sunat_verificado_at: string | null
  sunat_verificacion: string | null
  clientes: { razon_social: string | null; ruc: string | null; dni: string | null } | null
}

type Clave =
  | 'aceptado' | 'observado' | 'alerta' | 'rechazado' | 'error'
  | 'pendiente' | 'programado' | 'pruebas' | 'historico' | 'anulado' | 'no_declara'

const ESTILO: Record<Clave, { label: string; className: string }> = {
  aceptado:   { label: 'Aceptado por SUNAT', className: 'bg-emerald-100 text-emerald-800' },
  observado:  { label: 'Aceptado con observaciones', className: 'bg-lime-100 text-lime-800' },
  alerta:     { label: 'Revisar: SUNAT no coincide', className: 'bg-orange-100 text-orange-800' },
  rechazado:  { label: 'Rechazado', className: 'bg-red-100 text-red-800' },
  error:      { label: 'Error al enviar', className: 'bg-red-100 text-red-800' },
  pendiente:  { label: 'Pendiente de envío', className: 'bg-amber-100 text-amber-800' },
  programado: { label: 'Programado', className: 'bg-sky-100 text-sky-800' },
  pruebas:    { label: 'Solo en pruebas', className: 'bg-sky-50 text-sky-700' },
  historico:  { label: 'Anterior al inicio', className: 'bg-gray-100 text-gray-500' },
  anulado:    { label: 'Anulado', className: 'bg-gray-100 text-gray-500' },
  no_declara: { label: 'No se declara', className: 'bg-gray-100 text-gray-500' },
}

/** En qué situación está cada comprobante, en una palabra. */
function claveDe(c: Comp, conf: EstadoSunat | null, hoy: string): Clave {
  if (c.estado === 'anulado') return 'anulado'
  if (!['factura', 'boleta'].includes(c.tipo)) return 'no_declara'
  const declarado = !!c.enviado_sunat && c.sunat_modo === 'produccion'
  if (declarado) {
    // Lo que el ERP anotó dice aceptado, pero la última consulta a SUNAT no.
    if (['no_existe', 'rechazado', 'baja'].includes(c.sunat_verificacion ?? '')) return 'alerta'
    const obs = (c.sunat_observaciones?.length ?? 0) > 0 || Number(c.sunat_codigo ?? 0) >= 4000
    return obs ? 'observado' : 'aceptado'
  }
  if (c.sunat_verificacion === 'aceptado') return 'aceptado'
  if (c.sunat_estado === 'rechazado') return 'rechazado'
  if (c.sunat_estado === 'error') return 'error'
  // Todavía en el margen para corregir: el envío automático lo declara después.
  if (hoy < envioDe(c, conf)) return 'programado'
  if (conf?.sincronizar_desde && c.fecha_emision < conf.sincronizar_desde) return 'historico'
  if (c.enviado_sunat) return 'pruebas'
  return 'pendiente'
}

const VERIFICACION: Record<string, string> = {
  aceptado: 'SUNAT confirma: aceptado',
  rechazado: 'SUNAT dice: rechazado',
  baja: 'SUNAT dice: dado de baja',
  no_existe: 'SUNAT no lo tiene',
  no_consultable: 'SUNAT no permite consultarlo',
  error: 'No se pudo consultar',
}

interface ResultadoVerificacion {
  id: string
  comprobante: string
  veredicto: 'ok' | 'pendiente' | 'problema' | 'sin_consulta' | 'no_aplica'
  resumen: string
  consulta: { estado: string; codigo: string | null; mensaje: string } | null
  cdr: {
    valido: boolean; codigo?: string | null; descripcion?: string | null; referencia?: string | null
    corresponde?: boolean; firmadoPorSunat?: boolean; recibido?: string | null; observaciones?: readonly string[]
    motivo?: string
  } | null
  recuperado: boolean
}

function descargar(nombre: string, contenido: Blob) {
  const url = URL.createObjectURL(contenido)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function EstadoSunatPage() {
  const supabase = useMemo(() => createClient(), [])
  const conf = useEstadoSunat()
  const hoy = hoyLima()

  const [periodo, setPeriodo] = useState(() => hoyLima().slice(0, 7))
  const [puntas, setPuntas] = useState<{ viejo: string | null; nuevo: string | null }>({ viejo: null, nuevo: null })
  const [comps, setComps] = useState<Comp[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<Clave | 'todos'>('todos')
  const [tipo, setTipo] = useState<'todos' | 'factura' | 'boleta'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [verificando, setVerificando] = useState<Set<string>>(new Set())
  const [masivo, setMasivo] = useState<{ hechos: number; total: number } | null>(null)
  const [resultados, setResultados] = useState<Record<string, ResultadoVerificacion>>({})
  const [detalle, setDetalle] = useState<Comp | null>(null)

  // Desde y hasta qué mes hay comprobantes. El más nuevo puede ser del mes que
  // viene: la emisión lleva la fecha del reparto.
  useEffect(() => {
    const punta = (asc: boolean) => (supabase as any).from('comprobantes')
      .select('fecha_emision').in('tipo', ['factura', 'boleta'])
      .order('fecha_emision', { ascending: asc }).limit(1).maybeSingle()
    Promise.all([punta(true), punta(false)]).then(([v, n]: any[]) => {
      const viejo = v.data?.fecha_emision?.slice(0, 7) ?? null
      const nuevo = n.data?.fecha_emision?.slice(0, 7) ?? null
      setPuntas({ viejo, nuevo })
      const actual = hoyLima().slice(0, 7)
      if (nuevo && nuevo > actual) setPeriodo((p) => (p === actual ? nuevo : p))
    })
  }, [supabase])

  const periodos = useMemo(() => {
    const actual = hoyLima().slice(0, 7)
    const tope = puntas.nuevo && puntas.nuevo > actual ? puntas.nuevo : actual
    const lista: string[] = []
    let [a, m] = (puntas.viejo && puntas.viejo < actual ? puntas.viejo : actual).split('-').map(Number)
    const [at, mt] = tope.split('-').map(Number)
    while (a < at || (a === at && m <= mt)) {
      lista.push(`${a}-${String(m).padStart(2, '0')}`)
      m += 1
      if (m > 12) { m = 1; a += 1 }
    }
    if (!lista.includes(periodo)) lista.push(periodo)
    return lista.sort().reverse()
  }, [puntas, periodo])

  // Solo cuenta la última carga pedida: al abrir se pide el mes de hoy y
  // enseguida el de lo emitido para el reparto, y la respuesta vieja no puede
  // pisar a la nueva.
  const ultimaCarga = useRef(0)
  const cargar = useCallback(async () => {
    const estaCarga = ++ultimaCarga.current
    setCargando(true)
    try {
      const filas = await traerTodo<Comp>((desde, hasta) => (supabase as any).from('comprobantes')
        .select(COLUMNAS)
        .in('tipo', ['factura', 'boleta'])
        .gte('fecha_emision', `${periodo}-01`).lte('fecha_emision', finDePeriodo(periodo))
        .order('fecha_emision', { ascending: false })
        .order('serie').order('numero', { ascending: false })
        .range(desde, hasta))
      if (estaCarga !== ultimaCarga.current) return
      setComps(filas)
    } catch (e) {
      if (estaCarga !== ultimaCarga.current) return
      toast.error('No se pudieron cargar los comprobantes', { description: e instanceof Error ? e.message : undefined })
    } finally {
      if (estaCarga === ultimaCarga.current) setCargando(false)
    }
  }, [supabase, periodo])

  useEffect(() => { cargar() }, [cargar])

  const conClave = useMemo(
    () => comps.map((c) => ({ c, clave: claveDe(c, conf, hoy) })),
    [comps, conf, hoy],
  )

  const conteo = useMemo(() => {
    const n: Partial<Record<Clave, number>> = {}
    conClave.forEach(({ clave }) => { n[clave] = (n[clave] ?? 0) + 1 })
    return n
  }, [conClave])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return conClave.filter(({ c, clave }) => {
      if (tipo !== 'todos' && c.tipo !== tipo) return false
      if (filtro !== 'todos') {
        if (filtro === 'rechazado' ? !['rechazado', 'error'].includes(clave)
          : filtro === 'aceptado' ? !['aceptado', 'observado'].includes(clave)
          : clave !== filtro) return false
      }
      if (!q) return true
      return `${c.serie}-${c.numero}`.toLowerCase().includes(q)
        || `${c.serie}-${Number(c.numero)}`.toLowerCase().includes(q)
        || (c.clientes?.razon_social ?? '').toLowerCase().includes(q)
        || (c.clientes?.ruc ?? '').includes(q)
        || (c.clientes?.dni ?? '').includes(q)
    })
  }, [conClave, filtro, tipo, busqueda])

  const verificar = useCallback(async (ids: string[]) => {
    const res = await fetch('/api/sunat/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comprobante_ids: ids }),
    })
    const r = await res.json()
    if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`)
    const lista = r.resultados as ResultadoVerificacion[]
    setResultados((prev) => {
      const nuevo = { ...prev }
      lista.forEach((x) => { nuevo[x.id] = x })
      return nuevo
    })
    return lista
  }, [])

  const verificarUno = useCallback(async (c: Comp) => {
    setVerificando((s) => new Set(s).add(c.id))
    try {
      const [r] = await verificar([c.id])
      const fn = r.veredicto === 'ok' ? toast.success
        : r.veredicto === 'problema' ? toast.error
        : toast.info
      fn(`${r.comprobante}: ${VERIFICACION[r.consulta?.estado ?? ''] ?? 'verificado'}`, {
        description: r.resumen, duration: r.veredicto === 'problema' ? 15000 : 6000,
      })
      await cargar()
    } catch (e) {
      toast.error('No se pudo verificar', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setVerificando((s) => { const n = new Set(s); n.delete(c.id); return n })
    }
  }, [verificar, cargar])

  /** Verifica los que están en pantalla, de a tandas. */
  const verificarVisibles = useCallback(async () => {
    const ids = visibles
      .filter(({ clave }) => !['anulado', 'no_declara', 'programado', 'historico'].includes(clave))
      .map(({ c }) => c.id)
    if (ids.length === 0) {
      toast.info('No hay comprobantes para verificar', {
        description: 'Los programados todavía no se enviaron: están en el plazo para corregir.',
      })
      return
    }
    setMasivo({ hechos: 0, total: ids.length })
    const todos: ResultadoVerificacion[] = []
    try {
      for (let i = 0; i < ids.length; i += 20) {
        todos.push(...await verificar(ids.slice(i, i + 20)))
        setMasivo({ hechos: Math.min(i + 20, ids.length), total: ids.length })
      }
      const ok = todos.filter((r) => r.veredicto === 'ok').length
      const problemas = todos.filter((r) => r.veredicto === 'problema').length
      const recuperados = todos.filter((r) => r.recuperado).length
      const msg = `${ok} de ${todos.length} confirmados por SUNAT como aceptados`
        + (recuperados ? ` · ${recuperados} recuperados` : '')
      if (problemas) toast.error(`${problemas} con problemas`, { description: msg, duration: 15000 })
      else toast.success('Verificación terminada', { description: msg })
    } catch (e) {
      toast.error('La verificación se cortó', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setMasivo(null)
      await cargar()
    }
  }, [visibles, verificar, cargar])

  const tarjetas: { clave: Clave | 'todos'; titulo: string; n: number; icono: any; color: string }[] = [
    { clave: 'todos', titulo: 'Total del periodo', n: comps.length, icono: FileCheck2, color: 'text-gray-700' },
    { clave: 'aceptado', titulo: 'Aceptados por SUNAT', n: (conteo.aceptado ?? 0) + (conteo.observado ?? 0), icono: CheckCircle2, color: 'text-emerald-600' },
    { clave: 'programado', titulo: 'Programados', n: conteo.programado ?? 0, icono: CalendarClock, color: 'text-sky-600' },
    { clave: 'pendiente', titulo: 'Pendientes de envío', n: conteo.pendiente ?? 0, icono: Clock, color: 'text-amber-600' },
    { clave: 'rechazado', titulo: 'Rechazados / error', n: (conteo.rechazado ?? 0) + (conteo.error ?? 0), icono: XCircle, color: 'text-red-600' },
    { clave: 'alerta', titulo: 'Para revisar', n: conteo.alerta ?? 0, icono: AlertTriangle, color: 'text-orange-600' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Estado SUNAT
          </h1>
          <p className="text-sm text-gray-500">
            Cómo está cada factura y boleta ante SUNAT. «Verificar» se lo pregunta a SUNAT directamente: solo consulta, no envía nada.
          </p>
        </div>
      </div>

      <BannerSunat estado={conf} />
      <PanelPlazos conf={conf} onCambio={cargar} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tarjetas.map((t) => {
          const Icono = t.icono
          const activa = filtro === t.clave
          return (
            <button
              key={t.clave}
              type="button"
              data-tarjeta={t.clave}
              onClick={() => setFiltro(activa && t.clave !== 'todos' ? 'todos' : t.clave)}
              className={`text-left rounded-xl border bg-white p-3 shadow-sm transition hover:border-gray-400 ${
                activa ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.titulo}</span>
                <Icono className={`w-4 h-4 ${t.color}`} />
              </div>
              <p className={`mt-1 text-2xl font-bold ${t.color}`} data-cantidad>{t.n}</p>
            </button>
          )
        })}
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">Periodo</label>
              <select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm capitalize"
              >
                {periodos.map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide text-gray-500">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
              >
                <option value="todos">Facturas y boletas</option>
                <option value="factura">Solo facturas</option>
                <option value="boleta">Solo boletas</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar F002-15, cliente, RUC o DNI"
                className="pl-8 h-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1 h-9">
              <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
            <Button
              size="sm"
              onClick={verificarVisibles}
              disabled={!!masivo || cargando}
              className="gap-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {masivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {masivo ? `Verificando ${masivo.hechos}/${masivo.total}…` : 'Verificar con SUNAT los de la lista'}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Comprobante</th>
                  <th className="py-2 pr-3">Emisión</th>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3">Estado SUNAT</th>
                  <th className="py-2 pr-3">Respuesta de SUNAT</th>
                  <th className="py-2 pr-3">Verificación</th>
                  <th className="py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargando && (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400">
                    <Loader2 className="inline w-5 h-5 animate-spin" />
                  </td></tr>
                )}
                {!cargando && visibles.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400">
                    No hay comprobantes con este filtro en {nombrePeriodo(periodo)}.
                  </td></tr>
                )}
                {!cargando && visibles.map(({ c, clave }) => {
                  const est = ESTILO[clave]
                  const r = resultados[c.id]
                  const ocupado = verificando.has(c.id)
                  return (
                    <tr key={c.id} data-fila={`${c.serie}-${c.numero}`} className="border-b border-gray-100 align-top hover:bg-gray-50">
                      <td className="py-2 pr-3">
                        <p className="font-mono font-semibold">{c.serie}-{c.numero}</p>
                        <p className="text-[11px] text-gray-500 capitalize">{c.tipo}</p>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(c.fecha_emision)}</td>
                      <td className="py-2 pr-3 max-w-[220px]">
                        <p className="truncate">{c.clientes?.razon_social ?? '—'}</p>
                        <p className="text-[11px] text-gray-500">{c.clientes?.ruc || c.clientes?.dni || ''}</p>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{formatCurrency(Number(c.total))}</td>
                      <td className="py-2 pr-3">
                        <span data-estado={clave} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${est.className}`}>
                          {clave === 'programado' ? `Se declara el ${formatDate(envioDe(c, conf))}` : est.label}
                        </span>
                        {['programado', 'pendiente', 'error', 'rechazado'].includes(clave) && (
                          <p className={`mt-0.5 text-[10px] ${hoy >= venceElPlazo(c.fecha_emision) ? 'font-semibold text-red-700' : 'text-gray-400'}`}>
                            {hoy >= venceElPlazo(c.fecha_emision)
                              ? 'El plazo SUNAT vence HOY'
                              : `Se puede corregir hasta entonces · plazo SUNAT ${formatDate(venceElPlazo(c.fecha_emision))}`}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-[260px] text-xs text-gray-600">
                        {c.sunat_codigo || c.sunat_mensaje ? (
                          <>
                            {c.sunat_codigo && <span className="font-mono font-semibold mr-1">[{c.sunat_codigo}]</span>}
                            <span className="line-clamp-2">{c.sunat_mensaje}</span>
                            {c.sunat_enviado_at && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {formatDatetime(c.sunat_enviado_at)}{(c.sunat_intentos ?? 0) > 1 ? ` · ${c.sunat_intentos} intentos` : ''}
                              </p>
                            )}
                          </>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {r ? (
                          <span className={r.veredicto === 'ok' ? 'text-emerald-700 font-semibold'
                            : r.veredicto === 'problema' ? 'text-red-700 font-semibold' : 'text-gray-600'}>
                            {VERIFICACION[r.consulta?.estado ?? ''] ?? r.resumen}
                          </span>
                        ) : c.sunat_verificado_at ? (
                          <>
                            <span className={c.sunat_verificacion === 'aceptado' ? 'text-emerald-700 font-semibold' : 'text-gray-600'}>
                              {VERIFICACION[c.sunat_verificacion ?? ''] ?? c.sunat_verificacion}
                            </span>
                            <p className="text-[10px] text-gray-400">{formatDatetime(c.sunat_verificado_at)}</p>
                          </>
                        ) : <span className="text-gray-400">Sin verificar</span>}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          {!['anulado', 'no_declara', 'programado', 'historico'].includes(clave) && (
                            <Button
                              size="sm" variant="outline" disabled={ocupado}
                              onClick={() => verificarUno(c)}
                              className="h-7 px-2 text-xs gap-1 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                            >
                              {ocupado ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                              Verificar
                            </Button>
                          )}
                          {/* Declarar antes de tiempo se puede, si ya llegó su fecha de emisión. */}
                          {(['pendiente', 'rechazado', 'error', 'pruebas'].includes(clave)
                            || (clave === 'programado' && c.fecha_emision <= hoy)) && (
                            <BotonDeclarar comp={c} estado={conf} onListo={cargar} />
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setDetalle(c)} className="h-7 px-2 text-xs gap-1">
                            <Eye className="w-3 h-3" /> Detalle
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!cargando && visibles.length > 0 && (
            <p className="text-xs text-gray-500" data-franja="lista">
              {visibles.length} de {comps.length} comprobantes de {nombrePeriodo(periodo)}
            </p>
          )}
        </CardContent>
      </Card>

      <DetalleSunat
        comp={detalle}
        clave={detalle ? claveDe(detalle, conf, hoy) : null}
        envio={detalle ? envioDe(detalle, conf) : null}
        resultado={detalle ? resultados[detalle.id] : undefined}
        verificando={detalle ? verificando.has(detalle.id) : false}
        onVerificar={() => detalle && verificarUno(detalle)}
        onClose={() => setDetalle(null)}
      />
    </div>
  )
}

interface Atrasado { id: string; serie: string; numero: string; tipo: string; fecha_emision: string; sunat_estado: string | null }

/**
 * Lo que no puede pasar desapercibido, en todos los meses a la vez.
 *
 * La tabla de abajo muestra un mes; un comprobante del 31 que no salió se ve
 * en octubre aunque se esté mirando noviembre. Esto mira todo lo que ya debió
 * declararse y no se declaró, y dice cuándo corrió por última vez el envío
 * automático: si un día no corre, acá se ve antes de que el plazo se venza.
 */
function PanelPlazos({ conf, onCambio }: { conf: EstadoSunat | null; onCambio: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [atrasados, setAtrasados] = useState<Atrasado[]>([])
  const [barrido, setBarrido] = useState<any>(null)
  const [declarando, setDeclarando] = useState<{ hechos: number; total: number } | null>(null)
  const hoy = hoyLima()
  const produccion = conf?.modo === 'produccion'

  const revisar = useCallback(async () => {
    if (!conf?.sincronizar_desde) { setAtrasados([]); return }
    const dias = conf.dias_espera ?? DIAS_ESPERA_POR_OMISION
    const [{ data: lista }, { data: ultimo }] = await Promise.all([
      (supabase as any).from('comprobantes')
        .select('id, serie, numero, tipo, fecha_emision, sunat_estado')
        .in('tipo', ['factura', 'boleta']).neq('estado', 'anulado')
        // Sin declarar en producción: no enviado, o enviado solo a pruebas.
        .or('enviado_sunat.eq.false,sunat_modo.neq.produccion,sunat_modo.is.null')
        .gte('fecha_emision', conf.sincronizar_desde)
        .lte('fecha_emision', sumarDias(hoyLima(), -dias))
        .order('fecha_emision').order('serie').order('numero')
        .limit(1000),
      (supabase as any).from('configuracion').select('valor').eq('clave', 'sunat_ultimo_barrido').maybeSingle(),
    ])
    setAtrasados((lista ?? []) as Atrasado[])
    try { setBarrido(ultimo?.valor ? JSON.parse(ultimo.valor) : null) } catch { setBarrido(null) }
  }, [supabase, conf])

  useEffect(() => { revisar() }, [revisar])

  /** Declarar a mano lo atrasado: el respaldo de los respaldos. */
  const declararAhora = useCallback(async () => {
    if (!conf?.modo || atrasados.length === 0) return
    if (!confirm(`¿Declarar ahora ${atrasados.length} comprobante${atrasados.length === 1 ? '' : 's'} ante SUNAT?\n\n`
      + 'Una vez declarados no se pueden editar ni anular: solo corregir con nota de crédito.')) return
    setDeclarando({ hechos: 0, total: atrasados.length })
    let ok = 0
    const malos: string[] = []
    for (let i = 0; i < atrasados.length; i++) {
      const c = atrasados[i]
      try {
        const res = await fetch('/api/sunat/enviar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comprobante_id: c.id, modo_esperado: conf.modo }),
        })
        const r = await res.json()
        if (res.ok && r.ok) ok++
        // 409: ya lo está enviando otro proceso, o ya quedó declarado.
        else if (res.status !== 409) malos.push(`${c.serie}-${c.numero}: ${r.error ?? r.mensaje ?? 'rechazado'}`)
      } catch (e) {
        malos.push(`${c.serie}-${c.numero}: ${e instanceof Error ? e.message : 'sin conexión'}`)
      }
      setDeclarando({ hechos: i + 1, total: atrasados.length })
      await new Promise((r) => setTimeout(r, 1200))
    }
    setDeclarando(null)
    if (malos.length) {
      toast.error(`${malos.length} no se declararon`, { description: malos.slice(0, 4).join(' · '), duration: 15000 })
    } else {
      toast.success(`${ok} declarados ante SUNAT`)
    }
    await revisar()
    onCambio()
  }, [atrasados, conf, revisar, onCambio])

  if (!conf?.modo || !conf.sincronizar_desde) return null

  const vencenHoy = atrasados.filter((c) => venceElPlazo(c.fecha_emision) === hoy).length
  const fuera = atrasados.filter((c) => venceElPlazo(c.fecha_emision) < hoy).length
  const horas = barrido?.at ? (Date.now() - new Date(barrido.at).getTime()) / 3_600_000 : null
  // Con el envío automático encendido tiene que haber corrido en el último día.
  const noCorrio = !!conf.envio_automatico && produccion && horas !== null && horas > 26
  const hayAlerta = atrasados.length > 0 || noCorrio

  return (
    <div data-panel-plazos className={`rounded-lg border px-3 py-2 text-xs ${hayAlerta ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          {barrido?.at ? (
            <p className={noCorrio ? 'font-semibold text-red-800' : 'text-gray-600'}>
              {noCorrio && <Siren className="mr-1 inline h-3.5 w-3.5" />}
              Último envío automático: {formatDatetime(barrido.at)}
              {barrido.origen === 'respaldo' ? ' (respaldo)' : ''}
              {barrido.error
                ? ` · error: ${barrido.error}`
                : ` · ${barrido.enviados ?? 0} declarados`
                  + `${barrido.fallados ? `, ${barrido.fallados} con problemas` : ''}`
                  + `${barrido.quedaron_para_despues ? `, ${barrido.quedaron_para_despues} quedaron para el próximo` : ''}`
                  + `${barrido.verificados ? ` · ${barrido.verificados} verificados con SUNAT` : ''}`}
              {noCorrio ? ' — hace más de un día que no corre: revisar.' : ''}
            </p>
          ) : (
            <p className="text-gray-600">
              El envío automático todavía no corrió
              {produccion && conf.envio_automatico ? ': corre a las 6:00, con respaldo a las 13:00 y 21:00.' : '.'}
            </p>
          )}
          {atrasados.length > 0 ? (
            <p className="font-semibold text-red-800" data-atrasados={atrasados.length}>
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {atrasados.length} comprobante{atrasados.length === 1 ? '' : 's'} ya debía{atrasados.length === 1 ? '' : 'n'} haberse declarado
              {vencenHoy ? ` · ${vencenHoy} vence${vencenHoy === 1 ? '' : 'n'} HOY` : ''}
              {fuera ? ` · ${fuera} fuera de plazo` : ''}
              {' '}({atrasados.slice(0, 3).map((c) => `${c.serie}-${c.numero}`).join(', ')}{atrasados.length > 3 ? '…' : ''})
            </p>
          ) : (
            <p className="text-emerald-700" data-atrasados={0}>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              Nada atrasado: todo lo que ya cumplió su espera está declarado.
            </p>
          )}
        </div>
        {atrasados.length > 0 && (
          <Button size="sm" onClick={declararAhora} disabled={!!declarando}
            className="h-8 gap-1 bg-red-600 text-white hover:bg-red-700">
            {declarando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {declarando ? `Declarando ${declarando.hechos}/${declarando.total}…` : `Declarar ahora (${atrasados.length})`}
          </Button>
        )}
      </div>
    </div>
  )
}

function DetalleSunat({ comp, clave, envio, resultado, verificando, onVerificar, onClose }: {
  comp: Comp | null
  clave: Clave | null
  envio: string | null
  resultado?: ResultadoVerificacion
  verificando: boolean
  onVerificar: () => void
  onClose: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [archivos, setArchivos] = useState<{ xml: string | null; cdr: string | null } | null>(null)

  // El XML y la constancia pesan: se traen solo al abrir el detalle.
  useEffect(() => {
    setArchivos(null)
    if (!comp) return
    ;(supabase as any).from('comprobantes').select('sunat_xml, sunat_cdr').eq('id', comp.id).maybeSingle()
      .then(({ data }: any) => setArchivos({ xml: data?.sunat_xml ?? null, cdr: data?.sunat_cdr ?? null }))
  }, [comp, supabase, resultado])

  if (!comp || !clave) return null
  const nombre = `${comp.serie}-${comp.numero}`
  const tipoSunat = comp.tipo === 'factura' ? '01' : '03'
  const est = ESTILO[clave]

  return (
    <Dialog open={!!comp} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{nombre}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.className}`}>{est.label}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3">
            <div><p className="text-[10px] uppercase text-gray-500">Cliente</p><p>{comp.clientes?.razon_social ?? '—'}</p></div>
            <div><p className="text-[10px] uppercase text-gray-500">RUC / DNI</p><p>{comp.clientes?.ruc || comp.clientes?.dni || '—'}</p></div>
            <div><p className="text-[10px] uppercase text-gray-500">Emisión</p><p>{formatDate(comp.fecha_emision)}</p></div>
            <div><p className="text-[10px] uppercase text-gray-500">Total</p><p className="font-semibold">{formatCurrency(Number(comp.total))}</p></div>
          </div>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Lo que anotó el ERP al enviar</h3>
            {comp.sunat_enviado_at ? (
              <div className="rounded-lg border border-gray-200 p-3 space-y-1">
                <p>
                  {comp.sunat_modo === 'produccion' ? 'Producción' : comp.sunat_modo === 'beta'
                    ? <span className="inline-flex items-center gap-1"><FlaskConical className="w-3 h-3" /> Pruebas (no declarado)</span> : '—'}
                  {' · '}{formatDatetime(comp.sunat_enviado_at)}
                  {(comp.sunat_intentos ?? 0) > 0 ? ` · ${comp.sunat_intentos} intento${comp.sunat_intentos === 1 ? '' : 's'}` : ''}
                </p>
                <p><span className="font-mono font-semibold">[{comp.sunat_codigo ?? '—'}]</span> {comp.sunat_mensaje}</p>
                {(comp.sunat_observaciones?.length ?? 0) > 0 && (
                  <ul className="list-disc pl-5 text-xs text-lime-800">
                    {comp.sunat_observaciones!.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-gray-500">
                {clave === 'programado'
                  ? `Todavía no se envió: se declara solo el ${formatDate(envio ?? comp.fecha_emision)}. Hasta entonces se puede `
                    + `editar o anular desde Facturación. Plazo SUNAT: ${formatDate(venceElPlazo(comp.fecha_emision))}.`
                  : 'Todavía no se envió a SUNAT.'}
              </p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lo que dice SUNAT</h3>
              {!['anulado', 'no_declara', 'programado', 'historico'].includes(clave) && (
                <Button size="sm" onClick={onVerificar} disabled={verificando}
                  className="h-7 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {verificando ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  Verificar con SUNAT
                </Button>
              )}
            </div>
            {resultado ? (
              <div className={`rounded-lg border p-3 space-y-2 ${
                resultado.veredicto === 'ok' ? 'border-emerald-300 bg-emerald-50'
                  : resultado.veredicto === 'problema' ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'
              }`}>
                <p className="font-semibold">{resultado.resumen}</p>
                {resultado.consulta && (
                  <p className="text-xs">
                    Consulta en vivo: <span className="font-mono">[{resultado.consulta.codigo ?? '—'}]</span> {resultado.consulta.mensaje}
                  </p>
                )}
                {resultado.cdr && (
                  <div className="text-xs space-y-0.5">
                    <p className="font-semibold">Constancia de recepción (CDR) firmada por SUNAT:</p>
                    <p>Código {resultado.cdr.codigo ?? '—'} · {resultado.cdr.descripcion ?? resultado.cdr.motivo}</p>
                    <p>
                      Se refiere a {resultado.cdr.referencia ?? '—'} {resultado.cdr.corresponde ? '✓' : '✗ no coincide'}
                      {resultado.cdr.recibido ? ` · recibido el ${resultado.cdr.recibido}` : ''}
                      {resultado.cdr.firmadoPorSunat ? ' · firmado por SUNAT ✓' : ''}
                    </p>
                  </div>
                )}
              </div>
            ) : comp.sunat_verificado_at ? (
              <p className="text-gray-600">
                Última verificación: {VERIFICACION[comp.sunat_verificacion ?? ''] ?? comp.sunat_verificacion} · {formatDatetime(comp.sunat_verificado_at)}
              </p>
            ) : (
              <p className="text-gray-500">Todavía no se le preguntó a SUNAT por este comprobante.</p>
            )}
          </section>

          <section className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <Button size="sm" variant="outline" className="gap-1" disabled={!archivos?.xml}
              onClick={() => archivos?.xml && descargar(`20519883296-${tipoSunat}-${nombre}.xml`,
                new Blob([archivos.xml], { type: 'application/xml' }))}>
              <FileCode2 className="w-4 h-4" /> XML firmado
            </Button>
            <Button size="sm" variant="outline" className="gap-1" disabled={!archivos?.cdr}
              onClick={() => {
                if (!archivos?.cdr) return
                const bytes = Uint8Array.from(atob(archivos.cdr), (ch) => ch.charCodeAt(0))
                descargar(`R-20519883296-${tipoSunat}-${nombre}.zip`, new Blob([bytes], { type: 'application/zip' }))
              }}>
              <FileCheck2 className="w-4 h-4" /> Constancia SUNAT (CDR)
            </Button>
            {archivos && !archivos.cdr && (
              <p className="text-xs text-gray-400 self-center">La constancia aparece cuando SUNAT acepta el comprobante.</p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
