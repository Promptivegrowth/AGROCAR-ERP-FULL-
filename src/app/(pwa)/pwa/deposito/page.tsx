'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Landmark, Camera, X, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Caja Tacna', 'BanBif', 'Otro']

interface Deposito {
  id: string
  monto: number
  banco: string | null
  nro_operacion: string | null
  estado: string
  observacion: string | null
  voucher_url: string | null
  created_at: string
}

export default function DepositoPage() {
  const router = useRouter()
  const supabase = createClient()
  const hoy = hoyLima()

  const [monto, setMonto] = useState('')
  const [banco, setBanco] = useState('BCP')
  const [nroOperacion, setNroOperacion] = useState('')
  const [notas, setNotas] = useState('')
  const [voucherFile, setVoucherFile] = useState<File | null>(null)
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [depositosHoy, setDepositosHoy] = useState<Deposito[]>([])
  const [efectivoCobrado, setEfectivoCobrado] = useState(0)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCargando(false); return }

    const [{ data: deps }, { data: cobros }] = await Promise.all([
      (supabase as any).from('depositos_bancarios')
        .select('id, monto, banco, nro_operacion, estado, observacion, voucher_url, created_at')
        .eq('persona_id', user.id).eq('fecha', hoy)
        .order('created_at', { ascending: false }),
      (supabase as any).from('cobros')
        .select('efectivo').eq('cobrador_id', user.id).eq('fecha', hoy),
    ])

    setDepositosHoy((deps ?? []) as Deposito[])
    setEfectivoCobrado((cobros ?? []).reduce((a: number, c: any) => a + Number(c.efectivo ?? 0), 0))
    setCargando(false)
  }, [supabase, hoy])

  useEffect(() => { cargar() }, [cargar])

  const totalDepositado = depositosHoy.reduce((a, d) => a + Number(d.monto), 0)
  const porEntregar = efectivoCobrado - totalDepositado

  const elegirFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 8 * 1024 * 1024) {
      toast.error('La foto es muy pesada', { description: 'Máximo 8 MB' })
      return
    }
    setVoucherFile(f)
    setVoucherPreview(URL.createObjectURL(f))
  }

  const quitarFoto = () => {
    if (voucherPreview) URL.revokeObjectURL(voucherPreview)
    setVoucherFile(null)
    setVoucherPreview(null)
  }

  const guardar = async () => {
    const montoNum = parseFloat(monto.replace(',', '.'))
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa el monto depositado')
      return
    }
    if (montoNum > porEntregar + 0.01) {
      const seguir = confirm(
        `Estás registrando S/ ${montoNum.toFixed(2)} pero según el sistema solo tienes ` +
        `S/ ${porEntregar.toFixed(2)} en efectivo por entregar hoy.\n\n¿Registrar de todas formas?`
      )
      if (!seguir) return
    }

    setGuardando(true)
    try {
      let voucherUrl: string | null = null
      if (voucherFile) {
        const ext = voucherFile.name.split('.').pop() ?? 'jpg'
        const filename = `deposito-${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('vouchers').upload(filename, voucherFile)
        if (upErr) {
          toast.error('No se pudo subir la foto', { description: upErr.message })
        } else {
          voucherUrl = supabase.storage.from('vouchers').getPublicUrl(filename).data.publicUrl
        }
      }

      const { error } = await (supabase.rpc as any)('registrar_deposito', {
        p_monto: montoNum,
        p_banco: banco,
        p_nro_operacion: nroOperacion,
        p_voucher_url: voucherUrl,
        p_notas: notas,
        p_fecha: hoy,
      })

      if (error) {
        toast.error('No se pudo registrar', { description: error.message })
        return
      }

      toast.success('Depósito registrado', {
        description: `S/ ${montoNum.toFixed(2)} en ${banco}. Caja lo verá al instante.`,
      })
      setMonto(''); setNroOperacion(''); setNotas(''); quitarFoto()
      cargar()
    } finally {
      setGuardando(false)
    }
  }

  const badgeEstado = (estado: string) => {
    if (estado === 'verificado') {
      return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
        <CheckCircle2 className="w-3 h-3" /> Verificado</span>
    }
    if (estado === 'observado') {
      return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
        <AlertTriangle className="w-3 h-3" /> Observado</span>
    }
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
      <Clock className="w-3 h-3" /> Por verificar</span>
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-black text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-lg flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#FBE600]" />
              Depositar al banco
            </h1>
            <p className="text-xs text-gray-400">Para no andar con efectivo encima</p>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Cuánto tiene en efectivo */}
          <div className="bg-[#FBE600] rounded-2xl p-4">
            <p className="text-xs font-bold uppercase text-gray-800">EFECTIVO QUE TIENES HOY</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{formatCurrency(porEntregar)}</p>
            <div className="flex justify-between text-xs text-gray-800 mt-2 pt-2 border-t border-black/10">
              <span>Cobrado en efectivo: <strong>{formatCurrency(efectivoCobrado)}</strong></span>
              <span>Ya depositaste: <strong>{formatCurrency(totalDepositado)}</strong></span>
            </div>
          </div>

          {/* Formulario */}
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <div>
              <Label className="text-xs font-semibold text-gray-700">¿Cuánto depositaste? *</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">S/</span>
                <Input type="number" inputMode="decimal" step="0.10" min="0"
                  value={monto} onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="h-14 pl-10 text-2xl font-bold text-right" />
              </div>
              {porEntregar > 0 && (
                <button type="button" onClick={() => setMonto(porEntregar.toFixed(2))}
                  className="mt-1.5 text-xs font-semibold text-blue-600 underline">
                  Depositar todo ({formatCurrency(porEntregar)})
                </button>
              )}
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Banco</Label>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {BANCOS.map((b) => (
                  <button key={b} type="button" onClick={() => setBanco(b)}
                    className={`py-2 rounded-lg text-[11px] font-semibold border ${
                      banco === b ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200'
                    }`}>
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">N° de operación</Label>
              <Input value={nroOperacion} onChange={(e) => setNroOperacion(e.target.value)}
                placeholder="El número que sale en el voucher"
                className="h-11 mt-1" inputMode="numeric" />
            </div>

            {/* Foto del voucher */}
            <div>
              <Label className="text-xs font-semibold text-gray-700">Foto del voucher</Label>
              {voucherPreview ? (
                <div className="relative mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={voucherPreview} alt="Voucher" className="w-full h-44 object-cover rounded-lg border" />
                  <button type="button" onClick={quitarFoto}
                    className="absolute top-2 right-2 bg-black/70 text-white p-1.5 rounded-full">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="mt-1 flex flex-col items-center justify-center gap-1 h-24 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 cursor-pointer active:bg-gray-50">
                  <Camera className="w-6 h-6" />
                  <span className="text-xs font-semibold">Tomar foto del voucher</span>
                  <input type="file" accept="image/*" capture="environment" onChange={elegirFoto} className="hidden" />
                </label>
              )}
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Nota (opcional)</Label>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)}
                placeholder="Ej: depósito del mercado Grau" className="h-11 mt-1" />
            </div>

            <Button onClick={guardar} disabled={guardando}
              className="w-full h-14 bg-black hover:bg-gray-800 text-white font-bold text-base">
              {guardando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Landmark className="w-5 h-5" />}
              Registrar depósito
            </Button>
          </div>

          {/* Depósitos de hoy */}
          <div>
            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Tus depósitos de hoy</p>
            {depositosHoy.length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">
                Todavía no registraste ningún depósito hoy
              </div>
            ) : (
              <div className="space-y-2">
                {depositosHoy.map((d) => (
                  <div key={d.id} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-gray-900">{formatCurrency(d.monto)}</p>
                        <p className="text-xs text-gray-500">
                          {d.banco ?? 'Banco no indicado'}
                          {d.nro_operacion ? ` · Op. ${d.nro_operacion}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        {badgeEstado(d.estado)}
                        <p className="text-[10px] text-gray-400 mt-1">
                          {new Date(d.created_at).toLocaleTimeString('es-PE', {
                            hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
                          })}
                        </p>
                      </div>
                    </div>
                    {d.observacion && (
                      <p className="text-xs text-red-600 mt-1.5 bg-red-50 rounded p-1.5">
                        Caja observó: {d.observacion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-400 text-center">
            Lo que depositas se descuenta del efectivo que debes entregar en caja
            y aparece en tu hoja de rendición.
          </p>
        </div>
      )}
    </div>
  )
}
