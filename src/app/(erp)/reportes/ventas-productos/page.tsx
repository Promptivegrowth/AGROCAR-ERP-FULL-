import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import VentasProductosActions from './ventas-productos-actions'

export const dynamic = 'force-dynamic'

interface ProductoStat {
  producto_id: string | null
  codigo: string
  nombre: string
  familia: string
  cantidad: number
  monto: number
  veces: number
}

async function getData(desde: string, hasta: string) {
  const supabase = await createClient()

  const { data: items } = await (supabase as any)
    .from('comprobantes_items')
    .select(`
      cantidad, precio_unitario, subtotal, descripcion, producto_id,
      productos(id, codigo, nombre, familias(nombre)),
      comprobantes!inner(fecha_emision, estado)
    `)
    .gte('comprobantes.fecha_emision', desde)
    .lte('comprobantes.fecha_emision', hasta)
    .neq('comprobantes.estado', 'anulado')

  const map = new Map<string, ProductoStat>()
  ;(items ?? []).forEach((it: any) => {
    const key = it.producto_id ?? `__${it.descripcion}`
    const acc = map.get(key) ?? {
      producto_id: it.producto_id,
      codigo: it.productos?.codigo ?? '—',
      nombre: it.productos?.nombre ?? it.descripcion ?? '—',
      familia: it.productos?.familias?.nombre ?? '—',
      cantidad: 0, monto: 0, veces: 0,
    }
    acc.cantidad += Number(it.cantidad ?? 0)
    acc.monto += Number(it.subtotal ?? 0)
    acc.veces += 1
    map.set(key, acc)
  })

  const productos = Array.from(map.values()).sort((a, b) => b.monto - a.monto)

  // Agregación por familia
  const fam = new Map<string, { familia: string; cantidad: number; monto: number; productos: number }>()
  productos.forEach((p) => {
    const acc = fam.get(p.familia) ?? { familia: p.familia, cantidad: 0, monto: 0, productos: 0 }
    acc.cantidad += p.cantidad
    acc.monto += p.monto
    acc.productos += 1
    fam.set(p.familia, acc)
  })
  const familias = Array.from(fam.values()).sort((a, b) => b.monto - a.monto)

  return { productos, familias }
}

export default async function VentasProductosPage({ searchParams }: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const sp = await searchParams
  const hasta = sp.hasta ?? hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hasta + 'T00:00:00-05:00'); d.setDate(d.getDate() - 29)
    return d.toISOString().slice(0, 10)
  })()
  const desde = sp.desde ?? desdeDefault
  const { productos, familias } = await getData(desde, hasta)

  const totalMonto = productos.reduce((a, p) => a + p.monto, 0)
  const totalCantidad = productos.reduce((a, p) => a + p.cantidad, 0)

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .vp-doc { font-size: 11pt !important; line-height: 1.4 !important; }
          .vp-doc table { font-size: 10pt !important; }
          .vp-doc th, .vp-doc td { padding: 4px 6px !important; }
          .vp-doc tr { page-break-inside: avoid; }
          .vp-doc thead { display: table-header-group; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-6xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP</p>
            <h1 className="text-xl font-bold">Productos más vendidos</h1>
            <p className="text-sm text-gray-300">Ranking de productos y familias</p>
          </div>
          <VentasProductosActions desde={desde} hasta={hasta} />
        </div>

        <div className="print-only mb-3">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 55 }} />
              <div>
                <p className="font-bold text-base">{EMPRESA.razon_social}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 15, lineHeight: 1 }}>{EMPRESA.slogan}</p>
                <p className="text-[10px] text-gray-700">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
                <p className="text-[10px] text-gray-700">Tel. {EMPRESA.telefono} · {EMPRESA.correo}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">Productos más vendidos</p>
              <p className="text-[10px] text-gray-600">Del {formatDate(desde)} al {formatDate(hasta)}</p>
            </div>
          </div>
        </div>

        <div className="vp-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700 font-semibold">PRODUCTOS</p>
              <p className="text-lg font-bold text-blue-900">{productos.length}</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <p className="text-xs text-purple-700 font-semibold">UNIDADES VENDIDAS</p>
              <p className="text-lg font-bold text-purple-900">{totalCantidad.toFixed(0)}</p>
            </div>
            <div className="bg-[#FBE600] border border-yellow-400 rounded-lg p-3">
              <p className="text-xs text-black font-semibold">FACTURADO</p>
              <p className="text-lg font-bold">{formatCurrency(totalMonto)}</p>
            </div>
          </div>

          {/* Ranking de familias */}
          {familias.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">
                Ranking por familia ({familias.length})
              </h2>
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2 w-10">#</th>
                    <th className="text-left p-2">Familia</th>
                    <th className="text-right p-2">Productos</th>
                    <th className="text-right p-2">Cantidad</th>
                    <th className="text-right p-2">Monto</th>
                    <th className="text-right p-2">% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {familias.map((f, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="p-2 font-bold text-gray-500">{i + 1}</td>
                      <td className="p-2 font-semibold">{f.familia}</td>
                      <td className="p-2 text-right">{f.productos}</td>
                      <td className="p-2 text-right font-mono">{f.cantidad.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono font-semibold">{formatCurrency(f.monto)}</td>
                      <td className="p-2 text-right text-gray-600">
                        {totalMonto > 0 ? ((f.monto / totalMonto) * 100).toFixed(1) : '0.0'}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Ranking de productos */}
          {productos.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">
                Ranking de productos ({productos.length})
              </h2>
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-2 w-10">#</th>
                    <th className="text-left p-2">Código</th>
                    <th className="text-left p-2">Producto</th>
                    <th className="text-left p-2">Familia</th>
                    <th className="text-right p-2">Veces</th>
                    <th className="text-right p-2">Cantidad</th>
                    <th className="text-right p-2">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="p-2 font-bold text-gray-500">{i + 1}</td>
                      <td className="p-2 font-mono text-[10px]">{p.codigo}</td>
                      <td className="p-2 truncate max-w-[260px]">{p.nombre}</td>
                      <td className="p-2 text-gray-600 truncate max-w-[140px]">{p.familia}</td>
                      <td className="p-2 text-right">{p.veces}</td>
                      <td className="p-2 text-right font-mono">{p.cantidad.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono font-semibold">{formatCurrency(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
