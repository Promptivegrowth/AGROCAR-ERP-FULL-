import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import CatalogoActions from './catalogo-actions'

export const dynamic = 'force-dynamic'

interface ProductoCatalogo {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  familia: string
  udm: string
  peso_kg: number | null
  tiene_lote: boolean
  tiene_vencimiento: boolean
  stock: number
  precio_a: number | null
  precio_b: number | null
  precio_c: number | null
}

async function getData(soloActivos: boolean) {
  const supabase = await createClient()
  const { data: prod } = await (supabase as any)
    .from('productos')
    .select(`
      id, codigo, nombre, descripcion, activo, peso_kg,
      tiene_lote, tiene_vencimiento,
      familias(nombre),
      unidades_medida(simbolo),
      stock(cantidad)
    `)
    .order('codigo')

  let productos = (prod ?? []) as any[]
  if (soloActivos) productos = productos.filter((p) => p.activo)

  // Listas A, B, C
  const { data: listas } = await (supabase as any)
    .from('listas_precio')
    .select('id, nombre')
  const listaPorNombre: Record<string, string> = {}
  ;(listas ?? []).forEach((l: any) => {
    listaPorNombre[l.nombre] = l.id
  })

  // Precios de todas las listas en una sola query
  const { data: precios } = await (supabase as any)
    .from('lista_precio_items')
    .select('lista_precio_id, producto_id, precio')
    .eq('activo', true)

  const precioMap = new Map<string, { a: number | null; b: number | null; c: number | null }>()
  ;(precios ?? []).forEach((p: any) => {
    const acc = precioMap.get(p.producto_id) ?? { a: null, b: null, c: null }
    if (p.lista_precio_id === listaPorNombre['A']) acc.a = Number(p.precio)
    else if (p.lista_precio_id === listaPorNombre['B']) acc.b = Number(p.precio)
    else if (p.lista_precio_id === listaPorNombre['C']) acc.c = Number(p.precio)
    precioMap.set(p.producto_id, acc)
  })

  const result: ProductoCatalogo[] = productos.map((p) => {
    const precs = precioMap.get(p.id) ?? { a: null, b: null, c: null }
    return {
      id: p.id,
      codigo: p.codigo ?? '—',
      nombre: p.nombre ?? '—',
      descripcion: p.descripcion ?? null,
      familia: p.familias?.nombre ?? '—',
      udm: p.unidades_medida?.simbolo ?? '',
      peso_kg: p.peso_kg,
      tiene_lote: !!p.tiene_lote,
      tiene_vencimiento: !!p.tiene_vencimiento,
      stock: Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
      precio_a: precs.a,
      precio_b: precs.b,
      precio_c: precs.c,
    }
  })

  // Agrupar por familia para visualización
  const porFamilia = new Map<string, ProductoCatalogo[]>()
  result.forEach((p) => {
    const arr = porFamilia.get(p.familia) ?? []
    arr.push(p)
    porFamilia.set(p.familia, arr)
  })
  // Ordenar familias por nombre
  const familias = Array.from(porFamilia.entries())
    .sort(([a], [b]) => a.localeCompare(b))

  return { productos: result, familias }
}

export default async function CatalogoPage({ searchParams }: {
  searchParams: Promise<{ activos?: string }>
}) {
  const sp = await searchParams
  const soloActivos = sp.activos !== '0'
  const { productos, familias } = await getData(soloActivos)

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .cat-doc { font-size: 9pt !important; line-height: 1.2 !important; }
          .cat-doc table { font-size: 8.5pt !important; }
          .cat-doc th, .cat-doc td { padding: 2px 4px !important; }
          .cat-doc tr { page-break-inside: avoid; }
          .cat-doc thead { display: table-header-group; }
          .familia-header { page-break-after: avoid; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-7xl mx-auto p-4 print:p-0 print:max-w-full">
        <div className="bg-black text-white p-4 rounded-t-xl flex items-center justify-between no-print">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">AGROCAR ERP</p>
            <h1 className="text-xl font-bold">Catálogo de productos</h1>
            <p className="text-sm text-gray-300">{productos.length} productos · precios A / B / C</p>
          </div>
          <CatalogoActions soloActivos={soloActivos} />
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
              <p className="text-sm font-bold">Catálogo de productos</p>
              <p className="text-[10px] text-gray-600">{productos.length} productos</p>
              <p className="text-[10px] text-gray-600">{new Date().toLocaleDateString('es-PE')}</p>
            </div>
          </div>
        </div>

        <div className="cat-doc bg-white border border-gray-200 rounded-b-xl p-4 print:border-0 print:p-0 space-y-4">
          {/* Leyenda */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-700 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div><strong className="text-gray-900">Lista A:</strong> Mayorista / distribuidores</div>
            <div><strong className="text-gray-900">Lista B:</strong> Tiendas / intermedios</div>
            <div><strong className="text-gray-900">Lista C:</strong> Consumidor final / detalle</div>
          </div>

          {familias.map(([familia, productosFam]) => (
            <div key={familia}>
              <h2 className="familia-header text-sm font-bold text-gray-900 uppercase bg-gray-100 px-2 py-1 rounded-t border border-gray-300 border-b-0">
                {familia} <span className="text-gray-500 font-normal text-xs">({productosFam.length})</span>
              </h2>
              <table className="w-full text-xs border border-gray-300">
                <thead className="bg-gray-50 border-b border-gray-300">
                  <tr>
                    <th className="text-left p-1.5 w-20">Código</th>
                    <th className="text-left p-1.5">Producto</th>
                    <th className="text-center p-1.5 w-12">UDM</th>
                    <th className="text-right p-1.5 w-16">Stock</th>
                    <th className="text-right p-1.5 w-20 bg-blue-50">Lista A</th>
                    <th className="text-right p-1.5 w-20">Lista B</th>
                    <th className="text-right p-1.5 w-20">Lista C</th>
                    <th className="text-center p-1.5 w-16">Atributos</th>
                  </tr>
                </thead>
                <tbody>
                  {productosFam.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="p-1.5 font-mono text-[10px]">{p.codigo}</td>
                      <td className="p-1.5">
                        <div className="font-semibold text-gray-900">{p.nombre}</div>
                        {p.descripcion && (
                          <div className="text-[10px] text-gray-500 truncate max-w-[300px]">{p.descripcion}</div>
                        )}
                      </td>
                      <td className="p-1.5 text-center uppercase">{p.udm}</td>
                      <td className={`p-1.5 text-right font-mono ${
                        p.stock <= 0 ? 'text-red-600' : p.stock < 10 ? 'text-amber-600' : 'text-gray-900'
                      }`}>
                        {p.stock.toFixed(2)}
                      </td>
                      <td className="p-1.5 text-right font-mono bg-blue-50/40 font-semibold">
                        {p.precio_a !== null ? formatCurrency(p.precio_a) : '—'}
                      </td>
                      <td className="p-1.5 text-right font-mono">
                        {p.precio_b !== null ? formatCurrency(p.precio_b) : '—'}
                      </td>
                      <td className="p-1.5 text-right font-mono">
                        {p.precio_c !== null ? formatCurrency(p.precio_c) : '—'}
                      </td>
                      <td className="p-1.5 text-center text-[9px] space-x-0.5">
                        {p.peso_kg ? (
                          <span className="inline-block px-1 py-0.5 bg-gray-100 rounded">
                            {p.peso_kg}kg
                          </span>
                        ) : null}
                        {p.tiene_lote && (
                          <span className="inline-block px-1 py-0.5 bg-purple-100 text-purple-700 rounded" title="Maneja lote">L</span>
                        )}
                        {p.tiene_vencimiento && (
                          <span className="inline-block px-1 py-0.5 bg-orange-100 text-orange-700 rounded" title="Tiene vencimiento">V</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
