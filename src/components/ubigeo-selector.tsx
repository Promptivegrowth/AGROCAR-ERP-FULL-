'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface UbigeoItem {
  codigo: string
  nombre: string
}

export interface UbigeoValue {
  departamento_codigo: string | null
  departamento: string | null
  provincia_codigo: string | null
  provincia: string | null
  distrito_codigo: string | null
  distrito: string | null
  ubigeo: string | null // 6 dígitos: dep+prov+dist
}

interface Props {
  value: UbigeoValue
  onChange: (value: UbigeoValue) => void
  /** Mostrar labels arriba de cada select. Default true. */
  showLabels?: boolean
  /** Obligatorio (muestra asterisco). */
  required?: boolean
  /** Layout: "columns" (3 en fila en desktop) o "stacked". Default "columns". */
  layout?: 'columns' | 'stacked'
  className?: string
}

const EMPTY: UbigeoValue = {
  departamento_codigo: null,
  departamento: null,
  provincia_codigo: null,
  provincia: null,
  distrito_codigo: null,
  distrito: null,
  ubigeo: null,
}

export default function UbigeoSelector({
  value,
  onChange,
  showLabels = true,
  required = false,
  layout = 'columns',
  className = '',
}: Props) {
  const [departamentos, setDepartamentos] = useState<UbigeoItem[]>([])
  const [provincias, setProvincias] = useState<UbigeoItem[]>([])
  const [distritos, setDistritos] = useState<UbigeoItem[]>([])
  const [loadingDep, setLoadingDep] = useState(false)
  const [loadingProv, setLoadingProv] = useState(false)
  const [loadingDist, setLoadingDist] = useState(false)

  // Cargar departamentos al inicio
  useEffect(() => {
    setLoadingDep(true)
    fetch('/api/ubigeo/departamentos')
      .then((r) => r.json())
      .then((d) => setDepartamentos(d))
      .catch(() => setDepartamentos([]))
      .finally(() => setLoadingDep(false))
  }, [])

  // Cargar provincias cuando cambia departamento
  useEffect(() => {
    if (!value.departamento_codigo) {
      setProvincias([])
      return
    }
    setLoadingProv(true)
    fetch(`/api/ubigeo/provincias?dep=${value.departamento_codigo}`)
      .then((r) => r.json())
      .then((d) => setProvincias(Array.isArray(d) ? d : []))
      .catch(() => setProvincias([]))
      .finally(() => setLoadingProv(false))
  }, [value.departamento_codigo])

  // Cargar distritos cuando cambia provincia
  useEffect(() => {
    if (!value.departamento_codigo || !value.provincia_codigo) {
      setDistritos([])
      return
    }
    setLoadingDist(true)
    fetch(`/api/ubigeo/distritos?dep=${value.departamento_codigo}&prov=${value.provincia_codigo}`)
      .then((r) => r.json())
      .then((d) => setDistritos(Array.isArray(d) ? d : []))
      .catch(() => setDistritos([]))
      .finally(() => setLoadingDist(false))
  }, [value.departamento_codigo, value.provincia_codigo])

  const handleDepChange = (depCodigo: string) => {
    const dep = departamentos.find((d) => d.codigo === depCodigo)
    onChange({
      ...EMPTY,
      departamento_codigo: depCodigo,
      departamento: dep?.nombre ?? null,
    })
  }

  const handleProvChange = (provCodigo: string) => {
    const prov = provincias.find((p) => p.codigo === provCodigo)
    onChange({
      ...value,
      provincia_codigo: provCodigo,
      provincia: prov?.nombre ?? null,
      distrito_codigo: null,
      distrito: null,
      ubigeo: null,
    })
  }

  const handleDistChange = (distCodigo: string) => {
    const dist = distritos.find((d) => d.codigo === distCodigo)
    onChange({
      ...value,
      distrito_codigo: distCodigo,
      distrito: dist?.nombre ?? null,
      ubigeo: value.departamento_codigo && value.provincia_codigo && distCodigo
        ? `${value.departamento_codigo}${value.provincia_codigo}${distCodigo}`
        : null,
    })
  }

  const gridClass = layout === 'columns'
    ? 'grid grid-cols-1 sm:grid-cols-3 gap-3'
    : 'space-y-3'

  const ast = required ? ' *' : ''

  return (
    <div className={`${gridClass} ${className}`}>
      <div>
        {showLabels && <Label className="text-xs">Departamento{ast}</Label>}
        <Select value={value.departamento_codigo ?? ''} onValueChange={handleDepChange} disabled={loadingDep}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder={loadingDep ? 'Cargando...' : 'Seleccionar'} />
          </SelectTrigger>
          <SelectContent>
            {departamentos.map((d) => (
              <SelectItem key={d.codigo} value={d.codigo}>{d.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        {showLabels && <Label className="text-xs">Provincia{ast}</Label>}
        <Select
          value={value.provincia_codigo ?? ''}
          onValueChange={handleProvChange}
          disabled={!value.departamento_codigo || loadingProv}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder={loadingProv ? 'Cargando...' : 'Seleccionar'} />
          </SelectTrigger>
          <SelectContent>
            {provincias.map((p) => (
              <SelectItem key={p.codigo} value={p.codigo}>{p.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        {showLabels && <Label className="text-xs">Distrito{ast}</Label>}
        <Select
          value={value.distrito_codigo ?? ''}
          onValueChange={handleDistChange}
          disabled={!value.provincia_codigo || loadingDist}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder={loadingDist ? 'Cargando...' : 'Seleccionar'} />
          </SelectTrigger>
          <SelectContent>
            {distritos.map((d) => (
              <SelectItem key={d.codigo} value={d.codigo}>{d.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(loadingDep || loadingProv || loadingDist) && (
        <div className="col-span-full text-xs text-gray-400 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Cargando ubigeo...
        </div>
      )}
    </div>
  )
}

export { EMPTY as UBIGEO_EMPTY }
