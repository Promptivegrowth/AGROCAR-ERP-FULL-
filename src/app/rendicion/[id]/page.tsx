'use client'

import { useEffect, useState, useCallback } from 'react'
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

// En Next.js 14 los params llegan como objeto plano, no como promesa
export default function RendicionPage({ params }: { params: { id: string } }) {
  const { id } = params
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
        /* Daniel pidió que entren unos 40 ítems: se aprieta el margen y la
           altura de fila, que es lo que come la hoja. El cuerpo baja a 9pt,
           que sigue leyéndose en papel. */
        @page { size: A4 portrait; margin: 8mm; }
        body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        .hoja { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; font-size: 9pt !important; }
        .hoja table td, .hoja table th { padding-top: 0 !important; padding-bottom: 0 !important; line-height: 1.2 !important; font-size: 8.5pt !important; }
        .hoja p { margin-bottom: 1px !important; }
        .hoja .mb-4 { margin-bottom: 6px !important; }
        .hoja .mb-3 { margin-bottom: 5px !important; }
        tr { break-inside: avoid; }
        thead { display: table-header-group; }
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
        <div className="flex items-start justify-between border-b-2 border-black pb-1">
          <div>
            <p className="font-bold text-[12px] leading-tight">{EMPRESA.razon_social}</p>
            <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 11 }} className="leading-tight">{EMPRESA.slogan}</p>
            <p className="text-[9px] text-gray-600 leading-tight">RUC {EMPRESA.ruc} · Tel. {EMPRESA.telefono}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-sm">RENDICIÓN DIARIA</p>
            <p className="capitalize text-[11px]">{fechaFmt}</p>
          </div>
        </div>

        <div className="flex justify-between items-baseline mt-1 mb-2">
          <p className="font-bold uppercase text-[12px]">{data.persona.nombre}</p>
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
            {/* RESUMEN DE LO QUE ENTREGA
                Compactado a dos columnas: lo que entrega físicamente a la
                izquierda y lo que ya está en la cuenta a la derecha. Antes eran
                seis filas altas con una explicación al costado de cada una, y
                se comían un tercio de la hoja que hace falta para la cobranza. */}
            <div className="border-2 border-black mb-3">
              <p className="bg-black text-white font-bold text-center py-0.5 text-[11px]">
                RESUMEN DE COBRANZA — LO QUE ENTREGA
              </p>
              <div className="flex">
                <table className="w-1/2 border-r border-gray-400">
                  <tbody>
                    <tr className="border-b border-gray-200">
                      <td className="px-2 py-0.5 font-bold">EFECTIVO COBRADO</td>
                      <td className="px-2 py-0.5 text-right font-mono font-bold">S/ {num(data.cobros.efectivo)}</td>
                    </tr>
                    {(data.depositos?.count ?? 0) > 0 && (
                      <tr className="border-b border-gray-200">
                        <td className="px-2 py-0.5">(−) Depositado al banco</td>
                        <td className="px-2 py-0.5 text-right font-mono">S/ {num(data.depositos.monto)}</td>
                      </tr>
                    )}
                    <tr className="bg-yellow-50">
                      <td className="px-2 py-1 font-bold">EFECTIVO A ENTREGAR</td>
                      <td className="px-2 py-1 text-right font-mono font-bold text-[13px]">
                        S/ {num(data.efectivo_a_entregar ?? data.cobros.efectivo)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table className="w-1/2">
                  <tbody>
                    <tr className="border-b border-gray-200">
                      <td className="px-2 py-0.5 text-gray-600">Yape</td>
                      <td className="px-2 py-0.5 text-right font-mono">S/ {num(data.cobros.yape)}</td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="px-2 py-0.5 text-gray-600">Plin</td>
                      <td className="px-2 py-0.5 text-right font-mono">S/ {num(data.cobros.plin)}</td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="px-2 py-0.5 text-gray-600">Transferencia</td>
                      <td className="px-2 py-0.5 text-right font-mono">S/ {num(data.cobros.transferencia)}</td>
                    </tr>
                    <tr className="bg-gray-100">
                      <td className="px-2 py-1 font-bold">TOTAL COBRADO</td>
                      <td className="px-2 py-1 text-right font-mono font-bold text-[13px]">S/ {num(data.cobros.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-gray-600 px-2 py-0.5 border-t border-gray-300">
                Yape, Plin y transferencia ya están en la cuenta: lo único que entrega en mano es el efectivo.
                · {data.cobros.count} cobro(s)
              </p>
            </div>

            {/* VENTAS DEL DÍA — solo montos.
                Daniel: "no es necesario que se imprima las ventas por detalle,
                solo el monto, tanto en el contado y crédito". El detalle de los
                documentos ocupaba una línea por venta y desplazaba la cobranza,
                que es lo que se revisa al recibir el dinero. */}
            {data.ventas.count > 0 && (
              <div className="mb-3">
                <p className="font-bold border-b border-black pb-0.5 mb-1 text-[12px]">
                  VENTAS DEL DÍA ({data.ventas.count} documento{data.ventas.count === 1 ? '' : 's'})
                </p>
                <table className="w-full border-collapse text-[11px]">
                  <tbody>
                    <tr className="border-b border-gray-300">
                      <td className="px-1 py-0.5 font-semibold">AL CONTADO</td>
                      <td className="px-1 py-0.5 text-right w-[60px]">{data.ventas.contado_count} doc</td>
                      <td className="px-1 py-0.5 text-right font-mono w-[90px]">S/ {num(data.ventas.contado_monto)}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="px-1 py-0.5 font-semibold">AL CRÉDITO</td>
                      <td className="px-1 py-0.5 text-right">{data.ventas.credito_count} doc</td>
                      <td className="px-1 py-0.5 text-right font-mono">S/ {num(data.ventas.credito_monto)}</td>
                    </tr>
                    <tr className="border-t border-black font-bold">
                      <td className="px-1 py-1">TOTAL VENDIDO</td>
                      <td className="px-1 py-1 text-right">{data.ventas.count} doc</td>
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
