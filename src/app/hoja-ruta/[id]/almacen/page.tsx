import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import HojaRutaAlmacenActions from './almacen-actions'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

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
  const fechaDespachoFmt = new Date(despacho.fecha_despacho + 'T12:00:00').toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Lima',
  })
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
          @page { size: A4 portrait; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .almacen-table { font-size: 10pt !important; }
          .almacen-table td, .almacen-table th { padding: 3px 6px !important; }
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

      <div className="max-w-5xl mx-auto px-6 py-8 print:px-0 print:py-0">
        {/* Membrete empresa */}
        <div className="text-center pb-1 border-b border-gray-200 mb-3">
          <div className="font-bold text-[12pt]">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</div>
          <div style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 16, color: '#1f2937', lineHeight: 1 }}>{EMPRESA.slogan}</div>
          <div className="text-[9pt] text-gray-600">{EMPRESA.direccion_comercial} · Tel. {EMPRESA.telefono} · {EMPRESA.correo}</div>
        </div>

        {/* Cabecera del documento */}
        <div className="flex items-start justify-between mb-3 print:mb-2">
          <div></div>
          <div className="text-right text-[10pt] text-gray-700">
            <div className="capitalize">{fechaDespachoFmt}</div>
            <div className="font-mono">{generadoFmt.split(' ')[1]}</div>
          </div>
        </div>

        <h2 className="text-center text-[14pt] font-bold tracking-wide mb-2 print:mb-1">
          REPARTO DE MERCADERIA POR ZONA
        </h2>

        {/* Datos del vehículo + fecha */}
        <div className="border-y border-gray-300 py-1.5 mb-3 text-[10pt] flex items-baseline gap-6 flex-wrap">
          <div>
            <span className="font-bold">Fecha:</span>{' '}
            <span className="text-gray-700">Desde: {fechaCorta} hasta: {fechaCorta}</span>
          </div>
          <div>
            <span className="font-bold">Vehículo:</span>{' '}
            <span className="text-gray-700 font-mono">{v?.placa ?? '—'}</span>
            {v?.descripcion && <span className="text-gray-500 text-[9pt]"> · {v.descripcion}</span>}
          </div>
          <div>
            <span className="font-bold">Despacho:</span>{' '}
            <span className="text-gray-700 font-mono">{despacho.numero}</span>
          </div>
          <div>
            <span className="font-bold">Pedidos:</span>{' '}
            <span className="text-gray-700">{despacho.total_pedidos}</span>
          </div>
        </div>

        {/* Tabla consolidada */}
        <table className="w-full almacen-table border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-700 text-[10pt]">
              <th className="text-left py-1 px-2 font-bold w-20">Codigo</th>
              <th className="text-left py-1 px-2 font-bold">Descripción</th>
              <th className="text-left py-1 px-2 font-bold w-16">UDM</th>
              <th className="text-right py-1 px-2 font-bold w-20">Cantidad</th>
              <th className="text-right py-1 px-2 font-bold w-20">Peso</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-400 italic">
                  No hay productos asignados a este despacho.
                </td>
              </tr>
            ) : filas.map((r) => (
              <tr key={r.producto_id} className="border-b border-gray-100 text-[10pt]">
                <td className="py-1 px-2 font-mono text-gray-700">{r.codigo}</td>
                <td className="py-1 px-2 text-gray-900">{r.descripcion}</td>
                <td className="py-1 px-2 text-gray-700 uppercase">{r.udm}</td>
                <td className="py-1 px-2 text-right font-mono">{r.cantidad.toFixed(2)}</td>
                <td className="py-1 px-2 text-right font-mono">{r.peso_total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-700 text-[10pt] font-bold">
              <td colSpan={3} className="py-1.5 px-2 text-right">TOTALES DE PRODUCTOS:</td>
              <td className="py-1.5 px-2 text-right font-mono">
                {totalCantidad.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {totalPeso.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
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
