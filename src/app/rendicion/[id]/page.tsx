'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Printer, AlertTriangle } from 'lucide-react'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import { hoyLima } from '@/lib/fechas-pe'

interface Rendicion {
  persona: { id: string; nombre: string; rol: string }
  fecha: string
  generado_at: string
  ventas: {
    count: number; monto: number
    contado_count: number; contado_monto: number
    credito_count: number; credito_monto: number
    documentos: { tipo: string; serie: string; numero: string; cliente: string; total: number; tipo_pago: string }[]
  }
  cobros: {
    count: number; efectivo: number; yape: number; plin: number
    transferencia: number; total: number
    detalle: {
      hora: string; numero: string | null; cliente: string
      efectivo: number; yape: number; plin: number; transferencia: number
      total: number; nro_operacion: string | null; tiene_voucher: boolean
    }[]
  }
  depositos: {
    count: number; monto: number
    detalle: {
      hora: string; monto: number; banco: string | null
      nro_operacion: string | null; estado: string; tiene_voucher: boolean
    }[]
  }
  efectivo_a_entregar: number
}

const ROL_LABEL: Record<string, string> = {
  vendedor: 'VENDEDOR', repartidor: 'REPARTIDOR', chofer: 'CHOFER',
}

const TIPO_CORTO: Record<string, string> = {
  factura: 'FAC', boleta: 'BOL', nota_pedido_interna: 'INT', nota_credito: 'NC',
}

const num = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function RendicionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const search = useSearchParams()
  const supabase = createClient()

  const fecha = search.get('fecha') || hoyLima()
  const [data, setData] = useState<Rendicion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: d, error: e } = await (supabase.rpc as any)('rendicion_persona', {
      p_persona_id: id,
      p_fecha: fecha,
    })
    setLoading(false)
    if (e) { setError(e.message); return }
    setData(d as Rendicion)
  }, [supabase, id, fecha])

  useEffect(() => { cargar() }, [cargar])

  const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima',
  })

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="font-semibold text-gray-900">No se pudo generar la rendición</p>
        <p className="text-sm text-gray-500 max-w-sm">{error ?? 'Sin datos'}</p>
      </div>
    )
  }

  const sinMovimiento =
    data.ventas.count === 0 && data.cobros.count === 0 && (data.depositos?.count ?? 0) === 0

  return (
    <div className="min-h-dvh bg-gray-200 print:bg-white py-6 print:py-0">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 10mm; }
        body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        .hoja { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; }
        tr { break-inside: avoid; }
      }`}</style>

      {/* Barra solo en pantalla */}
      <div className="no-print max-w-[800px] mx-auto mb-4 flex items-center justify-between gap-3 px-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Rendición diaria</p>
          <p className="text-xs text-gray-500">{data.persona.nombre} · {fechaFmt}</p>
        </div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
          <Printer className="w-4 h-4" /> Imprimir / PDF
        </button>
      </div>

      <div className="hoja max-w-[800px] mx-auto bg-white shadow-lg p-8 print:p-0 text-[11px] text-black">
        {/* Encabezado */}
        <div className="flex items-start justify-between border-b-2 border-black pb-2">
          <div>
            <p className="font-bold text-sm">{EMPRESA.razon_social}</p>
            <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
            <p className="text-[10px] text-gray-600">RUC {EMPRESA.ruc} · Tel. {EMPRESA.telefono}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-sm">RENDICIÓN DIARIA</p>
            <p className="capitalize text-[11px]">{fechaFmt}</p>
          </div>
        </div>

        <div className="flex justify-between items-baseline mt-2 mb-3">
          <p className="font-bold uppercase text-[13px]">{data.persona.nombre}</p>
          <p className="text-[10px] font-semibold text-gray-600">
            {ROL_LABEL[data.persona.rol] ?? data.persona.rol.toUpperCase()}
          </p>
        </div>

        {sinMovimiento ? (
          <p className="text-center py-10 text-gray-500 italic">
            Sin ventas ni cobranzas registradas en esta fecha.
          </p>
        ) : (
          <>
            {/* RESUMEN DE LO QUE ENTREGA */}
            <div className="border-2 border-black mb-4">
              <p className="bg-black text-white font-bold text-center py-1 text-[12px]">
                RESUMEN DE COBRANZA — LO QUE ENTREGA
              </p>
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-gray-200">
                    <td className="p-2 font-bold w-[30%]">EFECTIVO COBRADO</td>
                    <td className="p-2 text-right font-mono font-bold">S/ {num(data.cobros.efectivo)}</td>
                    <td className="p-2 text-[10px] text-gray-600 w-[40%]">Total recibido en efectivo</td>
                  </tr>
                  {(data.depositos?.count ?? 0) > 0 && (
                    <tr className="border-b border-gray-200">
                      <td className="p-2">(−) Depositado al banco</td>
                      <td className="p-2 text-right font-mono">S/ {num(data.depositos.monto)}</td>
                      <td className="p-2 text-[10px] text-gray-500">
                        {data.depositos.count} depósito(s) — ver detalle abajo
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-300 bg-yellow-50">
                    <td className="p-2 font-bold">EFECTIVO A ENTREGAR</td>
                    <td className="p-2 text-right font-mono font-bold text-[15px]">
                      S/ {num(data.efectivo_a_entregar ?? data.cobros.efectivo)}
                    </td>
                    <td className="p-2 text-[10px] text-gray-600">Es lo único que entrega físicamente</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="p-2">Yape</td>
                    <td className="p-2 text-right font-mono">S/ {num(data.cobros.yape)}</td>
                    <td className="p-2 text-[10px] text-gray-500">Ya está en la cuenta</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="p-2">Plin</td>
                    <td className="p-2 text-right font-mono">S/ {num(data.cobros.plin)}</td>
                    <td className="p-2 text-[10px] text-gray-500">Ya está en la cuenta</td>
                  </tr>
                  <tr className="border-b border-gray-300">
                    <td className="p-2">Transferencia</td>
                    <td className="p-2 text-right font-mono">S/ {num(data.cobros.transferencia)}</td>
                    <td className="p-2 text-[10px] text-gray-500">Ya está en la cuenta</td>
                  </tr>
                  <tr className="bg-gray-100">
                    <td className="p-2 font-bold">TOTAL COBRADO</td>
                    <td className="p-2 text-right font-mono font-bold text-[15px]">S/ {num(data.cobros.total)}</td>
                    <td className="p-2 text-[10px] text-gray-600">{data.cobros.count} cobro(s)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* VENTAS DEL DÍA */}
            {data.ventas.count > 0 && (
              <div className="mb-4">
                <p className="font-bold border-b border-black pb-0.5 mb-1 text-[12px]">
                  VENTAS DEL DÍA ({data.ventas.count} documento{data.ventas.count === 1 ? '' : 's'})
                </p>
                <div className="flex gap-3 mb-2 text-[11px]">
                  <div className="flex-1 border border-gray-400 p-2">
                    <span className="font-semibold">AL CONTADO:</span>{' '}
                    <span className="font-mono">{data.ventas.contado_count} doc · S/ {num(data.ventas.contado_monto)}</span>
                  </div>
                  <div className="flex-1 border border-gray-400 p-2">
                    <span className="font-semibold">AL CRÉDITO:</span>{' '}
                    <span className="font-mono">{data.ventas.credito_count} doc · S/ {num(data.ventas.credito_monto)}</span>
                  </div>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-y border-black text-[10px]">
                      <th className="text-left px-1 py-0.5 w-[95px]">DOCUMENTO</th>
                      <th className="text-left px-1 py-0.5">CLIENTE</th>
                      <th className="text-center px-1 py-0.5 w-[60px]">PAGO</th>
                      <th className="text-right px-1 py-0.5 w-[80px]">IMPORTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ventas.documentos.map((d, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="px-1 py-0.5 font-mono text-[10px]">
                          {TIPO_CORTO[d.tipo] ?? d.tipo} {d.serie}-{d.numero}
                        </td>
                        <td className="px-1 py-0.5">{d.cliente}</td>
                        <td className="px-1 py-0.5 text-center text-[10px] font-semibold">
                          {d.tipo_pago === 'contado' ? 'CONTADO' : 'CRÉDITO'}
                        </td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(d.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-black font-bold">
                      <td colSpan={3} className="px-1 py-1 text-right">TOTAL VENDIDO</td>
                      <td className="px-1 py-1 text-right font-mono">S/ {num(data.ventas.monto)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* DEPÓSITOS AL BANCO */}
            {(data.depositos?.count ?? 0) > 0 && (
              <div className="mb-4">
                <p className="font-bold border-b border-black pb-0.5 mb-1 text-[12px]">
                  DEPÓSITOS AL BANCO ({data.depositos.count})
                </p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-y border-black text-[10px]">
                      <th className="text-left px-1 py-0.5 w-[38px]">HORA</th>
                      <th className="text-left px-1 py-0.5">BANCO</th>
                      <th className="text-left px-1 py-0.5 w-[100px]">N° OPERACIÓN</th>
                      <th className="text-left px-1 py-0.5 w-[80px]">ESTADO</th>
                      <th className="text-right px-1 py-0.5 w-[80px]">MONTO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.depositos.detalle.map((d, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="px-1 py-0.5 font-mono text-[10px]">{d.hora}</td>
                        <td className="px-1 py-0.5">{d.banco ?? '—'}</td>
                        <td className="px-1 py-0.5 font-mono text-[10px]">
                          {d.nro_operacion || '—'}{d.tiene_voucher ? ' 📎' : ''}
                        </td>
                        <td className="px-1 py-0.5 text-[10px] uppercase">{d.estado}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{num(d.monto)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-black font-bold">
                      <td colSpan={4} className="px-1 py-1 text-right">TOTAL DEPOSITADO</td>
                      <td className="px-1 py-1 text-right font-mono">S/ {num(data.depositos.monto)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* DETALLE DE COBRANZAS */}
            {data.cobros.count > 0 && (
              <div className="mb-4">
                <p className="font-bold border-b border-black pb-0.5 mb-1 text-[12px]">
                  DETALLE DE COBRANZAS
                </p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-y border-black text-[10px]">
                      <th className="text-left px-1 py-0.5 w-[38px]">HORA</th>
                      <th className="text-left px-1 py-0.5">CLIENTE</th>
                      <th className="text-left px-1 py-0.5 w-[90px]">N° OPERACIÓN</th>
                      <th className="text-right px-1 py-0.5 w-[62px]">EFECTIVO</th>
                      <th className="text-right px-1 py-0.5 w-[55px]">YAPE</th>
                      <th className="text-right px-1 py-0.5 w-[55px]">PLIN</th>
                      <th className="text-right px-1 py-0.5 w-[62px]">TRANSF.</th>
                      <th className="text-right px-1 py-0.5 w-[68px]">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cobros.detalle.map((c, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="px-1 py-0.5 font-mono text-[10px]">{c.hora}</td>
                        <td className="px-1 py-0.5">{c.cliente}</td>
                        <td className="px-1 py-0.5 font-mono text-[10px]">
                          {c.nro_operacion || '—'}{c.tiene_voucher ? ' 📎' : ''}
                        </td>
                        <td className="px-1 py-0.5 text-right font-mono">{c.efectivo ? num(c.efectivo) : '—'}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{c.yape ? num(c.yape) : '—'}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{c.plin ? num(c.plin) : '—'}</td>
                        <td className="px-1 py-0.5 text-right font-mono">{c.transferencia ? num(c.transferencia) : '—'}</td>
                        <td className="px-1 py-0.5 text-right font-mono font-semibold">{num(c.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-black font-bold">
                      <td colSpan={3} className="px-1 py-1 text-right">TOTALES</td>
                      <td className="px-1 py-1 text-right font-mono">{num(data.cobros.efectivo)}</td>
                      <td className="px-1 py-1 text-right font-mono">{num(data.cobros.yape)}</td>
                      <td className="px-1 py-1 text-right font-mono">{num(data.cobros.plin)}</td>
                      <td className="px-1 py-1 text-right font-mono">{num(data.cobros.transferencia)}</td>
                      <td className="px-1 py-1 text-right font-mono">{num(data.cobros.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Firmas */}
        <div className="flex justify-between mt-12 text-[10px]">
          <div className="border-t border-black pt-1 w-[45%] text-center">
            Entregado por: {data.persona.nombre}
          </div>
          <div className="border-t border-black pt-1 w-[45%] text-center">
            Recibido por (Caja)
          </div>
        </div>

        <p className="text-center text-[9px] text-gray-500 mt-6">
          Generado el {new Date(data.generado_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · AGROCAR ERP
        </p>
      </div>
    </div>
  )
}
