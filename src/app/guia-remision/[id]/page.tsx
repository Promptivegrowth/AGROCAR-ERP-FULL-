import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import PrintButton from './print-button'
import { qrDataUri } from '@/lib/qr'

export const dynamic = 'force-dynamic'

function pad(n: string | number, len: number) {
  return String(n).padStart(len, '0')
}

type ItemAgregado = {
  codigo: string
  nombre: string
  cantidad: number
}

export default async function GuiaRemisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: despacho } = await supabase
    .from('despachos')
    .select(`
      id, numero, fecha_despacho, estado, notas, created_at,
      vehiculos(placa, descripcion),
      profiles!despachos_conductor_id_fkey(full_name),
      despachos_items(
        id, pedido_id,
        pedidos(
          id, numero, total,
          clientes(id, razon_social, ruc, dni, direccion, telefono)
        )
      )
    `)
    .eq('id', id)
    .single()

  if (!despacho) notFound()

  const items: any[] = (despacho as any).despachos_items ?? []
  const pedidoIds: string[] = items.map((it) => it.pedido_id).filter(Boolean)

  // Agregar items de todos los pedidos
  const agregados = new Map<string, ItemAgregado>()
  if (pedidoIds.length > 0) {
    const { data: pedItems } = await supabase
      .from('pedidos_items')
      .select('cantidad, productos(codigo, nombre, descripcion)')
      .in('pedido_id', pedidoIds)
    for (const pi of pedItems ?? []) {
      const p: any = (pi as any).productos
      if (!p) continue
      const nombreProducto = p.descripcion?.trim() || p.nombre || '—'
      const key = p.codigo ?? nombreProducto
      const prev = agregados.get(key)
      const cant = Number((pi as any).cantidad ?? 0)
      if (prev) prev.cantidad += cant
      else agregados.set(key, { codigo: p.codigo ?? '—', nombre: nombreProducto, cantidad: cant })
    }
  }
  const itemsAgregados = Array.from(agregados.values())

  const clientes: any[] = items.map((it) => it.pedidos?.clientes).filter(Boolean)
  const primerCliente = clientes[0]
  const destinatarios = clientes.map((c) => `${c.razon_social} (${c.ruc ?? c.dni ?? 's/d'})`).join(' · ')

  const correlativo = `T001-${pad(despacho.numero.replace(/\D/g, '') || '0', 8)}`
  const fechaEmision = new Date(despacho.created_at).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Lima',
  })
  const fechaInicio = new Date(despacho.fecha_despacho).toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  })

  const vehiculo: any = (despacho as any).vehiculos
  const conductor: any = (despacho as any).profiles

  // Placeholders (los datos de licencia no están en DB)
  const conductorNombre = conductor?.full_name ?? 'VALERIO AGUILAR JARRO'
  const conductorDni = '40389487'
  const conductorLic = 'K40389487'

  const qrData = `AGROCAR|20519883296|09|${correlativo}|${despacho.fecha_despacho}`
  // QR generado en el servidor, sin depender de una web externa
  const qrUrl = await qrDataUri(qrData, 120)

  return (
    <div className="min-h-dvh bg-gray-100 py-6 px-3 print:bg-white print:py-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { margin: 0; }
        }
      `}</style>

      <div className="mx-auto bg-white shadow print:shadow-none" style={{ maxWidth: 900, padding: 28, fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#000' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-agrocar.png" alt="AGROCAR" style={{ height: 70, objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 'bold', letterSpacing: 0.5 }}>AGROCAR S.R.L.</div>
              <div style={{ fontSize: 10, color: '#333' }}>
                CALLE EMILIO FORERO 553-A PARA GRANDE - TACNA
                <br />
                FUNDO PARA GRANDE PARCELA 31 SUB LT 1 - TACNA
                <br />
                TELEFONO: 952901119
              </div>
            </div>
          </div>
          <div style={{ border: '2px solid #000', padding: '10px 16px', textAlign: 'center', minWidth: 240 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12 }}>RUC N° 20519883296</div>
            <div style={{ fontWeight: 'bold', fontSize: 12, marginTop: 4 }}>
              GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE
            </div>
            <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 6 }}>N° {correlativo}</div>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR" style={{ width: 100, height: 100 }} />
          <div style={{ flex: 1, fontSize: 11 }}>
            <div><strong>Fecha y hora de emisión:</strong> {fechaEmision}</div>
            <div><strong>Fecha de inicio de Traslado:</strong> {fechaInicio}</div>
            <div><strong>Motivo de Traslado:</strong> Venta</div>
            <div><strong>Punto de Partida:</strong> CALLE EMILIO FORERO 553-A PARA GRANDE - TACNA</div>
            <div>
              <strong>Punto de llegada:</strong>{' '}
              {primerCliente?.direccion ?? 'Dirección del destinatario'}
              {clientes.length > 1 ? ` y ${clientes.length - 1} destino(s) adicional(es)` : ''}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid #000', paddingTop: 8 }}>
          <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>Datos del Destinatario:</div>
          {primerCliente ? (
            <div>
              {primerCliente.razon_social} —{' '}
              {primerCliente.ruc
                ? `REGISTRO ÚNICO DE CONTRIBUYENTES N° ${primerCliente.ruc}`
                : `DOCUMENTO NACIONAL DE IDENTIDAD N° ${primerCliente.dni ?? '—'}`}
            </div>
          ) : (
            <div>—</div>
          )}
          {clientes.length > 1 && (
            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
              Destinatarios incluidos: {destinatarios}
            </div>
          )}
        </div>

        {/* Tabla bienes */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 4 }}>Bienes por transportar:</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                {['N°', 'Bien normalizado', 'Código Bien', 'Código SUNAT', 'Partida arancelaria', 'Código GTIN', 'Descripción', 'UM', 'Cantidad'].map((h) => (
                  <th key={h} style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemsAgregados.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', color: '#777' }}>
                    Sin items
                  </td>
                </tr>
              ) : (
                itemsAgregados.map((it, i) => (
                  <tr key={it.codigo + i}>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>{i + 1}</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>NO</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>{it.codigo}</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>—</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>—</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>—</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>{it.nombre}</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px' }}>UNIDAD</td>
                    <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>{it.cantidad.toFixed(0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 11 }}>
          <div><strong>Indicador de traslado total de la DAM o DS (*):</strong> NO</div>
          <div><strong>Unidad de Medida del Peso Bruto:</strong> KGM</div>
          <div><strong>Peso Bruto total de la carga:</strong> {vehiculo?.capacidad_kg ? `${vehiculo.capacidad_kg}` : '0'}</div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid #000', paddingTop: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Datos del traslado:</div>
          <div>Modalidad de Traslado: Privado</div>
          <div>Indicador de transbordo programado: NO</div>
          <div>Indicador de traslado en vehículos de categoría M1 o L: NO</div>
          <div>Indicador de retorno de vehículo con envases o embalajes vacíos: NO</div>
          <div>Indicador de retorno de vehículo vacío: NO</div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid #000', paddingTop: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Datos de los vehículos:</div>
          <div>Principal: Número de placa: <strong>{vehiculo?.placa ?? '—'}</strong></div>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid #000', paddingTop: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Datos de los conductores:</div>
          <div>
            Principal: {conductorNombre} — DOCUMENTO NACIONAL DE IDENTIDAD N° {conductorDni}
          </div>
          <div>Número de licencia de conducir: {conductorLic}</div>
        </div>

        <div style={{ marginTop: 20, fontSize: 9, color: '#555', textAlign: 'center', borderTop: '1px dashed #999', paddingTop: 8 }}>
          Esta es una representación impresa sin valor tributario de la Guía de Remisión Electrónica
          generada en el sistema de la SUNAT. Puede verificarla utilizando su clave SOL.
        </div>
      </div>

      <div className="mx-auto mt-4 text-center print:hidden" style={{ maxWidth: 900 }}>
        <PrintButton />
      </div>
    </div>
  )
}
