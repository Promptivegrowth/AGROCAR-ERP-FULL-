import { createClient } from '@/lib/supabase/server'
import CobranzasClient, { type ClienteSaldo } from './cobranzas-client'

export const dynamic = 'force-dynamic'

// Ruta: /cobranzas — Gestión de créditos de clientes (cuentas por cobrar)
async function getCobranzasData() {
  const supabase = await createClient()

  // 1) Traer todos los clientes con crédito configurado
  const { data: clientes } = await supabase
    .from('clientes')
    .select('id, razon_social, ruc, dni, telefono, credito_dias, credito_limite, estado')
    .order('razon_social')

  // 2) Traer comprobantes NO anulados agrupados por cliente
  const { data: comprobantes } = await supabase
    .from('comprobantes')
    .select('id, cliente_id, tipo, serie, numero, fecha_emision, total, estado')
    .neq('estado', 'anulado')

  // 3) Traer cobros (pagos aplicados) por cliente
  const { data: cobros } = await supabase
    .from('cobros')
    .select('id, cliente_id, fecha, total, efectivo, yape, plin, transferencia, notas, created_at')

  // 4) Agregación en JS: saldo pendiente por cliente
  const facturadoPorCliente = new Map<string, number>()
  const comprobantesPorCliente = new Map<string, any[]>()
  for (const c of comprobantes ?? []) {
    if (!c.cliente_id) continue
    facturadoPorCliente.set(c.cliente_id, (facturadoPorCliente.get(c.cliente_id) ?? 0) + (c.total ?? 0))
    if (!comprobantesPorCliente.has(c.cliente_id)) comprobantesPorCliente.set(c.cliente_id, [])
    comprobantesPorCliente.get(c.cliente_id)!.push(c)
  }

  const cobradoPorCliente = new Map<string, number>()
  const cobrosPorCliente = new Map<string, any[]>()
  for (const c of cobros ?? []) {
    if (!c.cliente_id) continue
    cobradoPorCliente.set(c.cliente_id, (cobradoPorCliente.get(c.cliente_id) ?? 0) + (c.total ?? 0))
    if (!cobrosPorCliente.has(c.cliente_id)) cobrosPorCliente.set(c.cliente_id, [])
    cobrosPorCliente.get(c.cliente_id)!.push(c)
  }

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const clientesConSaldo: ClienteSaldo[] = (clientes ?? []).map((cli: any) => {
    const facturado = facturadoPorCliente.get(cli.id) ?? 0
    const cobrado = cobradoPorCliente.get(cli.id) ?? 0
    const saldo = Math.max(0, facturado - cobrado)
    const comps = (comprobantesPorCliente.get(cli.id) ?? []).sort(
      (a: any, b: any) => (a.fecha_emision > b.fecha_emision ? 1 : -1)
    )

    // Para calcular "días transcurridos" tomamos el comprobante NO cubierto más antiguo
    const creditoDias = cli.credito_dias ?? 0
    let diasTranscurridos = 0
    let estadoDeuda: 'al_dia' | 'por_vencer' | 'vencida_leve' | 'vencida_grave' = 'al_dia'

    if (saldo > 0 && comps.length > 0) {
      // Asumimos FIFO: cubrir con cobros desde los comprobantes más antiguos
      let pendienteCobros = cobrado
      let comprobanteMasAntiguoPendiente: any = null
      for (const c of comps) {
        const tot = c.total ?? 0
        if (pendienteCobros >= tot) {
          pendienteCobros -= tot
        } else {
          comprobanteMasAntiguoPendiente = c
          break
        }
      }
      if (comprobanteMasAntiguoPendiente) {
        const fechaEmi = new Date(comprobanteMasAntiguoPendiente.fecha_emision + 'T00:00:00')
        const diffMs = hoy.getTime() - fechaEmi.getTime()
        diasTranscurridos = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        const diasExceso = diasTranscurridos - creditoDias
        if (diasExceso <= 0) {
          estadoDeuda = diasExceso > -3 ? 'por_vencer' : 'al_dia'
        } else if (diasExceso <= 7) {
          estadoDeuda = 'vencida_leve'
        } else {
          estadoDeuda = 'vencida_grave'
        }
      }
    }

    return {
      id: cli.id,
      razon_social: cli.razon_social,
      ruc: cli.ruc,
      dni: cli.dni ?? null,
      telefono: cli.telefono ?? null,
      credito_dias: creditoDias,
      credito_limite: cli.credito_limite ?? 0,
      estado: cli.estado,
      facturado,
      cobrado,
      saldo,
      dias_transcurridos: diasTranscurridos,
      estado_deuda: estadoDeuda,
      comprobantes: comps,
      cobros: cobrosPorCliente.get(cli.id) ?? [],
    }
  })

  // Solo mostrar los que tengan actividad (facturado > 0) o deuda
  const visibles = clientesConSaldo.filter((c) => c.facturado > 0 || c.saldo > 0)

  // Orden: vencidos graves, vencidos leves, por vencer, al día; dentro de cada grupo por saldo desc
  const orden: Record<ClienteSaldo['estado_deuda'], number> = {
    vencida_grave: 0,
    vencida_leve: 1,
    por_vencer: 2,
    al_dia: 3,
  }
  visibles.sort((a, b) => {
    const cmp = orden[a.estado_deuda] - orden[b.estado_deuda]
    if (cmp !== 0) return cmp
    return b.saldo - a.saldo
  })

  // KPIs
  const cuentasPorCobrarTotal = visibles.reduce((acc, c) => acc + c.saldo, 0)
  const deudaVencida = visibles
    .filter((c) => c.estado_deuda === 'vencida_leve' || c.estado_deuda === 'vencida_grave')
    .reduce((acc, c) => acc + c.saldo, 0)
  const clientesConDeuda = visibles.filter((c) => c.saldo > 0).length
  const clientesAlDia = visibles.filter((c) => c.saldo === 0 || c.estado_deuda === 'al_dia').length
  const vencidosMas30 = visibles.filter(
    (c) => c.estado_deuda === 'vencida_grave' && c.dias_transcurridos - c.credito_dias > 30
  ).length
  const cercaLimite = visibles.filter(
    (c) => c.credito_limite > 0 && c.saldo >= c.credito_limite * 0.9
  ).length

  return {
    clientes: visibles,
    kpis: {
      cuentasPorCobrarTotal,
      deudaVencida,
      clientesConDeuda,
      clientesAlDia,
      vencidosMas30,
      cercaLimite,
    },
  }
}

export default async function CobranzasPage() {
  const data = await getCobranzasData()
  return <CobranzasClient clientesIniciales={data.clientes} kpis={data.kpis} />
}
