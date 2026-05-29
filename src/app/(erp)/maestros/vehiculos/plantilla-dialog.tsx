'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Calendar, MapPin, Trash2, Plus } from 'lucide-react'

const DIAS = [
  { key: 'lun', label: 'L' },
  { key: 'mar', label: 'M' },
  { key: 'mie', label: 'M' },
  { key: 'jue', label: 'J' },
  { key: 'vie', label: 'V' },
  { key: 'sab', label: 'S' },
  { key: 'dom', label: 'D' },
] as const

type Zona = { id: string; nombre: string }
type PlantillaItem = {
  id?: string
  zona_id: string
  zona_nombre: string
  dias_semana: string[]
}

export default function PlantillaDialog({
  vehiculoId,
  vehiculoPlaca,
  open,
  onOpenChange,
}: {
  vehiculoId: string | null
  vehiculoPlaca: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [zonas, setZonas] = useState<Zona[]>([])
  const [items, setItems] = useState<PlantillaItem[]>([])

  const cargar = useCallback(async () => {
    if (!vehiculoId) return
    setLoading(true)
    const [{ data: zonasRaw }, { data: vzhRaw }] = await Promise.all([
      supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      (supabase as any)
        .from('vehiculos_zonas_habituales')
        .select('id, zona_id, dias_semana, zonas(nombre)')
        .eq('vehiculo_id', vehiculoId),
    ])
    setZonas((zonasRaw ?? []) as Zona[])
    setItems(
      (vzhRaw ?? []).map((r: any) => ({
        id: r.id,
        zona_id: r.zona_id,
        zona_nombre: r.zonas?.nombre ?? '—',
        dias_semana: r.dias_semana ?? [],
      })),
    )
    setLoading(false)
  }, [supabase, vehiculoId])

  useEffect(() => {
    if (open && vehiculoId) cargar()
  }, [open, vehiculoId, cargar])

  function agregarZona(zonaId: string) {
    const z = zonas.find((zo) => zo.id === zonaId)
    if (!z) return
    if (items.some((it) => it.zona_id === zonaId)) {
      toast.error('Esta zona ya está en la plantilla')
      return
    }
    setItems((prev) => [...prev, { zona_id: zonaId, zona_nombre: z.nombre, dias_semana: [] }])
  }

  function toggleDia(zonaId: string, dia: string) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.zona_id !== zonaId) return it
        const tiene = it.dias_semana.includes(dia)
        return {
          ...it,
          dias_semana: tiene ? it.dias_semana.filter((d) => d !== dia) : [...it.dias_semana, dia],
        }
      }),
    )
  }

  function eliminar(zonaId: string) {
    setItems((prev) => prev.filter((it) => it.zona_id !== zonaId))
  }

  async function guardar() {
    if (!vehiculoId) return
    setSaving(true)
    try {
      // Estrategia simple: borrar todo lo del vehículo y reinsertar.
      // Volumen máximo esperado ~20 zonas por vehículo, no es problema.
      const { error: eDel } = await (supabase as any)
        .from('vehiculos_zonas_habituales')
        .delete()
        .eq('vehiculo_id', vehiculoId)
      if (eDel) throw eDel

      const itemsAGuardar = items.filter((it) => it.dias_semana.length > 0)
      if (itemsAGuardar.length > 0) {
        const { error: eIns } = await (supabase as any).from('vehiculos_zonas_habituales').insert(
          itemsAGuardar.map((it) => ({
            vehiculo_id: vehiculoId,
            zona_id: it.zona_id,
            dias_semana: it.dias_semana,
          })),
        )
        if (eIns) throw eIns
      }

      toast.success('Plantilla guardada', {
        description: `${itemsAGuardar.length} zonas configuradas para ${vehiculoPlaca}.`,
      })
      onOpenChange(false)
    } catch (err: any) {
      toast.error('No se pudo guardar la plantilla', { description: err?.message ?? 'Error desconocido' })
    } finally {
      setSaving(false)
    }
  }

  const zonasDisponibles = zonas.filter((z) => !items.some((it) => it.zona_id === z.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-500" />
            Plantilla de ruta — {vehiculoPlaca}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
              Cuando un pedido pertenece a una zona configurada aquí, se pre-asigna automáticamente a este vehículo
              en el día indicado. El operador no necesita conocer direcciones.
            </div>

            {/* Agregar zona */}
            {zonasDisponibles.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      agregarZona(e.target.value)
                      e.target.value = ''
                    }
                  }}
                  className="h-9 px-3 border border-gray-300 rounded-md text-sm flex-1 bg-white"
                  defaultValue=""
                >
                  <option value="" disabled>+ Añadir zona…</option>
                  {zonasDisponibles.map((z) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Lista de zonas configuradas */}
            {items.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-400 text-sm">
                <MapPin className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                Sin zonas habituales. Añade una zona para empezar.
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it) => (
                  <div key={it.zona_id} className="border border-gray-200 rounded-lg p-3 bg-gray-50/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        <span className="font-medium text-sm text-gray-800 truncate">{it.zona_nombre}</span>
                        {it.dias_semana.length === 0 && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">Sin días</Badge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => eliminar(it.zona_id)}
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      {DIAS.map((d) => {
                        const activo = it.dias_semana.includes(d.key)
                        return (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => toggleDia(it.zona_id, d.key)}
                            className={`w-8 h-8 rounded-md text-xs font-bold transition-colors ${
                              activo
                                ? 'bg-amber-400 text-black border-2 border-amber-500'
                                : 'bg-white text-gray-400 border border-gray-200 hover:bg-gray-100'
                            }`}
                            title={d.key}
                          >
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={guardar}
                disabled={saving}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Guardar plantilla
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
