import type { UbigeoValue } from '@/components/ubigeo-selector'

interface UbigeoItem {
  codigo: string
  nombre: string
}

function norm(s: string): string {
  // Quita acentos/diacríticos usando rango Unicode combining marks (U+0300 – U+036F)
  // en vez de \p{Diacritic} para ser compatible con targets TS < ES2018.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

/**
 * Intenta hacer matching de departamento/provincia/distrito desde nombres (por ejemplo los
 * que devuelve el endpoint de consulta SUNAT). Devuelve un UbigeoValue listo para usar, o
 * null si no se pudo encontrar siquiera el departamento.
 *
 * El matching es case-insensitive y sin acentos. Si solo matchea departamento, devuelve
 * parcial; el usuario puede completar manualmente lo que falte.
 */
export async function matchUbigeoFromNombres(params: {
  departamento?: string | null
  provincia?: string | null
  distrito?: string | null
}): Promise<UbigeoValue | null> {
  const depNombre = params.departamento?.trim()
  if (!depNombre) return null

  const deps = await fetchJson<UbigeoItem[]>('/api/ubigeo/departamentos')
  if (!deps || !deps.length) return null

  const depNorm = norm(depNombre)
  const dep = deps.find((d) => norm(d.nombre) === depNorm)
  if (!dep) return null

  const result: UbigeoValue = {
    departamento_codigo: dep.codigo,
    departamento: dep.nombre,
    provincia_codigo: null,
    provincia: null,
    distrito_codigo: null,
    distrito: null,
    ubigeo: null,
  }

  const provNombre = params.provincia?.trim()
  if (!provNombre) return result

  const provs = await fetchJson<UbigeoItem[]>(`/api/ubigeo/provincias?dep=${dep.codigo}`)
  if (!provs || !provs.length) return result

  const provNorm = norm(provNombre)
  const prov = provs.find((p) => norm(p.nombre) === provNorm)
  if (!prov) return result

  result.provincia_codigo = prov.codigo
  result.provincia = prov.nombre

  const distNombre = params.distrito?.trim()
  if (!distNombre) return result

  const dists = await fetchJson<UbigeoItem[]>(`/api/ubigeo/distritos?dep=${dep.codigo}&prov=${prov.codigo}`)
  if (!dists || !dists.length) return result

  const distNorm = norm(distNombre)
  const dist = dists.find((d) => norm(d.nombre) === distNorm)
  if (!dist) return result

  result.distrito_codigo = dist.codigo
  result.distrito = dist.nombre
  result.ubigeo = `${dep.codigo}${prov.codigo}${dist.codigo}`

  return result
}
