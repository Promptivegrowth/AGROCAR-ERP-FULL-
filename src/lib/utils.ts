import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = 'PEN'): string {
  if (currency === 'PEN') {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: 'PEN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formatea una fecha en zona horaria de Lima (UTC-5).
 *
 * Para strings tipo 'YYYY-MM-DD' (columnas DATE), se interpreta con T12:00:00
 * Lima para evitar desplazamientos. Para timestamptz se respeta el momento real
 * pero se formatea en zona Lima.
 *
 * Antes este helper no tenía timeZone y en Vercel (UTC) formateaba con la
 * zona del servidor, mostrando día siguiente entre 19:00-23:59 hora Lima.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string'
    ? (/^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00-05:00') : new Date(date))
    : date
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(d)
}

export function formatDatetime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(d)
}

/**
 * Convierte un número a palabras en español (soles).
 * Soporta hasta 999,999,999.99. Devuelve la frase SIN el sufijo "SOLES".
 * Ejemplo: 1234.56 => "MIL DOSCIENTOS TREINTA Y CUATRO CON 56/100"
 */
export function numeroALetras(n: number): string {
  if (!isFinite(n) || n < 0) return 'CERO CON 00/100'
  const entero = Math.floor(n)
  const decimales = Math.round((n - entero) * 100)
  const dec = decimales.toString().padStart(2, '0')

  const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
  const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
  const decenas = ['', '', 'VEINTI', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

  function menosDeCien(num: number): string {
    if (num < 10) return unidades[num]
    if (num < 20) return especiales[num - 10]
    if (num < 30) {
      if (num === 20) return 'VEINTE'
      return 'VEINTI' + unidades[num - 20].toLowerCase().toUpperCase()
    }
    const d = Math.floor(num / 10)
    const u = num % 10
    if (u === 0) return decenas[d]
    return decenas[d] + ' Y ' + unidades[u]
  }

  function menosDeMil(num: number): string {
    if (num === 0) return ''
    if (num === 100) return 'CIEN'
    const c = Math.floor(num / 100)
    const resto = num % 100
    const pref = c > 0 ? centenas[c] : ''
    const suf = resto > 0 ? menosDeCien(resto) : ''
    return (pref + (pref && suf ? ' ' : '') + suf).trim()
  }

  function convertir(num: number): string {
    if (num === 0) return 'CERO'
    const millones = Math.floor(num / 1_000_000)
    const miles = Math.floor((num % 1_000_000) / 1000)
    const resto = num % 1000

    let out = ''
    if (millones > 0) {
      out += (millones === 1 ? 'UN MILLON' : menosDeMil(millones) + ' MILLONES')
    }
    if (miles > 0) {
      if (out) out += ' '
      out += (miles === 1 ? 'MIL' : menosDeMil(miles) + ' MIL')
    }
    if (resto > 0) {
      if (out) out += ' '
      out += menosDeMil(resto)
    }
    return out.trim()
  }

  return `${convertir(entero)} CON ${dec}/100`
}

export const ROLES_LABELS: Record<string, string> = {
  gerente: 'Gerente',
  administrador: 'Administrador',
  facturador: 'Facturador',
  almacenero: 'Almacenero',
  vendedor: 'Vendedor',
  repartidor: 'Repartidor',
  contador: 'Contador',
}

export const ESTADO_CLIENTE_COLORS: Record<string, string> = {
  activo: 'success',
  inactivo: 'secondary',
  deudor: 'warning',
  de_baja: 'destructive',
}
