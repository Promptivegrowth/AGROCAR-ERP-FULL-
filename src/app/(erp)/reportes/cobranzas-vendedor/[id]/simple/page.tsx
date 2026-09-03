import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { diasVencidos, fechaVencimientoTexto } from '@/lib/cliente-saldo'
import { EMPRESA } from '@/lib/empresa'
import CobranzasVendedorSimpleActions from './cobranzas-vendedor-simple-actions'

export const dynamic = 'force-dynamic'

/**
 * Cobranzas a cargo — versión simple, para imprimir.
 *
 * La vista premium arma una tarjeta por cliente: se ve bien en pantalla pero
 * gasta media hoja por cada uno. Daniel pidió lo mismo que hicimos con el
 * reparto: una sola tabla corrida, la mayor cantidad de líneas por A4, y sin
 * las firmas al pie —esto no se entrega ni se recibe conforme, es la lista
 * con la que el cobrador sale a la calle.
 *
 * Una línea por comprobante impago. El nombre del cliente aparece solo cuando
 * cambia, así que las boletas de un mismo cliente se leen juntas sin repetir
 * el nombre tres veces. La columna Observación queda en blanco a propósito,
 * para anotar a mano lo que se cobró.
 */

interface Fila {
  cliente: string
  doc: string
  telefono: string | null
  primera: boolean
  /** Ultima linea de ese cliente: debajo va lo que debe en total. */
  ultima: boolean
  /** Lo que debe el cliente sumando todas sus lineas. */
  totalCliente: number
  comprobante: string
  emision: string
  vence: string | null
  dias: number
  total: number
  abonado: number
  saldo: number
}

async function getData(vendedorId: string) {
  const supabase = await createClient()

  const { data: vendedor } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', vendedorId)
    .maybeSingle()
  if (!vendedor) return null

  const { data: clientes } = await (supabase as any)
    .from('clientes')
    .select('id, razon_social, ruc, dni, telefono, credito_dias')
    .eq('vendedor_id', vendedorId)
    .eq('estado', 'activo')

  const clienteIds = ((clientes ?? []) as any[]).map((c) => c.id)
  if (clienteIds.length === 0) {
    return { vendedor, filas: [] as Fila[], totales: { clientes: 0, total: 0, abonado: 0, saldo: 0, vencido: 0 } }
  }

  const [compRes, aplRes] = await Promise.all([
    (supabase as any).from('comprobantes')
      .select('id, serie, numero, tipo, fecha_emision, total, cliente_id')
      .in('cliente_id', clienteIds)
      .neq('estado', 'anulado'),
    (supabase as any).from('cobros_aplicaciones')
      .select('comprobante_id, monto_aplicado, cobros!inner(cliente_id)')
      .in('cobros.cliente_id', clienteIds),
  ])

  // Solo cuentan las aplicaciones a un comprobante concreto. Las que no lo
  // tienen son saldo a favor del cliente y desde la migración 101 se aplican
  // solas al emitirse la boleta siguiente, así que lo que quede acá no
  // corresponde a ninguna deuda.
  const aplicado = new Map<string, number>()
  ;((aplRes.data ?? []) as any[]).forEach((a) => {
    if (!a.comprobante_id) return
    aplicado.set(a.comprobante_id, (aplicado.get(a.comprobante_id) ?? 0) + Number(a.monto_aplicado ?? 0))
  })

  const porCliente = new Map<string, any[]>()
  ;((compRes.data ?? []) as any[]).forEach((c) => {
    const arr = porCliente.get(c.cliente_id) ?? []
    arr.push(c)
    porCliente.set(c.cliente_id, arr)
  })

  const grupos = ((clientes ?? []) as any[])
    .map((cl) => {
      const docs = (porCliente.get(cl.id) ?? [])
        .map((c: any) => {
          const abonado = aplicado.get(c.id) ?? 0
          const total = Number(c.total ?? 0)
          return {
            comprobante: `${c.serie} ${c.numero}`,
            emision: c.fecha_emision,
            vence: fechaVencimientoTexto(c.fecha_emision, cl.credito_dias),
            dias: diasVencidos(c.fecha_emision, cl.credito_dias),
            total,
            abonado,
            saldo: Math.max(0, total - abonado),
          }
        })
        .filter((d: any) => d.saldo > 0.01)
        .sort((a: any, b: any) => a.emision.localeCompare(b.emision))
      const saldo = docs.reduce((a: number, d: any) => a + d.saldo, 0)
      return { cl, docs, saldo }
    })
    .filter((g) => g.docs.length > 0)
    .sort((a, b) => b.saldo - a.saldo)

  const filas: Fila[] = []
  grupos.forEach((g) => {
    g.docs.forEach((d: any, i: number) => {
      filas.push({
        cliente: g.cl.razon_social,
        doc: g.cl.ruc ?? g.cl.dni ?? '—',
        telefono: g.cl.telefono,
        primera: i === 0,
        ultima: i === g.docs.length - 1,
        totalCliente: g.saldo,
        ...d,
      })
    })
  })

  const totales = {
    clientes: grupos.length,
    total: filas.reduce((a, f) => a + f.total, 0),
    abonado: filas.reduce((a, f) => a + f.abonado, 0),
    saldo: filas.reduce((a, f) => a + f.saldo, 0),
    vencido: filas.filter((f) => f.dias > 0).reduce((a, f) => a + f.saldo, 0),
  }

  return { vendedor, filas, totales }
}

const soles = (n: number) => n.toFixed(2)
const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Lima' }) : '—'

export default async function CobranzasVendedorSimplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getData(id)
  if (!data) return notFound()
  const { vendedor, filas, totales } = data

  const ahora = new Date()
  const fechaDoc = ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })
  const horaDoc = ahora.toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Lima',
  })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .simple-table { table-layout: fixed !important; width: 100% !important; }
          .simple-table td, .simple-table th { overflow: hidden; }
          /* El nombre del cliente no se trunca: el cobrador tiene que leerlo
             completo para reconocer el puesto. Si no entra, envuelve. */
          .simple-table .col-cliente { white-space: normal; word-break: break-word; }
          /* Estos jamás se parten: partirlos duplica el alto de la fila y se
             pierde media hoja. */
          .simple-table .nowrap { white-space: nowrap !important; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900 text-sm">Cobranzas Simple · {vendedor.full_name}</h1>
            <p className="text-[11px] text-gray-500">Vista compacta para impresión económica</p>
          </div>
          <CobranzasVendedorSimpleActions vendedorId={id} />
        </div>
      </div>

      <div className="max-w-5xl mx-auto print:mx-0 print:max-w-full bg-white p-6 print:p-0 shadow-sm my-3 print:my-0 print:shadow-none">
        {/* Encabezado mínimo, igual que la hoja de reparto: la razón social a
            un costado y todo el ancho para la lista. */}
        <div className="flex items-baseline justify-between pb-1 border-b-2 border-black">
          <span className="font-bold text-[10pt] whitespace-nowrap">{EMPRESA.razon_social}</span>
          <h1 className="text-[12pt] font-bold text-gray-900 underline">COBRANZAS POR COBRAR</h1>
          <span className="text-[8pt] text-gray-600 whitespace-nowrap">{fechaDoc} · {horaDoc}</span>
        </div>

        <div className="flex items-center gap-4 py-1.5 text-[11px] text-gray-700 border-b border-gray-200">
          <span><strong>Vendedor:</strong> {vendedor.full_name}</span>
          <span><strong>Clientes:</strong> {totales.clientes}</span>
          <span><strong>Documentos:</strong> {filas.length}</span>
          <span><strong>Vencido:</strong> S/ {soles(totales.vencido)}</span>
          <span className="ml-auto font-bold">Saldo: S/ {soles(totales.saldo)}</span>
        </div>

        <table className="simple-table w-full mt-1 text-[9.5pt]" style={{ borderCollapse: 'collapse', lineHeight: 1.15, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '24%' }} />{/* Cliente */}
            <col style={{ width: '8%' }} />{/* Doc */}
            <col style={{ width: '12%' }} />{/* Comprobante */}
            <col style={{ width: '7%' }} />{/* Emisión */}
            <col style={{ width: '7%' }} />{/* Vence */}
            <col style={{ width: '4%' }} />{/* Días */}
            <col style={{ width: '9%' }} />{/* Total */}
            <col style={{ width: '9%' }} />{/* Abonado */}
            <col style={{ width: '10%' }} />{/* Saldo */}
            <col style={{ width: '10%' }} />{/* Observación */}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-400">
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Cliente</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Doc.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Comprob.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Emis.</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Vence</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Días</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Total</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Abonado</th>
              <th className="text-right px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Saldo</th>
              <th className="text-left px-1 py-0.5 text-[7.5pt] font-bold text-gray-700">Observación</th>
            </tr>
          </thead>
          <tbody>
            {filas.flatMap((f, i) => [
              <tr
                key={i}
                /* La línea llena separa clientes; entre boletas del mismo
                   cliente va punteada, para que el bloque se lea como uno. */
                className={f.primera && i > 0 ? 'border-t border-gray-400' : 'border-b border-dotted border-gray-200'}
                style={{ lineHeight: 1.1 }}
              >
                <td className="col-cliente px-1 py-0 text-[8.5pt] text-gray-900 uppercase">
                  {f.primera ? f.cliente : ''}
                  {f.primera && f.telefono ? <span className="text-[7pt] text-gray-500 normal-case"> · {f.telefono}</span> : null}
                </td>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{f.primera ? f.doc : ''}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8.5pt] text-gray-700">{f.comprobante}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{fechaCorta(f.emision)}</td>
                <td className="nowrap px-1 py-0 font-mono text-[8pt] text-gray-700">{fechaCorta(f.vence)}</td>
                {/* Positivo = días que lleva vencido. Negativo = los que le
                    quedan para vencer. Se marca en rojo solo lo vencido. */}
                <td className={`nowrap px-1 py-0 font-mono text-[8pt] text-right ${f.dias > 0 ? 'text-red-700 font-bold' : 'text-gray-600'}`}>
                  {f.dias > 0 ? `+${f.dias}` : f.dias}
                </td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right">{soles(f.total)}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right text-gray-600">{f.abonado > 0.01 ? soles(f.abonado) : '—'}</td>
                <td className="nowrap px-1 py-0 text-[8.5pt] text-right font-semibold">{soles(f.saldo)}</td>
                <td className="px-1 py-0 text-[8.5pt] text-gray-600 border-b border-dotted border-gray-400"></td>
              </tr>,
              /*
                Lo que debe el cliente, sumando sus comprobantes.
                Daniel lo pidio: en la version premium sale y en esta no, y es
                el numero que le dice al cliente por telefono. Con dos boletas
                -698.50 y 680.00- lo que importa es el 1,378.50, no cada linea
                suelta.
                Solo aparece cuando el cliente tiene mas de un comprobante: con
                uno solo, el total ya esta en la columna Saldo.
              */
              f.ultima && filas.filter((x) => x.doc === f.doc).length > 1 ? (
                <tr key={`${i}-total`}>
                  <td colSpan={8} className="px-1 py-0 text-right text-[8pt] font-semibold text-gray-700">
                    Debe {f.cliente.split(' ').slice(0, 2).join(' ')}:
                  </td>
                  <td className="nowrap px-1 py-0 text-right text-[9pt] font-bold border-t border-gray-500">
                    {soles(f.totalCliente)}
                  </td>
                  <td></td>
                </tr>
              ) : null,
            ])}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={6} className="px-1 py-1.5 text-[9pt] font-bold text-right">TOTAL GENERAL:</td>
              <td className="nowrap px-1 py-1.5 text-[9pt] font-bold text-right">{soles(totales.total)}</td>
              <td className="nowrap px-1 py-1.5 text-[9pt] font-bold text-right">{soles(totales.abonado)}</td>
              <td className="nowrap px-1 py-1.5 text-[10pt] font-bold text-right">S/ {soles(totales.saldo)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {filas.length === 0 && (
          <p className="text-center py-10 text-[10pt] text-gray-500">
            Este vendedor no tiene cobranzas pendientes.
          </p>
        )}

        {/* Sin firmas: Daniel las pidió fuera. Esta hoja no se entrega ni se
            recibe conforme, es la lista de trabajo del cobrador. */}
      </div>
    </div>
  )
}
