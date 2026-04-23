export type EstadoDespacho = 'preparacion' | 'en_ruta' | 'completado' | 'cancelado'

export type PedidoListo = {
  id: string
  numero: string
  cliente_id: string
  cliente_nombre: string
  cliente_ruc: string | null
  cliente_dni: string | null
  cliente_tipo_comprobante: 'factura' | 'boleta' | 'nota_pedido_interna' | null
  cliente_direccion: string | null
  cliente_telefono: string | null
  cliente_lat: number | null
  cliente_lng: number | null
  zona_id: string | null
  zona_nombre: string | null
  distrito: string | null
  vendedor_id: string | null
  vendedor_nombre: string | null
  total: number
  peso_kg: number
  items_count: number
  tiene_productos_sin_peso: boolean
}

export type VehiculoDisponible = {
  id: string
  placa: string
  descripcion: string | null
  tipo: 'zona' | 'auxiliar'
  capacidad_kg: number
  conductor_id: string | null
  conductor_nombre: string | null
}

export type AsignacionState = {
  // vehiculo_id -> [pedido_id, ...]
  porVehiculo: Record<string, string[]>
}

export type OrdenEntrega = {
  pedido_id: string
  secuencia: number
  distancia_km: number
  distancia_acumulada_km: number
}
