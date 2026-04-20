/**
 * Helpers de ubigeo peruano usando el paquete `ubigeo` (npm).
 *
 * Estructura interna:
 * - regions.json: [{ region: "01 Amazonas", provincies: [{ code: "01", provincie: "Chachapoyas" }, ...] }]
 * - districts.json: [{ provincie: "01 Amazonas - 01 Chachapoyas", districts: [{ code: "01", name: "Chachapoyas" }, ...] }]
 */

import regionsData from 'ubigeo/dist/regions.json'
import districtsData from 'ubigeo/dist/districts.json'

export interface Departamento {
  codigo: string // "01", "02", ..., "25"
  nombre: string // "Amazonas", "Áncash", ...
}

export interface Provincia {
  codigo: string // Código de provincia dentro del departamento: "01", "02", ...
  nombre: string
  departamentoCodigo: string
}

export interface Distrito {
  codigo: string // Código de distrito dentro de la provincia
  nombre: string
  provinciaCodigo: string
  departamentoCodigo: string
  ubigeo: string // Concatenación completa: dep+prov+dist → ej. "150101" (Lima - Lima - Lima)
}

interface RegionRaw { region: string; provincies: { code: string; provincie: string }[] }
interface DistrictGroupRaw { provincie: string; districts: { code: string; name: string }[] }

const regions = regionsData as RegionRaw[]
const districts = districtsData as DistrictGroupRaw[]

function parseRegion(r: string): { codigo: string; nombre: string } {
  const [codigo, ...nombre] = r.split(' ')
  return { codigo, nombre: nombre.join(' ') }
}

function parseProvincieKey(key: string): { depCodigo: string; provCodigo: string } {
  // formato: "01 Amazonas - 01 Chachapoyas"
  const [left, right] = key.split(' - ')
  const [depCodigo] = left.split(' ')
  const [provCodigo] = right.split(' ')
  return { depCodigo, provCodigo }
}

export function getDepartamentos(): Departamento[] {
  return regions
    .map((r) => parseRegion(r.region))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function getProvincias(depCodigo: string): Provincia[] {
  const r = regions.find((r) => r.region.startsWith(depCodigo + ' '))
  if (!r) return []
  return r.provincies
    .map((p) => ({
      codigo: p.code,
      nombre: p.provincie,
      departamentoCodigo: depCodigo,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function getDistritos(depCodigo: string, provCodigo: string): Distrito[] {
  const group = districts.find((g) => {
    const { depCodigo: d, provCodigo: p } = parseProvincieKey(g.provincie)
    return d === depCodigo && p === provCodigo
  })
  if (!group) return []
  return group.districts
    .map((d) => ({
      codigo: d.code,
      nombre: d.name,
      provinciaCodigo: provCodigo,
      departamentoCodigo: depCodigo,
      ubigeo: `${depCodigo}${provCodigo}${d.code}`,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function findUbigeo(ubigeo: string): { departamento: string; provincia: string; distrito: string } | null {
  if (!ubigeo || ubigeo.length !== 6) return null
  const depCodigo = ubigeo.slice(0, 2)
  const provCodigo = ubigeo.slice(2, 4)
  const distCodigo = ubigeo.slice(4, 6)
  const dep = getDepartamentos().find((d) => d.codigo === depCodigo)
  if (!dep) return null
  const prov = getProvincias(depCodigo).find((p) => p.codigo === provCodigo)
  if (!prov) return null
  const dist = getDistritos(depCodigo, provCodigo).find((d) => d.codigo === distCodigo)
  if (!dist) return null
  return {
    departamento: dep.nombre,
    provincia: prov.nombre,
    distrito: dist.nombre,
  }
}
