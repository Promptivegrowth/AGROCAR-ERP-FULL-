'use client'

/**
 * ¿El usuario puede registrar una venta "sin IGV"?
 *
 * Daniel, 07/11/2026: los vendedores y repartidores no deben tocar el IGV;
 * solo gerencia y administración. Un pedido "sin IGV" de la PWA terminó en la
 * boleta B002-1692 rechazada por SUNAT. La base lo hace cumplir igual
 * (migración 157); esto solo esconde el interruptor a quien no puede usarlo.
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export const ROLES_IGV = ['administrador', 'gerente'] as const

export const puedeCambiarIgv = (rol: string | null | undefined) =>
  !!rol && (ROLES_IGV as readonly string[]).includes(rol)

export function usePuedeCambiarIgv(): boolean {
  const [puede, setPuede] = useState(false)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (vivo) setPuede(puedeCambiarIgv((data as any)?.role))
    })()
    return () => { vivo = false }
  }, [])
  return puede
}
