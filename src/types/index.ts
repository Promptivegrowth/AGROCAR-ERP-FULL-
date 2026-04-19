/**
 * AGROCAR ERP - Tipos públicos y re-exportaciones
 * Punto de entrada principal para todos los tipos del proyecto
 */

// ─── Re-exportar tipos de base de datos ──────────────────────────────────────

export type { Database } from './database'

// Tipos de tabla (Row)
export type {
  Profile,
  Zona,
  Familia,
  UnidadMedida,
  ListaPrecio,
  Cliente,
  Proveedor,
  Producto,
  ListaPrecioItem,
  Lote,
  Vehiculo,
  OrdenCompra,
  OrdenCompraItem,
  Compra,
  CompraItem,
  Stock,
  MovimientoStock,
  Pedido,
  PedidoItem,
  Comprobante,
  ComprobanteItem,
  NotaCredito,
  Despacho,
  DespachoItem,
  Cobro,
  CajaSesion,
  CajaMovimiento,
  GpsCheckin,
  GpsUbicacion,
  TipoCambio,
  ComisionRegla,
  Configuracion,
} from './database'

// Tipos Insert
export type {
  ProfileInsert,
  ClienteInsert,
  ProductoInsert,
  PedidoInsert,
  PedidoItemInsert,
  ComprobanteInsert,
  CompraInsert,
  CompraItemInsert,
  DespachoInsert,
  DespachoItemInsert,
  CobroInsert,
  MovimientoStockInsert,
  GpsCheckinInsert,
} from './database'

// Tipos Update
export type {
  PedidoUpdate,
  ClienteUpdate,
  ProductoUpdate,
  ComprobanteUpdate,
  DespachoUpdate,
  StockUpdate,
} from './database'

// Tipos compuestos (joins)
export type {
  PedidoConItems,
  ComprobanteConItems,
  DespachoConItems,
  ProductoConStock,
  ClienteConVendedor,
} from './database'

// Helpers genéricos
export type {
  Tables,
  TablesInsert,
  TablesUpdate,
  Views,
  Functions,
  Enums,
  Json,
} from './database'

// ─── Enums de dominio ─────────────────────────────────────────────────────────

export type UserRole =
  | 'gerente'
  | 'administrador'
  | 'facturador'
  | 'almacenero'
  | 'vendedor'
  | 'repartidor'
  | 'contador'

export type EstadoCliente = 'activo' | 'inactivo' | 'deudor' | 'de_baja'

export type TipoCliente = 'consumidor_final' | 'tienda'

export type EstadoPedido =
  | 'borrador'
  | 'enviado'
  | 'validado'
  | 'facturado'
  | 'despachado'
  | 'entregado'
  | 'cancelado'

export type TipoComprobante = 'factura' | 'boleta' | 'nota_pedido_interna'

export type EstadoComprobante =
  | 'emitido'
  | 'enviado_sunat'
  | 'aceptado'
  | 'rechazado'
  | 'anulado'

export type Moneda = 'PEN' | 'USD'

export type MetodoValorizacion = 'promedio' | 'fifo' | 'directo'

export type EstadoDespacho = 'preparacion' | 'en_ruta' | 'completado' | 'cancelado'

export type TipoMovimientoStock = 'entrada' | 'salida' | 'ajuste' | 'devolucion'

export type ListaPrecioNombre = 'A' | 'B' | 'C'

// ─── Tipos de navegación ──────────────────────────────────────────────────────

export interface NavItem {
  title: string
  href: string
  icon?: string
  /** Si se define, solo usuarios con estos roles ven este ítem */
  roles?: UserRole[]
  children?: NavItem[]
  /** Marca el ítem como externo (abre en nueva pestaña) */
  external?: boolean
  /** Badge/contador numérico para mostrar junto al ítem */
  badge?: number
  /** Deshabilita el ítem sin ocultarlo */
  disabled?: boolean
}

// ─── Tipos de UI / Formularios ────────────────────────────────────────────────

/** Resultado estándar de operaciones async */
export interface ActionResult<T = unknown> {
  data: T | null
  error: string | null
  success: boolean
}

/** Paginación estándar */
export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** Filtros comunes */
export interface DateRangeFilter {
  desde: string | null  // ISO date string
  hasta: string | null  // ISO date string
}

/** Opciones para select/combobox */
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

/** Columna de tabla de datos */
export interface DataTableColumn<T> {
  key: keyof T | string
  title: string
  sortable?: boolean
  width?: number
  align?: 'left' | 'center' | 'right'
  render?: (value: unknown, row: T) => React.ReactNode
}

// ─── Tipos de sesión / auth ───────────────────────────────────────────────────

export interface SessionUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  zona_id: string | null
  avatar_url: string | null
  activo: boolean
}

export interface AuthState {
  user: SessionUser | null
  isLoading: boolean
  isAuthenticated: boolean
}

// ─── Tipos de métricas / dashboard ───────────────────────────────────────────

export interface DashboardMetrics {
  ventas_hoy: number
  ventas_mes: number
  pedidos_pendientes: number
  pedidos_en_ruta: number
  clientes_activos: number
  stock_bajo: number            // productos con stock < mínimo
  cobros_pendientes: number
  comprobantes_por_emitir: number
}

export interface VentasPorZona {
  zona_id: string
  zona_nombre: string
  total: number
  pedidos: number
  variacion_porcentaje: number  // vs mes anterior
}

export interface VentasPorVendedor {
  vendedor_id: string
  vendedor_nombre: string
  total: number
  pedidos: number
  meta: number | null
  porcentaje_meta: number | null
}

// ─── Tipos de GPS / Tracking ──────────────────────────────────────────────────

export interface Coordenadas {
  latitud: number
  longitud: number
  precision_metros?: number
}

export interface CheckinRequest extends Coordenadas {
  cliente_id: string
  tipo: 'entrada' | 'salida' | 'visita_sin_compra'
  foto_url?: string
  notas?: string
}

// ─── Tipos de facturación SUNAT ───────────────────────────────────────────────

export interface SunatCredentials {
  ruc: string
  usuario_sol: string
  clave_sol: string
  certificado_url: string
  modo: 'produccion' | 'beta'
}

export interface SunatResponse {
  estado: 'aceptado' | 'rechazado' | 'observado'
  codigo_respuesta: string
  descripcion_respuesta: string
  cdr_xml: string | null
  hash: string | null
}

export interface ComprobanteParaSunat {
  tipo: TipoComprobante
  serie: string
  numero: string
  fecha_emision: string
  cliente_ruc: string | null
  cliente_razon_social: string
  cliente_direccion: string | null
  moneda: Moneda
  tipo_cambio: number | null
  subtotal: number
  igv: number
  percepcion: number
  total: number
  items: {
    descripcion: string
    cantidad: number
    precio_unitario: number
    subtotal: number
    igv_porcentaje: number
  }[]
}

// ─── Tipos de cobros / caja ───────────────────────────────────────────────────

export interface PagoDetalle {
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  total: number
}

export interface ResumenCaja {
  sesion_id: string
  fecha_apertura: string
  saldo_inicial: number
  total_ingresos: number
  total_egresos: number
  saldo_teorico: number
  movimientos_count: number
}

// ─── Constantes de dominio ────────────────────────────────────────────────────

export const ROLES_LABELS: Record<UserRole, string> = {
  gerente:        'Gerente',
  administrador:  'Administrador',
  facturador:     'Facturador',
  almacenero:     'Almacenero',
  vendedor:       'Vendedor',
  repartidor:     'Repartidor',
  contador:       'Contador',
}

export const ESTADO_PEDIDO_LABELS: Record<EstadoPedido, string> = {
  borrador:   'Borrador',
  enviado:    'Enviado',
  validado:   'Validado',
  facturado:  'Facturado',
  despachado: 'Despachado',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}

export const ESTADO_COMPROBANTE_LABELS: Record<EstadoComprobante, string> = {
  emitido:       'Emitido',
  enviado_sunat: 'Enviado a SUNAT',
  aceptado:      'Aceptado',
  rechazado:     'Rechazado',
  anulado:       'Anulado',
}

export const ESTADO_CLIENTE_LABELS: Record<EstadoCliente, string> = {
  activo:   'Activo',
  inactivo: 'Inactivo',
  deudor:   'Deudor',
  de_baja:  'De Baja',
}

export const MONEDA_SIMBOLO: Record<Moneda, string> = {
  PEN: 'S/',
  USD: '$',
}

export const IGV_PORCENTAJE = 18
export const IGV_FACTOR = 0.18
export const PERCEPCION_DEFAULT = 2.0
