import { createClient } from '@/lib/supabase/server'
import VendedoresClient, {
  type VendedorData,
  type LiquidacionPendiente,
  type ReglaComision,
  type FamiliaOption,
} from './vendedores-client'

export const dynamic = 'force-dynamic'

async function getVendedoresData() {
  const supabase = await createClient()

  const now = new Date()
  const anioActual = now.getFullYear()
  const mesActual = now.getMonth() + 1 // 1-12
  const hoyStr = now.toISOString().split('T')[0]
  const inicioMes = new Date(anioActual, mesActual - 1, 1).toISOString().split('T')[0]
  const finMes = new Date(anioActual, mesActual, 0).toISOString().split('T')[0]

  // Promise.allSettled — si UNA query falla (tabla nueva, RLS, timeout, etc.) la página
  // sigue cargando con array vacío para esa fuente, en lugar de hacer crash y dejar al
  // usuario en blanco o redirigido al login.
  const results = await Promise.allSettled([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, activo')
      .eq('role', 'vendedor')
      .eq('activo', true)
      .order('full_name'),
    supabase.from('familias').select('id, nombre').order('nombre'),
    supabase
      .from('pedidos')
      .select('id, vendedor_id, total, fecha_pedido, estado, numero, cliente_id')
      .gte('fecha_pedido', inicioMes)
      .lte('fecha_pedido', finMes),
    supabase
      .from('comprobantes')
      .select('id, pedido_id, cliente_id, total, fecha_emision, estado')
      .gte('fecha_emision', inicioMes)
      .lte('fecha_emision', finMes)
      .neq('estado', 'anulado'),
    supabase
      .from('cobros')
      .select('id, cobrador_id, cliente_id, total, fecha')
      .gte('fecha', inicioMes)
      .lte('fecha', finMes),
    supabase
      .from('gps_checkins' as any)
      .select('id, usuario_id, cliente_id, tipo, created_at')
      .gte('created_at', `${inicioMes}T00:00:00`)
      .lte('created_at', `${finMes}T23:59:59`)
      .eq('tipo', 'entrada'),
    supabase
      .from('metas_vendedor' as any)
      .select('*')
      .eq('periodo', 'mensual')
      .eq('anio', anioActual)
      .eq('mes', mesActual),
    supabase
      .from('comisiones_reglas')
      .select('*')
      .eq('activo', true),
    supabase
      .from('liquidaciones_comision' as any)
      .select('*')
      .order('created_at', { ascending: false }),
  ])

  const pick = <T,>(idx: number, label: string): T[] => {
    const r = results[idx]
    if (r.status === 'rejected') {
      console.error(`[vendedores] query "${label}" rechazada:`, r.reason)
      return []
    }
    const v = r.value as any
    if (v?.error) {
      console.error(`[vendedores] query "${label}" devolvió error:`, v.error)
      return []
    }
    return (v?.data ?? []) as T[]
  }
  const vendedoresRaw = pick<any>(0, 'profiles vendedores')
  // Llamar RPC calcular_comision_vendedor por cada vendedor (en paralelo).
  // Esto reemplaza el cálculo manual antiguo que ignoraba la familia.
  const comisionesRpc = await Promise.all(
    vendedoresRaw.map(async (v) => {
      const { data } = await (supabase.rpc as any)('calcular_comision_vendedor', {
        p_vendedor_id: v.id,
        p_desde: inicioMes,
        p_hasta: finMes,
      })
      return { vendedor_id: v.id, data }
    }),
  )
  const comisionRpcPorVendedor = new Map<string, any>()
  comisionesRpc.forEach((r) => {
    if (r.data) comisionRpcPorVendedor.set(r.vendedor_id, r.data)
  })
  const familiasRaw = pick<any>(1, 'familias')
  const pedidosMes = pick<any>(2, 'pedidos mes')
  const comprobantesMes = pick<any>(3, 'comprobantes mes')
  const cobrosMes = pick<any>(4, 'cobros mes')
  const checkinsMes = pick<any>(5, 'gps_checkins mes')
  const metasMes = pick<any>(6, 'metas mes')
  const reglasRaw = pick<any>(7, 'comisiones_reglas')
  const liquidacionesRaw = pick<any>(8, 'liquidaciones_comision')

  const vendedores = (vendedoresRaw ?? []) as any[]
  const familias = (familiasRaw ?? []) as FamiliaOption[]

  // Indice pedidos por id y por vendedor
  const pedidosPorId = new Map<string, any>()
  const pedidosPorVendedor = new Map<string, any[]>()
  for (const p of (pedidosMes ?? []) as any[]) {
    pedidosPorId.set(p.id, p)
    if (!p.vendedor_id) continue
    if (!pedidosPorVendedor.has(p.vendedor_id)) pedidosPorVendedor.set(p.vendedor_id, [])
    pedidosPorVendedor.get(p.vendedor_id)!.push(p)
  }

  // Ventas por vendedor (via pedido.vendedor_id)
  const ventasPorVendedor = new Map<string, number>()
  const comprobantesPorVendedor = new Map<string, any[]>()
  for (const c of (comprobantesMes ?? []) as any[]) {
    if (!c.pedido_id) continue
    const ped = pedidosPorId.get(c.pedido_id)
    if (!ped?.vendedor_id) continue
    ventasPorVendedor.set(ped.vendedor_id, (ventasPorVendedor.get(ped.vendedor_id) ?? 0) + Number(c.total ?? 0))
    if (!comprobantesPorVendedor.has(ped.vendedor_id)) comprobantesPorVendedor.set(ped.vendedor_id, [])
    comprobantesPorVendedor.get(ped.vendedor_id)!.push({ ...c, vendedor_id: ped.vendedor_id })
  }

  // Cobros por cobrador
  const cobradoPorVendedor = new Map<string, number>()
  const cobrosPorVendedor = new Map<string, any[]>()
  for (const c of (cobrosMes ?? []) as any[]) {
    if (!c.cobrador_id) continue
    cobradoPorVendedor.set(c.cobrador_id, (cobradoPorVendedor.get(c.cobrador_id) ?? 0) + Number(c.total ?? 0))
    if (!cobrosPorVendedor.has(c.cobrador_id)) cobrosPorVendedor.set(c.cobrador_id, [])
    cobrosPorVendedor.get(c.cobrador_id)!.push(c)
  }

  // Check-ins por usuario
  const clientesPorVendedor = new Map<string, Set<string>>()
  const checkinsPorVendedor = new Map<string, any[]>()
  for (const ci of (checkinsMes ?? []) as any[]) {
    if (!ci.usuario_id) continue
    if (!clientesPorVendedor.has(ci.usuario_id)) clientesPorVendedor.set(ci.usuario_id, new Set())
    if (ci.cliente_id) clientesPorVendedor.get(ci.usuario_id)!.add(ci.cliente_id)
    if (!checkinsPorVendedor.has(ci.usuario_id)) checkinsPorVendedor.set(ci.usuario_id, [])
    checkinsPorVendedor.get(ci.usuario_id)!.push(ci)
  }

  // Metas del mes
  const metaPorVendedor = new Map<string, any>()
  for (const m of (metasMes ?? []) as any[]) {
    metaPorVendedor.set(m.vendedor_id, m)
  }

  // Reglas: por vendedor + global
  const reglas = (reglasRaw ?? []) as any[]
  const reglaPorVendedor = new Map<string, any>()
  let reglaGlobal: any = null
  for (const r of reglas) {
    if (r.vendedor_id) {
      const prev = reglaPorVendedor.get(r.vendedor_id)
      if (!prev || new Date(r.created_at ?? 0) > new Date(prev.created_at ?? 0)) {
        reglaPorVendedor.set(r.vendedor_id, r)
      }
    } else {
      if (!reglaGlobal || new Date(r.created_at ?? 0) > new Date(reglaGlobal.created_at ?? 0)) {
        reglaGlobal = r
      }
    }
  }

  // Liquidaciones
  const liquidacionesTodas = (liquidacionesRaw ?? []) as any[]
  const liquidacionesPorVendedor = new Map<string, any[]>()
  for (const l of liquidacionesTodas) {
    if (!liquidacionesPorVendedor.has(l.vendedor_id)) liquidacionesPorVendedor.set(l.vendedor_id, [])
    liquidacionesPorVendedor.get(l.vendedor_id)!.push(l)
  }

  // HOY
  const ventasHoyPorVendedor = new Map<string, number>()
  for (const c of (comprobantesMes ?? []) as any[]) {
    if (c.fecha_emision !== hoyStr) continue
    if (!c.pedido_id) continue
    const ped = pedidosPorId.get(c.pedido_id)
    if (!ped?.vendedor_id) continue
    ventasHoyPorVendedor.set(ped.vendedor_id, (ventasHoyPorVendedor.get(ped.vendedor_id) ?? 0) + Number(c.total ?? 0))
  }
  const cobradoHoyPorVendedor = new Map<string, number>()
  const pedidosHoyCount = new Map<string, number>()
  for (const c of (cobrosMes ?? []) as any[]) {
    if (c.fecha !== hoyStr) continue
    if (!c.cobrador_id) continue
    cobradoHoyPorVendedor.set(c.cobrador_id, (cobradoHoyPorVendedor.get(c.cobrador_id) ?? 0) + Number(c.total ?? 0))
  }
  for (const p of (pedidosMes ?? []) as any[]) {
    if (p.fecha_pedido !== hoyStr) continue
    if (!p.vendedor_id) continue
    pedidosHoyCount.set(p.vendedor_id, (pedidosHoyCount.get(p.vendedor_id) ?? 0) + 1)
  }

  const vendedoresData: VendedorData[] = vendedores.map((v) => {
    const total_ventas = ventasPorVendedor.get(v.id) ?? 0
    const total_cobrado = cobradoPorVendedor.get(v.id) ?? 0
    const pedidos = pedidosPorVendedor.get(v.id) ?? []
    const pedidos_count = pedidos.length
    const clientes_visitados = clientesPorVendedor.get(v.id)?.size ?? 0
    const ventas_hoy = ventasHoyPorVendedor.get(v.id) ?? 0
    const cobrado_hoy = cobradoHoyPorVendedor.get(v.id) ?? 0
    const pedidos_hoy = pedidosHoyCount.get(v.id) ?? 0

    const meta = metaPorVendedor.get(v.id) ?? null
    const regla = reglaPorVendedor.get(v.id) ?? reglaGlobal ?? null

    // Comisión calculada con desglose por familia (RPC nueva).
    // Antes era un cálculo manual (total_ventas * porcentaje) que ignoraba
    // la familia; ahora respeta la prioridad de reglas configuradas.
    const comisionRpc = comisionRpcPorVendedor.get(v.id)
    const comision_calculada = comisionRpc ? Number(comisionRpc.total_comision ?? 0) : 0

    const liquidaciones = (liquidacionesPorVendedor.get(v.id) ?? []).map((l) => ({
      id: l.id,
      vendedor_id: l.vendedor_id,
      periodo_inicio: l.periodo_inicio,
      periodo_fin: l.periodo_fin,
      total_ventas: Number(l.total_ventas ?? 0),
      total_cobrado: Number(l.total_cobrado ?? 0),
      base_calculo: l.base_calculo,
      porcentaje_aplicado: l.porcentaje_aplicado ? Number(l.porcentaje_aplicado) : null,
      monto_fijo_aplicado: l.monto_fijo_aplicado ? Number(l.monto_fijo_aplicado) : null,
      comision_calculada: Number(l.comision_calculada ?? 0),
      monto_pagado: l.monto_pagado ? Number(l.monto_pagado) : null,
      estado: l.estado,
      fecha_aprobacion: l.fecha_aprobacion,
      fecha_pago: l.fecha_pago,
      caja_movimiento_id: l.caja_movimiento_id,
      notas: l.notas,
    }))

    return {
      id: v.id,
      full_name: v.full_name ?? 'Sin nombre',
      email: v.email ?? '',
      total_ventas,
      total_cobrado,
      pedidos_count,
      clientes_visitados,
      ventas_hoy,
      cobrado_hoy,
      pedidos_hoy,
      meta: meta
        ? {
            id: meta.id,
            vendedor_id: meta.vendedor_id,
            periodo: meta.periodo,
            anio: meta.anio,
            mes: meta.mes,
            semana_iso: meta.semana_iso,
            dia: meta.dia,
            monto_meta: Number(meta.monto_meta ?? 0),
            notas: meta.notas,
          }
        : null,
      regla: regla
        ? ({
            id: regla.id,
            vendedor_id: regla.vendedor_id,
            familia_id: regla.familia_id,
            porcentaje: regla.porcentaje ? Number(regla.porcentaje) : null,
            monto_fijo: regla.monto_fijo ? Number(regla.monto_fijo) : null,
            objetivo_mensual: regla.objetivo_mensual ? Number(regla.objetivo_mensual) : null,
            activo: regla.activo,
            es_global: !regla.vendedor_id,
          } as ReglaComision)
        : null,
      comision_calculada,
      liquidaciones,
      pedidos_detalle: pedidos.map((p) => ({
        id: p.id,
        numero: p.numero,
        cliente_id: p.cliente_id,
        fecha_pedido: p.fecha_pedido,
        total: Number(p.total ?? 0),
        estado: p.estado,
      })),
      comprobantes_detalle: (comprobantesPorVendedor.get(v.id) ?? []).map((c: any) => ({
        id: c.id,
        fecha_emision: c.fecha_emision,
        total: Number(c.total ?? 0),
        cliente_id: c.cliente_id,
      })),
      cobros_detalle: (cobrosPorVendedor.get(v.id) ?? []).map((c: any) => ({
        id: c.id,
        fecha: c.fecha,
        total: Number(c.total ?? 0),
        cliente_id: c.cliente_id,
      })),
      checkins_detalle: (checkinsPorVendedor.get(v.id) ?? []).map((c: any) => ({
        id: c.id,
        created_at: c.created_at,
        cliente_id: c.cliente_id,
        tipo: c.tipo,
      })),
    }
  })

  // Liquidaciones pendientes globales (para la tabla inferior)
  const liquidacionesPendientes: LiquidacionPendiente[] = liquidacionesTodas
    .filter((l) => l.estado === 'pendiente' || l.estado === 'aprobada' || l.estado === 'pagada')
    .map((l) => {
      const vend = vendedores.find((v) => v.id === l.vendedor_id)
      return {
        id: l.id,
        vendedor_id: l.vendedor_id,
        vendedor_nombre: vend?.full_name ?? 'Desconocido',
        periodo_inicio: l.periodo_inicio,
        periodo_fin: l.periodo_fin,
        total_ventas: Number(l.total_ventas ?? 0),
        total_cobrado: Number(l.total_cobrado ?? 0),
        comision_calculada: Number(l.comision_calculada ?? 0),
        monto_pagado: l.monto_pagado ? Number(l.monto_pagado) : null,
        estado: l.estado,
        caja_movimiento_id: l.caja_movimiento_id,
        notas: l.notas,
      }
    })

  // KPIs globales
  const ventas_totales_mes = Array.from(ventasPorVendedor.values()).reduce((a, b) => a + b, 0)
  const cobros_totales_mes = Array.from(cobradoPorVendedor.values()).reduce((a, b) => a + b, 0)
  const comisiones_pendientes_pago = liquidacionesTodas
    .filter((l) => l.estado === 'aprobada')
    .reduce((a, l) => a + Number(l.comision_calculada ?? 0), 0)

  return {
    vendedores: vendedoresData,
    familias,
    liquidacionesPendientes,
    kpis: {
      total_vendedores: vendedoresData.length,
      ventas_totales_mes,
      cobros_totales_mes,
      comisiones_pendientes_pago,
    },
    anioActual,
    mesActual,
  }
}

export default async function VendedoresPage() {
  const data = await getVendedoresData()
  return (
    <VendedoresClient
      vendedoresIniciales={data.vendedores}
      familias={data.familias}
      liquidacionesPendientes={data.liquidacionesPendientes}
      kpis={data.kpis}
      anioActual={data.anioActual}
      mesActual={data.mesActual}
    />
  )
}
