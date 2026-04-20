'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export interface RucData {
  ruc: string
  razonSocial: string
  nombreComercial?: string | null
  estado?: string | null
  condicion?: string | null
  direccion?: string | null
  direccionCompleta?: string | null
  ubigeo?: string | null
  departamento?: string | null
  provincia?: string | null
  distrito?: string | null
  viaTipo?: string | null
  viaNombre?: string | null
  numero?: string | null
  esAgenteRetencion?: boolean | null
  esBuenContribuyente?: boolean | null
}

export interface DniData {
  dni: string
  nombres: string
  apellidoPaterno?: string | null
  apellidoMaterno?: string | null
  nombreCompleto: string
}

export interface GeocodeData {
  lat: number
  lng: number
  displayName: string
  confianza: 'alta' | 'media' | 'baja'
}

export function useSunatReniec() {
  const [loading, setLoading] = useState(false)

  async function consultarRuc(ruc: string): Promise<RucData | null> {
    if (!/^\d{11}$/.test(ruc)) {
      toast.error('RUC inválido', { description: 'Debe tener exactamente 11 dígitos.' })
      return null
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/consulta/ruc?numero=${ruc}`)
      const data = await res.json()
      if (!res.ok) {
        toast.error('No se pudo consultar SUNAT', { description: data.error ?? 'Intenta de nuevo.' })
        return null
      }
      const estadoTag = [data.estado, data.condicion].filter(Boolean).join(' · ')
      toast.success(data.razonSocial, {
        description: estadoTag
          ? `${estadoTag}${data.distrito ? ' · ' + data.distrito : ''}`
          : 'Datos obtenidos de SUNAT',
      })
      return data as RucData
    } catch (err: any) {
      toast.error('Error de conexión', { description: err?.message ?? 'Verifica tu internet.' })
      return null
    } finally {
      setLoading(false)
    }
  }

  async function consultarDni(dni: string): Promise<DniData | null> {
    if (!/^\d{8}$/.test(dni)) {
      toast.error('DNI inválido', { description: 'Debe tener exactamente 8 dígitos.' })
      return null
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/consulta/dni?numero=${dni}`)
      const data = await res.json()
      if (!res.ok) {
        toast.error('No se pudo consultar RENIEC', { description: data.error ?? 'Intenta de nuevo.' })
        return null
      }
      toast.success('Datos obtenidos de RENIEC', { description: data.nombreCompleto })
      return data as DniData
    } catch (err: any) {
      toast.error('Error de conexión', { description: err?.message ?? 'Verifica tu internet.' })
      return null
    } finally {
      setLoading(false)
    }
  }

  async function geocodificar(params: {
    direccion?: string | null
    distrito?: string | null
    provincia?: string | null
    departamento?: string | null
  }): Promise<GeocodeData | null> {
    const qs = new URLSearchParams()
    if (params.direccion) qs.set('direccion', params.direccion)
    if (params.distrito) qs.set('distrito', params.distrito)
    if (params.provincia) qs.set('provincia', params.provincia)
    if (params.departamento) qs.set('departamento', params.departamento)
    if (!qs.toString()) return null
    try {
      const res = await fetch(`/api/geocode?${qs.toString()}`)
      if (!res.ok) return null
      return (await res.json()) as GeocodeData
    } catch {
      return null
    }
  }

  return { consultarRuc, consultarDni, geocodificar, loading }
}
