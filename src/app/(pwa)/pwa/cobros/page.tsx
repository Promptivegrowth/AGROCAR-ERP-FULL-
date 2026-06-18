'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import {
  DollarSign, Search, Camera, Loader2, CheckCircle, AlertCircle, X, Send,
  FileText, AlertTriangle, StickyNote,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { linkEnviarBoletaPago, esTelefonoPeruanoValido } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import type { Cliente, Cobro } from '@/types'

type Tab = 'registrar' | 'del-dia'

type MetodoPago = 'efectivo' | 'yape' | 'plin' | 'transferencia'

const metodoLabels: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  transferencia: 'Transferencia',
}

const metodoColors: Record<MetodoPago, string> = {
  efectivo: 'bg-green-50 border-green-200 text-green-700',
  yape: 'bg-purple-50 border-purple-200 text-purple-700',
  plin: 'bg-blue-50 border-blue-200 text-blue-700',
  transferencia: 'bg-indigo-50 border-indigo-200 text-indigo-700',
}

interface MontosPago {
  efectivo: number
  yape: number
  plin: number
  transferencia: number
}

interface ComprobantePendiente {
  id: string
  serie: string
  numero: string
  fecha_emision: string
  total: number
  saldo: number
  dias_transcurridos: number
  estado_deuda: 'al_dia' | 'por_vencer' | 'vencido'
}

interface EstadoCuentaCliente {
  facturado: number
  cobrado: number
  saldo: number
  comprobantes: ComprobantePendiente[]
  tieneVencidos: boolean
}

export default function CobrosPage() {
  const [tab, setTab] = useState<Tab>('registrar')
  const [userId, setUserId] = useState<string | null>(null)

  // Registro de cobro
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const [clientesFiltrados, setClientesFiltrados] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const [montos, setMontos] = useState<MontosPago>({ efectivo: 0, yape: 0, plin: 0, transferencia: 0 })
  const [montosStr, setMontosStr] = useState<Record<MetodoPago, string>>({
    efectivo: '', yape: '', plin: '', transferencia: '',
  })
  const [ultimoCobro, setUltimoCobro] = useState<{
    id: string
    numero: string | null
    total: number
    cliente: string
    telefono: string | null
    aplicaciones: Array<{ codigo: string; monto: number }>
    saldoRestante: number | null
  } | null>(null)
  const [voucherFile, setVoucherFile] = useState<File | null>(null)
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null)
  const [nroOperacion, setNroOperacion] = useState('')
  const [notas, setNotas] = useState('')
  const [loadingEnvio, setLoadingEnvio] = useState(false)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)
  const [mensajeError, setMensajeError] = useState<string | null>(null)

  // Estado de cuenta del cliente seleccionado
  const [estadoCuenta, setEstadoCuenta] = useState<EstadoCuentaCliente | null>(null)
  const [loadingEstadoCuenta, setLoadingEstadoCuenta] = useState(false)

  // Modo aplicación: 'fifo' (automático) | 'manual' (selección touch)
  const [modoAplicacion, setModoAplicacion] = useState<'fifo' | 'manual'>('fifo')
  // En modo manual: facturas seleccionadas con su monto a aplicar
  const [aplicacionesManuales, setAplicacionesManuales] = useState<Record<string, string>>({})

  // Cobros del día
  const [cobrosDia, setCobrosDia] = useState<Cobro[]>([])
  const [loadingCobros, setLoadingCobros] = useState(false)
  const [notaExpandida, setNotaExpandida] = useState<string | null>(null)

  const supabase = createClient()

  const totalCobro = Object.values(montos).reduce((acc, v) => acc + v, 0)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Para cobranzas: cargar TODOS los clientes activos (no solo los del vendedor),
      // porque el vendedor también cumple rol de cobrador para cualquier cliente.
      const { data: clientesData } = await supabase
        .from('clientes')
        .select('*')
        .eq('estado', 'activo')
        .order('razon_social')

      setClientes(clientesData ?? [])
    }
    init()
  }, [])

  useEffect(() => {
    if (clienteSearch.length < 2) {
      setClientesFiltrados([])
      setShowDropdown(false)
      return
    }
    const q = clienteSearch.toLowerCase()
    const filtrados = clientes.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.ruc ?? '').toLowerCase().includes(q) ||
        (c.dni ?? '').toLowerCase().includes(q)
    )
    setClientesFiltrados(filtrados.slice(0, 8))
    setShowDropdown(true)
  }, [clienteSearch, clientes])

  const cargarEstadoCuenta = useCallback(async (cliente: Cliente) => {
    setLoadingEstadoCuenta(true)
    setEstadoCuenta(null)
    try {
      const [compRes, cobRes] = await Promise.all([
        supabase
          .from('comprobantes')
          .select('id, serie, numero, fecha_emision, total, estado')
          .eq('cliente_id', cliente.id)
          .neq('estado', 'anulado')
          .order('fecha_emision', { ascending: true }),
        supabase
          .from('cobros')
          .select('total')
          .eq('cliente_id', cliente.id),
      ])

      const comprobantes = compRes.data ?? []
      const cobros = cobRes.data ?? []

      const facturado = comprobantes.reduce((acc, c: any) => acc + Number(c.total ?? 0), 0)
      const cobrado = cobros.reduce((acc, c: any) => acc + Number(c.total ?? 0), 0)
      const saldo = Math.max(0, facturado - cobrado)

      // Aplicar FIFO informativo para saber cuánto queda por cobrar por comprobante
      let remanente = cobrado
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      const creditoDias = cliente.credito_dias ?? 0
      let tieneVencidos = false

      const compPendientes: ComprobantePendiente[] = []
      for (const comp of comprobantes as any[]) {
        const totalComp = Number(comp.total ?? 0)
        const aplicado = Math.min(remanente, totalComp)
        remanente -= aplicado
        const saldoComp = totalComp - aplicado
        if (saldoComp <= 0.0001) continue

        const fechaEmi = new Date(comp.fecha_emision + 'T00:00:00')
        const diasT = Math.floor((hoy.getTime() - fechaEmi.getTime()) / (1000 * 60 * 60 * 24))
        let estadoDeuda: 'al_dia' | 'por_vencer' | 'vencido' = 'al_dia'
        if (diasT > creditoDias) {
          estadoDeuda = 'vencido'
          tieneVencidos = true
        } else if (diasT >= creditoDias - 3) {
          estadoDeuda = 'por_vencer'
        }
        compPendientes.push({
          id: comp.id,
          serie: comp.serie,
          numero: comp.numero,
          fecha_emision: comp.fecha_emision,
          total: totalComp,
          saldo: saldoComp,
          dias_transcurridos: diasT,
          estado_deuda: estadoDeuda,
        })
      }

      setEstadoCuenta({
        facturado,
        cobrado,
        saldo,
        comprobantes: compPendientes,
        tieneVencidos,
      })
    } catch {
      setEstadoCuenta(null)
    } finally {
      setLoadingEstadoCuenta(false)
    }
  }, [supabase])

  useEffect(() => {
    if (clienteSeleccionado) {
      cargarEstadoCuenta(clienteSeleccionado)
    } else {
      setEstadoCuenta(null)
    }
  }, [clienteSeleccionado, cargarEstadoCuenta])

  function actualizarMonto(metodo: MetodoPago, valor: string) {
    setMontosStr((prev) => ({ ...prev, [metodo]: valor }))
    setMontos((prev) => ({ ...prev, [metodo]: parseFloat(valor) || 0 }))
  }

  function handleVoucherChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setVoucherFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setVoucherPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function registrarCobro() {
    if (!clienteSeleccionado || totalCobro <= 0 || !userId) return
    const yapePlinTrans = montos.yape + montos.plin + montos.transferencia
    if (yapePlinTrans > 0 && !nroOperacion.trim()) {
      const msg = 'Yape, Plin y Transferencia requieren el código de operación para conciliación bancaria.'
      setMensajeError(msg)
      toast.error('Nro. de operación requerido', { description: msg })
      return
    }
    setLoadingEnvio(true)
    setMensajeError(null)
    setMensajeExito(null)

    try {
      let voucherUrl: string | null = null

      if (voucherFile) {
        const ext = voucherFile.name.split('.').pop()
        const filename = `cobros/${userId}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('vouchers')
          .upload(filename, voucherFile)

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('vouchers').getPublicUrl(filename)
          voucherUrl = urlData.publicUrl
        }
      }

      // Construir aplicaciones manuales si el vendedor las eligió
      let aplicacionesPayload: Array<{ comprobante_id: string; monto_aplicado: number }> | null = null
      if (modoAplicacion === 'manual') {
        const aps = Object.entries(aplicacionesManuales)
          .map(([compId, montoStr]) => ({
            comprobante_id: compId,
            monto_aplicado: parseFloat(montoStr) || 0,
          }))
          .filter((a) => a.monto_aplicado > 0)
        if (aps.length === 0) {
          const msg = 'Selecciona al menos una factura con monto a aplicar, o cambia a modo automático FIFO.'
          setMensajeError(msg)
          toast.error('Sin facturas seleccionadas', { description: msg })
          return
        }
        const sumaAplic = aps.reduce((acc, a) => acc + a.monto_aplicado, 0)
        if (sumaAplic > totalCobro + 0.001) {
          const msg = `La suma de aplicaciones (${formatCurrency(sumaAplic)}) excede el total cobrado (${formatCurrency(totalCobro)}).`
          setMensajeError(msg)
          toast.error('Aplicaciones inválidas', { description: msg })
          return
        }
        aplicacionesPayload = aps
      }

      const { data: cobroData, error: cobroError } = await (supabase.rpc as any)(
        'registrar_cobro_atomico',
        {
          p_cobro: {
            cliente_id: clienteSeleccionado.id,
            cobrador_id: userId,
            tipo: 'cobranza',
            efectivo: montos.efectivo,
            yape: montos.yape,
            plin: montos.plin,
            transferencia: montos.transferencia,
            total: totalCobro,
            voucher_url: voucherUrl,
            nro_operacion: nroOperacion.trim() || null,
            notas: notas || null,
            fecha: hoyLima(),
          },
          p_aplicaciones: aplicacionesPayload,
        },
      )

      if (cobroError || !cobroData?.id) {
        setMensajeError('Error al registrar el cobro: ' + (cobroError?.message ?? ''))
        toast.error('No se pudo registrar el cobro', { description: cobroError?.message ?? '' })
        return
      }

      // Calcular aplicaciones reales (manuales o FIFO simulado) para el mensaje y toast
      const aplicacionesDetalle: Array<{ codigo: string; monto: number }> = []
      let restante = totalCobro
      if (modoAplicacion === 'manual' && aplicacionesPayload) {
        // Buscar el código de cada factura aplicada en el estado de cuenta
        for (const ap of aplicacionesPayload) {
          const comp = estadoCuenta?.comprobantes.find((c) => c.id === ap.comprobante_id)
          if (comp) {
            aplicacionesDetalle.push({
              codigo: `${comp.serie}-${comp.numero}`,
              monto: ap.monto_aplicado,
            })
          }
          restante -= ap.monto_aplicado
        }
      } else if (estadoCuenta && estadoCuenta.comprobantes.length > 0) {
        for (const comp of estadoCuenta.comprobantes) {
          if (restante <= 0.0001) break
          const aplicar = Math.min(restante, comp.saldo)
          restante -= aplicar
          aplicacionesDetalle.push({
            codigo: `${comp.serie}-${comp.numero}`,
            monto: aplicar,
          })
        }
      }
      // Saldo restante del cliente DESPUÉS de este pago (deuda pendiente)
      const saldoPrevio = estadoCuenta?.saldo ?? 0
      const saldoRestante = Math.max(0, saldoPrevio - totalCobro)

      const toastDescripcion = aplicacionesDetalle.length > 0
        ? aplicacionesDetalle.slice(0, 3).map((a) => `S/${a.monto.toFixed(2)} → ${a.codigo}`).join(' · ')
          + (aplicacionesDetalle.length > 3 ? ` (+${aplicacionesDetalle.length - 3} más)` : '')
        : `${formatCurrency(totalCobro)} · ${clienteSeleccionado.razon_social}`

      setUltimoCobro({
        id: cobroData.id,
        numero: cobroData.numero ?? null,
        total: totalCobro,
        cliente: clienteSeleccionado.razon_social,
        telefono: (clienteSeleccionado as any).telefono ?? null,
        aplicaciones: aplicacionesDetalle,
        saldoRestante,
      })
      setMensajeExito(`Cobro de ${formatCurrency(totalCobro)} registrado correctamente`)
      toast.success('Cobro registrado', {
        description: toastDescripcion,
      })
      setClienteSeleccionado(null)
      setClienteSearch('')
      setMontos({ efectivo: 0, yape: 0, plin: 0, transferencia: 0 })
      setMontosStr({ efectivo: '', yape: '', plin: '', transferencia: '' })
      setNroOperacion('')
      setNotas('')
      setVoucherFile(null)
      setVoucherPreview(null)
      setModoAplicacion('fifo')
      setAplicacionesManuales({})
      cargarCobrosDia()
    } catch {
      setMensajeError('Error inesperado al registrar el cobro')
      toast.error('Error inesperado', { description: 'No se pudo registrar el cobro.' })
    } finally {
      setLoadingEnvio(false)
    }
  }

  const cargarCobrosDia = useCallback(async () => {
    if (!userId) return
    setLoadingCobros(true)
    const hoy = hoyLima()

    const { data } = await supabase
      .from('cobros')
      .select('*')
      .eq('cobrador_id', userId)
      .gte('created_at', hoy)
      .order('created_at', { ascending: false })

    setCobrosDia((data ?? []) as Cobro[])
    setLoadingCobros(false)
  }, [userId])

  useEffect(() => {
    if (tab === 'del-dia' && userId) {
      cargarCobrosDia()
    }
  }, [tab, userId, cargarCobrosDia])

  const totalDia = cobrosDia.reduce((acc, c) => acc + (c.total ?? 0), 0)

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-6 h-6" />
            <h1 className="text-xl font-bold">Cobros</h1>
          </div>
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        <div className="flex bg-white/10 rounded-xl p-1 gap-1">
          {(['registrar', 'del-dia'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === t ? 'bg-[#FBE600] text-black' : 'text-gray-300 hover:text-white'
              }`}
            >
              {t === 'registrar' ? 'Registrar Cobro' : 'Cobros del Día'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {tab === 'registrar' && (
          <>
            {mensajeExito && (
              <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0 text-green-600" />
                  <p className="font-medium text-sm">{mensajeExito}</p>
                </div>
                {ultimoCobro && (() => {
                  const telOk = esTelefonoPeruanoValido(ultimoCobro.telefono)
                  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
                  const waLink = telOk
                    ? linkEnviarBoletaPago({
                        baseUrl,
                        cobroId: ultimoCobro.id,
                        numeroCobro: ultimoCobro.numero,
                        clienteNombre: ultimoCobro.cliente,
                        total: ultimoCobro.total,
                        telefonoCliente: ultimoCobro.telefono!,
                        aplicaciones: ultimoCobro.aplicaciones,
                        saldoRestante: ultimoCobro.saldoRestante,
                      })
                    : null
                  return (
                    <div className="flex flex-col sm:flex-row gap-2">
                      {waLink ? (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-[#25D366] hover:bg-[#1FB659] text-white font-semibold rounded-lg px-4 py-3 text-sm flex items-center justify-center gap-2 transition-colors"
                          onClick={() => {
                            setMensajeExito(null)
                            setUltimoCobro(null)
                            setTab('del-dia')
                          }}
                        >
                          <Send className="w-4 h-4" /> Enviar boleta por WhatsApp
                        </a>
                      ) : (
                        <p className="flex-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          El cliente no tiene celular de 9 dígitos registrado. No se puede enviar por WhatsApp.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMensajeExito(null)
                          setUltimoCobro(null)
                          setTab('del-dia')
                        }}
                        className="px-4 py-3 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                      >
                        Cerrar
                      </button>
                    </div>
                  )
                })()}
              </div>
            )}
            {mensajeError && (
              <div className="bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 px-4 py-3 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {mensajeError}
              </div>
            )}

            {/* Selector de cliente */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">1. Cliente</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Buscar por nombre, RUC o DNI..."
                    value={clienteSearch}
                    onChange={(e) => {
                      setClienteSearch(e.target.value)
                      if (clienteSeleccionado) setClienteSeleccionado(null)
                    }}
                    className="pl-9 h-12 text-base"
                  />
                  {showDropdown && clientesFiltrados.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 mt-1 overflow-hidden">
                      {clientesFiltrados.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setClienteSeleccionado(c)
                            setClienteSearch(c.razon_social)
                            setShowDropdown(false)
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-green-50 border-b border-gray-100 last:border-0"
                        >
                          <div className="font-medium text-gray-900 text-sm">{c.razon_social}</div>
                          <div className="text-xs text-gray-500 font-mono">
                            {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {clienteSeleccionado && (
                  <div className="mt-2 px-3 py-2 bg-green-50 rounded-lg text-sm text-green-800 font-medium">
                    {clienteSeleccionado.razon_social}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Estado de cuenta del cliente */}
            {clienteSeleccionado && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-500" />
                      Estado de cuenta
                    </h3>
                    {loadingEstadoCuenta && (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    )}
                  </div>

                  {estadoCuenta ? (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div className="p-2 rounded-lg bg-gray-50">
                          <p className="text-[10px] text-gray-500 uppercase">Facturado</p>
                          <p className="text-sm font-semibold text-gray-800">
                            {formatCurrency(estadoCuenta.facturado)}
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-green-50">
                          <p className="text-[10px] text-green-700 uppercase">Cobrado</p>
                          <p className="text-sm font-semibold text-green-700">
                            {formatCurrency(estadoCuenta.cobrado)}
                          </p>
                        </div>
                        <div className={`p-2 rounded-lg ${estadoCuenta.saldo > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                          <p className={`text-[10px] uppercase ${estadoCuenta.saldo > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                            Saldo
                          </p>
                          <p className={`text-sm font-bold ${estadoCuenta.saldo > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                            {formatCurrency(estadoCuenta.saldo)}
                          </p>
                        </div>
                      </div>

                      {estadoCuenta.tieneVencidos && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 mb-3 text-xs font-medium">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          Deuda vencida — cliente fuera de plazo de crédito
                        </div>
                      )}

                      {estadoCuenta.comprobantes.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-3">
                          Sin comprobantes pendientes
                        </p>
                      ) : (
                        <div>
                          {/* Selector de modo: FIFO automático vs manual touch */}
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[11px] font-medium text-gray-500 uppercase">
                              Pendientes ({estadoCuenta.comprobantes.length})
                            </p>
                            <div className="flex gap-1 bg-gray-100 rounded-full p-0.5">
                              <button
                                type="button"
                                onClick={() => setModoAplicacion('fifo')}
                                className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full transition-colors ${
                                  modoAplicacion === 'fifo' ? 'bg-white text-black shadow-sm' : 'text-gray-500'
                                }`}
                              >
                                🤖 FIFO
                              </button>
                              <button
                                type="button"
                                onClick={() => setModoAplicacion('manual')}
                                className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full transition-colors ${
                                  modoAplicacion === 'manual' ? 'bg-white text-black shadow-sm' : 'text-gray-500'
                                }`}
                              >
                                ✋ Manual
                              </button>
                            </div>
                          </div>

                          {modoAplicacion === 'manual' && (
                            <p className="text-[10px] text-gray-500 mb-1.5 leading-tight">
                              Marca las facturas que vas a pagar y el monto. Si dejas el monto en blanco, se aplicará el saldo completo de esa factura.
                            </p>
                          )}

                          <div className="max-h-[260px] overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                            {estadoCuenta.comprobantes.map((comp) => {
                              const badgeClass =
                                comp.estado_deuda === 'vencido'
                                  ? 'bg-red-100 text-red-700 border-red-200'
                                  : comp.estado_deuda === 'por_vencer'
                                  ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                                  : 'bg-green-100 text-green-700 border-green-200'
                              const badgeLabel =
                                comp.estado_deuda === 'vencido'
                                  ? 'Vencido'
                                  : comp.estado_deuda === 'por_vencer'
                                  ? 'Por vencer'
                                  : 'Al día'
                              const seleccionada = aplicacionesManuales[comp.id] !== undefined
                              return (
                                <div
                                  key={comp.id}
                                  className={`p-2.5 ${
                                    modoAplicacion === 'manual' && seleccionada ? 'bg-green-50/60' : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    {modoAplicacion === 'manual' && (
                                      <input
                                        type="checkbox"
                                        checked={seleccionada}
                                        onChange={(e) => {
                                          setAplicacionesManuales((prev) => {
                                            const next = { ...prev }
                                            if (e.target.checked) {
                                              next[comp.id] = comp.saldo.toFixed(2)
                                            } else {
                                              delete next[comp.id]
                                            }
                                            return next
                                          })
                                        }}
                                        className="w-5 h-5 shrink-0 accent-green-600 cursor-pointer"
                                      />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-xs font-mono font-semibold text-gray-800">
                                          {comp.serie}-{comp.numero}
                                        </span>
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${badgeClass}`}>
                                          {badgeLabel}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-gray-500 mt-0.5">
                                        {formatDate(comp.fecha_emision)} · {comp.dias_transcurridos}d
                                      </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-xs font-bold text-gray-900">
                                        {formatCurrency(comp.saldo)}
                                      </p>
                                      {comp.saldo < comp.total && (
                                        <p className="text-[10px] text-gray-400">
                                          de {formatCurrency(comp.total)}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Input de monto en modo manual cuando está seleccionada */}
                                  {modoAplicacion === 'manual' && seleccionada && (
                                    <div className="flex items-center gap-2 mt-2 pl-7">
                                      <span className="text-[11px] text-gray-500">Aplicar:</span>
                                      <span className="text-xs text-gray-400">S/</span>
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0"
                                        max={comp.saldo}
                                        value={aplicacionesManuales[comp.id]}
                                        onChange={(e) =>
                                          setAplicacionesManuales((prev) => ({
                                            ...prev,
                                            [comp.id]: e.target.value,
                                          }))
                                        }
                                        className="flex-1 h-8 px-2 text-sm font-mono border border-gray-200 rounded-md focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                        placeholder={comp.saldo.toFixed(2)}
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setAplicacionesManuales((prev) => ({
                                            ...prev,
                                            [comp.id]: comp.saldo.toFixed(2),
                                          }))
                                        }
                                        className="text-[10px] text-green-700 font-semibold underline"
                                      >
                                        Total
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Resumen aplicación manual */}
                          {modoAplicacion === 'manual' && Object.keys(aplicacionesManuales).length > 0 && (() => {
                            const sumaAplic = Object.values(aplicacionesManuales)
                              .reduce((acc, v) => acc + (parseFloat(v) || 0), 0)
                            const diferencia = totalCobro - sumaAplic
                            return (
                              <div className="mt-2 p-2 bg-gray-50 rounded-lg text-xs space-y-0.5">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Suma aplicada:</span>
                                  <span className="font-mono font-semibold">{formatCurrency(sumaAplic)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Total cobrado:</span>
                                  <span className="font-mono">{formatCurrency(totalCobro)}</span>
                                </div>
                                {Math.abs(diferencia) > 0.001 && (
                                  <div className={`flex justify-between font-semibold ${
                                    diferencia > 0 ? 'text-amber-700' : 'text-red-700'
                                  }`}>
                                    <span>{diferencia > 0 ? 'A cuenta:' : '⚠ Sobra-aplicado:'}</span>
                                    <span className="font-mono">{formatCurrency(Math.abs(diferencia))}</span>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </>
                  ) : !loadingEstadoCuenta ? (
                    <p className="text-xs text-gray-400 text-center py-3">
                      Sin información de cuenta
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {/* Métodos de pago */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">2. Montos por Método de Pago</h3>
                <div className="space-y-3">
                  {(Object.keys(metodoLabels) as MetodoPago[]).map((metodo) => (
                    <div key={metodo} className="flex items-center gap-3">
                      <div className={`flex-none w-28 text-center text-xs font-semibold px-2 py-2 rounded-lg border ${metodoColors[metodo]}`}>
                        {metodoLabels[metodo]}
                      </div>
                      <div className="flex-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={montosStr[metodo]}
                          onChange={(e) => actualizarMonto(metodo, e.target.value)}
                          className="h-11 text-base"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {totalCobro > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
                    <span className="font-semibold text-gray-800">Total a cobrar</span>
                    <span className="text-2xl font-bold text-green-700">{formatCurrency(totalCobro)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Nro. operación — solo si pagó con método digital */}
            {(montos.yape + montos.plin + montos.transferencia) > 0 && (
              <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-800 mb-1">
                    3. Nro. de operación <span className="text-red-500">*</span>
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Código de la transacción Yape / Plin / Transferencia. Necesario para conciliar con el banco.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Ej. 0123456789"
                    value={nroOperacion}
                    onChange={(e) => setNroOperacion(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-[#FBE600]"
                  />
                </CardContent>
              </Card>
            )}

            {/* Foto de voucher */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">
                  {(montos.yape + montos.plin + montos.transferencia) > 0 ? '4' : '3'}. Foto de Voucher (opcional)
                </h3>
                {voucherPreview ? (
                  <div className="relative bg-gray-100 rounded-xl overflow-hidden">
                    <img
                      src={voucherPreview}
                      alt="Voucher"
                      className="block mx-auto max-h-64 w-auto max-w-full object-contain rounded-xl"
                    />
                    <button
                      onClick={() => { setVoucherFile(null); setVoucherPreview(null) }}
                      className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md"
                    >
                      <X className="w-4 h-4 text-gray-600" />
                    </button>
                    <p className="text-[11px] text-gray-500 text-center py-1.5 bg-white border-t border-gray-100">
                      Se guardará junto al cobro para consulta posterior
                    </p>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-[#FBE600] hover:bg-yellow-50 transition-colors">
                    <Camera className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-500">Tomar foto o seleccionar</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleVoucherChange}
                      className="hidden"
                    />
                  </label>
                )}
              </CardContent>
            </Card>

            {/* Notas */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">4. Notas (opcional)</h3>
                <textarea
                  placeholder="Observaciones del cobro..."
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-[#FBE600]"
                />
              </CardContent>
            </Card>

            {/* Botón registrar */}
            <Button
              onClick={registrarCobro}
              disabled={!clienteSeleccionado || totalCobro <= 0 || loadingEnvio}
              className="w-full h-14 bg-[#FBE600] hover:bg-[#E5D100] text-black font-bold text-base rounded-xl shadow-md"
            >
              {loadingEnvio ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <DollarSign className="w-5 h-5" />
                  Registrar Cobro
                </>
              )}
            </Button>
          </>
        )}

        {tab === 'del-dia' && (
          <div className="space-y-3">
            {/* Resumen del día */}
            {cobrosDia.length > 0 && (
              <div className="bg-black rounded-2xl p-4 text-white border-l-4 border-[#FBE600]">
                <div className="text-sm opacity-80">Total cobrado hoy</div>
                <div className="text-3xl font-bold mt-1 text-[#FBE600]">{formatCurrency(totalDia)}</div>
                <div className="text-sm opacity-70 mt-1">{cobrosDia.length} cobros registrados</div>
              </div>
            )}

            {loadingCobros ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-green-600" />
              </div>
            ) : cobrosDia.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">Sin cobros hoy</p>
                <p className="text-gray-400 text-sm">Los cobros registrados hoy aparecerán aquí</p>
              </div>
            ) : (
              cobrosDia.map((cobro) => {
                const metodosPagados = (Object.keys(metodoLabels) as MetodoPago[]).filter(
                  (m) => (cobro[m] ?? 0) > 0
                )
                const tieneNota = Boolean(cobro.notas && cobro.notas.trim().length > 0)
                const notaLarga = tieneNota && (cobro.notas ?? '').length > 60
                const expandida = notaExpandida === cobro.id
                return (
                  <Card key={cobro.id} className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-gray-900 text-sm">
                            #{cobro.id.slice(-8).toUpperCase()}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatDate(cobro.created_at)}
                          </div>
                          {metodosPagados.length > 0 && (
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {metodosPagados.map((m) => (
                                <span
                                  key={m}
                                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${metodoColors[m]}`}
                                >
                                  {metodoLabels[m]}: {formatCurrency(cobro[m] ?? 0)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="font-bold text-green-700 text-lg shrink-0 ml-2">
                          {formatCurrency(cobro.total ?? 0)}
                        </div>
                      </div>
                      {tieneNota && (
                        <button
                          type="button"
                          onClick={() => setNotaExpandida(expandida ? null : cobro.id)}
                          className="mt-2 w-full text-left flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5"
                        >
                          <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <span className={`text-xs text-amber-800 ${expandida ? '' : 'line-clamp-1'}`}>
                            {cobro.notas}
                          </span>
                          {notaLarga && !expandida && (
                            <span className="text-[10px] text-amber-600 font-medium shrink-0">
                              ver más
                            </span>
                          )}
                        </button>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
