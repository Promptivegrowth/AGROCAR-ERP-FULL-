import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima, fechaLima, rangoDiaLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import EquipoReporteActions from './equipo-reporte-actions'

/**
 * El reporte de todos, en un solo documento.
 *
 * El reporte por persona ya existía, pero había que abrirlo uno por uno y no
 * había forma de compararlos ni de imprimir el mes completo del equipo de una
 * sola vez. Acá va primero el cuadro con todos —para ver de un vistazo quién
 * vendió y quién cobró— y después la hoja de cada uno, cada una en su página.
 *
 * Los datos se traen de una sola vez para todo el equipo y se agrupan acá.
 * Repetir las tres consultas por cada persona son treinta viajes a la base
 * para un documento que se pide entero.
 */

export const dynamic = 'force-dynamic'

/** Quiénes salen en el reporte: los que venden o cobran en la calle. */
const ROLES_CAMPO = ['vendedor', 'repartidor', 'chofer']

type Dia = {
  fecha: string
  pedidos_count: number
  pedidos_monto: number
  comprobantes_count: number
  comprobantes_monto: number
  cobros_count: number
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  cobros_total: number
}

type Persona = {
  id: string
  full_name: string
  role: string
  dias: Dia[]
  total: Omit<Dia, 'fecha'>
}

const diaVacio = (fecha: string): Dia => ({
  fecha,
  pedidos_count: 0, pedidos_monto: 0,
  comprobantes_count: 0, comprobantes_monto: 0,
  cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
})

function sumar(dias: Dia[]): Omit<Dia, 'fecha'> {
  return dias.reduce((a, d) => ({
    pedidos_count: a.pedidos_count + d.pedidos_count,
    pedidos_monto: a.pedidos_monto + d.pedidos_monto,
    comprobantes_count: a.comprobantes_count + d.comprobantes_count,
    comprobantes_monto: a.comprobantes_monto + d.comprobantes_monto,
    cobros_count: a.cobros_count + d.cobros_count,
    efectivo: a.efectivo + d.efectivo,
    yape: a.yape + d.yape,
    plin: a.plin + d.plin,
    transferencia: a.transferencia + d.transferencia,
    cobros_total: a.cobros_total + d.cobros_total,
  }), {
    pedidos_count: 0, pedidos_monto: 0, comprobantes_count: 0, comprobantes_monto: 0,
    cobros_count: 0, efectivo: 0, yape: 0, plin: 0, transferencia: 0, cobros_total: 0,
  })
}

async function getData(desde: string, hasta: string) {
  const supabase = await createClient()

  const { data: gente } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role, activo')
    .in('role', ROLES_CAMPO)
    .order('full_name')

  const personas = ((gente ?? []) as any[]).filter((p) => p.activo !== false)
  const ids = personas.map((p) => p.id)
  if (ids.length === 0) return { personas: [] as Persona[], desde, hasta }

  const [pedRes, compRes, cobRes] = await Promise.all([
    (supabase as any).from('pedidos')
      .select('vendedor_id, total, fecha_pedido')
      .gte('fecha_pedido', desde).lte('fecha_pedido', hasta)
      .in('vendedor_id', ids),
    // Por el momento de emisión y no por la fecha impresa, que es la del
    // despacho: se factura hoy lo que se reparte mañana.
    (supabase as any).from('comprobantes')
      .select('total, created_at, estado, pedidos(vendedor_id)')
      .gte('created_at', rangoDiaLima(desde).desde)
      .lt('created_at', rangoDiaLima(hasta).hasta)
      .neq('estado', 'anulado'),
    (supabase as any).from('cobros')
      .select('cobrador_id, efectivo, yape, plin, transferencia, total, fecha')
      .gte('fecha', desde).lte('fecha', hasta)
      .in('cobrador_id', ids),
  ])

  // Un mapa por persona y día, para no recorrer todo por cada uno
  const porPersona = new Map<string, Map<string, Dia>>()
  ids.forEach((id) => porPersona.set(id, new Map()))
  const dia = (personaId: string, fecha: string): Dia | null => {
    const m = porPersona.get(personaId)
    if (!m || !fecha) return null
    if (!m.has(fecha)) m.set(fecha, diaVacio(fecha))
    return m.get(fecha)!
  }

  ;((pedRes.data ?? []) as any[]).forEach((p) => {
    const d = dia(p.vendedor_id, p.fecha_pedido)
    if (!d) return
    d.pedidos_count++
    d.pedidos_monto += Number(p.total ?? 0)
  })
  ;((compRes.data ?? []) as any[]).forEach((c) => {
    const d = dia(c.pedidos?.vendedor_id, fechaLima(c.created_at))
    if (!d) return
    d.comprobantes_count++
    d.comprobantes_monto += Number(c.total ?? 0)
  })
  ;((cobRes.data ?? []) as any[]).forEach((c) => {
    const d = dia(c.cobrador_id, c.fecha)
    if (!d) return
    d.cobros_count++
    d.efectivo += Number(c.efectivo ?? 0)
    d.yape += Number(c.yape ?? 0)
    d.plin += Number(c.plin ?? 0)
    d.transferencia += Number(c.transferencia ?? 0)
    d.cobros_total += Number(c.total ?? 0)
  })

  const armadas: Persona[] = personas.map((p) => {
    const dias = Array.from(porPersona.get(p.id)?.values() ?? [])
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
    return { id: p.id, full_name: p.full_name, role: p.role, dias, total: sumar(dias) }
  })

  // Primero quien más cobró: es el orden en que Daniel lee el reporte
  armadas.sort((a, b) => b.total.cobros_total - a.total.cobros_total)
  return { personas: armadas, desde, hasta }
}

const rolLabel = (r: string) =>
  r === 'vendedor' ? 'Vendedor' : r === 'repartidor' ? 'Repartidor' : r === 'chofer' ? 'Chofer' : r

export default async function ReporteEquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const sp = await searchParams
  const hoy = hoyLima()
  const hasta = sp.hasta ?? hoy
  const desdeDefault = new Date(hoy + 'T00:00:00-05:00')
  desdeDefault.setDate(desdeDefault.getDate() - 13)
  const desde = sp.desde ?? desdeDefault.toISOString().slice(0, 10)

  const { personas } = await getData(desde, hasta)
  const totalEquipo = sumar(personas.flatMap((p) => p.dias))
  const conMovimiento = personas.filter((p) => p.dias.length > 0)
  const sinMovimiento = personas.filter((p) => p.dias.length === 0)

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .reporte-equipo { font-size: 10.5pt !important; line-height: 1.35 !important; color: #111 !important; }
          .reporte-equipo table { font-size: 9.5pt !important; page-break-inside: auto; }
          .reporte-equipo th, .reporte-equipo td { padding: 3px 6px !important; }
          .reporte-equipo tr { page-break-inside: avoid; }
          .reporte-equipo thead { display: table-header-group; }
          /* Cada persona arranca en su propia hoja: así se puede repartir el
             documento y darle a cada uno la suya. */
          .hoja-persona { page-break-before: always; }
        }
      `}</style>

      <div className="reporte-equipo max-w-6xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP</p>
            <h1 className="text-xl font-bold">Reporte consolidado del equipo</h1>
            <p className="text-sm text-gray-300">
              {personas.length} persona{personas.length === 1 ? '' : 's'} · del {formatDate(desde)} al {formatDate(hasta)}
            </p>
          </div>
          <EquipoReporteActions desde={desde} hasta={hasta} />
        </div>

        {/* Encabezado para impresión */}
        <div className="hidden print:block mb-4">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div>
              <p className="font-bold text-lg">{EMPRESA.razon_social}</p>
              <p style={{ fontFamily: SLOGAN_FONT_STACK }} className="text-base">{EMPRESA.slogan}</p>
              <p className="text-[10px] text-gray-600">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">Reporte consolidado del equipo</p>
              <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)}</p>
              <p className="text-[10px] text-gray-600">{personas.length} personas</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-5">
          {/* ── Cuadro comparativo: todos juntos */}
          <div>
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Resumen del equipo</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="border border-gray-300 px-2 py-1">Persona</th>
                    <th className="border border-gray-300 px-2 py-1">Rol</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Pedidos</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Monto pedidos</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Comprob.</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Facturado</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Cobros</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Cobrado</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Efectivo</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.id} className={p.dias.length === 0 ? 'text-gray-400' : ''}>
                      <td className="border border-gray-300 px-2 py-1 font-semibold">{p.full_name}</td>
                      <td className="border border-gray-300 px-2 py-1 text-xs">{rolLabel(p.role)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{p.total.pedidos_count}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.pedidos_monto)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{p.total.comprobantes_count}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.comprobantes_monto)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{p.total.cobros_count}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-semibold">{formatCurrency(p.total.cobros_total)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.efectivo)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#FBE600] font-bold">
                    <td className="border border-gray-400 px-2 py-1" colSpan={2}>TOTAL DEL EQUIPO</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{totalEquipo.pedidos_count}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalEquipo.pedidos_monto)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{totalEquipo.comprobantes_count}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalEquipo.comprobantes_monto)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{totalEquipo.cobros_count}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalEquipo.cobros_total)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">{formatCurrency(totalEquipo.efectivo)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {sinMovimiento.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                Sin movimiento en el período: {sinMovimiento.map((p) => p.full_name).join(' · ')}
              </p>
            )}
          </div>

          {/* ── La hoja de cada uno */}
          {conMovimiento.map((p) => (
            <div key={p.id} className="hoja-persona">
              <div className="flex items-baseline justify-between border-b-2 border-black pb-1 mb-2">
                <h2 className="text-base font-bold">{p.full_name}</h2>
                <span className="text-xs text-gray-600">
                  {rolLabel(p.role)} · del {formatDate(desde)} al {formatDate(hasta)}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-[11px] text-gray-500">Pedidos creados</p>
                  <p className="text-base font-bold">{p.total.pedidos_count}</p>
                  <p className="text-[11px] text-gray-600">{formatCurrency(p.total.pedidos_monto)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-[11px] text-gray-500">Facturas/Boletas</p>
                  <p className="text-base font-bold">{p.total.comprobantes_count}</p>
                  <p className="text-[11px] text-gray-600">{formatCurrency(p.total.comprobantes_monto)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <p className="text-[11px] text-gray-500">Cobros</p>
                  <p className="text-base font-bold">{p.total.cobros_count}</p>
                  <p className="text-[11px] text-gray-600">{formatCurrency(p.total.cobros_total)}</p>
                </div>
                <div className="bg-[#FBE600] border border-yellow-400 rounded-lg p-2">
                  <p className="text-[11px] text-black/70">Cómo cobró</p>
                  <p className="text-[11px] text-black font-semibold leading-tight">
                    Efectivo {formatCurrency(p.total.efectivo)}<br />
                    Yape {formatCurrency(p.total.yape)} · Plin {formatCurrency(p.total.plin)}<br />
                    Transfer. {formatCurrency(p.total.transferencia)}
                  </p>
                </div>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="border border-gray-300 px-2 py-1">Día</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Pedidos</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Monto</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Comprob.</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Facturado</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Efectivo</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Yape</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Plin</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Transfer.</th>
                    <th className="border border-gray-300 px-2 py-1 text-right">Cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {p.dias.map((d) => (
                    <tr key={d.fecha}>
                      <td className="border border-gray-300 px-2 py-1">{formatDate(d.fecha)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.pedidos_count || '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.pedidos_monto ? formatCurrency(d.pedidos_monto) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.comprobantes_count || '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.comprobantes_monto ? formatCurrency(d.comprobantes_monto) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.efectivo ? formatCurrency(d.efectivo) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.yape ? formatCurrency(d.yape) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.plin ? formatCurrency(d.plin) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{d.transferencia ? formatCurrency(d.transferencia) : '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right font-semibold">{d.cobros_total ? formatCurrency(d.cobros_total) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold">
                    <td className="border border-gray-300 px-2 py-1">TOTAL</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{p.total.pedidos_count}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.pedidos_monto)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{p.total.comprobantes_count}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.comprobantes_monto)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.efectivo)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.yape)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.plin)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.transferencia)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{formatCurrency(p.total.cobros_total)}</td>
                  </tr>
                </tbody>
              </table>

              <p className="text-[10px] text-gray-500 mt-1 no-print">
                Para ver operación por operación de {p.full_name},{' '}
                <a href={`/reportes/persona/${p.id}?desde=${desde}&hasta=${hasta}`}
                   target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 underline">abrir su reporte individual</a>.
              </p>
            </div>
          ))}

          {conMovimiento.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-10">
              Nadie registró movimiento entre el {formatDate(desde)} y el {formatDate(hasta)}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
