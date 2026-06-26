import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { EMPRESA } from '@/lib/empresa'
import GuiaActions from './guia-actions'

export const dynamic = 'force-dynamic'

const MOTIVOS_LABEL: Record<string, string> = {
  venta: 'Venta',
  compra: 'Compra',
  traslado_entre_establecimientos: 'Traslado entre establecimientos del mismo contribuyente',
  traslado_emisor_itinerante: 'Traslado por emisor itinerante de CP electrónico',
  importacion: 'Importación',
  exportacion: 'Exportación',
  devolucion: 'Devolución',
  recojo_bienes: 'Recojo de bienes',
  otros: 'Otros',
}

export default async function GuiaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: guia } = await (supabase as any)
    .from('guias_remision')
    .select(`
      *,
      clientes(razon_social, ruc, dni),
      comprobantes(serie, numero, tipo)
    `)
    .eq('id', id).maybeSingle()
  if (!guia) return notFound()

  const { data: items } = await (supabase as any)
    .from('guias_remision_items')
    .select('*')
    .eq('guia_id', id)
    .order('orden')

  const numeroCompleto = `${guia.serie}-${String(guia.numero).padStart(8, '0')}`

  const cliNombre = guia.clientes?.razon_social ?? guia.cliente_externo_nombre ?? 'Consumidor final'
  const cliDoc = guia.clientes?.ruc
    ? `REGISTRO ÚNICO DE CONTRIBUYENTES N° ${guia.clientes.ruc}`
    : guia.clientes?.dni
    ? `DOCUMENTO NACIONAL DE IDENTIDAD N° ${guia.clientes.dni}`
    : guia.cliente_externo_doc
    ? guia.cliente_externo_doc
    : '—'

  const fechaEmisionFmt = new Date(guia.fecha_emision).toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
  const fechaInicioFmt = new Date(guia.fecha_inicio_traslado + 'T12:00:00-05:00')
    .toLocaleDateString('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
    })

  // QR data básico (similar a SUNAT)
  const qrData = `${EMPRESA.ruc}|09|${guia.serie}|${guia.numero}|${guia.peso_bruto_total ?? 0}|${(guia.fecha_inicio_traslado ?? '').replace(/-/g, '')}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`

  const motivoLabel = MOTIVOS_LABEL[guia.motivo_traslado] ?? guia.motivo_traslado
  const modalidadLabel = guia.modalidad_traslado === 'publico' ? 'Público' : 'Privado'

  const ind = (v: boolean) => (v ? 'SI' : 'NO')

  return (
    <div className="min-h-dvh bg-gray-200 py-6 px-3 print:bg-white print:py-0 print:px-0">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          html, body { background: white !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
            font-family: 'Helvetica Neue', Arial, sans-serif !important; color: #111 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <GuiaActions guiaId={id} numero={numeroCompleto} />

      <div className="guia-doc max-w-4xl mx-auto bg-white shadow-lg print:shadow-none p-8" style={{
        fontFamily: '"Helvetica Neue", Arial, sans-serif', fontSize: 11, color: '#111',
      }}>
        {/* Encabezado: Logo + razón social + recuadro número */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={{ width: '20%', verticalAlign: 'top' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="QR" style={{ width: 110, height: 110 }} />
              </td>
              <td style={{ width: '50%', verticalAlign: 'top', paddingLeft: 16 }}>
                <div style={{ fontWeight: 'bold', fontSize: 18 }}>{EMPRESA.razon_social}</div>
              </td>
              <td style={{ width: '30%', verticalAlign: 'top', textAlign: 'center' }}>
                <div style={{ border: '1.5px solid #000', padding: 8, fontSize: 11, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 'bold' }}>RUC N°{EMPRESA.ruc}</div>
                  <div style={{ fontWeight: 'bold', marginTop: 4 }}>GUÍA DE REMISIÓN ELECTRÓNICA</div>
                  <div style={{ fontWeight: 'bold' }}>REMITENTE</div>
                  <div style={{ fontWeight: 'bold', marginTop: 4 }}>N° {numeroCompleto}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Fechas + Punto Partida */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginBottom: 8 }}>
          <tbody>
            <tr>
              <td style={{ width: '45%', verticalAlign: 'top', paddingRight: 12 }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>Fecha y hora de emisión :</strong> {fechaEmisionFmt}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Fecha y hora de CDR :</strong> {fechaEmisionFmt}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Fecha de inicio de Traslado :</strong> {fechaInicioFmt}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Motivo de Traslado :</strong> {motivoLabel}
                  {guia.motivo_descripcion && <span style={{ color: '#555' }}> · {guia.motivo_descripcion}</span>}
                </div>
              </td>
              <td style={{ width: '55%', verticalAlign: 'top', borderLeft: '1px solid #ccc', paddingLeft: 12 }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>Punto de Partida</strong>
                  <div style={{ marginTop: 2 }}>{guia.punto_partida}</div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>Punto de llegada</strong>
                  <div style={{ marginTop: 2 }}>{guia.punto_llegada}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Destinatario */}
        <div style={{ fontSize: 10.5, marginBottom: 8, borderTop: '1px solid #999', paddingTop: 6 }}>
          <strong>Datos del Destinatario :</strong>{' '}
          {cliNombre} - {cliDoc}
        </div>

        {/* Bienes por transportar */}
        <div style={{ fontSize: 10.5, marginBottom: 4 }}><strong>Bienes por transportar:</strong></div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9.5, marginBottom: 8, border: '1px solid #000' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 28 }}>N°</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 60 }}>Bien<br/>normalizado</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 68 }}>Código de<br/>Bien</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 68 }}>Código<br/>producto<br/>SUNAT</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 70 }}>Partida<br/>arancelaria</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 70 }}>Código<br/>GTIN</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px' }}>Descripción Detallada</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 70 }}>Unidad de<br/>medida</th>
              <th style={{ border: '1px solid #000', padding: '4px 3px', width: 60 }}>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 12, textAlign: 'center', color: '#999' }}>Sin items</td></tr>
            ) : (items ?? []).map((it: any, i: number) => (
              <tr key={it.id}>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center' }}>{i + 1}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center' }}>{it.bien_normalizado ? 'SI' : 'NO'}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center', fontSize: 9 }}>{it.codigo ?? ''}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center', fontSize: 9 }}>{it.codigo_producto_sunat ?? ''}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center', fontSize: 9 }}>{it.partida_arancelaria ?? ''}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center', fontSize: 9 }}>{it.codigo_gtin ?? ''}</td>
                <td style={{ border: '1px solid #000', padding: '3px' }}>{it.descripcion}</td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'center' }}>
                  {it.unidad_medida === 'NIU' ? 'UNIDAD' :
                   it.unidad_medida === 'KGM' ? 'KILO' :
                   it.unidad_medida === 'LTR' ? 'LITRO' : it.unidad_medida}
                </td>
                <td style={{ border: '1px solid #000', padding: '3px', textAlign: 'right' }}>{Number(it.cantidad).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Indicadores y peso */}
        <div style={{ fontSize: 10.5, lineHeight: 1.55 }}>
          <div><strong>Indicador de traslado total de la DAM o DS (*):</strong> {ind(guia.ind_traslado_total_dam)}</div>
          <div style={{ marginTop: 6 }}><strong>Unidad de Medida del Peso Bruto:</strong> {guia.unidad_peso}</div>
          <div><strong>Peso Bruto total de la carga:</strong> {Number(guia.peso_bruto_total).toFixed(2)}</div>

          <div style={{ marginTop: 10 }}><strong>Datos del traslado:</strong></div>

          <table style={{ width: '100%', marginTop: 4 }}>
            <tbody>
              <tr>
                <td style={{ width: '50%', verticalAlign: 'top' }}>
                  <div><strong>Modalidad de Traslado:</strong>{modalidadLabel}</div>
                  <div><strong>Indicador de transbordo programado:</strong> {ind(guia.ind_transbordo_programado)}</div>
                  <div><strong>Indicador de traslado en vehículos de categoría M1 o L:</strong> {ind(guia.ind_vehiculo_categoria_m1l)}</div>
                </td>
                <td style={{ width: '50%', verticalAlign: 'top' }}>
                  <div><strong>Indicador de retorno de vehículo con envases o embalajes vacíos:</strong> {ind(guia.ind_retorno_envases)}</div>
                  <div><strong>Indicador de retorno de vehículo vacío:</strong> {ind(guia.ind_retorno_vehiculo_vacio)}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {guia.modalidad_traslado === 'publico' && guia.transportista_razon_social && (
            <div style={{ marginTop: 10 }}>
              <strong>Datos del transportista:</strong>
              <div>{guia.transportista_razon_social}{guia.transportista_ruc ? ` - RUC ${guia.transportista_ruc}` : ''}</div>
            </div>
          )}

          <div style={{ marginTop: 10 }}><strong>Datos de los vehículos:</strong></div>
          <div style={{ paddingLeft: 12, marginTop: 2 }}>
            <strong>Principal:</strong> Número de placa: {guia.vehiculo_placa}
          </div>

          <div style={{ marginTop: 10 }}><strong>Datos de los conductores:</strong></div>
          <div style={{ paddingLeft: 12, marginTop: 2 }}>
            <strong>Principal:</strong> {guia.conductor_nombre} - DOCUMENTO NACIONAL DE IDENTIDAD N° {guia.conductor_doc}
            {guia.conductor_licencia && (
              <div style={{ paddingLeft: 12, marginTop: 4 }}>
                Número de licencia de conducir: {guia.conductor_licencia}
              </div>
            )}
          </div>

          {guia.comprobantes && (
            <div style={{ marginTop: 12, paddingTop: 6, borderTop: '1px solid #ccc', fontSize: 10 }}>
              <strong>Comprobante asociado:</strong>{' '}
              {guia.comprobantes.tipo === 'factura' ? 'Factura ' : 'Boleta '}
              {guia.comprobantes.serie}-{String(guia.comprobantes.numero).padStart(8, '0')}
            </div>
          )}

          {guia.estado === 'anulado' && (
            <div style={{ marginTop: 12, padding: 10, background: '#fee', border: '1px solid #f00', textAlign: 'center', fontWeight: 'bold', color: '#c00' }}>
              ⚠ GUÍA ANULADA
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
