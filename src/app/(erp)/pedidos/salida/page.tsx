import { Fragment } from 'react'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA } from '@/lib/empresa'
import SalidaAcciones from './acciones'

export const dynamic = 'force-dynamic'

/**
 * Los productos que salen en un día de despacho, desde los PEDIDOS.
 *
 * Daniel, 03/10: "adicionar una opción como movimiento del día: los productos
 * que saldrán al día siguiente, para imprimir y visualizar". Movimientos del
 * día cuenta lo ya facturado; esto suma también lo que todavía está como
 * pedido, para preparar la mercadería antes de facturar.
 *
 * Entran los pedidos que van en camión ese día: enviados, validados,
 * facturados y despachados. Quedan afuera los cancelados, los borradores y los
 * entregados (venta directa y venta de oficina: la mercadería ya salió).
 */
const ESTADOS = ['enviado', 'validado', 'facturado', 'despachado']

function manana(): string {
  const d = new Date(`${hoyLima()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function getData(fechaPedida?: string) {
  const supabase = await createClient()

  // Sin fecha elegida: el próximo día con despacho desde mañana (el domingo
  // no sale camión, así que "mañana" puede no tener nada).
  let fecha: string = fechaPedida ?? ''
  if (!fecha) {
    const { data: prox } = await (supabase as any).from('pedidos')
      .select('fecha_despacho').in('estado', ESTADOS).gte('fecha_despacho', manana())
      .order('fecha_despacho', { ascending: true }).limit(1).maybeSingle()
    fecha = (prox?.fecha_despacho as string | undefined) ?? manana()
  }

  const pedidos: any[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data } = await (supabase as any).from('pedidos')
      .select(`id, numero, estado, total,
        clientes(razon_social),
        pedidos_items(cantidad, subtotal, descripcion_libre,
          productos(id, codigo, nombre, descripcion, peso_kg, familias(nombre), unidades_medida(simbolo)))`)
      .eq('fecha_despacho', fecha).in('estado', ESTADOS)
      .order('created_at', { ascending: true })
      .range(desde, desde + 999)
    pedidos.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  type Fila = { codigo: string; producto: string; familia: string; udm: string; cantidad: number; peso: number; monto: number; pedidos: Set<string> }
  const mapa = new Map<string, Fila>()
  for (const p of pedidos) {
    for (const it of p.pedidos_items ?? []) {
      const pr = it.productos
      const clave = pr?.id ?? `libre:${it.descripcion_libre}`
      const f = mapa.get(clave) ?? {
        codigo: pr?.codigo ?? '—',
        producto: it.descripcion_libre?.trim() || pr?.descripcion?.trim() || pr?.nombre || 'Producto',
        familia: pr?.familias?.nombre ?? 'Sin familia',
        udm: pr?.unidades_medida?.simbolo ?? '',
        cantidad: 0, peso: 0, monto: 0, pedidos: new Set<string>(),
      }
      const cant = Number(it.cantidad ?? 0)
      f.cantidad += cant
      f.peso += cant * Number(pr?.peso_kg ?? 0)
      f.monto += Number(it.subtotal ?? 0)
      f.pedidos.add(p.id)
      mapa.set(clave, f)
    }
  }
  const filas = Array.from(mapa.values())
    .sort((a, b) => a.familia.localeCompare(b.familia) || a.producto.localeCompare(b.producto))
  const familias = new Map<string, Fila[]>()
  for (const f of filas) familias.set(f.familia, [...(familias.get(f.familia) ?? []), f])

  const porEstado: Record<string, number> = {}
  for (const p of pedidos) porEstado[p.estado] = (porEstado[p.estado] ?? 0) + 1

  return {
    fecha,
    pedidos: pedidos.length,
    porEstado,
    familias: Array.from(familias.entries()),
    totales: {
      productos: filas.length,
      cantidad: filas.reduce((a, f) => a + f.cantidad, 0),
      peso: filas.reduce((a, f) => a + f.peso, 0),
      monto: pedidos.reduce((a, p) => a + Number(p.total ?? 0), 0),
    },
  }
}

export default async function SalidaPage({ searchParams }: { searchParams: { fecha?: string } }) {
  const fechaPedida = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.fecha ?? '') ? searchParams.fecha : undefined
  const d = await getData(fechaPedida)
  const n2 = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const ESTADO_LABEL: Record<string, string> = { enviado: 'sin facturar', validado: 'validados', facturado: 'facturados', despachado: 'ya consolidados' }

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 portrait; margin: 9mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .salida-doc table { font-size: 8.5pt !important; }
          .salida-doc th, .salida-doc td { padding: 2px 5px !important; }
          .salida-doc tr { page-break-inside: avoid; }
          .salida-doc thead { display: table-header-group; }
        }
      ` }} />

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos que salen</h1>
          <p className="text-sm text-gray-500">Consolidado de los pedidos del día de despacho, para preparar la mercadería.</p>
        </div>
        <SalidaAcciones fecha={d.fecha} />
      </div>

      <div className="salida-doc rounded-xl border border-gray-200 bg-white p-4 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b-2 border-black pb-2 mb-3">
          <div>
            <p className="font-bold">{EMPRESA.razon_social}</p>
            <p className="text-lg font-bold underline" data-titulo-salida>PRODUCTOS QUE SALEN · {formatDate(d.fecha)}</p>
          </div>
          <div className="text-right text-xs text-gray-700">
            <p><strong>{d.pedidos}</strong> pedidos · <strong>{d.totales.productos}</strong> productos</p>
            <p>{Object.entries(d.porEstado).map(([e, n]) => `${n} ${ESTADO_LABEL[e] ?? e}`).join(' · ')}</p>
            <p>Peso aprox. <strong>{n2(d.totales.peso)} kg</strong> · {formatCurrency(d.totales.monto)}</p>
          </div>
        </div>

        {d.pedidos === 0 ? (
          <p className="py-10 text-center text-gray-400" data-salida-vacia>No hay pedidos para despachar el {formatDate(d.fecha)}.</p>
        ) : (
          <table className="w-full text-xs" data-tabla-salida>
            <thead>
              <tr className="border-b border-gray-400 text-left text-[11px] uppercase text-gray-600">
                <th className="py-1.5 pr-2">Código</th>
                <th className="py-1.5 pr-2">Producto</th>
                <th className="py-1.5 pr-2 text-center">UDM</th>
                <th className="py-1.5 pr-2 text-right">Cantidad</th>
                <th className="py-1.5 pr-2 text-right">Peso (kg)</th>
                <th className="py-1.5 pr-2 text-right">Pedidos</th>
                <th className="py-1.5 text-left w-28">Observación</th>
              </tr>
            </thead>
            <tbody>
              {d.familias.map(([familia, filas]) => (
                <Fragment key={familia}>
                  <tr className="bg-gray-100">
                    <td colSpan={7} className="py-1 px-1 font-bold uppercase text-[11px]">{familia}</td>
                  </tr>
                  {filas.map((f) => (
                    <tr key={`${familia}-${f.codigo}-${f.producto}`} className="border-b border-gray-100" data-fila-salida>
                      <td className="py-1 pr-2 font-mono">{f.codigo}</td>
                      <td className="py-1 pr-2">{f.producto}</td>
                      <td className="py-1 pr-2 text-center">{f.udm}</td>
                      <td className="py-1 pr-2 text-right font-mono font-semibold">{n2(f.cantidad)}</td>
                      <td className="py-1 pr-2 text-right font-mono">{f.peso > 0 ? n2(f.peso) : '—'}</td>
                      <td className="py-1 pr-2 text-right font-mono">{f.pedidos.size}</td>
                      <td className="py-1 border-b border-dotted border-gray-300"></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-bold">
                <td colSpan={3} className="py-1.5 text-right pr-2">TOTALES</td>
                <td className="py-1.5 pr-2 text-right font-mono" data-total-cantidad>{n2(d.totales.cantidad)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{n2(d.totales.peso)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mt-3 text-[10px] text-gray-500">
          Incluye pedidos sin facturar, facturados y ya consolidados del día. No incluye ventas directas ni de oficina (ya entregadas) ni cancelados.
        </p>
      </div>
    </div>
  )
}
