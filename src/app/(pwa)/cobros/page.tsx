'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign, Search, Camera, Loader2, CheckCircle, AlertCircle, X
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
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
  const [voucherFile, setVoucherFile] = useState<File | null>(null)
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null)
  const [notas, setNotas] = useState('')
  const [loadingEnvio, setLoadingEnvio] = useState(false)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)
  const [mensajeError, setMensajeError] = useState<string | null>(null)

  // Cobros del día
  const [cobrosDia, setCobrosDia] = useState<Cobro[]>([])
  const [loadingCobros, setLoadingCobros] = useState(false)

  const supabase = createClient()

  const totalCobro = Object.values(montos).reduce((acc, v) => acc + v, 0)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: clientesData } = await supabase
        .from('clientes')
        .select('*')
        .eq('vendedor_id', user.id)
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
        (c.codigo ?? '').toLowerCase().includes(q)
    )
    setClientesFiltrados(filtrados.slice(0, 8))
    setShowDropdown(true)
  }, [clienteSearch, clientes])

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

      const { error: cobroError } = await supabase.from('cobros').insert({
        cliente_id: clienteSeleccionado.id,
        cobrador_id: userId,
        tipo: 'cobranza',
        efectivo: montos.efectivo,
        yape: montos.yape,
        plin: montos.plin,
        transferencia: montos.transferencia,
        total: totalCobro,
        voucher_url: voucherUrl,
        notas: notas || null,
        fecha: new Date().toISOString().split('T')[0],
      })

      if (cobroError) {
        setMensajeError('Error al registrar el cobro: ' + cobroError.message)
        return
      }

      setMensajeExito(`Cobro de ${formatCurrency(totalCobro)} registrado correctamente`)
      setClienteSeleccionado(null)
      setClienteSearch('')
      setMontos({ efectivo: 0, yape: 0, plin: 0, transferencia: 0 })
      setMontosStr({ efectivo: '', yape: '', plin: '', transferencia: '' })
      setNotas('')
      setVoucherFile(null)
      setVoucherPreview(null)
      setTab('del-dia')
      cargarCobrosDia()
    } catch {
      setMensajeError('Error inesperado al registrar el cobro')
    } finally {
      setLoadingEnvio(false)
    }
  }

  const cargarCobrosDia = useCallback(async () => {
    if (!userId) return
    setLoadingCobros(true)
    const hoy = new Date().toISOString().split('T')[0]

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
      <div className="bg-green-600 text-white px-4 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <DollarSign className="w-6 h-6" />
          <h1 className="text-xl font-bold">Cobros</h1>
        </div>
        <div className="flex bg-green-700/50 rounded-xl p-1 gap-1">
          {(['registrar', 'del-dia'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === t ? 'bg-white text-green-700' : 'text-green-100 hover:text-white'
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
              <div className="bg-green-50 border border-green-200 text-green-700 flex items-center gap-2 px-4 py-3 rounded-xl">
                <CheckCircle className="w-4 h-4 shrink-0" />
                {mensajeExito}
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
                    placeholder="Buscar cliente..."
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
                          <div className="text-xs text-gray-500">{c.codigo}</div>
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

            {/* Foto de voucher */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">3. Foto de Voucher (opcional)</h3>
                {voucherPreview ? (
                  <div className="relative">
                    <img
                      src={voucherPreview}
                      alt="Voucher"
                      className="w-full h-40 object-cover rounded-xl"
                    />
                    <button
                      onClick={() => { setVoucherFile(null); setVoucherPreview(null) }}
                      className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md"
                    >
                      <X className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors">
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-green-500"
                />
              </CardContent>
            </Card>

            {/* Botón registrar */}
            <Button
              onClick={registrarCobro}
              disabled={!clienteSeleccionado || totalCobro <= 0 || loadingEnvio}
              className="w-full h-14 bg-green-600 hover:bg-green-700 text-white font-bold text-base rounded-xl shadow-md"
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
              <div className="bg-green-600 rounded-2xl p-4 text-white">
                <div className="text-sm opacity-80">Total cobrado hoy</div>
                <div className="text-3xl font-bold mt-1">{formatCurrency(totalDia)}</div>
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
                return (
                  <Card key={cobro.id} className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
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
                        <div className="font-bold text-green-700 text-lg">
                          {formatCurrency(cobro.total ?? 0)}
                        </div>
                      </div>
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
