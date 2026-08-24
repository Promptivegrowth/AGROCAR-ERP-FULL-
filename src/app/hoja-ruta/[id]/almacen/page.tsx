import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import HojaRutaAlmacenActions from './almacen-actions'
import { EMPRESA } from '@/lib/empresa'

export const dynamic = 'force-dynamic'

/**
 * Vista "Consolidado para almacén" del despacho.
 *
 * Muestra todos los productos de los pedidos asignados al vehículo,
 * agregados por producto. Sirve como hoja de picking para el almacenero:
 * sabe exactamente cuánto separar de cada producto sin tener que
 * sumar pedido por pedido.
 *
 * Columnas: Código · Descripción · UDM · Cantidad · Peso unitario · Peso total
 *
 * El documento siempre se imprime EN EL MÓDULO DE DESPACHO, no en almacén.
 */
async function getData(id: string) {
  const supabase = await createClient()

  const { data: despacho } = await (supabase as any)
    .from('despachos')
    .select(`
      id, numero, fecha_despacho, estado, total_pedidos, total_monto, peso_total_kg,
      hoja_ruta_emitida_at,
      vehiculos(placa, descripcion, capacidad_kg)
    `)
    .eq('id', id)
    .maybeSingle()
  if (!despacho) return null

  // Todos los items de los pedidos asignados a este despacho
  const { data: items } = await (supabase as any)
    .from('despachos_items')
    .select(`
      pedido_id,
      pedidos(
        id, numero,
        pedidos_items(
          cantidad,
          productos(
            id, codigo, nombre, descripcion, peso_kg,
            unidades_medida(simbolo, nombre)
          )
        )
      )
    `)
    .eq('despacho_id', id)

  // Consolidar por producto_id
  type ConsolidadoRow = {
    producto_id: string
    codigo: string
    descripcion: string
    nombre: string
    udm: string
    cantidad: number
    peso_unitario: number
    peso_total: number
  }
  const consolidado = new Map<string, ConsolidadoRow>()
  ;(items ?? []).forEach((it: any) => {
    const ped = it.pedidos
    if (!ped) return
    ;(ped.pedidos_items ?? []).forEach((pi: any) => {
      const prod = pi.productos
      if (!prod) return
      const cant = Number(pi.cantidad ?? 0)
      const pesoUnit = Number(prod.peso_kg ?? 0)
      const cur = consolidado.get(prod.id) ?? {
        producto_id: prod.id,
        codigo: prod.codigo ?? '—',
        descripcion: (prod.descripcion ?? '').trim() || prod.nombre || '—',
        nombre: prod.nombre ?? '—',
        udm: prod.unidades_medida?.simbolo ?? 'UND',
        cantidad: 0,
        peso_unitario: pesoUnit,
        peso_total: 0,
      }
      cur.cantidad += cant
      cur.peso_total += cant * pesoUnit
      consolidado.set(prod.id, cur)
    })
  })

  // Ordenar por descripción alfabéticamente para que el almacenero lo recorra ordenado
  const filas = Array.from(consolidado.values()).sort((a, b) =>
    a.descripcion.localeCompare(b.descripcion, 'es'),
  )

  // Totales generales
  const totalCantidad = filas.reduce((acc, r) => acc + r.cantidad, 0)
  const totalPeso = filas.reduce((acc, r) => acc + r.peso_total, 0)

  return { despacho, filas, totalCantidad, totalPeso }
}

export default async function HojaRutaAlmacenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getData(id)
  if (!data) return notFound()

  const { despacho, filas, totalCantidad, totalPeso } = data
  const v = despacho.vehiculos as any

  // Fechas en hora de Lima
  const generadoFmt = new Date().toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/Lima',
  })

  // Para el subtítulo "Desde X hasta Y" usamos la misma fecha (el despacho es de un día)
  const fechaCorta = new Date(despacho.fecha_despacho + 'T12:00:00').toLocaleDateString('es-PE', {
    day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'America/Lima',
  })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 7mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; line-height: 1.15; }
          .no-print { display: none !important; }
          .almacen-table { font-size: 9pt !important; line-height: 1.1 !important; }
          .almacen-table td, .almacen-table th { padding: 1px 4px !important; }
          .almacen-table tr { height: auto !important; }
        }
      `}</style>

      {/* Barra superior (no se imprime) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="font-bold text-gray-900 text-sm">Consolidado de Almacén · {despacho.numero}</h1>
            <p className="text-[11px] text-gray-500">
              Lista de picking para preparar la mercadería del vehículo {v?.placa ?? '—'}.
            </p>
          </div>
          <HojaRutaAlmacenActions despachoId={id} />
        </div>
      </div>

      {/* Aprovechamos todo el ancho de la hoja A4 — la columna Observación
          al final reemplaza el espacio en blanco que antes quedaba a la
          derecha. Daniel pidió que el almacenero anote ahí, una observación
          por línea de producto. */}
      <div className="max-w-5xl mx-auto px-6 py-8 print:max-w-full print:mx-0 print:px-0 print:py-0">
        {/* Encabezado mínimo, el mismo de la hoja de reparto.
            Pedido de Daniel: el membrete centrado con el nombre, el eslogan y
            la dirección se comía media hoja en un documento que no sale de la
            empresa. Queda AGROCAR a un costado, el título al medio y la fecha
            al otro, en un solo renglón.
            La fecha "desde/hasta" también se va: repetía dos veces el mismo
            día, que ya está acá arriba. */}
        <div className="flex items-baseline justify-between pb-1 border-b-2 border-black">
          <span className="font-bold text-[10pt] whitespace-nowrap">{EMPRESA.razon_social}</span>
          <h1 className="text-[12pt] font-bold text-gray-900 underline">REPARTO DE MERCADERIA POR ZONA</h1>
          <span className="text-[8pt] text-gray-600 whitespace-nowrap">
            {fechaCorta} · {generadoFmt.split(' ')[1]}
          </span>
        </div>

        {/* Metadatos */}
        <div className="flex items-center gap-4 py-1.5 text-[11px] text-gray-700 border-b border-gray-200">
          <span>
            <strong>Vehículo:</strong> {v?.placa ?? '—'}
            {v?.descripcion ? ` · ${v.descripcion}` : ''}
          </span>
          <span><strong>Despacho:</strong> <span className="font-mono">{despacho.numero}</span></span>
          <span><strong>Pedidos:</strong> {despacho.total_pedidos}</span>
        </div>

        {/* Tabla consolidada */}
        <table className="w-full almacen-table border-collapse" style={{ lineHeight: 1.15 }}>
          <thead>
            {/* Daniel: "más espacio para la descripción y con letras más
                pequeñas para que pueda entrar más ítem". La Observación se
                llevaba el 38% del ancho estando siempre vacía; con 20% sigue
                habiendo dónde anotar a mano y la descripción deja de partirse
                en dos líneas, que era lo que hacía altas las filas. */}
            <tr className="border-b-2 border-gray-700 text-[8pt]">
              <th className="text-left py-0.5 px-1.5 font-bold w-14">Código</th>
              <th className="text-left py-0.5 px-1.5 font-bold">Descripción</th>
              <th className="text-left py-0.5 px-1.5 font-bold w-10">UDM</th>
              <th className="text-right py-0.5 px-1.5 font-bold w-14">Cant.</th>
              <th className="text-right py-0.5 px-1.5 font-bold w-14">Peso</th>
              <th className="text-left py-0.5 px-1.5 font-bold border-l border-gray-400" style={{ width: '20%' }}>
                Observación
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400 italic">
                  No hay productos asignados a este despacho.
                </td>
              </tr>
            ) : filas.map((r) => (
              <tr key={r.producto_id} className="border-b border-gray-300 text-[8pt]" style={{ lineHeight: 1.1, height: 16 }}>
                <td className="py-0 px-1.5 font-mono text-gray-700">{r.codigo}</td>
                <td className="py-0 px-1.5 text-gray-900">{r.descripcion}</td>
                <td className="py-0 px-1.5 text-gray-700 uppercase">{r.udm}</td>
                <td className="py-0 px-1.5 text-right font-mono">{r.cantidad.toFixed(2)}</td>
                <td className="py-0 px-1.5 text-right font-mono">{r.peso_total.toFixed(2)}</td>
                <td className="py-0 px-1.5 border-l border-gray-300">&nbsp;</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-700 text-[8.5pt] font-bold">
              <td colSpan={3} className="py-1 px-1.5 text-right">TOTALES:</td>
              <td className="py-1 px-1.5 text-right font-mono">
                {totalCantidad.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="py-1 px-1.5 text-right font-mono">
                {totalPeso.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="border-l border-gray-400">&nbsp;</td>
            </tr>
          </tfoot>
        </table>

        {/* Recordatorios al pie */}
        <div className="mt-6 text-[9pt] text-gray-500 border-t border-gray-200 pt-2 print:hidden">
          <p>
            Documento generado {generadoFmt} · AGROCAR ERP · Despacho {despacho.numero} · {filas.length} líneas
          </p>
        </div>
        <div className="hidden print:block mt-6 text-[8pt] text-gray-500 border-t border-gray-300 pt-1 text-center">
          Documento interno · Vehículo {v?.placa ?? '—'} · Despacho {despacho.numero} · Impreso {generadoFmt} · AGROCAR ERP
        </div>
      </div>
    </div>
  )
}
