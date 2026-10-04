import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import { calcularUtilidad, type FilaUtilidad } from '@/lib/reporte-utilidad'
import AccionesUtilidad from './acciones'

/**
 * Reporte gerencial de utilidad: ventas entre dos fechas por familia y
 * producto, con costo de compra, precio promedio de venta, utilidad neta y
 * margen. Pedido de Daniel (04/10/2026), solo para gerencia: la ruta /gerencia
 * la abren únicamente gerente y administrador (lib/access-control).
 *
 * El cálculo vive en lib/reporte-utilidad, compartido con el Excel.
 */

export const dynamic = 'force-dynamic'

const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)
const num = (n: number) => n.toLocaleString('es-PE', { maximumFractionDigits: 2 })
const color = (n: number | null) => (n === null ? 'text-gray-400' : n < 0 ? 'text-red-600' : 'text-emerald-700')

function CeldasMonto({ f }: { f: Pick<FilaUtilidad, 'venta' | 'costo_total' | 'utilidad' | 'margen_venta' | 'margen_costo'> }) {
  return (
    <>
      <td className="p-1.5 text-right font-mono">{formatCurrency(f.venta)}</td>
      <td className="p-1.5 text-right font-mono">{f.costo_total === null ? <span className="text-amber-600">sin costo</span> : formatCurrency(f.costo_total)}</td>
      <td className={`p-1.5 text-right font-mono font-semibold ${color(f.utilidad)}`}>{f.utilidad === null ? '—' : formatCurrency(f.utilidad)}</td>
      <td className={`p-1.5 text-right font-semibold ${color(f.margen_venta)}`}>{pct(f.margen_venta)}</td>
      <td className={`p-1.5 text-right ${color(f.margen_costo)}`}>{pct(f.margen_costo)}</td>
    </>
  )
}

export default async function UtilidadPage({ searchParams }: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const sp = await searchParams
  const hasta = sp.hasta ?? hoyLima()
  const desde = sp.desde ?? `${hasta.slice(0, 8)}01`
  const supabase = await createClient()
  const { familias, total } = await calcularUtilidad(supabase, desde, hasta)

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .ut-doc table { font-size: 8.5pt !important; }
          .ut-doc th, .ut-doc td { padding: 2px 4px !important; }
          .ut-doc tr { page-break-inside: avoid; }
          .ut-doc thead { display: table-header-group; }
        }
        .print-only { display: none; }
      ` }} />

      <div className="max-w-7xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between gap-3 flex-wrap no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP · Gerencia</p>
            <h1 className="text-xl font-bold">Utilidad por producto y familia</h1>
            <p className="text-sm text-gray-300">Del {formatDate(desde)} al {formatDate(hasta)} · montos sin IGV</p>
          </div>
          <AccionesUtilidad desde={desde} hasta={hasta} />
        </div>

        <div className="print-only mb-3">
          <div className="flex items-center justify-between border-b-2 border-black pb-2">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 45 }} />
              <div>
                <p className="font-bold text-sm">{EMPRESA.razon_social}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 13, lineHeight: 1 }}>{EMPRESA.slogan}</p>
                <p className="text-[9px] text-gray-700">RUC {EMPRESA.ruc}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">Utilidad por producto y familia</p>
              <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)} · montos sin IGV · reservado a gerencia</p>
            </div>
          </div>
        </div>

        <div className="ut-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-5">
          {/* Totales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700 font-semibold">VENTA NETA</p>
              <p className="text-lg font-bold text-blue-900">{formatCurrency(total.venta)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600 font-semibold">COSTO DE COMPRA</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(total.costo_total)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs text-emerald-700 font-semibold">UTILIDAD NETA</p>
              <p className={`text-lg font-bold ${color(total.utilidad)}`}>{formatCurrency(total.utilidad)}</p>
            </div>
            <div className="bg-[#FBE600] border border-yellow-400 rounded-lg p-3">
              <p className="text-xs text-black font-semibold">MARGEN PROMEDIO</p>
              <p className="text-lg font-bold">{pct(total.margen_venta)} <span className="text-xs font-normal">s/ venta</span></p>
              <p className="text-[11px]">{pct(total.margen_costo)} sobre el costo</p>
            </div>
          </div>
          {total.sin_costo > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              {total.sin_costo} producto(s) vendidos no tienen costo de compra registrado: su venta se muestra, pero no entra en la utilidad ni en el margen.
            </p>
          )}

          {familias.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No hay ventas en este rango.</p>
          ) : (
            <>
              {/* Resumen por familia */}
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Resumen por familia ({familias.length})</h2>
                <table className="w-full text-xs border border-gray-200">
                  <thead className="bg-gray-100 border-b border-gray-300">
                    <tr>
                      <th className="text-left p-1.5">Familia</th>
                      <th className="text-right p-1.5">Productos</th>
                      <th className="text-right p-1.5">Cantidad</th>
                      <th className="text-right p-1.5">Venta</th>
                      <th className="text-right p-1.5">Costo</th>
                      <th className="text-right p-1.5">Utilidad</th>
                      <th className="text-right p-1.5">% s/venta</th>
                      <th className="text-right p-1.5">% s/costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {familias.map((g) => (
                      <tr key={g.familia} className="border-b border-gray-100">
                        <td className="p-1.5 font-semibold">{g.familia}</td>
                        <td className="p-1.5 text-right">{g.productos.length}</td>
                        <td className="p-1.5 text-right font-mono">{num(g.cantidad)}</td>
                        <CeldasMonto f={g} />
                      </tr>
                    ))}
                    <tr className="bg-gray-900 text-white font-bold">
                      <td className="p-1.5">TOTAL</td>
                      <td className="p-1.5 text-right">{familias.reduce((a, g) => a + g.productos.length, 0)}</td>
                      <td className="p-1.5 text-right font-mono">{num(total.cantidad)}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(total.venta)}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(total.costo_total)}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(total.utilidad)}</td>
                      <td className="p-1.5 text-right">{pct(total.margen_venta)}</td>
                      <td className="p-1.5 text-right">{pct(total.margen_costo)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Detalle por producto, agrupado por familia */}
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Detalle por producto</h2>
                <table className="w-full text-xs border border-gray-200">
                  <thead className="bg-gray-100 border-b border-gray-300">
                    <tr>
                      <th className="text-left p-1.5">Código</th>
                      <th className="text-left p-1.5">Producto</th>
                      <th className="text-right p-1.5">Cantidad</th>
                      <th className="text-right p-1.5">Costo unit.</th>
                      <th className="text-right p-1.5">P. prom. venta</th>
                      <th className="text-right p-1.5">Venta</th>
                      <th className="text-right p-1.5">Costo</th>
                      <th className="text-right p-1.5">Utilidad</th>
                      <th className="text-right p-1.5">% s/venta</th>
                      <th className="text-right p-1.5">% s/costo</th>
                    </tr>
                  </thead>
                  {familias.map((g) => (
                    <tbody key={g.familia}>
                      <tr className="bg-[#FFF9C4] border-y border-yellow-300 font-bold">
                        <td className="p-1.5" colSpan={2}>{g.familia} · {g.productos.length} producto(s)</td>
                        <td className="p-1.5 text-right font-mono">{num(g.cantidad)}</td>
                        <td className="p-1.5" colSpan={2}></td>
                        <CeldasMonto f={g} />
                      </tr>
                      {g.productos.map((p) => (
                        <tr key={p.producto_id ?? p.producto} className="border-b border-gray-100">
                          <td className="p-1.5 font-mono text-[10px]">{p.codigo}</td>
                          <td className="p-1.5">{p.producto}</td>
                          <td className="p-1.5 text-right font-mono">{num(p.cantidad)}</td>
                          <td className="p-1.5 text-right font-mono">{p.costo_unitario === null ? '—' : p.costo_unitario.toFixed(2)}</td>
                          <td className="p-1.5 text-right font-mono">{p.precio_promedio.toFixed(2)}</td>
                          <CeldasMonto f={p} />
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            </>
          )}

          <p className="text-[10px] text-gray-500 leading-snug">
            Montos sin IGV. Venta: boletas, facturas y notas internas no anuladas del rango; las notas de crédito restan.
            Costo unitario: promedio ponderado de las compras aplicadas hasta el {formatDate(hasta)}.
            % s/venta = utilidad ÷ venta. % s/costo = utilidad ÷ costo. Los porcentajes de familia y total son ponderados por monto.
          </p>
        </div>
      </div>
    </div>
  )
}
