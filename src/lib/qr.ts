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

/**
 * Cuántos módulos por lado tiene el QR de este contenido.
 *
 * La impresora elige la versión del código según cuántos datos entren, y de
 * ahí sale su tamaño físico. Para que la vista en pantalla mida lo mismo que
 * el papel hay que hacer la misma cuenta con los mismos datos.
 */
export function modulosQr(contenido: string): number {
  try {
    return QRCode.create(contenido, { errorCorrectionLevel: 'M' }).modules.size
  } catch {
    // 41 módulos es lo que da un comprobante típico; sirve de referencia si
    // el cálculo falla, y solo afecta al dibujo en pantalla.
    return 41
  }
}

/**
 * Tamaño de módulo que hace falta para cumplir el mínimo de SUNAT.
 *
 * SUNAT exige que el QR de la representación impresa mida al menos 2 cm de
 * lado. Cuántos módulos tiene el código depende de los datos del comprobante
 * —uno con nombre corto genera un QR más chico—, así que un tamaño fijo puede
 * cumplir en unos comprobantes y no en otros. Acá se busca el módulo más chico
 * que llega a los 2 cm: se cumple siempre y no se gasta papel de más.
 */
export function moduloQrMinimo(contenido: string, minimoMm = 20): number {
  const PUNTO_MM = 25.4 / 203
  const modulos = modulosQr(contenido)
  const necesarios = Math.ceil(minimoMm / PUNTO_MM / modulos)
  return Math.max(2, Math.min(16, necesarios))
}
