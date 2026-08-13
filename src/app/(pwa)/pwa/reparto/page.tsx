'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Truck, MapPin, Phone, CheckCircle2, Clock, FileText } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface Entrega {
  id: string
  pedido: string
  cliente: string
  direccion: string | null
  telefono: string | null
  zona: string | null
  condicion: string
  total: number
  cobrado: number
  estado: string
  notas: string | null
  comprobante: string | null
  comp_tipo: string | null
}

interface Reparto {
  fecha: string
  despachos: { id: string; numero: string; estado: string; placa: string | null; conductor: string | null }[]
  entregas: Entrega[]
  resumen: {
    entregas: number; monto: number; cobrado: number
    contado: number; credito: number; pendientes: number
  }
}

export default function RepartoPage() {
  const supabase = createClient()
  const [data, setData] = useState<Reparto | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const { data: d, error: e } = await (supabase.rpc as any)('pwa_mi_reparto', {
      p_fecha: hoyLima(),
    })
    setCargando(false)
    if (e) { setError(e.message); return }
    setData(d as Reparto)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const fechaFmt = new Date(hoyLima() + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Lima',
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-black text-white px-4 py-4 sticky top-0 z-10">
        <h1 className="font-bold text-lg flex items-center gap-2">
          <Truck className="w-5 h-5 text-[#FBE600]" />
          Mi reparto de hoy
        </h1>
        <p className="text-xs text-gray-400 capitalize">{fechaFmt}</p>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <p className="text-center py-16 px-6 text-sm text-red-600">{error}</p>
      ) : !data || data.entregas.length === 0 ? (
        <div className="text-center py-20 px-8">
          <Truck className="w-14 h-14 text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-700">No tienes reparto asignado hoy</p>
          <p className="text-sm text-gray-500 mt-1">
            Cuando en oficina te asignen la ruta, va a aparecer acá con todas tus entregas.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Resumen del día */}
          <div className="bg-[#FBE600] rounded-2xl p-4">
            <p className="text-xs font-bold uppercase text-gray-800">ENTREGAS DE HOY</p>
            <p className="text-3xl font-black text-gray-900 mt-1">
              {data.resumen.entregas}
              {data.resumen.pendientes > 0 && (
                <span className="text-base font-bold ml-2">
                  · {data.resumen.pendientes} por entregar
                </span>
              )}
            </p>
            <div className="flex justify-between text-xs text-gray-800 mt-2 pt-2 border-t border-black/10">
              <span>A repartir: <strong>{formatCurrency(data.resumen.monto)}</strong></span>
              <span>Cobrado: <strong>{formatCurrency(data.resumen.cobrado)}</strong></span>
            </div>
            <div className="flex gap-3 text-[11px] text-gray-700 mt-1">
              <span>{data.resumen.contado} al contado</span>
              <span>·</span>
              <span>{data.resumen.credito} al crédito</span>
            </div>
          </div>

          {/* Vehículo asignado */}
          {data.despachos.map((d) => (
            <div key={d.id} className="bg-white rounded-xl p-3 shadow-sm text-xs text-gray-600">
              <span className="font-semibold text-gray-900">{d.numero}</span>
              {d.placa && <span className="ml-2">· Unidad {d.placa}</span>}
              {d.conductor && <span className="ml-2">· Chofer {d.conductor}</span>}
            </div>
          ))}

          {/* Entregas */}
          <div className="space-y-2">
            {data.entregas.map((e) => {
              const entregado = e.estado === 'entregado'
              const saldo = Number(e.total) - Number(e.cobrado)
              return (
                <div key={e.id}
                  className={`bg-white rounded-xl p-3 shadow-sm border-l-4 ${
                    entregado ? 'border-green-500' : 'border-amber-400'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-gray-900 leading-tight">{e.cliente}</p>
                      {e.direccion && (
                        <p className="text-[11px] text-gray-500 mt-0.5 flex items-start gap-1">
                          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                          {e.direccion}
                        </p>
                      )}
                      {e.zona && <p className="text-[10px] text-gray-400 mt-0.5">{e.zona}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">{formatCurrency(e.total)}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        e.condicion === 'contado'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-orange-100 text-orange-800'
                      }`}>
                        {e.condicion === 'contado' ? 'CONTADO' : 'CRÉDITO'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-100">
                    <span className={`text-[11px] font-semibold flex items-center gap-1 ${
                      entregado ? 'text-green-700' : 'text-amber-700'
                    }`}>
                      {entregado
                        ? <><CheckCircle2 className="w-3.5 h-3.5" /> Entregado</>
                        : <><Clock className="w-3.5 h-3.5" /> Pendiente</>}
                    </span>

                    {e.comprobante && (
                      <span className="text-[10px] font-mono text-gray-500 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {e.comprobante}
                      </span>
                    )}

                    {e.telefono && (
                      <a href={`tel:${e.telefono}`}
                        className="text-[11px] font-semibold text-blue-700 flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" /> Llamar
                      </a>
                    )}
                  </div>

                  {saldo > 0.009 && (
                    <p className="text-[11px] text-orange-700 bg-orange-50 rounded p-1.5 mt-2">
                      Por cobrar: <strong>{formatCurrency(saldo)}</strong>
                    </p>
                  )}
                  {e.notas && (
                    <p className="text-[11px] text-gray-500 mt-1.5">{e.notas}</p>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-gray-400 text-center">
            Los cobros se registran en la pantalla de Cobros.
          </p>
        </div>
      )}
    </div>
  )
}
