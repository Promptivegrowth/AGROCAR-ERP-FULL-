'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Printer, Landmark, Droplets, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

type Vista = 'balance' | 'flujo' | 'patrimonio'

const ORIGEN_LABELS: Record<string, string> = {
  venta: 'Cobranzas de ventas',
  cobro: 'Cobranzas de clientes',
  compra: 'Pagos por compras',
  manual: 'Operaciones manuales',
  caja_chica: 'Caja Chica',
  declaracion_jurada: 'Declaraciones juradas',
  nota_credito: 'Notas de crédito',
  diferencia_cambio: 'Diferencia de cambio',
}

export default function EstadosFinancierosPage() {
  const router = useRouter()
  const supabase = createClient()
  const hoy = hoyLima()
  const inicioMes = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })()

  const [vista, setVista] = useState<Vista>('balance')
  const [al, setAl] = useState(hoy)             // para balance
  const [desde, setDesde] = useState(inicioMes) // para flujo/patrimonio
  const [hasta, setHasta] = useState(hoy)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    let res
    if (vista === 'balance') {
      res = await (supabase.rpc as any)('balance_general', { p_al: al })
    } else if (vista === 'flujo') {
      res = await (supabase.rpc as any)('flujo_efectivo', { p_desde: desde, p_hasta: hasta })
    } else {
      res = await (supabase.rpc as any)('cambios_patrimonio', { p_desde: desde, p_hasta: hasta })
    }
    setData(res.data)
    setLoading(false)
  }, [supabase, vista, al, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const totalActivo = Number(data?.total_activo_corriente ?? 0) + Number(data?.total_activo_no_corriente ?? 0)
  const totalPasivoPat = Number(data?.total_pasivo ?? 0) + Number(data?.total_patrimonio_cuentas ?? 0) + Number(data?.resultado_ejercicio ?? 0)

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 14mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-blue-700" />
            Estados Financieros
          </h1>
          <p className="text-sm text-gray-500">
            Situación Financiera · Flujo de Efectivo · Cambios en el Patrimonio ·{' '}
            <Link href="/contabilidad/estado-resultados" className="underline text-blue-700">Estado de Resultados →</Link>
          </p>
        </div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 no-print">
        {([
          { key: 'balance', label: 'Situación Financiera (EF1)', icon: Landmark },
          { key: 'flujo', label: 'Flujo de Efectivo (EF4)', icon: Droplets },
          { key: 'patrimonio', label: 'Cambios en Patrimonio (EF5)', icon: Layers },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setVista(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-1.5 ${
              vista === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        {vista === 'balance' ? (
          <div>
            <Label className="text-xs">Al (fecha de corte)</Label>
            <Input type="date" value={al} max={hoy} onChange={(e) => setAl(e.target.value)} className="w-36 h-9 text-sm" />
          </div>
        ) : (
          <>
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="w-36 h-9 text-sm" />
            </div>
          </>
        )}
        <p className="text-[10px] text-gray-400 ml-auto">Solo asientos ASENTADOS entran en los estados.</p>
      </div>

      {/* Header impresión */}
      <div className="hidden print:block pb-3 border-b-2 border-black">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-base">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
            <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold">
              {vista === 'balance' ? 'ESTADO DE SITUACIÓN FINANCIERA' :
               vista === 'flujo' ? 'ESTADO DE FLUJO DE EFECTIVO' : 'ESTADO DE CAMBIOS EN EL PATRIMONIO NETO'}
            </p>
            <p>{vista === 'balance' ? `Al ${formatDate(al)}` : `Del ${formatDate(desde)} al ${formatDate(hasta)}`}</p>
            <p className="text-gray-500">(Expresado en Soles)</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !data ? (
        <p className="text-center py-12 text-gray-400 text-sm">Sin datos</p>
      ) : vista === 'balance' ? (
        /* ══════ BALANCE GENERAL ══════ */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:grid-cols-2">
          {/* ACTIVO */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-gray-400">
            <div className="bg-blue-700 text-white px-3 py-2 font-bold text-sm">ACTIVO</div>
            <SeccionBalance titulo="Activo Corriente" items={data.activo_corriente} total={data.total_activo_corriente} />
            <SeccionBalance titulo="Activo No Corriente" items={data.activo_no_corriente} total={data.total_activo_no_corriente} />
            <div className="bg-blue-50 border-t-2 border-blue-700 px-3 py-2 flex justify-between font-bold">
              <span>TOTAL ACTIVO</span>
              <span className="font-mono">{formatCurrency(totalActivo)}</span>
            </div>
          </div>
          {/* PASIVO + PATRIMONIO */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-gray-400">
            <div className="bg-red-700 text-white px-3 py-2 font-bold text-sm">PASIVO Y PATRIMONIO</div>
            <SeccionBalance titulo="Pasivo" items={data.pasivo} total={data.total_pasivo} />
            <SeccionBalance titulo="Patrimonio" items={data.patrimonio} total={data.total_patrimonio_cuentas} />
            <div className="px-3 py-1.5 flex justify-between text-sm border-t border-gray-100">
              <span className="text-gray-700">Resultado del ejercicio</span>
              <span className={`font-mono font-semibold ${Number(data.resultado_ejercicio) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatCurrency(data.resultado_ejercicio)}
              </span>
            </div>
            <div className="bg-red-50 border-t-2 border-red-700 px-3 py-2 flex justify-between font-bold">
              <span>TOTAL PASIVO + PATRIMONIO</span>
              <span className="font-mono">{formatCurrency(totalPasivoPat)}</span>
            </div>
          </div>
          {/* Validación de ecuación contable */}
          <div className={`lg:col-span-2 print:col-span-2 rounded-lg p-3 border-2 text-sm font-semibold flex justify-between ${
            Math.abs(totalActivo - totalPasivoPat) < 0.01
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}>
            <span>{Math.abs(totalActivo - totalPasivoPat) < 0.01 ? '✓ ACTIVO = PASIVO + PATRIMONIO (ecuación cuadra)' : '⚠ Ecuación contable descuadrada'}</span>
            <span className="font-mono">Diferencia: {formatCurrency(totalActivo - totalPasivoPat)}</span>
          </div>
        </div>
      ) : vista === 'flujo' ? (
        /* ══════ FLUJO DE EFECTIVO ══════ */
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600">Concepto (por origen)</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Entradas</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Salidas</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Neto</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-300 font-semibold">
                <td colSpan={3} className="p-2 text-right">SALDO INICIAL DE EFECTIVO</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.saldo_inicial)}</td>
              </tr>
              {(data.detalle ?? []).map((d: any) => (
                <tr key={d.origen} className="border-b border-gray-100">
                  <td className="p-2">{ORIGEN_LABELS[d.origen] ?? d.origen}</td>
                  <td className="p-2 text-right font-mono text-emerald-700">{Number(d.entradas) > 0 ? formatCurrency(d.entradas) : ''}</td>
                  <td className="p-2 text-right font-mono text-red-700">{Number(d.salidas) > 0 ? formatCurrency(d.salidas) : ''}</td>
                  <td className={`p-2 text-right font-mono font-semibold ${Number(d.neto) >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                    {formatCurrency(d.neto)}
                  </td>
                </tr>
              ))}
              {(data.detalle ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-gray-400">Sin movimientos de efectivo asentados en el período</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td className="p-2 text-right">TOTALES PERÍODO</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.total_entradas)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.total_salidas)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.flujo_neto)}</td>
              </tr>
              <tr className="bg-[#FBE600]">
                <td colSpan={3} className="p-2 text-right">SALDO FINAL DE EFECTIVO</td>
                <td className="p-2 text-right font-mono text-base">{formatCurrency(data.saldo_final)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        /* ══════ CAMBIOS EN PATRIMONIO ══════ */
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                <th className="text-left p-2 font-semibold text-gray-600">Cuenta patrimonial</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Saldo inicial</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Aumentos</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Disminuciones</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {(data.cuentas ?? []).map((c: any) => (
                <tr key={c.codigo} className="border-b border-gray-100">
                  <td className="p-2 font-mono text-xs">{c.codigo}</td>
                  <td className="p-2">{c.nombre}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(c.saldo_inicial)}</td>
                  <td className="p-2 text-right font-mono text-emerald-700">{Number(c.aumentos) > 0 ? formatCurrency(c.aumentos) : ''}</td>
                  <td className="p-2 text-right font-mono text-red-700">{Number(c.disminuciones) > 0 ? formatCurrency(c.disminuciones) : ''}</td>
                  <td className="p-2 text-right font-mono font-semibold">{formatCurrency(c.saldo_final)}</td>
                </tr>
              ))}
              <tr className="border-b border-gray-200 bg-blue-50/40">
                <td className="p-2 font-mono text-xs">—</td>
                <td className="p-2 font-semibold">Resultado del período (utilidad/pérdida)</td>
                <td className="p-2"></td>
                <td className="p-2 text-right font-mono text-emerald-700">
                  {Number(data.resultado_periodo) > 0 ? formatCurrency(data.resultado_periodo) : ''}
                </td>
                <td className="p-2 text-right font-mono text-red-700">
                  {Number(data.resultado_periodo) < 0 ? formatCurrency(Math.abs(Number(data.resultado_periodo))) : ''}
                </td>
                <td className="p-2 text-right font-mono font-semibold">{formatCurrency(data.resultado_periodo)}</td>
              </tr>
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td colSpan={2} className="p-2 text-right">TOTAL PATRIMONIO</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.total_inicial)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.total_aumentos)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(data.total_disminuciones)}</td>
                <td className="p-2 text-right font-mono bg-[#FBE600]">{formatCurrency(data.total_final)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function SeccionBalance({ titulo, items, total }: { titulo: string; items: any[]; total: number }) {
  return (
    <div>
      <div className="px-3 py-1.5 bg-gray-50 border-y border-gray-100 text-xs font-bold text-gray-600 uppercase">{titulo}</div>
      {(items ?? []).length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-400 italic">Sin saldos</p>
      ) : (
        (items ?? []).map((i: any) => (
          <div key={i.codigo} className="px-3 py-1 flex justify-between text-sm border-b border-gray-50">
            <span className="text-gray-700"><span className="font-mono text-xs text-gray-400 mr-1">{i.codigo}</span>{i.nombre}</span>
            <span className="font-mono">{formatCurrency(i.saldo)}</span>
          </div>
        ))
      )}
      <div className="px-3 py-1.5 flex justify-between text-sm font-semibold border-t border-gray-200">
        <span>Total {titulo}</span>
        <span className="font-mono">{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
