import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EMPRESA } from '@/lib/empresa'

export const dynamic = 'force-dynamic'

/**
 * Descargar el XML firmado o la constancia de SUNAT (CDR) de un documento.
 *
 * Daniel: "para poder enviar los documentos en PDF y XML, ¿cómo se realiza?".
 * El PDF sale de la página de impresión (Imprimir / Guardar como PDF); el XML
 * y la constancia salen de acá, para mandárselos al cliente.
 *
 * Se abre con el identificador del documento, igual que la página de impresión
 * —que ya se comparte por WhatsApp—: quien tiene el enlace del comprobante
 * puede bajar su XML. No expone nada que el impreso no muestre.
 *
 *   /api/documentos/comprobante/<id>/xml
 *   /api/documentos/comprobante/<id>/cdr
 *   /api/documentos/guia/<id>/xml
 *   /api/documentos/guia/<id>/cdr
 */
const TIPO_SUNAT: Record<string, string> = { factura: '01', boleta: '03', nota_credito: '07' }

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tipo: string; id: string; archivo: string }> },
) {
  const { tipo, id, archivo } = await params
  if (!['comprobante', 'guia'].includes(tipo) || !['xml', 'cdr'].includes(archivo)) {
    return NextResponse.json({ error: 'No existe' }, { status: 404 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  const admin = createAdminClient() as any
  const tabla = tipo === 'guia' ? 'guias_remision' : 'comprobantes'
  const { data: d } = await admin.from(tabla)
    .select(tipo === 'guia' ? 'serie, numero, sunat_xml, sunat_cdr' : 'serie, numero, tipo, sunat_xml, sunat_cdr')
    .eq('id', id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'No existe' }, { status: 404 })

  const codigo = tipo === 'guia' ? '09' : (TIPO_SUNAT[d.tipo] ?? '00')
  const numero = String(d.numero).replace(/\D/g, '').padStart(8, '0')
  const base = `${EMPRESA.ruc}-${codigo}-${d.serie}-${numero}`

  if (archivo === 'xml') {
    if (!d.sunat_xml) {
      return NextResponse.json({ error: 'Este documento todavía no tiene XML firmado' }, { status: 404 })
    }
    return new NextResponse(d.sunat_xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.xml"`,
      },
    })
  }

  if (!d.sunat_cdr) {
    return NextResponse.json({ error: 'La constancia aparece cuando SUNAT acepta el documento' }, { status: 404 })
  }
  return new NextResponse(Buffer.from(d.sunat_cdr, 'base64'), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="R-${base}.zip"`,
    },
  })
}
