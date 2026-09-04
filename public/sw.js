// Service Worker — AGROCAR ERP
//
// v2: la v1 nunca se subió, así que los caches viejos jamás se limpiaban y las
// pantallas seguían sirviéndose de una versión anterior aunque el sistema ya
// estuviera actualizado. Pasó con la impresión de tickets: el ERP desplegado
// tenía el cambio y la PWA seguía abriendo el diálogo viejo.
//
// v3: volvió a pasar. Se desplegó el selector de comprobante en la venta
// directa y el repartidor seguía viendo la pantalla anterior, con boleta fija.
// Subir la versión no alcanzaba: el problema era la estrategia.
//
// Las pantallas se servían con "stale-while-revalidate" —primero la copia
// guardada, la nueva en segundo plano—, así que después de cada despliegue
// hacía falta abrir la aplicación DOS veces para ver el cambio. En un ERP eso
// no sirve: quien lo usa no sabe que está mirando algo viejo, y encima el HTML
// guardado apunta a piezas de código que ya no existen, que es de donde salen
// los errores de carga.
//
// Ahora las pantallas van a la red primero, con tres segundos de paciencia. Si
// hay señal, siempre se ve lo último. Si no la hay —el repartidor en la
// calle—, se sirve la copia guardada igual que antes. Se cambia la pregunta de
// "¿tengo algo guardado?" a "¿tengo señal?".
const CACHE_VERSION = 'agrocar-v3'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`
const PAGES_CACHE = `${CACHE_VERSION}-pages`

// Assets críticos a precachar al instalar
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/logo-agrocar.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
]

// ── Install: precarga assets críticos
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Precarga, pero tolera fallos individuales (no abortar todo si falta un asset)
      return Promise.all(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo precachar', url, err.message)
          }),
        ),
      )
    }),
  )
})

// ── Activate: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  )
})

// Helper para distinguir tipos de request
function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') ||
         url.pathname.startsWith('/icons/') ||
         url.pathname.endsWith('.png') ||
         url.pathname.endsWith('.svg') ||
         url.pathname.endsWith('.jpg') ||
         url.pathname.endsWith('.webp') ||
         url.pathname.endsWith('.woff2') ||
         url.pathname.endsWith('.css')
}

function isApiOrAuth(url) {
  return url.hostname.includes('supabase') ||
         url.pathname.startsWith('/api/') ||
         url.pathname.startsWith('/_next/data/')
}

/**
 * Pantallas que NUNCA deben salir del cache.
 *
 * Un comprobante es un documento fiscal: servirlo de una copia guardada puede
 * mostrar importes o correlativos que ya cambiaron, y encima deja al sistema
 * imprimiendo con código viejo. Siempre se piden a la red.
 */
function isSiempreFresca(url) {
  return url.pathname.startsWith('/comprobante/') ||
         url.pathname.startsWith('/boleta/') ||
         url.pathname.startsWith('/guia/') ||
         url.pathname.startsWith('/guia-remision/') ||
         url.pathname.startsWith('/rendicion/') ||
         url.pathname.startsWith('/hoja-ruta/')
}

function isHTMLPage(request) {
  return request.mode === 'navigate' ||
         (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
}

// ── Fetch: estrategia de caching
self.addEventListener('fetch', (event) => {
  const { request } = event
  // Solo cachear GET
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Saltarse chrome-extension u otros esquemas
  if (!url.protocol.startsWith('http')) return

  // Para llamadas a Supabase / API → NETWORK-ONLY (nunca cache, son dinámicos)
  // Esto evita que veas datos viejos sin saberlo.
  if (isApiOrAuth(url)) {
    return // Deja que el navegador maneje normal
  }

  // Documentos e impresión: siempre de la red, nunca del cache
  if (isSiempreFresca(url)) {
    return
  }

  // Para assets estáticos → CACHE-FIRST (rápidos, casi nunca cambian con el mismo hash)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone))
          }
          return response
        }).catch(() => cached)
      }),
    )
    return
  }

  // Para páginas HTML → RED PRIMERO, con la copia guardada como respaldo.
  //
  // Los tres segundos son el equilibrio: suficiente para una conexión de
  // mercado y poco para que alguien crea que la aplicación se colgó. Pasado
  // ese tiempo se sirve lo guardado, que es mejor que una pantalla en blanco.
  if (isHTMLPage(request)) {
    event.respondWith(
      caches.open(PAGES_CACHE).then(async (cache) => {
        const cached = await cache.match(request)

        const desdeLaRed = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        }).catch(() => null)

        const conPaciencia = cached
          ? Promise.race([
              desdeLaRed,
              new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
            ])
          : desdeLaRed

        const fresh = await conPaciencia
        if (fresh) return fresh
        if (cached) {
          // Se sirve lo guardado, pero se sigue bajando lo nuevo para la
          // próxima vez.
          event.waitUntil(desdeLaRed)
          return cached
        }
        return new Response(
          `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión · AGROCAR</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafafa;color:#111}
.box{max-width:380px;padding:24px;text-align:center}h1{font-size:18px;margin:8px 0}p{color:#666;font-size:13px}
button{margin-top:14px;padding:10px 18px;border:0;border-radius:8px;background:#FBE600;font-weight:600;cursor:pointer}</style></head>
<body><div class="box">
<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
<h1>Sin conexión</h1><p>No se pudo cargar esta página y no está disponible offline. Verifica tu internet y vuelve a intentar.</p>
<button onclick="location.reload()">Reintentar</button>
</div></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        )
      }),
    )
    return
  }

  // Cualquier otra cosa → network-first con fallback a cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request)),
  )
})

// Mensajes desde el cliente (ej. para forzar update)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
