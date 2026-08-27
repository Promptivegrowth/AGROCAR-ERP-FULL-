/**
 * El monto en letras que SUNAT exige en `cbc:Note languageLocaleID="1000"`.
 *
 * "MIL TRESCIENTOS CUARENTA Y TRES CON 25/100 SOLES". Los centavos van en
 * números sobre 100 y no en letras: así lo pide la guía y así los imprime
 * cualquier comprobante peruano.
 */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']

const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']

const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function hasta999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c])
  if (r > 0) {
    if (r < 30) partes.push(UNIDADES[r])
    else {
      const d = Math.floor(r / 10)
      const u = r % 10
      partes.push(u > 0 ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d])
    }
  }
  return partes.join(' ')
}

export function montoEnLetras(monto: number, moneda = 'PEN'): string {
  const nombre = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES'
  const entero = Math.floor(Math.abs(monto))
  const centavos = Math.round((Math.abs(monto) - entero) * 100)

  let texto: string
  if (entero === 0) texto = 'CERO'
  else {
    const millones = Math.floor(entero / 1000000)
    const miles = Math.floor((entero % 1000000) / 1000)
    const resto = entero % 1000
    const partes: string[] = []
    if (millones > 0) partes.push(millones === 1 ? 'UN MILLON' : `${hasta999(millones)} MILLONES`)
    if (miles > 0) partes.push(miles === 1 ? 'MIL' : `${hasta999(miles)} MIL`)
    if (resto > 0) partes.push(hasta999(resto))
    texto = partes.join(' ')
  }

  return `${texto} CON ${String(centavos).padStart(2, '0')}/100 ${nombre}`
}
