import QRCode from 'qrcode'

/**
 * QR del comprobante como data URI, generado en el servidor.
 *
 * Antes se pedía a api.qrserver.com. SUNAT exige el QR en la representación
 * impresa, así que dejar ese dato en manos de una web ajena significa que si
 * esa web se cae —o si en el local se corta el internet mientras el sistema
 * sigue andando— los comprobantes salen sin QR y mal emitidos. Además cada
 * ticket hacía una descarga extra antes de poder imprimir.
 *
 * Se genera acá, sin salir a internet, y viaja incrustado en el HTML.
 */
export async function qrDataUri(contenido: string, tamanoPx = 150): Promise<string> {
  try {
    return await QRCode.toDataURL(contenido, {
      width: tamanoPx,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
  } catch {
    // Un QR ilegible es preferible a romper la emisión del comprobante
    return ''
  }
}
