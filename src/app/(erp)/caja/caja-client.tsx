'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  Wallet, Lock, Unlock, TrendingUp, TrendingDown, DollarSign, Clock, Users,
  Banknote, Smartphone, Building2, FileDown, Loader2, Plus, ChevronDown, ChevronUp,
  Receipt, MessageCircle, Send, StickyNote,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { linkEnviarBoletaPago, esTelefonoPeruanoValido } from '@/lib/whatsapp'
import { formatCurrency, formatDate, formatDatetime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { CategoriaCajaMovimiento, TipoCajaMovimiento } from '@/types/database'

// ─── Tipos expuestos al server component ─────────────────────────────────────
export interface CajaSesionData {
  id: string
  cajero_id: string
  cajero_nombre: string | null
  fecha_apertura: string
  fecha_cierre: string | null
  saldo_inicial: number
  saldo_final: number | null
  estado: 'abierta' | 'cerrada'
}

export interface CobroDia {
  id: string
  cliente_id: string
  cliente_nombre: string
  cliente_telefono: string | null
  cobrador_id: string | null
  cobrador_nombre: string
  cobrador_rol: string | null
  fecha: string
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  total: number
  notas: string | null
  created_at: string
}

export interface MovimientoCaja {
  id: string
  sesion_id: string
  tipo: TipoCajaMovimiento
  categoria: CategoriaCajaMovimiento
  descripcion: string
  monto: number
  created_at: string
  cobrador_id: string | null
  // Si el movimiento corresponde a un cobro, este es el id del cobro.
  // Para egresos manuales es null.
  cobro_id: string | null
}

export interface SesionHistorial {
  id: string
  cajero_nombre: string
  fecha_apertura: string
  fecha_cierre: string | null
  saldo_inicial: number
  saldo_final: number | null
}

// ─── Config de categorías ───────────────────────────────────────────────────
const CATEGORIA_LABELS: Record<CategoriaCajaMovimiento, string> = {
  cobro_cliente: 'Cobro cliente',
  pago_planilla: 'Pago planilla',
  prestamo_empleado: 'Préstamo empleado',
  otro: 'Otro',
}

const CATEGORIA_COLORS: Record<CategoriaCajaMovimiento, string> = {
  cobro_cliente: 'bg-green-100 text-green-700 border-green-200',
  pago_planilla: 'bg-blue-100 text-blue-700 border-blue-200',
  prestamo_empleado: 'bg-purple-100 text-purple-700 border-purple-200',
  otro: 'bg-gray-100 text-gray-700 border-gray-200',
}

// Categorías válidas para egresos (cobro_cliente es solo para ingresos)
const CATEGORIAS_EGRESO: CategoriaCajaMovimiento[] = [
  'pago_planilla',
  'prestamo_empleado',
  'otro',
]

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDuration(startISO: string, endISO?: string | null): string {
  const start = new Date(startISO).getTime()
  const end = endISO ? new Date(endISO).getTime() : Date.now()
  const diffMs = Math.max(0, end - start)
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Lima',
  })
}

// ─── Componente principal ───────────────────────────────────────────────────
export default function CajaClient({
  today,
  sesionInicial,
  cobrosIniciales,
  movimientosIniciales,
  historialInicial,
}: {
  today: string
  sesionInicial: CajaSesionData | null
  cobrosIniciales: CobroDia[]
  movimientosIniciales: MovimientoCaja[]
  historialInicial: SesionHistorial[]
}) {
  const supabase = createClient()

  const [sesion, setSesion] = useState<CajaSesionData | null>(sesionInicial)
  const [cobros, setCobros] = useState<CobroDia[]>(cobrosIniciales)
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>(movimientosIniciales)
  const [historial, setHistorial] = useState<SesionHistorial[]>(historialInicial)
  const [recargando, setRecargando] = useState(false)
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date>(new Date())

  const [saving, setSaving] = useState(false)
  const [abrirOpen, setAbrirOpen] = useState(false)
  const [cerrarOpen, setCerrarOpen] = useState(false)
  const [egresoOpen, setEgresoOpen] = useState(false)
  const [historialOpen, setHistorialOpen] = useState(false)
  const [cobradorSeleccionado, setCobradorSeleccionado] = useState<string | null>(null)

  // ─── Recarga manual y en tiempo real ─────────────────────────────────────
  // Ref para evitar saturar el endpoint cuando llegan eventos seguidos
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reloadAll = useCallback(async (silencioso = false) => {
    if (!silencioso) setRecargando(true)
    try {
      // 1) Sesión abierta
      const { data: sesRaw } = await supabase
        .from('caja_sesiones')
        .select(`id, cajero_id, fecha_apertura, fecha_cierre, saldo_inicial, saldo_final, estado, created_at,
                 profiles!caja_sesiones_cajero_id_fkey(full_name)`)
        .eq('estado', 'abierta')
        .order('fecha_apertura', { ascending: false })
        .limit(1)
        .maybeSingle()

      const nuevaSesion: CajaSesionData | null = sesRaw
        ? {
            id: sesRaw.id,
            cajero_id: sesRaw.cajero_id,
            cajero_nombre: (sesRaw.profiles as any)?.full_name ?? null,
            fecha_apertura: sesRaw.fecha_apertura,
            fecha_cierre: sesRaw.fecha_cierre,
            saldo_inicial: Number(sesRaw.saldo_inicial ?? 0),
            saldo_final: sesRaw.saldo_final !== null ? Number(sesRaw.saldo_final) : null,
            estado: sesRaw.estado,
          }
        : null
      setSesion(nuevaSesion)

      // 2) Cobros del día
      const { data: cobrosRaw } = await supabase
        .from('cobros')
        .select(`id, cliente_id, cobrador_id, fecha, efectivo, yape, plin, transferencia, total, tipo, notas, created_at,
                 cliente_externo_nombre,
                 clientes(razon_social, telefono),
                 profiles!cobros_cobrador_id_fkey(full_name, role)`)
        .eq('fecha', today)
        .order('created_at', { ascending: false })

      setCobros(
        (cobrosRaw ?? []).map((c: any) => ({
          id: c.id,
          cliente_id: c.cliente_id,
          cliente_nombre: c.clientes?.razon_social ?? c.cliente_externo_nombre ?? '—',
          cliente_telefono: c.clientes?.telefono ?? null,
          cobrador_id: c.cobrador_id,
          cobrador_nombre: c.profiles?.full_name ?? 'Sin asignar',
          cobrador_rol: c.profiles?.role ?? null,
          fecha: c.fecha,
          efectivo: Number(c.efectivo ?? 0),
          yape: Number(c.yape ?? 0),
          plin: Number(c.plin ?? 0),
          transferencia: Number(c.transferencia ?? 0),
          total: Number(c.total ?? 0),
          notas: c.notas ?? null,
          created_at: c.created_at,
        })),
      )

      // 3) Movimientos de la sesión actual
      if (nuevaSesion?.id) {
        const { data: movRaw } = await supabase
          .from('caja_movimientos')
          .select('id, sesion_id, tipo, categoria, descripcion, monto, created_at, cobrador_id, cobro_id')
          .eq('sesion_id', nuevaSesion.id)
          .order('created_at', { ascending: false })
        setMovimientos(
          (movRaw ?? []).map((m: any) => ({
            id: m.id,
            sesion_id: m.sesion_id,
            tipo: m.tipo,
            categoria: m.categoria,
            descripcion: m.descripcion,
            monto: Number(m.monto ?? 0),
            created_at: m.created_at,
            cobrador_id: m.cobrador_id,
            cobro_id: m.cobro_id ?? null,
          })),
        )
      } else {
        setMovimientos([])
      }

      // 4) Historial: últimas 30 sesiones cerradas
      const { data: histRaw } = await supabase
        .from('caja_sesiones')
        .select(`id, cajero_id, fecha_apertura, fecha_cierre, saldo_inicial, saldo_final, estado, created_at,
                 profiles!caja_sesiones_cajero_id_fkey(full_name)`)
        .eq('estado', 'cerrada')
        .order('fecha_cierre', { ascending: false })
        .limit(30)
      setHistorial(
        (histRaw ?? []).map((s: any) => ({
          id: s.id,
          cajero_nombre: s.profiles?.full_name ?? '—',
          fecha_apertura: s.fecha_apertura,
          fecha_cierre: s.fecha_cierre,
          saldo_inicial: Number(s.saldo_inicial ?? 0),
          saldo_final: s.saldo_final !== null ? Number(s.saldo_final) : null,
        })),
      )

      setUltimaActualizacion(new Date())
    } finally {
      if (!silencioso) setRecargando(false)
    }
  }, [supabase, today])

  // Recarga diferida (debounce) para eventos realtime múltiples
  const reloadDebounced = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => {
      void reloadAll(true)
    }, 400)
  }, [reloadAll])

  // Suscripción a cambios en tiempo real
  useEffect(() => {
    const channel = supabase
      .channel('caja-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cobros' }, () => {
        reloadDebounced()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caja_sesiones' }, () => {
        reloadDebounced()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caja_movimientos' }, () => {
        reloadDebounced()
      })
      .subscribe()

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      void supabase.removeChannel(channel)
    }
  }, [supabase, reloadDebounced])

  // Fallback: refresco cada 30s por si el realtime se cae (red mala, túneles, etc.)
  useEffect(() => {
    const id = setInterval(() => {
      void reloadAll(true)
    }, 30_000)
    return () => clearInterval(id)
  }, [reloadAll])

  // Formularios
  const [formApertura, setFormApertura] = useState({ monto: '', notas: '' })
  // Cobros huérfanos detectados al abrir el dialog (hechos sin caja abierta)
  const [huerfanos, setHuerfanos] = useState<{
    count: number
    total: number
    efectivo_total: number
    fecha_minima: string | null
    fecha_maxima: string | null
    cobros: Array<{ id: string; numero: string; total: number; efectivo: number; cliente: string | null; cobrador: string | null; created_at: string }>
  } | null>(null)
  const [cargarHuerfanos, setCargarHuerfanos] = useState(true)
  const [formCierre, setFormCierre] = useState({ monto: '', notas: '' })
  const [formEgreso, setFormEgreso] = useState({
    categoria: 'gasto_operativo' as CategoriaCajaMovimiento | 'gasto_operativo' | 'pago_proveedor',
    monto: '',
    descripcion: '',
  })

  // ─── Cálculos de la sesión actual ────────────────────────────────────────
  // Usamos caja_movimientos.sesion_id como fuente de verdad (incluye los
  // retroactivos que el cajero migró al abrir caja). Filtrar cobros por
  // fecha_apertura excluiría los retroactivos porque tienen created_at viejo.
  const ingresosCobros = useMemo(() => {
    if (!sesion) {
      return { efectivo: 0, yape: 0, plin: 0, transferencia: 0, total: 0, count: 0 }
    }
    // Mapa de cobros por id para acceder a los desgloses (yape/plin/transfer)
    const cobroById = new Map(cobros.map((c) => [c.id, c]))
    // Movimientos de ingreso de esta sesión
    const movsIngreso = movimientos.filter(
      (m) => m.tipo === 'ingreso' && (m as any).cobro_id
    )
    const ids = new Set(movsIngreso.map((m: any) => m.cobro_id))
    const cobrosSesion = Array.from(ids)
      .map((id) => cobroById.get(id as string))
      .filter((c): c is NonNullable<typeof c> => !!c)
    return cobrosSesion.reduce(
      (acc, c) => ({
        efectivo: acc.efectivo + c.efectivo,
        yape: acc.yape + c.yape,
        plin: acc.plin + c.plin,
        transferencia: acc.transferencia + c.transferencia,
        total: acc.total + c.total,
        count: acc.count + 1,
      }),
      { efectivo: 0, yape: 0, plin: 0, transferencia: 0, total: 0, count: 0 }
    )
  }, [sesion, cobros, movimientos])

  // Ingresos del DÍA completo (para KPIs y tab cobros)
  const ingresosDia = useMemo(() => {
    return cobros.reduce(
      (acc, c) => ({
        efectivo: acc.efectivo + c.efectivo,
        yape: acc.yape + c.yape,
        plin: acc.plin + c.plin,
        transferencia: acc.transferencia + c.transferencia,
        total: acc.total + c.total,
      }),
      { efectivo: 0, yape: 0, plin: 0, transferencia: 0, total: 0 }
    )
  }, [cobros])

  const egresosTotales = useMemo(
    () =>
      movimientos
        .filter((m) => m.tipo === 'egreso')
        .reduce((acc, m) => acc + m.monto, 0),
    [movimientos]
  )

  const egresosPorCategoria = useMemo(() => {
    const map: Record<string, number> = {}
    movimientos
      .filter((m) => m.tipo === 'egreso')
      .forEach((m) => {
        map[m.categoria] = (map[m.categoria] ?? 0) + m.monto
      })
    return map
  }, [movimientos])

  const saldoTeorico = useMemo(() => {
    if (!sesion) return 0
    return sesion.saldo_inicial + ingresosCobros.total - egresosTotales
  }, [sesion, ingresosCobros.total, egresosTotales])

  // ─── Liquidación por cobrador ────────────────────────────────────────────
  const liquidacion = useMemo(() => {
    const map = new Map<
      string,
      {
        cobrador_id: string | null
        nombre: string
        rol: string | null
        count: number
        efectivo: number
        yape: number
        plin: number
        transferencia: number
        total: number
      }
    >()
    for (const c of cobros) {
      const key = c.cobrador_id ?? 'sin_asignar'
      const cur = map.get(key) ?? {
        cobrador_id: c.cobrador_id,
        nombre: c.cobrador_nombre,
        rol: c.cobrador_rol,
        count: 0,
        efectivo: 0,
        yape: 0,
        plin: 0,
        transferencia: 0,
        total: 0,
      }
      cur.count += 1
      cur.efectivo += c.efectivo
      cur.yape += c.yape
      cur.plin += c.plin
      cur.transferencia += c.transferencia
      cur.total += c.total
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [cobros])

  const cobrosCobradorSeleccionado = useMemo(() => {
    if (!cobradorSeleccionado) return []
    return cobros.filter(
      (c) => (c.cobrador_id ?? 'sin_asignar') === cobradorSeleccionado
    )
  }, [cobros, cobradorSeleccionado])

  // ─── Acciones ────────────────────────────────────────────────────────────

  // Al abrir el dialog de apertura, detectar cobros que se hicieron sin caja
  // (vendedores cobrando con caja cerrada). El cajero/admin decide si los
  // carga a la nueva sesión o no — manteniendo trazabilidad.
  useEffect(() => {
    if (!abrirOpen) return
    let cancel = false
    ;(async () => {
      const { data } = await (supabase.rpc as any)('contar_cobros_huerfanos')
      if (!cancel && data) setHuerfanos(data as any)
    })()
    return () => { cancel = true }
  }, [abrirOpen, supabase])

  const abrirCaja = async () => {
    const monto = parseFloat(formApertura.monto)
    if (isNaN(monto) || monto < 0) {
      toast.error('Monto inválido', { description: 'Ingresa un monto de apertura válido.' })
      return
    }
    setSaving(true)

    // Usamos la RPC abrir_caja_con_huerfanos para mantener atomicidad:
    // crea la sesión y migra los huérfanos en una sola transacción.
    const { data: result, error } = await (supabase.rpc as any)(
      'abrir_caja_con_huerfanos',
      {
        p_saldo_inicial: monto,
        p_cargar_huerfanos: cargarHuerfanos && (huerfanos?.count ?? 0) > 0,
        p_notas: formApertura.notas || null,
      },
    )

    setSaving(false)

    if (error) {
      toast.error('Error al abrir caja', { description: error.message })
      return
    }

    const migrados = result?.huerfanos_migrados ?? 0
    if (migrados > 0) {
      toast.success('Caja aperturada con cobros retroactivos', {
        description: `Saldo inicial: ${formatCurrency(monto)} · Migrados ${migrados} cobros (S/${(result.total_migrado ?? 0).toFixed(2)})`,
      })
    } else {
      toast.success('Caja aperturada', {
        description: `Saldo inicial: ${formatCurrency(monto)}`,
      })
    }
    setAbrirOpen(false)
    setFormApertura({ monto: '', notas: '' })
    setHuerfanos(null)
    setCargarHuerfanos(true)
    await reloadAll()
  }

  const cerrarCaja = async () => {
    if (!sesion) return
    const monto = parseFloat(formCierre.monto)
    if (isNaN(monto) || monto < 0) {
      toast.error('Monto inválido', { description: 'Ingresa el monto de cierre.' })
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('caja_sesiones')
      .update({
        estado: 'cerrada',
        fecha_cierre: new Date().toISOString(),
        saldo_final: monto,
      })
      .eq('id', sesion.id)

    setSaving(false)

    if (error) {
      toast.error('Error al cerrar caja', { description: error.message })
      return
    }

    toast.success('Caja cerrada', {
      description: `Saldo final: ${formatCurrency(monto)}`,
    })
    setCerrarOpen(false)
    setFormCierre({ monto: '', notas: '' })
    await reloadAll()
  }

  const registrarEgreso = async () => {
    if (!sesion) {
      toast.error('Abre la caja primero', {
        description: 'No hay una sesión de caja abierta.',
      })
      return
    }
    const monto = parseFloat(formEgreso.monto)
    if (isNaN(monto) || monto <= 0) {
      toast.error('Monto inválido', { description: 'Ingresa un monto mayor a 0.' })
      return
    }
    if (!formEgreso.descripcion.trim()) {
      toast.error('Descripción requerida', {
        description: 'Describe brevemente el egreso.',
      })
      return
    }

    // El enum actual solo soporta: cobro_cliente | pago_planilla | prestamo_empleado | otro.
    // Mapeamos valores del UI que no están en el enum a 'otro'.
    const categoriaBD: CategoriaCajaMovimiento =
      formEgreso.categoria === 'pago_planilla' ||
      formEgreso.categoria === 'prestamo_empleado'
        ? formEgreso.categoria
        : 'otro'

    setSaving(true)
    const { data: auth } = await supabase.auth.getUser()

    const { error } = await supabase.from('caja_movimientos').insert({
      sesion_id: sesion.id,
      tipo: 'egreso',
      categoria: categoriaBD,
      descripcion: formEgreso.descripcion.trim(),
      monto,
      cobrador_id: auth.user?.id ?? null,
    })

    setSaving(false)

    if (error) {
      toast.error('Error al registrar egreso', { description: error.message })
      return
    }

    toast.success('Egreso registrado', {
      description: `${CATEGORIA_LABELS[categoriaBD]} · ${formatCurrency(monto)}`,
    })
    setEgresoOpen(false)
    setFormEgreso({ categoria: 'gasto_operativo', monto: '', descripcion: '' })
    await reloadAll()
  }

  const abrirBoleta = (cobroId: string) => {
    window.open(`/boleta/${cobroId}`, '_blank')
  }

  const imprimirArqueo = () => {
    window.print()
  }

  // ─── Diferencia de cierre en vivo ────────────────────────────────────────
  const montoCierreParsed = parseFloat(formCierre.monto) || 0
  const diferenciaCierre = montoCierreParsed - saldoTeorico

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Caja</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Centro financiero — {formatDate(today)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span>En vivo · actualizado {formatHora(ultimaActualizacion.toISOString())}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reloadAll(false)}
            disabled={recargando}
            className="gap-2"
          >
            {recargando ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
            Actualizar
          </Button>
        </div>
      </div>

      {/* A) Estado de la sesión actual */}
      <Card
        className={`border-2 shadow-sm ${
          sesion ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
        }`}
      >
        <CardContent className="p-5">
          {sesion ? (
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                  <Unlock className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">Sesión abierta</p>
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                      Activa
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Cajero: <strong>{sesion.cajero_nombre ?? '—'}</strong>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Abierta {formatDatetime(sesion.fecha_apertura)}
                    </span>
                    <span>Duración: {formatDuration(sesion.fecha_apertura)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:flex lg:items-center gap-3 lg:gap-6">
                <div>
                  <p className="text-xs text-gray-500">Saldo apertura</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatCurrency(sesion.saldo_inicial)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Saldo teórico</p>
                  <p className="text-lg font-bold text-green-700">
                    {formatCurrency(saldoTeorico)}
                  </p>
                </div>
                <div className="col-span-2 lg:col-auto">
                  <a
                    href={`/caja/cierre/${sesion.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 w-full lg:w-auto"
                    title="Reporte general de todas las operaciones de la sesión"
                  >
                    <FileDown className="w-4 h-4" /> Reporte de cierre
                  </a>
                  <Button
                    onClick={() => {
                      setFormCierre({ monto: saldoTeorico.toFixed(2), notas: '' })
                      setCerrarOpen(true)
                    }}
                    variant="outline"
                    className="gap-2 w-full lg:w-auto"
                  >
                    <Lock className="w-4 h-4" /> Cerrar Caja
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                  <Lock className="w-6 h-6 text-gray-400" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">No hay sesión abierta</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Abre la caja para comenzar a registrar operaciones del día.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setAbrirOpen(true)}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 h-11 px-6"
              >
                <Unlock className="w-4 h-4" /> Abrir Caja
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* B) KPIs del día */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Ingresos
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(ingresosDia.total)}
                </p>
                <p className="text-xs text-gray-400 mt-1">cobros del día</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Egresos
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(egresosTotales)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {sesion ? 'sesión actual' : 'sin sesión abierta'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Saldo Actual
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(saldoTeorico)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  apertura + ing − egr
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Cobros de Hoy
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{cobros.length}</p>
                <p className="text-xs text-gray-400 mt-1">transacciones</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Receipt className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* C) Tabs */}
      <Tabs defaultValue="cobros" className="w-full">
        <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full h-auto">
          <TabsTrigger value="cobros" className="text-xs sm:text-sm">
            Cobros de hoy
          </TabsTrigger>
          <TabsTrigger value="liquidacion" className="text-xs sm:text-sm">
            Liquidación
          </TabsTrigger>
          <TabsTrigger value="egresos" className="text-xs sm:text-sm">
            Egresos
          </TabsTrigger>
          <TabsTrigger value="arqueo" className="text-xs sm:text-sm">
            Arqueo
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Cobros de hoy */}
        <TabsContent value="cobros" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Cobros del Día ({cobros.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {cobros.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  No hay cobros registrados hoy
                </div>
              ) : (
                <>
                  {/* Mobile: cards */}
                  <div className="md:hidden divide-y divide-gray-50">
                    {cobros.map((c) => (
                      <div key={c.id} className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">
                              {c.cliente_nombre}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatHora(c.created_at)} · {c.cobrador_nombre}
                            </p>
                            {c.notas && c.notas.trim().length > 0 && (
                              <p className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 flex items-start gap-1">
                                <StickyNote className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                <span className="break-words">{c.notas}</span>
                              </p>
                            )}
                          </div>
                          <p className="font-bold text-green-600 shrink-0">
                            {formatCurrency(c.total)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                          {c.efectivo > 0 && (
                            <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded">
                              Ef {formatCurrency(c.efectivo)}
                            </span>
                          )}
                          {c.yape > 0 && (
                            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                              Yape {formatCurrency(c.yape)}
                            </span>
                          )}
                          {c.plin > 0 && (
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                              Plin {formatCurrency(c.plin)}
                            </span>
                          )}
                          {c.transferencia > 0 && (
                            <span className="px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded">
                              Transf {formatCurrency(c.transferencia)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => abrirBoleta(c.id)}
                            className="h-7 text-xs gap-1"
                          >
                            <Receipt className="w-3.5 h-3.5" /> Ver
                          </Button>
                          {(() => {
                            const waLink = esTelefonoPeruanoValido(c.cliente_telefono)
                              ? linkEnviarBoletaPago({
                                  baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
                                  cobroId: c.id,
                                  clienteNombre: c.cliente_nombre,
                                  total: c.total,
                                  telefonoCliente: c.cliente_telefono!,
                                })
                              : null
                            return waLink ? (
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 h-7 px-3 text-xs bg-[#25D366] hover:bg-[#1FB659] text-white font-semibold rounded-md transition-colors"
                              >
                                <Send className="w-3.5 h-3.5" /> WhatsApp
                              </a>
                            ) : (
                              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                Sin WA
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: tabla */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-100 bg-gray-50/50">
                        <tr>
                          {[
                            'Hora', 'Cobrador', 'Cliente', 'Efectivo', 'Yape', 'Plin',
                            'Transfer.', 'Total', 'Nota', 'Acciones',
                          ].map((h) => (
                            <th
                              key={h}
                              className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {cobros.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-2.5 px-3 text-gray-500 text-xs whitespace-nowrap">
                              {formatHora(c.created_at)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-700">{c.cobrador_nombre}</td>
                            <td className="py-2.5 px-3 font-medium text-gray-900 max-w-[220px] truncate">
                              {c.cliente_nombre}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {c.efectivo > 0 ? formatCurrency(c.efectivo) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {c.yape > 0 ? formatCurrency(c.yape) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {c.plin > 0 ? formatCurrency(c.plin) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {c.transferencia > 0 ? formatCurrency(c.transferencia) : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-green-600">
                              {formatCurrency(c.total)}
                            </td>
                            <td className="py-2.5 px-3 max-w-[180px]">
                              {c.notas && c.notas.trim().length > 0 ? (
                                <div
                                  className="flex items-start gap-1 text-xs text-amber-800"
                                  title={c.notas}
                                >
                                  <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                                  <span className="truncate">{c.notas}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => abrirBoleta(c.id)}
                                  className="h-7 px-2 text-xs gap-1"
                                  title="Ver boleta"
                                >
                                  <Receipt className="w-3.5 h-3.5" />
                                </Button>
                                {(() => {
                                  const waLink = esTelefonoPeruanoValido(c.cliente_telefono)
                                    ? linkEnviarBoletaPago({
                                        baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
                                        cobroId: c.id,
                                        clienteNombre: c.cliente_nombre,
                                        total: c.total,
                                        telefonoCliente: c.cliente_telefono!,
                                      })
                                    : null
                                  return waLink ? (
                                    <a
                                      href={waLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 h-7 px-2 text-xs bg-[#25D366] hover:bg-[#1FB659] text-white font-semibold rounded-md transition-colors"
                                      title="Enviar boleta por WhatsApp"
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                    </a>
                                  ) : (
                                    <span
                                      className="inline-flex items-center h-7 px-2 text-[10px] text-gray-400 border border-dashed border-gray-200 rounded-md"
                                      title="Cliente sin celular válido"
                                    >
                                      —
                                    </span>
                                  )
                                })()}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Liquidación */}
        <TabsContent value="liquidacion" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" />
                Liquidación por Vendedor / Repartidor
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {liquidacion.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Sin cobros del día
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {[
                          'Cobrador', 'Rol', 'N° cobros', 'Efectivo', 'Yape', 'Plin',
                          'Transfer.', 'Total', '',
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {liquidacion.map((l) => {
                        const key = l.cobrador_id ?? 'sin_asignar'
                        const activo = cobradorSeleccionado === key
                        return (
                          <tr
                            key={key}
                            onClick={() =>
                              setCobradorSeleccionado(activo ? null : key)
                            }
                            className={`cursor-pointer transition-colors ${
                              activo ? 'bg-yellow-50' : 'hover:bg-gray-50/50'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-medium text-gray-900">
                              {l.nombre}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-500 capitalize">
                              {l.rol ?? '—'}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {l.count}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {formatCurrency(l.efectivo)}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {formatCurrency(l.yape)}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {formatCurrency(l.plin)}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-gray-600">
                              {formatCurrency(l.transferencia)}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-green-600">
                              {formatCurrency(l.total)}
                            </td>
                            <td className="py-2.5 px-3">
                              {/* Constancia que caja le imprime al vendedor
                                  cuando entrega su cobranza (pedido de Daniel) */}
                              {l.cobrador_id && (
                                <a
                                  href={`/rendicion/${l.cobrador_id}?fecha=${today}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] px-2 py-1 bg-[#FBE600] hover:bg-[#E5D100] text-black rounded font-semibold whitespace-nowrap"
                                  title="Imprimir su hoja de rendición"
                                >
                                  🧾 Rendición
                                </a>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detalle del cobrador seleccionado */}
          {cobradorSeleccionado && cobrosCobradorSeleccionado.length > 0 && (
            <Card className="mt-3 border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-gray-800">
                  Detalle de cobros — {cobrosCobradorSeleccionado[0]?.cobrador_nombre}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Hora', 'Cliente', 'Ef.', 'Yape', 'Plin', 'Transf.', 'Total'].map(
                          (h) => (
                            <th
                              key={h}
                              className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cobrosCobradorSeleccionado.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50/50">
                          <td className="py-2 px-3 text-xs text-gray-500">
                            {formatHora(c.created_at)}
                          </td>
                          <td className="py-2 px-3 text-gray-800 max-w-[220px] truncate">
                            {c.cliente_nombre}
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-600">
                            {formatCurrency(c.efectivo)}
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-600">
                            {formatCurrency(c.yape)}
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-600">
                            {formatCurrency(c.plin)}
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-600">
                            {formatCurrency(c.transferencia)}
                          </td>
                          <td className="py-2 px-3 font-bold text-green-600">
                            {formatCurrency(c.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 3: Egresos */}
        <TabsContent value="egresos" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800">
                Egresos de la sesión actual (
                {movimientos.filter((m) => m.tipo === 'egreso').length})
              </CardTitle>
              <Button
                onClick={() => {
                  if (!sesion) {
                    toast.error('Abre la caja primero')
                    return
                  }
                  setEgresoOpen(true)
                }}
                size="sm"
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                <Plus className="w-4 h-4" /> Registrar Egreso
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!sesion ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Abre la caja para registrar egresos
                </p>
              ) : movimientos.filter((m) => m.tipo === 'egreso').length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Sin egresos registrados
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Hora', 'Categoría', 'Descripción', 'Monto'].map((h) => (
                          <th
                            key={h}
                            className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {movimientos
                        .filter((m) => m.tipo === 'egreso')
                        .map((m) => (
                          <tr key={m.id} className="hover:bg-gray-50/50">
                            <td className="py-2.5 px-3 text-xs text-gray-500">
                              {formatHora(m.created_at)}
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge
                                className={`text-xs border ${CATEGORIA_COLORS[m.categoria]}`}
                              >
                                {CATEGORIA_LABELS[m.categoria]}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 text-gray-700">{m.descripcion}</td>
                            <td className="py-2.5 px-3 font-bold text-red-600">
                              −{formatCurrency(m.monto)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Arqueo */}
        <TabsContent value="arqueo" className="mt-4">
          <Card className="border-gray-200 shadow-sm print:shadow-none">
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800">
                Arqueo del día — {formatDate(today)}
              </CardTitle>
              <Button
                onClick={imprimirArqueo}
                size="sm"
                variant="outline"
                className="gap-2 print:hidden"
              >
                <FileDown className="w-4 h-4" /> Imprimir
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Apertura */}
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Saldo de apertura
                </p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">
                  {sesion ? formatCurrency(sesion.saldo_inicial) : '—'}
                </p>
                {sesion && (
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDatetime(sesion.fecha_apertura)} · {sesion.cajero_nombre}
                  </p>
                )}
              </div>

              {/* Ingresos */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" /> Ingresos por método
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border border-green-100 bg-green-50/50">
                    <div className="flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-green-600" />
                      <p className="text-xs font-medium text-green-700">Efectivo</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatCurrency(ingresosDia.efectivo)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border border-purple-100 bg-purple-50/50">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-purple-600" />
                      <p className="text-xs font-medium text-purple-700">Yape</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatCurrency(ingresosDia.yape)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border border-blue-100 bg-blue-50/50">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-blue-600" />
                      <p className="text-xs font-medium text-blue-700">Plin</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatCurrency(ingresosDia.plin)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border border-orange-100 bg-orange-50/50">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-orange-600" />
                      <p className="text-xs font-medium text-orange-700">Transferencia</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatCurrency(ingresosDia.transferencia)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex justify-between px-1">
                  <span className="text-sm font-semibold text-gray-700">
                    Total ingresos
                  </span>
                  <span className="text-sm font-bold text-green-700">
                    {formatCurrency(ingresosDia.total)}
                  </span>
                </div>
              </div>

              {/* Egresos */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-600" /> Egresos por categoría
                </h3>
                {Object.keys(egresosPorCategoria).length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">Sin egresos</p>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(egresosPorCategoria).map(([cat, monto]) => (
                      <div
                        key={cat}
                        className="flex items-center justify-between p-2 rounded bg-red-50/40 border border-red-100"
                      >
                        <Badge
                          className={`text-xs border ${
                            CATEGORIA_COLORS[cat as CategoriaCajaMovimiento] ?? ''
                          }`}
                        >
                          {CATEGORIA_LABELS[cat as CategoriaCajaMovimiento] ?? cat}
                        </Badge>
                        <span className="font-semibold text-red-700 text-sm">
                          −{formatCurrency(monto)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1 px-1">
                      <span className="text-sm font-semibold text-gray-700">
                        Total egresos
                      </span>
                      <span className="text-sm font-bold text-red-700">
                        −{formatCurrency(egresosTotales)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Detalle de movimientos del día (Daniel pidió incluirlo) */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-600" /> Detalle de movimientos del día
                  <span className="text-xs font-normal text-gray-500">
                    ({cobros.length} cobros · {movimientos.filter((m) => m.tipo === 'egreso').length} egresos)
                  </span>
                </h3>
                {cobros.length === 0 && movimientos.filter((m) => m.tipo === 'egreso').length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">Sin movimientos hoy</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="border-b border-gray-200">
                          <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Hora</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Tipo</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Doc.</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Descripción</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Cobrador / Autor</th>
                          <th className="text-right px-2 py-1.5 font-semibold text-gray-600">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          type Mov = { hora: string; tipo: 'ingreso' | 'egreso'; doc: string; desc: string; quien: string; monto: number }
                          const items: Mov[] = []
                          cobros.forEach((c) => {
                            items.push({
                              hora: new Date(c.created_at).toLocaleTimeString('es-PE', {
                                hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
                              }),
                              tipo: 'ingreso',
                              doc: (c as any).numero ?? '—',
                              desc: c.cliente_nombre,
                              quien: c.cobrador_nombre,
                              monto: Number(c.total ?? 0),
                            })
                          })
                          movimientos.filter((m) => m.tipo === 'egreso').forEach((m) => {
                            items.push({
                              hora: new Date(m.created_at).toLocaleTimeString('es-PE', {
                                hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
                              }),
                              tipo: 'egreso',
                              doc: '—',
                              desc: `${m.categoria ?? ''} · ${m.descripcion ?? '—'}`,
                              quien: (m as any).cobrador_nombre ?? '—',
                              monto: Number(m.monto ?? 0),
                            })
                          })
                          items.sort((a, b) => a.hora.localeCompare(b.hora))
                          return items.map((m, i) => (
                            <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                              <td className="px-2 py-1.5 font-mono text-gray-600">{m.hora}</td>
                              <td className="px-2 py-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  m.tipo === 'ingreso' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {m.tipo === 'ingreso' ? '+ COBRO' : '− EGRESO'}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 font-mono text-gray-700">{m.doc}</td>
                              <td className="px-2 py-1.5 text-gray-700">{m.desc}</td>
                              <td className="px-2 py-1.5 text-gray-600">{m.quien}</td>
                              <td className={`px-2 py-1.5 text-right font-mono font-semibold ${
                                m.tipo === 'ingreso' ? 'text-green-700' : 'text-red-700'
                              }`}>
                                {m.tipo === 'ingreso' ? '+' : '−'}{formatCurrency(m.monto)}
                              </td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Saldo teórico */}
              <div className="p-4 rounded-lg bg-yellow-50 border-2 border-yellow-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-yellow-800 uppercase tracking-wide">
                      Saldo teórico de cierre
                    </p>
                    <p className="text-xs text-yellow-700 mt-0.5">
                      apertura + ingresos − egresos
                    </p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(saldoTeorico)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* D) Historial de sesiones cerradas */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader
          className="pb-2 cursor-pointer select-none"
          onClick={() => setHistorialOpen((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-gray-800">
              Historial de sesiones cerradas ({historial.length})
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              {historialOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        {historialOpen && (
          <CardContent className="p-0">
            {historial.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                Sin sesiones cerradas
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {[
                        'Apertura', 'Cierre', 'Cajero', 'Saldo inicial',
                        'Saldo final', 'Diferencia', 'Duración', 'Reporte',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {historial.map((s) => {
                      const dif =
                        s.saldo_final !== null ? s.saldo_final - s.saldo_inicial : null
                      return (
                        <tr key={s.id} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-3 text-xs text-gray-600">
                            {formatDatetime(s.fecha_apertura)}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-600">
                            {s.fecha_cierre ? formatDatetime(s.fecha_cierre) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-gray-800">{s.cajero_nombre}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-600">
                            {formatCurrency(s.saldo_inicial)}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-700">
                            {s.saldo_final !== null ? formatCurrency(s.saldo_final) : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-xs font-semibold ${
                              dif === null
                                ? 'text-gray-400'
                                : dif === 0
                                ? 'text-gray-700'
                                : dif > 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            {dif !== null
                              ? `${dif >= 0 ? '+' : ''}${formatCurrency(dif)}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-500">
                            {s.fecha_cierre
                              ? formatDuration(s.fecha_apertura, s.fecha_cierre)
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs">
                            <a
                              href={`/caja/cierre/${s.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-700 hover:underline"
                            >
                              📄 Ver
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ─── Modal Abrir Caja ───────────────────────────────────────────── */}
      <Dialog open={abrirOpen} onOpenChange={setAbrirOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="w-5 h-5 text-green-600" /> Abrir Caja
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Monto de apertura (S/) *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                placeholder="0.00"
                value={formApertura.monto}
                onChange={(e) =>
                  setFormApertura((f) => ({ ...f, monto: e.target.value }))
                }
                className="mt-1"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Efectivo disponible en caja al momento de abrir.
              </p>
            </div>

            {/* Banner de cobros huérfanos detectados (hechos sin caja abierta) */}
            {huerfanos && huerfanos.count > 0 && (
              <div className="border-2 border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-amber-900">
                      {huerfanos.count} cobros fueron registrados con la caja cerrada
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5 leading-snug">
                      Suman {formatCurrency(huerfanos.total)} ({formatCurrency(huerfanos.efectivo_total)} en efectivo).
                      Si los cargas a esta caja, aparecerán en el cierre y reportes.
                    </p>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto bg-white border border-amber-200 rounded">
                  <table className="w-full text-[10px]">
                    <thead className="bg-amber-100/60 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">Recibo</th>
                        <th className="text-left px-2 py-1">Cliente</th>
                        <th className="text-left px-2 py-1">Cobrador</th>
                        <th className="text-right px-2 py-1">Efectivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {huerfanos.cobros.slice(0, 20).map((c) => (
                        <tr key={c.id} className="border-t border-amber-100">
                          <td className="px-2 py-1 font-mono">{c.numero}</td>
                          <td className="px-2 py-1 truncate max-w-[140px]">{c.cliente ?? 'CF'}</td>
                          <td className="px-2 py-1 truncate max-w-[100px]">{c.cobrador}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {Number(c.efectivo).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {huerfanos.cobros.length > 20 && (
                        <tr>
                          <td colSpan={4} className="px-2 py-1 text-center text-amber-700 italic">
                            … y {huerfanos.cobros.length - 20} más
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cargarHuerfanos}
                    onChange={(e) => setCargarHuerfanos(e.target.checked)}
                    className="w-4 h-4 accent-amber-600"
                  />
                  <span className="text-xs font-semibold text-amber-900">
                    Cargar estos cobros a esta sesión (recomendado para trazabilidad)
                  </span>
                </label>
              </div>
            )}
            <div>
              <Label>Notas (opcional)</Label>
              <Textarea
                placeholder="Observaciones sobre la apertura..."
                value={formApertura.notas}
                onChange={(e) =>
                  setFormApertura((f) => ({ ...f, notas: e.target.value }))
                }
                className="mt-1"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setAbrirOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={abrirCaja}
                disabled={saving || !formApertura.monto}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Unlock className="w-4 h-4" /> Confirmar apertura
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Cerrar Caja / Arqueo ─────────────────────────────────── */}
      <Dialog open={cerrarOpen} onOpenChange={setCerrarOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-gray-700" /> Cerrar Caja — Arqueo
            </DialogTitle>
          </DialogHeader>
          {sesion && (
            <div className="space-y-4 mt-2">
              {/* Resumen ingresos */}
              <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                <p className="text-xs text-green-800 font-semibold uppercase tracking-wide mb-2">
                  Ingresos (cobros de la sesión)
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Efectivo</span>
                    <strong>{formatCurrency(ingresosCobros.efectivo)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Yape</span>
                    <strong>{formatCurrency(ingresosCobros.yape)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Plin</span>
                    <strong>{formatCurrency(ingresosCobros.plin)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Transferencia</span>
                    <strong>{formatCurrency(ingresosCobros.transferencia)}</strong>
                  </div>
                </div>
                <div className="flex justify-between mt-2 pt-2 border-t border-green-200">
                  <span className="font-semibold text-green-800">Total ingresos</span>
                  <strong className="text-green-700">
                    {formatCurrency(ingresosCobros.total)}
                  </strong>
                </div>
              </div>

              {/* Resumen egresos */}
              <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                <div className="flex justify-between items-center">
                  <p className="text-xs text-red-800 font-semibold uppercase tracking-wide">
                    Egresos totales
                  </p>
                  <strong className="text-red-700">
                    −{formatCurrency(egresosTotales)}
                  </strong>
                </div>
              </div>

              {/* Saldo teórico */}
              <div className="p-3 rounded-lg bg-gray-100 border border-gray-200 grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between col-span-2">
                  <span className="text-gray-600">Saldo apertura</span>
                  <strong>{formatCurrency(sesion.saldo_inicial)}</strong>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-gray-600">+ Ingresos</span>
                  <strong className="text-green-600">
                    {formatCurrency(ingresosCobros.total)}
                  </strong>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-gray-600">− Egresos</span>
                  <strong className="text-red-600">
                    −{formatCurrency(egresosTotales)}
                  </strong>
                </div>
                <div className="flex justify-between col-span-2 pt-2 border-t border-gray-200">
                  <span className="font-semibold text-gray-800">Saldo teórico</span>
                  <strong className="text-gray-900 text-base">
                    {formatCurrency(saldoTeorico)}
                  </strong>
                </div>
              </div>

              {/* Input monto cierre */}
              <div>
                <Label>Monto de cierre real (S/) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  value={formCierre.monto}
                  onChange={(e) =>
                    setFormCierre((f) => ({ ...f, monto: e.target.value }))
                  }
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Lo que realmente hay en caja (efectivo contado).
                </p>
              </div>

              {/* Diferencia */}
              <div
                className={`p-3 rounded-lg border-2 ${
                  diferenciaCierre === 0
                    ? 'bg-gray-50 border-gray-200'
                    : diferenciaCierre > 0
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">
                      Diferencia
                    </p>
                    <p className="text-xs text-gray-500">cierre − teórico</p>
                  </div>
                  <p
                    className={`text-xl font-bold ${
                      diferenciaCierre === 0
                        ? 'text-gray-700'
                        : diferenciaCierre > 0
                        ? 'text-green-700'
                        : 'text-red-700'
                    }`}
                  >
                    {diferenciaCierre >= 0 ? '+' : ''}
                    {formatCurrency(diferenciaCierre)}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setCerrarOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={cerrarCaja}
                  disabled={saving || !formCierre.monto}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Lock className="w-4 h-4" /> Cerrar caja
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Modal Registrar Egreso ─────────────────────────────────────── */}
      <Dialog open={egresoOpen} onOpenChange={setEgresoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-600" /> Registrar Egreso
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Categoría *</Label>
              <Select
                value={formEgreso.categoria}
                onValueChange={(v) =>
                  setFormEgreso((f) => ({ ...f, categoria: v as typeof f.categoria }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pago_planilla">Pago planilla</SelectItem>
                  <SelectItem value="prestamo_empleado">Préstamo empleado</SelectItem>
                  <SelectItem value="pago_proveedor">Pago proveedor</SelectItem>
                  <SelectItem value="gasto_operativo">Gasto operativo</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
              {(formEgreso.categoria === 'pago_proveedor' ||
                formEgreso.categoria === 'gasto_operativo' ||
                formEgreso.categoria === 'otro') && (
                <p className="text-xs text-amber-600 mt-1">
                  Se registrará como &quot;Otro&quot; en base de datos.
                </p>
              )}
            </div>

            <div>
              <Label>Monto (S/) *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                placeholder="0.00"
                value={formEgreso.monto}
                onChange={(e) =>
                  setFormEgreso((f) => ({ ...f, monto: e.target.value }))
                }
                className="mt-1"
              />
            </div>

            <div>
              <Label>Descripción *</Label>
              <Textarea
                placeholder="Detalle del egreso..."
                value={formEgreso.descripcion}
                onChange={(e) =>
                  setFormEgreso((f) => ({ ...f, descripcion: e.target.value }))
                }
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setEgresoOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={registrarEgreso}
                disabled={saving || !formEgreso.monto || !formEgreso.descripcion}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <DollarSign className="w-4 h-4" /> Registrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Exportamos la lista para documentación (no se usa en runtime)
export { CATEGORIAS_EGRESO }
