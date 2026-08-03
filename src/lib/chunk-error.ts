/**
 * Detección y recuperación de errores por versión desactualizada.
 *
 * Next.js parte la aplicación en archivos con un hash en el nombre. Cuando se
 * publica una versión nueva mientras alguien tiene el sistema abierto, su
 * navegador sigue pidiendo los archivos de la versión anterior, que ya no
 * existen en el servidor, y la pantalla revienta con "Loading chunk failed".
 *
 * No es una falla del módulo: basta con recargar para tomar la versión nueva.
 */

const PATRONES = [
  /loading chunk \S+ failed/i,
  /chunkloaderror/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  // El navegador recibió el HTML del 404 donde esperaba un .js.
  // Chrome y Safari lo redactan distinto, por eso van los dos.
  /responded with a mime type of/i,
  /is not a valid javascript mime type/i,
  /failed to load module script/i,
]

/** ¿El error viene de una versión vieja cargada en el navegador? */
export function esErrorDeVersion(error: unknown): boolean {
  if (!error) return false
  const e = error as { message?: string; name?: string }
  const texto = `${e.name ?? ''} ${e.message ?? ''}`
  return PATRONES.some((re) => re.test(texto))
}

const CLAVE = 'agrocar:recarga-por-version'
/** Si ya recargamos hace menos de esto, no volvemos a intentar: sería un ciclo. */
const ESPERA_MS = 60_000

/**
 * Recarga para tomar la versión nueva, con un candado por tiempo: si acabamos
 * de recargar hace menos de un minuto y el error persiste, el problema es otro
 * y dejamos que la pantalla muestre el mensaje en vez de recargar sin fin.
 */
export function recargarPorVersion(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const ultimo = Number(sessionStorage.getItem(CLAVE) ?? 0)
    if (ultimo && Date.now() - ultimo < ESPERA_MS) return false
    sessionStorage.setItem(CLAVE, String(Date.now()))
  } catch {
    // Sin sessionStorage no hay forma de evitar el ciclo: mejor no recargar
    return false
  }
  window.location.reload()
  return true
}

/**
 * En el aplicativo hay service worker: además de recargar hay que soltar la
 * versión cacheada, si no el teléfono vuelve a servir la misma pantalla vieja.
 */
export async function recargarAplicativo(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const ultimo = Number(sessionStorage.getItem(CLAVE) ?? 0)
    if (ultimo && Date.now() - ultimo < ESPERA_MS) return false
    sessionStorage.setItem(CLAVE, String(Date.now()))
  } catch {
    return false
  }

  try {
    if ('caches' in window) {
      const nombres = await caches.keys()
      await Promise.all(nombres.map((n) => caches.delete(n)))
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    // Si no se pudo limpiar, igual recargamos: es mejor que quedarse trabado
  }

  window.location.reload()
  return true
}
