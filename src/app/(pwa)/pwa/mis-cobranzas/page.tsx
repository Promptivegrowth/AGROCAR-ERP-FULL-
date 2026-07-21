'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Landmark, Search, Phone, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { diasVencidos } from '@/lib/cliente-saldo'

interface Doc {
  comp_id: string
  serie: string
  numero: number
  fecha_emision: string
  total: number
  abonado: number
  saldo: number
  dv: number
}

interface ClienteCxC {
  id: string
  razon_social: string
  telefono: string | null
  direccion: string | null
  credito_dias: number
  saldo: number
  vencido: number
  docs: Doc[]
}

export default function MisCobranzasPage() {
  const router = useRouter()
  const supabase = createClient()
  const [clientes, setClientes] = useState<ClienteCxC[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [soloVencidos, setSoloVencidos] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) { setLoading(false); return }

    // Mis clientes activos
    const { data: cls } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, telefono, direccion, credito_dias')
      .eq('vendedor_id', uid)
      .eq('estado', 'activo')
    const ids = ((cls ?? []) as any[]).map((c) => c.id)
    if (ids.length === 0) { setClientes([]); setLoading(false); return }

    // Comprobantes + aplicaciones de cobro
    const [{ data: comps }, { data: apls }] = await Promise.all([
      (supabase as any).from('comprobantes')
        .select('id, serie, numero, fecha_emision, total, cliente_id')
        .in('cliente_id', ids)
        .neq('estado', 'anulado'),
      (supabase as any).from('cobros_aplicaciones')
        .select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)')
        .in('cobros.cliente_id', ids),
    ])

    const abonadoMap = new Map<string, number>()
    ;((apls ?? []) as any[]).forEach((a) => {
      if (!a.comprobante_id) return
      abonadoMap.set(a.comprobante_id, (abonadoMap.get(a.comprobante_id) ?? 0) + Number(a.monto_aplicado ?? 0))
    })

    const porCliente = new Map<string, any[]>()
    ;((comps ?? []) as any[]).forEach((c) => {
      const arr = porCliente.get(c.cliente_id) ?? []
      arr.push(c)
      porCliente.set(c.cliente_id, arr)
    })

    const filas: ClienteCxC[] = ((cls ?? []) as any[]).map((cl) => {
      const docs: Doc[] = (porCliente.get(cl.id) ?? [])
        .map((c: any) => {
          const abonado = abonadoMap.get(c.id) ?? 0
          const total = Number(c.total ?? 0)
          return {
            comp_id: c.id, serie: c.serie, numero: c.numero,
            fecha_emision: c.fecha_emision, total, abonado,
            saldo: Math.max(0, total - abonado),
            dv: diasVencidos(c.fecha_emision, cl.credito_dias),
          }
        })
        .filter((d: Doc) => d.saldo > 0.01)
        .sort((a: Doc, b: Doc) => b.dv - a.dv)
      const saldo = docs.reduce((a, d) => a + d.saldo, 0)
      const vencido = docs.filter((d) => d.dv > 0).reduce((a, d) => a + d.saldo, 0)
      return { ...cl, saldo, vencido, docs }
    })
      .filter((c: ClienteCxC) => c.saldo > 0.01)
      .sort((a: ClienteCxC, b: ClienteCxC) => b.vencido - a.vencido || b.saldo - a.saldo)

    setClientes(filas)
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    let r = clientes
    if (soloVencidos) r = r.filter((c) => c.vencido > 0)
    const q = busqueda.trim().toLowerCase()
    if (q) r = r.filter((c) => c.razon_social.toLowerCase().includes(q))
    return r
  }, [clientes, busqueda, soloVencidos])

  const totalSaldo = clientes.reduce((a, c) => a + c.saldo, 0)
  const totalVencido = clientes.reduce((a, c) => a + c.vencido, 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-black text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-lg flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#FBE600]" />
              Mis Cuentas por Cobrar
            </h1>
            <p className="text-xs text-gray-400">Clientes con deuda a tu cargo</p>
          </div>
        </div>
        {/* Totales */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-white/10 rounded-lg p-2">
            <p className="text-[10px] text-gray-400 uppercase">Por cobrar total</p>
            <p className="font-bold text-[#FBE600]">{formatCurrency(totalSaldo)}</p>
          </div>
          <div className="bg-red-500/20 rounded-lg p-2">
            <p className="text-[10px] text-red-300 uppercase">Vencido</p>
            <p className="font-bold text-red-300">{formatCurrency(totalVencido)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-3 space-y-2 bg-white border-b border-gray-100 sticky top-[132px] z-10">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-xl bg-gray-50"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)}
            className="w-4 h-4 accent-red-500" />
          Solo clientes con deuda vencida
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 px-6">
          <Landmark className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-semibold">
            {busqueda || soloVencidos ? 'Sin resultados con ese filtro' : '¡Sin deudas pendientes! 🎉'}
          </p>
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {filtrados.map((c) => {
            const abierto = expandido === c.id
            return (
              <div key={c.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Cabecera del cliente */}
                <button onClick={() => setExpandido(abierto ? null : c.id)}
                  className="w-full p-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-gray-900 truncate">{c.razon_social}</p>
                      <p className="text-[10px] text-gray-400 truncate">{c.direccion ?? 'Sin dirección'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">{formatCurrency(c.saldo)}</p>
                      {c.vencido > 0 && (
                        <p className="text-[10px] text-red-600 font-bold flex items-center justify-end gap-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          {formatCurrency(c.vencido)} vencido
                        </p>
                      )}
                    </div>
                    {abierto ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-1" />}
                  </div>
                </button>

                {/* Detalle expandido */}
                {abierto && (
                  <div className="border-t border-gray-100 bg-gray-50/60 p-3 space-y-2">
                    {c.docs.map((d) => (
                      <div key={d.comp_id} className="flex items-center justify-between text-xs bg-white rounded-lg p-2">
                        <div>
                          <p className="font-mono font-semibold">{d.serie}-{String(d.numero).padStart(8, '0')}</p>
                          <p className="text-gray-400">{formatDate(d.fecha_emision)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">{formatCurrency(d.saldo)}</p>
                          {d.dv > 0
                            ? <p className="text-red-600 font-semibold">{d.dv} días vencido</p>
                            : <p className="text-emerald-600">al día</p>}
                        </div>
                      </div>
                    ))}
                    {/* Acciones de contacto */}
                    {c.telefono && (
                      <div className="flex gap-2 pt-1">
                        <a href={`tel:${c.telefono}`}
                          className="flex-1 h-10 bg-blue-600 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1">
                          <Phone className="w-3.5 h-3.5" /> Llamar
                        </a>
                        <a href={`https://wa.me/51${c.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${c.razon_social}, le saluda su vendedor de AGROCAR. Le recuerdo su saldo pendiente de ${formatCurrency(c.saldo)}. ¿Coordinamos el pago?`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex-1 h-10 bg-green-600 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1">
                          💬 WhatsApp
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
