import { createClient } from '@/lib/supabase/server'
import CajaClient, {
  type CajaSesionData,
  type CobroDia,
  type MovimientoCaja,
  type SesionHistorial,
} from './caja-client'

export const dynamic = 'force-dynamic'

// Ruta: /caja — Módulo de Caja profesional (sesiones, cobros, egresos, arqueo)
async function getCajaData() {
  const supabase = await createClient()

  const today = new Date().toISOString().split('T')[0]

  // 1) Sesión abierta actual (si hay)
  const { data: sesionAbiertaRaw } = await supabase
    .from('caja_sesiones')
    .select(`
      id, cajero_id, fecha_apertura, fecha_cierre, saldo_inicial, saldo_final, estado, created_at,
      profiles!caja_sesiones_cajero_id_fkey(full_name)
    `)
    .eq('estado', 'abierta')
    .order('fecha_apertura', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sesionAbierta: CajaSesionData | null = sesionAbiertaRaw
    ? {
        id: sesionAbiertaRaw.id,
        cajero_id: sesionAbiertaRaw.cajero_id,
        cajero_nombre: (sesionAbiertaRaw.profiles as any)?.full_name ?? null,
        fecha_apertura: sesionAbiertaRaw.fecha_apertura,
        fecha_cierre: sesionAbiertaRaw.fecha_cierre,
        saldo_inicial: sesionAbiertaRaw.saldo_inicial ?? 0,
        saldo_final: sesionAbiertaRaw.saldo_final,
        estado: sesionAbiertaRaw.estado,
      }
    : null

  // 2) Cobros del día
  const { data: cobrosRaw } = await supabase
    .from('cobros')
    .select(`
      id, cliente_id, cobrador_id, fecha, efectivo, yape, plin, transferencia, total, tipo, notas, created_at,
      cliente_externo_nombre,
      clientes(razon_social, telefono),
      profiles!cobros_cobrador_id_fkey(full_name, role)
    `)
    .eq('fecha', today)
    .order('created_at', { ascending: false })

  const cobros: CobroDia[] = (cobrosRaw ?? []).map((c: any) => ({
    id: c.id,
    cliente_id: c.cliente_id,
    cliente_nombre: c.clientes?.razon_social ?? c.cliente_externo_nombre ?? '—',
    cliente_telefono: c.clientes?.telefono ?? null,
    cobrador_id: c.cobrador_id,
    cobrador_nombre: c.profiles?.full_name ?? 'Sin asignar',
    cobrador_rol: c.profiles?.role ?? null,
    fecha: c.fecha,
    efectivo: Number(c.efectivo ?? 0),
    yape: Number(c.yape ?? 0),
    plin: Number(c.plin ?? 0),
    transferencia: Number(c.transferencia ?? 0),
    total: Number(c.total ?? 0),
    notas: c.notas ?? null,
    created_at: c.created_at,
  }))

  // 3) Movimientos de la sesión actual (si hay)
  let movimientos: MovimientoCaja[] = []
  if (sesionAbierta?.id) {
    const { data: movRaw } = await supabase
      .from('caja_movimientos')
      .select('id, sesion_id, tipo, categoria, descripcion, monto, created_at, cobrador_id')
      .eq('sesion_id', sesionAbierta.id)
      .order('created_at', { ascending: false })
    movimientos = (movRaw ?? []).map((m: any) => ({
      id: m.id,
      sesion_id: m.sesion_id,
      tipo: m.tipo,
      categoria: m.categoria,
      descripcion: m.descripcion,
      monto: Number(m.monto ?? 0),
      created_at: m.created_at,
      cobrador_id: m.cobrador_id,
    }))
  }

  // 4) Historial: últimas 30 sesiones cerradas
  const { data: historialRaw } = await supabase
    .from('caja_sesiones')
    .select(`
      id, cajero_id, fecha_apertura, fecha_cierre, saldo_inicial, saldo_final, estado, created_at,
      profiles!caja_sesiones_cajero_id_fkey(full_name)
    `)
    .eq('estado', 'cerrada')
    .order('fecha_cierre', { ascending: false })
    .limit(30)

  const historial: SesionHistorial[] = (historialRaw ?? []).map((s: any) => ({
    id: s.id,
    cajero_nombre: s.profiles?.full_name ?? '—',
    fecha_apertura: s.fecha_apertura,
    fecha_cierre: s.fecha_cierre,
    saldo_inicial: Number(s.saldo_inicial ?? 0),
    saldo_final: s.saldo_final !== null ? Number(s.saldo_final) : null,
  }))

  return {
    today,
    sesionAbierta,
    cobros,
    movimientos,
    historial,
  }
}

export default async function CajaPage() {
  const data = await getCajaData()
  return (
    <CajaClient
      today={data.today}
      sesionInicial={data.sesionAbierta}
      cobrosIniciales={data.cobros}
      movimientosIniciales={data.movimientos}
      historialInicial={data.historial}
    />
  )
}
