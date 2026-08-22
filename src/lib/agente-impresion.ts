/**
 * Cliente del agente de impresión.
 *
 * El agente es un programa chico que corre en la misma computadora y le pasa
 * a la ticketera los comandos ESC/POS en crudo. Sin él, el navegador solo
 * puede imprimir por el driver de Windows, que rasteriza la página y decide el
 * corte por el tamaño de papel: de ahí el papel desperdiciado.
 *
 * Todo acá está pensado para que la ausencia del agente NO rompa nada: si no
 * está corriendo, quien llama se entera y cae al método de siempre. Nadie se
 * queda sin poder facturar porque un programa auxiliar esté apagado.
 */

const AGENTE_URL = 'http://127.0.0.1:9123'
const ESPERA_MS = 1500

/** Impresora elegida en esta computadora; se recuerda en el navegador. */
const CLAVE_IMPRESORA = 'agrocar.ticketera'

export type EstadoAgente = {
  disponible: boolean
  version?: string
  impresoras: string[]
}

/**
 * ¿Está el agente corriendo?
 *
 * Se consulta con un tiempo de espera corto: si no está, la respuesta tiene
 * que llegar rápido para caer al método normal sin que se note.
 */
export async function estadoAgente(): Promise<EstadoAgente> {
  try {
    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), ESPERA_MS)
    const r = await fetch(`${AGENTE_URL}/ping`, { signal: control.signal, cache: 'no-store' })
    clearTimeout(reloj)
    if (!r.ok) return { disponible: false, impresoras: [] }
    const d = await r.json()
    return {
      disponible: d?.ok === true,
      version: d?.version,
      impresoras: Array.isArray(d?.impresoras) ? d.impresoras : [],
    }
  } catch {
    // Agente apagado, puerto ocupado o navegador bloqueando: da igual el
    // motivo, el resultado es el mismo y se imprime como siempre.
    return { disponible: false, impresoras: [] }
  }
}

/** Impresora guardada para esta computadora. */
export function impresoraElegida(): string | null {
  try {
    return localStorage.getItem(CLAVE_IMPRESORA)
  } catch {
    return null
  }
}

export function guardarImpresora(nombre: string) {
  try {
    localStorage.setItem(CLAVE_IMPRESORA, nombre)
  } catch {
    /* modo privado o almacenamiento bloqueado */
  }
}

/**
 * Adivina cuál de las impresoras instaladas es la ticketera.
 *
 * Los nombres típicos traen POS, 80mm, thermal o receipt. Si no hay ninguna
 * evidente devuelve null y la pantalla pide elegirla a mano una vez.
 */
export function adivinarTicketera(impresoras: string[]): string | null {
  const pistas = ['pos-80', 'pos80', 'pos ', 'thermal', 'termica', 'receipt', 'ticket', '80mm']
  for (const n of impresoras) {
    const bajo = n.toLowerCase()
    if (pistas.some((p) => bajo.includes(p))) return n
  }
  return null
}

export type ResultadoImpresion =
  | { ok: true; bytes: number }
  | { ok: false; motivo: 'sin-agente' | 'error'; detalle?: string }

/**
 * Manda un ticket ya armado en ESC/POS.
 *
 * `base64` son los bytes del ticket; `impresora` puede omitirse y el agente
 * elige la que parezca ticketera.
 */
export async function imprimirEscPos(base64: string, impresora?: string | null): Promise<ResultadoImpresion> {
  try {
    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), 15000)
    const r = await fetch(`${AGENTE_URL}/imprimir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ impresora: impresora ?? '', base64 }),
      signal: control.signal,
    })
    clearTimeout(reloj)
    const d = await r.json().catch(() => null)
    if (r.ok && d?.ok) return { ok: true, bytes: Number(d.bytes ?? 0) }
    return { ok: false, motivo: 'error', detalle: d?.error ?? `HTTP ${r.status}` }
  } catch (e: any) {
    // Si el agente no está, el fetch falla por conexión rechazada
    if (e?.name === 'AbortError') return { ok: false, motivo: 'error', detalle: 'la impresora no respondió' }
    return { ok: false, motivo: 'sin-agente' }
  }
}
