/**
 * AGROCAR ERP - Tipos TypeScript para Supabase
 * Generado para: AGROCAR SRL - Distribuidora de embutidos en Perú
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole =
  | 'gerente'
  | 'administrador'
  | 'facturador'
  | 'almacenero'
  | 'vendedor'
  | 'repartidor'
  | 'contador'

export type EstadoCliente = 'activo' | 'suspendido' | 'bloqueado'
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
export type EstadoOrdenCompra = 'borrador' | 'enviado' | 'recibido' | 'cancelado'
export type EstadoDespacho = 'preparacion' | 'en_ruta' | 'completado' | 'cancelado'
export type EstadoDespachoItem = 'pendiente' | 'entregado' | 'rechazado'
export type TipoMovimientoStock = 'entrada' | 'salida' | 'ajuste' | 'devolucion'
export type TipoVehiculo = 'zona' | 'auxiliar'
export type MetodoValorizacion = 'promedio' | 'fifo' | 'directo'
export type Moneda = 'PEN' | 'USD'
export type EstadoCajaSesion = 'abierta' | 'cerrada'
export type TipoGpsCheckin = 'entrada' | 'salida' | 'visita_sin_compra'
export type TipoCobro = 'venta' | 'cobranza'
export type TipoCajaMovimiento = 'ingreso' | 'egreso'
export type CategoriaCajaMovimiento =
  | 'cobro_cliente'
  | 'pago_planilla'
  | 'prestamo_empleado'
  | 'otro'
export type ListaPrecioNombre = 'A' | 'B' | 'C'

// ─── Database Interface Principal ────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {

      // ── Profiles ────────────────────────────────────────────────────────
      profiles: {
        Row: {
          id: string                     // uuid, references auth.users
          email: string
          full_name: string | null
          role: UserRole
          zona_id: string | null         // uuid, references zonas
          activo: boolean
          avatar_url: string | null
          telefono: string | null
          created_at: string             // timestamptz
          updated_at: string             // timestamptz
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: UserRole
          zona_id?: string | null
          activo?: boolean
          avatar_url?: string | null
          telefono?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: UserRole
          zona_id?: string | null
          activo?: boolean
          avatar_url?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_zona_id_fkey'
            columns: ['zona_id']
            isOneToOne: false
            referencedRelation: 'zonas'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Zonas ───────────────────────────────────────────────────────────
      zonas: {
        Row: {
          id: string                     // uuid
          nombre: string
          descripcion: string | null
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          nombre: string
          descripcion?: string | null
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          descripcion?: string | null
          activo?: boolean
        }
        Relationships: []
      }

      // ── Familias (Marcas) ────────────────────────────────────────────────
      familias: {
        Row: {
          id: string                     // uuid
          nombre: string                 // Cascajo | Centros Carnes AQP | Cerdena | Delis Embutidas | Industrias TH | Napolitano | Talas
          descripcion: string | null
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          nombre: string
          descripcion?: string | null
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          descripcion?: string | null
          activo?: boolean
        }
        Relationships: []
      }

      // ── Unidades de Medida ───────────────────────────────────────────────
      unidades_medida: {
        Row: {
          id: string                     // uuid
          nombre: string                 // Moldes | Unidades | Kilogramos
          simbolo: string                // Mld | Und | Kg
          activo: boolean
        }
        Insert: {
          id?: string
          nombre: string
          simbolo: string
          activo?: boolean
        }
        Update: {
          id?: string
          nombre?: string
          simbolo?: string
          activo?: boolean
        }
        Relationships: []
      }

      // ── Listas de Precio ─────────────────────────────────────────────────
      listas_precio: {
        Row: {
          id: string                     // uuid
          nombre: ListaPrecioNombre      // A | B | C
          descripcion: string | null
          activo: boolean
        }
        Insert: {
          id?: string
          nombre: ListaPrecioNombre
          descripcion?: string | null
          activo?: boolean
        }
        Update: {
          id?: string
          nombre?: ListaPrecioNombre
          descripcion?: string | null
          activo?: boolean
        }
        Relationships: []
      }

      // ── Clientes ─────────────────────────────────────────────────────────
      clientes: {
        Row: {
          id: string                     // uuid
          razon_social: string
          ruc: string | null
          dni: string | null
          tipo_cliente: TipoCliente
          tipo_comprobante_preferido: TipoComprobante
          lista_precio_id: string | null // uuid, references listas_precio
          zona_id: string | null         // uuid, references zonas
          vendedor_id: string | null     // uuid, references profiles
          direccion: string | null
          telefono: string | null
          email: string | null
          contacto: string | null
          credito_dias: number
          credito_limite: number
          estado: EstadoCliente
          latitud: number | null
          longitud: number | null
          notas: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          razon_social: string
          ruc?: string | null
          dni?: string | null
          tipo_cliente?: TipoCliente
          tipo_comprobante_preferido?: TipoComprobante
          lista_precio_id?: string | null
          zona_id?: string | null
          vendedor_id?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto?: string | null
          credito_dias?: number
          credito_limite?: number
          estado?: EstadoCliente
          latitud?: number | null
          longitud?: number | null
          notas?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          razon_social?: string
          ruc?: string | null
          dni?: string | null
          tipo_cliente?: TipoCliente
          tipo_comprobante_preferido?: TipoComprobante
          lista_precio_id?: string | null
          zona_id?: string | null
          vendedor_id?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto?: string | null
          credito_dias?: number
          credito_limite?: number
          estado?: EstadoCliente
          latitud?: number | null
          longitud?: number | null
          notas?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'clientes_lista_precio_id_fkey'
            columns: ['lista_precio_id']
            isOneToOne: false
            referencedRelation: 'listas_precio'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'clientes_zona_id_fkey'
            columns: ['zona_id']
            isOneToOne: false
            referencedRelation: 'zonas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'clientes_vendedor_id_fkey'
            columns: ['vendedor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Proveedores ──────────────────────────────────────────────────────
      proveedores: {
        Row: {
          id: string                     // uuid
          razon_social: string
          ruc: string | null
          direccion: string | null
          telefono: string | null
          email: string | null
          contacto: string | null
          activo: boolean
          created_at: string
          ubigeo: string | null
          departamento: string | null
          provincia: string | null
          distrito: string | null
          cliente_id: string | null
          banco: string | null
          cuenta_bancaria: string | null
          cci: string | null
          condiciones_pago: string | null
          pais: string
        }
        Insert: {
          id?: string
          razon_social: string
          ruc?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto?: string | null
          activo?: boolean
          created_at?: string
          ubigeo?: string | null
          departamento?: string | null
          provincia?: string | null
          distrito?: string | null
          cliente_id?: string | null
          banco?: string | null
          cuenta_bancaria?: string | null
          cci?: string | null
          condiciones_pago?: string | null
          pais?: string
        }
        Update: {
          id?: string
          razon_social?: string
          ruc?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          contacto?: string | null
          activo?: boolean
          ubigeo?: string | null
          departamento?: string | null
          provincia?: string | null
          distrito?: string | null
          cliente_id?: string | null
          banco?: string | null
          cuenta_bancaria?: string | null
          cci?: string | null
          condiciones_pago?: string | null
          pais?: string
        }
        Relationships: []
      }

      // ── Productos ────────────────────────────────────────────────────────
      productos: {
        Row: {
          id: string                     // uuid
          codigo: string
          nombre: string
          descripcion: string | null
          familia_id: string | null      // uuid, references familias
          unidad_medida_id: string | null // uuid, references unidades_medida
          tiene_lote: boolean
          tiene_vencimiento: boolean
          tiene_percepcion: boolean
          tasa_percepcion: number        // porcentaje, ej: 2.0
          activo: boolean
          imagen_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          codigo: string
          nombre: string
          descripcion?: string | null
          familia_id?: string | null
          unidad_medida_id?: string | null
          tiene_lote?: boolean
          tiene_vencimiento?: boolean
          tiene_percepcion?: boolean
          tasa_percepcion?: number
          activo?: boolean
          imagen_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          codigo?: string
          nombre?: string
          descripcion?: string | null
          familia_id?: string | null
          unidad_medida_id?: string | null
          tiene_lote?: boolean
          tiene_vencimiento?: boolean
          tiene_percepcion?: boolean
          tasa_percepcion?: number
          activo?: boolean
          imagen_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'productos_familia_id_fkey'
            columns: ['familia_id']
            isOneToOne: false
            referencedRelation: 'familias'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'productos_unidad_medida_id_fkey'
            columns: ['unidad_medida_id']
            isOneToOne: false
            referencedRelation: 'unidades_medida'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Lista Precio Items ───────────────────────────────────────────────
      lista_precio_items: {
        Row: {
          id: string                     // uuid
          lista_precio_id: string        // uuid, references listas_precio
          producto_id: string            // uuid, references productos
          precio: number
          moneda: Moneda
          activo: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          lista_precio_id: string
          producto_id: string
          precio: number
          moneda?: Moneda
          activo?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          lista_precio_id?: string
          producto_id?: string
          precio?: number
          moneda?: Moneda
          activo?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lista_precio_items_lista_precio_id_fkey'
            columns: ['lista_precio_id']
            isOneToOne: false
            referencedRelation: 'listas_precio'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lista_precio_items_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Lotes ────────────────────────────────────────────────────────────
      lotes: {
        Row: {
          id: string                     // uuid
          producto_id: string            // uuid, references productos
          numero_lote: string
          fecha_vencimiento: string | null // date
          cantidad_inicial: number
          cantidad_actual: number
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          producto_id: string
          numero_lote: string
          fecha_vencimiento?: string | null
          cantidad_inicial: number
          cantidad_actual?: number
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          producto_id?: string
          numero_lote?: string
          fecha_vencimiento?: string | null
          cantidad_inicial?: number
          cantidad_actual?: number
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'lotes_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Vehículos ────────────────────────────────────────────────────────
      vehiculos: {
        Row: {
          id: string                     // uuid
          placa: string
          descripcion: string | null
          tipo: TipoVehiculo
          capacidad_kg: number | null
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          placa: string
          descripcion?: string | null
          tipo?: TipoVehiculo
          capacidad_kg?: number | null
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          placa?: string
          descripcion?: string | null
          tipo?: TipoVehiculo
          capacidad_kg?: number | null
          activo?: boolean
        }
        Relationships: []
      }

      // ── Órdenes de Compra ────────────────────────────────────────────────
      ordenes_compra: {
        Row: {
          id: string                     // uuid
          numero: string
          proveedor_id: string           // uuid, references proveedores
          fecha: string                  // date
          estado: EstadoOrdenCompra
          subtotal: number
          igv: number
          total: number
          moneda: Moneda
          notas: string | null
          created_at: string
          updated_at: string
          created_by: string | null      // uuid, references profiles
        }
        Insert: {
          id?: string
          numero: string
          proveedor_id: string
          fecha: string
          estado?: EstadoOrdenCompra
          subtotal?: number
          igv?: number
          total?: number
          moneda?: Moneda
          notas?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          numero?: string
          proveedor_id?: string
          fecha?: string
          estado?: EstadoOrdenCompra
          subtotal?: number
          igv?: number
          total?: number
          moneda?: Moneda
          notas?: string | null
          updated_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ordenes_compra_proveedor_id_fkey'
            columns: ['proveedor_id']
            isOneToOne: false
            referencedRelation: 'proveedores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ordenes_compra_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Órdenes de Compra Items ──────────────────────────────────────────
      ordenes_compra_items: {
        Row: {
          id: string                     // uuid
          orden_compra_id: string        // uuid, references ordenes_compra
          producto_id: string            // uuid, references productos
          cantidad: number
          precio_unitario: number
          subtotal: number
        }
        Insert: {
          id?: string
          orden_compra_id: string
          producto_id: string
          cantidad: number
          precio_unitario: number
          subtotal: number
        }
        Update: {
          id?: string
          orden_compra_id?: string
          producto_id?: string
          cantidad?: number
          precio_unitario?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: 'ordenes_compra_items_orden_compra_id_fkey'
            columns: ['orden_compra_id']
            isOneToOne: false
            referencedRelation: 'ordenes_compra'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ordenes_compra_items_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Compras ──────────────────────────────────────────────────────────
      compras: {
        Row: {
          id: string                     // uuid
          proveedor_id: string           // uuid, references proveedores
          orden_compra_id: string | null // uuid, references ordenes_compra
          numero_factura_proveedor: string | null
          fecha: string                  // date
          metodo_valorizacion: MetodoValorizacion
          subtotal: number
          igv: number
          total: number
          moneda: Moneda
          estado: 'activo' | 'anulado'
          notas: string | null
          incluir_igv: boolean
          created_at: string
          created_by: string | null      // uuid, references profiles
        }
        Insert: {
          id?: string
          proveedor_id: string
          orden_compra_id?: string | null
          numero_factura_proveedor?: string | null
          fecha: string
          metodo_valorizacion?: MetodoValorizacion
          subtotal?: number
          igv?: number
          total?: number
          moneda?: Moneda
          estado?: 'activo' | 'anulado'
          notas?: string | null
          incluir_igv?: boolean
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          proveedor_id?: string
          orden_compra_id?: string | null
          numero_factura_proveedor?: string | null
          fecha?: string
          metodo_valorizacion?: MetodoValorizacion
          subtotal?: number
          igv?: number
          total?: number
          moneda?: Moneda
          estado?: 'activo' | 'anulado'
          notas?: string | null
          incluir_igv?: boolean
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'compras_proveedor_id_fkey'
            columns: ['proveedor_id']
            isOneToOne: false
            referencedRelation: 'proveedores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compras_orden_compra_id_fkey'
            columns: ['orden_compra_id']
            isOneToOne: false
            referencedRelation: 'ordenes_compra'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compras_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Compras Items ────────────────────────────────────────────────────
      compras_items: {
        Row: {
          id: string                     // uuid
          compra_id: string              // uuid, references compras
          producto_id: string            // uuid, references productos
          lote_id: string | null         // uuid, references lotes
          cantidad: number
          precio_unitario: number
          subtotal: number
        }
        Insert: {
          id?: string
          compra_id: string
          producto_id: string
          lote_id?: string | null
          cantidad: number
          precio_unitario: number
          subtotal: number
        }
        Update: {
          id?: string
          compra_id?: string
          producto_id?: string
          lote_id?: string | null
          cantidad?: number
          precio_unitario?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: 'compras_items_compra_id_fkey'
            columns: ['compra_id']
            isOneToOne: false
            referencedRelation: 'compras'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compras_items_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'compras_items_lote_id_fkey'
            columns: ['lote_id']
            isOneToOne: false
            referencedRelation: 'lotes'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Stock ────────────────────────────────────────────────────────────
      stock: {
        Row: {
          id: string                     // uuid
          producto_id: string            // uuid, references productos (unique)
          cantidad: number
          cantidad_reservada: number
          costo_promedio: number
          updated_at: string
        }
        Insert: {
          id?: string
          producto_id: string
          cantidad?: number
          cantidad_reservada?: number
          costo_promedio?: number
          updated_at?: string
        }
        Update: {
          id?: string
          producto_id?: string
          cantidad?: number
          cantidad_reservada?: number
          costo_promedio?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stock_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: true
            referencedRelation: 'productos'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Movimientos de Stock ─────────────────────────────────────────────
      movimientos_stock: {
        Row: {
          id: string                     // uuid
          tipo: TipoMovimientoStock
          referencia_tipo: string | null // 'compra' | 'pedido' | 'ajuste' | 'despacho'
          referencia_id: string | null   // uuid del documento origen
          producto_id: string            // uuid, references productos
          lote_id: string | null         // uuid, references lotes
          cantidad: number               // positivo=entrada, negativo=salida
          costo_unitario: number | null
          notas: string | null
          created_at: string
          created_by: string | null      // uuid, references profiles
        }
        Insert: {
          id?: string
          tipo: TipoMovimientoStock
          referencia_tipo?: string | null
          referencia_id?: string | null
          producto_id: string
          lote_id?: string | null
          cantidad: number
          costo_unitario?: number | null
          notas?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          tipo?: TipoMovimientoStock
          referencia_tipo?: string | null
          referencia_id?: string | null
          producto_id?: string
          lote_id?: string | null
          cantidad?: number
          costo_unitario?: number | null
          notas?: string | null
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'movimientos_stock_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_stock_lote_id_fkey'
            columns: ['lote_id']
            isOneToOne: false
            referencedRelation: 'lotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movimientos_stock_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Pedidos ──────────────────────────────────────────────────────────
      pedidos: {
        Row: {
          id: string                     // uuid
          numero: string
          cliente_id: string | null      // uuid, nullable para venta directa a consumidor final
          vendedor_id: string | null     // uuid, nullable cuando el pedido se crea desde oficina sin vendedor
          cliente_externo_nombre: string | null
          cliente_externo_doc: string | null
          fecha_pedido: string           // date
          fecha_despacho: string | null  // date
          estado: EstadoPedido
          subtotal: number
          descuento_porcentaje: number
          descuento_monto: number
          total: number
          moneda: Moneda
          notas: string | null
          gps_lat: number | null
          gps_lng: number | null
          requiere_autorizacion: boolean
          autorizado_por: string | null  // uuid, references profiles
          autorizado_at: string | null   // timestamptz
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          numero: string
          cliente_id?: string | null
          vendedor_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          fecha_pedido?: string
          fecha_despacho?: string | null
          estado?: EstadoPedido
          subtotal?: number
          descuento_porcentaje?: number
          descuento_monto?: number
          total?: number
          moneda?: Moneda
          notas?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          requiere_autorizacion?: boolean
          autorizado_por?: string | null
          autorizado_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          numero?: string
          cliente_id?: string | null
          vendedor_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          fecha_pedido?: string
          fecha_despacho?: string | null
          estado?: EstadoPedido
          subtotal?: number
          descuento_porcentaje?: number
          descuento_monto?: number
          total?: number
          moneda?: Moneda
          notas?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          requiere_autorizacion?: boolean
          autorizado_por?: string | null
          autorizado_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pedidos_cliente_id_fkey'
            columns: ['cliente_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedidos_vendedor_id_fkey'
            columns: ['vendedor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedidos_autorizado_por_fkey'
            columns: ['autorizado_por']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Pedidos Items ────────────────────────────────────────────────────
      pedidos_items: {
        Row: {
          id: string                     // uuid
          pedido_id: string              // uuid, references pedidos
          producto_id: string            // uuid, references productos
          lote_id: string | null         // uuid, references lotes
          cantidad: number
          precio_unitario: number
          descuento_porcentaje: number
          subtotal: number
        }
        Insert: {
          id?: string
          pedido_id: string
          producto_id: string
          lote_id?: string | null
          cantidad: number
          precio_unitario: number
          descuento_porcentaje?: number
          subtotal: number
        }
        Update: {
          id?: string
          pedido_id?: string
          producto_id?: string
          lote_id?: string | null
          cantidad?: number
          precio_unitario?: number
          descuento_porcentaje?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: 'pedidos_items_pedido_id_fkey'
            columns: ['pedido_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedidos_items_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedidos_items_lote_id_fkey'
            columns: ['lote_id']
            isOneToOne: false
            referencedRelation: 'lotes'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Comprobantes ─────────────────────────────────────────────────────
      comprobantes: {
        Row: {
          id: string                     // uuid
          tipo: TipoComprobante
          serie: string                  // F001, B001, NP01
          numero: string                 // correlativo
          pedido_id: string | null       // uuid, references pedidos
          cliente_id: string | null      // uuid, nullable para venta directa
          cliente_externo_nombre: string | null
          cliente_externo_doc: string | null
          facturador_id: string | null   // uuid, references profiles
          fecha_emision: string          // date
          fecha_vencimiento: string | null // date
          subtotal: number
          igv: number
          percepcion: number
          total: number
          moneda: Moneda
          tipo_cambio: number | null
          estado: EstadoComprobante
          sunat_estado: string | null
          sunat_cdr: string | null       // CDR XML en base64 o URL
          email_enviado: boolean
          whatsapp_enviado: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tipo: TipoComprobante
          serie: string
          numero: string
          pedido_id?: string | null
          cliente_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          facturador_id?: string | null
          fecha_emision?: string
          fecha_vencimiento?: string | null
          subtotal?: number
          igv?: number
          percepcion?: number
          total?: number
          moneda?: Moneda
          tipo_cambio?: number | null
          estado?: EstadoComprobante
          sunat_estado?: string | null
          sunat_cdr?: string | null
          email_enviado?: boolean
          whatsapp_enviado?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tipo?: TipoComprobante
          serie?: string
          numero?: string
          pedido_id?: string | null
          cliente_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          facturador_id?: string | null
          fecha_emision?: string
          fecha_vencimiento?: string | null
          subtotal?: number
          igv?: number
          percepcion?: number
          total?: number
          moneda?: Moneda
          tipo_cambio?: number | null
          estado?: EstadoComprobante
          sunat_estado?: string | null
          sunat_cdr?: string | null
          email_enviado?: boolean
          whatsapp_enviado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'comprobantes_pedido_id_fkey'
            columns: ['pedido_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comprobantes_cliente_id_fkey'
            columns: ['cliente_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comprobantes_facturador_id_fkey'
            columns: ['facturador_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Comprobantes Items ───────────────────────────────────────────────
      comprobantes_items: {
        Row: {
          id: string                     // uuid
          comprobante_id: string         // uuid, references comprobantes
          producto_id: string | null     // uuid, references productos
          descripcion: string
          cantidad: number
          precio_unitario: number
          subtotal: number
          igv_porcentaje: number         // 18 para IGV estándar
        }
        Insert: {
          id?: string
          comprobante_id: string
          producto_id?: string | null
          descripcion: string
          cantidad: number
          precio_unitario: number
          subtotal: number
          igv_porcentaje?: number
        }
        Update: {
          id?: string
          comprobante_id?: string
          producto_id?: string | null
          descripcion?: string
          cantidad?: number
          precio_unitario?: number
          subtotal?: number
          igv_porcentaje?: number
        }
        Relationships: [
          {
            foreignKeyName: 'comprobantes_items_comprobante_id_fkey'
            columns: ['comprobante_id']
            isOneToOne: false
            referencedRelation: 'comprobantes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comprobantes_items_producto_id_fkey'
            columns: ['producto_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Notas de Crédito ─────────────────────────────────────────────────
      notas_credito: {
        Row: {
          id: string                     // uuid
          comprobante_id: string         // uuid, references comprobantes
          numero: string
          motivo: string
          monto: number
          estado: 'emitido' | 'aceptado' | 'rechazado' | 'anulado'
          created_at: string
        }
        Insert: {
          id?: string
          comprobante_id: string
          numero: string
          motivo: string
          monto: number
          estado?: 'emitido' | 'aceptado' | 'rechazado' | 'anulado'
          created_at?: string
        }
        Update: {
          id?: string
          comprobante_id?: string
          numero?: string
          motivo?: string
          monto?: number
          estado?: 'emitido' | 'aceptado' | 'rechazado' | 'anulado'
        }
        Relationships: [
          {
            foreignKeyName: 'notas_credito_comprobante_id_fkey'
            columns: ['comprobante_id']
            isOneToOne: false
            referencedRelation: 'comprobantes'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Despachos ────────────────────────────────────────────────────────
      despachos: {
        Row: {
          id: string                     // uuid
          numero: string
          vehiculo_id: string | null     // uuid, references vehiculos
          conductor_id: string | null    // uuid, references profiles (repartidor)
          fecha_despacho: string         // date
          estado: EstadoDespacho
          total_pedidos: number
          total_monto: number
          notas: string | null
          created_at: string
          created_by: string | null      // uuid, references profiles
        }
        Insert: {
          id?: string
          numero: string
          vehiculo_id?: string | null
          conductor_id?: string | null
          fecha_despacho: string
          estado?: EstadoDespacho
          total_pedidos?: number
          total_monto?: number
          notas?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          numero?: string
          vehiculo_id?: string | null
          conductor_id?: string | null
          fecha_despacho?: string
          estado?: EstadoDespacho
          total_pedidos?: number
          total_monto?: number
          notas?: string | null
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'despachos_vehiculo_id_fkey'
            columns: ['vehiculo_id']
            isOneToOne: false
            referencedRelation: 'vehiculos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'despachos_conductor_id_fkey'
            columns: ['conductor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'despachos_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Despachos Items ──────────────────────────────────────────────────
      despachos_items: {
        Row: {
          id: string                     // uuid
          despacho_id: string            // uuid, references despachos
          pedido_id: string              // uuid, references pedidos
          comprobante_id: string | null  // uuid, references comprobantes
          estado: EstadoDespachoItem
          cobro_efectivo: number
          cobro_yape: number
          cobro_plin: number
          cobro_transferencia: number
          notas_entrega: string | null
        }
        Insert: {
          id?: string
          despacho_id: string
          pedido_id: string
          comprobante_id?: string | null
          estado?: EstadoDespachoItem
          cobro_efectivo?: number
          cobro_yape?: number
          cobro_plin?: number
          cobro_transferencia?: number
          notas_entrega?: string | null
        }
        Update: {
          id?: string
          despacho_id?: string
          pedido_id?: string
          comprobante_id?: string | null
          estado?: EstadoDespachoItem
          cobro_efectivo?: number
          cobro_yape?: number
          cobro_plin?: number
          cobro_transferencia?: number
          notas_entrega?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'despachos_items_despacho_id_fkey'
            columns: ['despacho_id']
            isOneToOne: false
            referencedRelation: 'despachos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'despachos_items_pedido_id_fkey'
            columns: ['pedido_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'despachos_items_comprobante_id_fkey'
            columns: ['comprobante_id']
            isOneToOne: false
            referencedRelation: 'comprobantes'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Cobros ───────────────────────────────────────────────────────────
      cobros: {
        Row: {
          id: string                     // uuid
          tipo: TipoCobro
          referencia_id: string | null   // uuid del pedido/comprobante
          cliente_id: string | null      // nullable para venta directa
          cliente_externo_nombre: string | null
          cliente_externo_doc: string | null
          cobrador_id: string | null     // uuid, references profiles
          fecha: string                  // date
          efectivo: number
          yape: number
          plin: number
          transferencia: number
          total: number
          voucher_url: string | null
          notas: string | null
          conciliado: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tipo: TipoCobro
          referencia_id?: string | null
          cliente_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          cobrador_id?: string | null
          fecha?: string
          efectivo?: number
          yape?: number
          plin?: number
          transferencia?: number
          total: number
          voucher_url?: string | null
          notas?: string | null
          conciliado?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tipo?: TipoCobro
          referencia_id?: string | null
          cliente_id?: string | null
          cliente_externo_nombre?: string | null
          cliente_externo_doc?: string | null
          cobrador_id?: string | null
          fecha?: string
          efectivo?: number
          yape?: number
          plin?: number
          transferencia?: number
          total?: number
          voucher_url?: string | null
          notas?: string | null
          conciliado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'cobros_cliente_id_fkey'
            columns: ['cliente_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cobros_cobrador_id_fkey'
            columns: ['cobrador_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Caja Sesiones ────────────────────────────────────────────────────
      caja_sesiones: {
        Row: {
          id: string                     // uuid
          cajero_id: string              // uuid, references profiles
          fecha_apertura: string         // timestamptz
          fecha_cierre: string | null    // timestamptz
          saldo_inicial: number
          saldo_final: number | null
          estado: EstadoCajaSesion
          created_at: string
        }
        Insert: {
          id?: string
          cajero_id: string
          fecha_apertura?: string
          fecha_cierre?: string | null
          saldo_inicial?: number
          saldo_final?: number | null
          estado?: EstadoCajaSesion
          created_at?: string
        }
        Update: {
          id?: string
          cajero_id?: string
          fecha_apertura?: string
          fecha_cierre?: string | null
          saldo_inicial?: number
          saldo_final?: number | null
          estado?: EstadoCajaSesion
        }
        Relationships: [
          {
            foreignKeyName: 'caja_sesiones_cajero_id_fkey'
            columns: ['cajero_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Caja Movimientos ─────────────────────────────────────────────────
      caja_movimientos: {
        Row: {
          id: string                     // uuid
          sesion_id: string              // uuid, references caja_sesiones
          tipo: TipoCajaMovimiento
          categoria: CategoriaCajaMovimiento
          referencia_id: string | null   // uuid del cobro u otro documento
          descripcion: string
          monto: number
          cobrador_id: string | null     // uuid, references profiles
          created_at: string
        }
        Insert: {
          id?: string
          sesion_id: string
          tipo: TipoCajaMovimiento
          categoria: CategoriaCajaMovimiento
          referencia_id?: string | null
          descripcion: string
          monto: number
          cobrador_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sesion_id?: string
          tipo?: TipoCajaMovimiento
          categoria?: CategoriaCajaMovimiento
          referencia_id?: string | null
          descripcion?: string
          monto?: number
          cobrador_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'caja_movimientos_sesion_id_fkey'
            columns: ['sesion_id']
            isOneToOne: false
            referencedRelation: 'caja_sesiones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'caja_movimientos_cobrador_id_fkey'
            columns: ['cobrador_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── GPS Checkins ─────────────────────────────────────────────────────
      gps_checkins: {
        Row: {
          id: string                     // uuid
          usuario_id: string             // uuid, references profiles
          cliente_id: string | null      // uuid, references clientes
          tipo: TipoGpsCheckin
          latitud: number
          longitud: number
          precision_metros: number | null
          foto_url: string | null
          notas: string | null
          created_at: string
        }
        Insert: {
          id?: string
          usuario_id: string
          cliente_id?: string | null
          tipo: TipoGpsCheckin
          latitud: number
          longitud: number
          precision_metros?: number | null
          foto_url?: string | null
          notas?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          usuario_id?: string
          cliente_id?: string | null
          tipo?: TipoGpsCheckin
          latitud?: number
          longitud?: number
          precision_metros?: number | null
          foto_url?: string | null
          notas?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'gps_checkins_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gps_checkins_cliente_id_fkey'
            columns: ['cliente_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id']
          }
        ]
      }

      // ── GPS Ubicaciones (tracking continuo) ──────────────────────────────
      gps_ubicaciones: {
        Row: {
          id: string                     // uuid
          usuario_id: string             // uuid, references profiles
          latitud: number
          longitud: number
          precision_metros: number | null
          created_at: string
        }
        Insert: {
          id?: string
          usuario_id: string
          latitud: number
          longitud: number
          precision_metros?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          usuario_id?: string
          latitud?: number
          longitud?: number
          precision_metros?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'gps_ubicaciones_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Tipo de Cambio ───────────────────────────────────────────────────
      tipo_cambio: {
        Row: {
          id: string                     // uuid
          fecha: string                  // date (unique)
          compra: number                 // tipo cambio compra USD/PEN
          venta: number                  // tipo cambio venta USD/PEN
          fuente: string | null          // 'SBS' | 'manual'
          created_at: string
        }
        Insert: {
          id?: string
          fecha: string
          compra: number
          venta: number
          fuente?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          fecha?: string
          compra?: number
          venta?: number
          fuente?: string | null
        }
        Relationships: []
      }

      // ── Comisiones Reglas ────────────────────────────────────────────────
      comisiones_reglas: {
        Row: {
          id: string                     // uuid
          vendedor_id: string | null     // uuid, references profiles (null = aplica a todos)
          familia_id: string | null      // uuid, references familias (null = aplica a todas)
          porcentaje: number | null      // comisión como % del subtotal
          monto_fijo: number | null      // comisión fija por unidad
          objetivo_mensual: number | null // meta de ventas mensual en PEN
          activo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          vendedor_id?: string | null
          familia_id?: string | null
          porcentaje?: number | null
          monto_fijo?: number | null
          objetivo_mensual?: number | null
          activo?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          vendedor_id?: string | null
          familia_id?: string | null
          porcentaje?: number | null
          monto_fijo?: number | null
          objetivo_mensual?: number | null
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'comisiones_reglas_vendedor_id_fkey'
            columns: ['vendedor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comisiones_reglas_familia_id_fkey'
            columns: ['familia_id']
            isOneToOne: false
            referencedRelation: 'familias'
            referencedColumns: ['id']
          }
        ]
      }

      // ── Configuración ────────────────────────────────────────────────────
      configuracion: {
        Row: {
          id: string                     // uuid
          clave: string                  // unique, ej: 'gps_radio_checkin'
          valor: string                  // stored as text, parse as needed
          descripcion: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          clave: string
          valor: string
          descripcion?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          clave?: string
          valor?: string
          descripcion?: string | null
          updated_at?: string
        }
        Relationships: []
      }

    }

    // ─── Views ────────────────────────────────────────────────────────────
    Views: {
      // Vista de stock disponible (cantidad - cantidad_reservada)
      v_stock_disponible: {
        Row: {
          producto_id: string
          codigo: string
          nombre: string
          familia: string | null
          unidad: string | null
          cantidad: number
          cantidad_reservada: number
          disponible: number
          costo_promedio: number
        }
        Relationships: []
      }
      // Vista resumen de pedidos con datos del cliente
      v_pedidos_resumen: {
        Row: {
          id: string
          numero: string
          cliente: string
          vendedor: string | null
          fecha_pedido: string
          estado: EstadoPedido
          total: number
          moneda: Moneda
          items_count: number | null
        }
        Relationships: []
      }
    }

    // ─── Functions ────────────────────────────────────────────────────────
    Functions: {
      get_stock_disponible: {
        Args: { producto_id: string }
        Returns: number
      }
      get_precio_producto: {
        Args: { producto_id: string; lista_precio_id: string }
        Returns: number | null
      }
      handle_new_user: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
    }

    // ─── Enums (Postgres) ─────────────────────────────────────────────────
    Enums: {
      user_role: UserRole
      estado_cliente: EstadoCliente
      tipo_cliente: TipoCliente
      estado_pedido: EstadoPedido
      tipo_comprobante: TipoComprobante
      estado_comprobante: EstadoComprobante
      estado_orden_compra: EstadoOrdenCompra
      estado_despacho: EstadoDespacho
      estado_despacho_item: EstadoDespachoItem
      tipo_movimiento_stock: TipoMovimientoStock
      tipo_vehiculo: TipoVehiculo
      metodo_valorizacion: MetodoValorizacion
      moneda: Moneda
      estado_caja_sesion: EstadoCajaSesion
      tipo_gps_checkin: TipoGpsCheckin
      tipo_cobro: TipoCobro
      tipo_caja_movimiento: TipoCajaMovimiento
      categoria_caja_movimiento: CategoriaCajaMovimiento
      lista_precio_nombre: ListaPrecioNombre
    }

    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ─── Helpers de tipo para acceso más fácil ───────────────────────────────────

/** Extrae el tipo Row de una tabla */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

/** Extrae el tipo Insert de una tabla */
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

/** Extrae el tipo Update de una tabla */
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

/** Extrae el tipo Row de una vista */
export type Views<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row']

/** Extrae el tipo de retorno de una función */
export type Functions<T extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][T]['Returns']

/** Extrae el tipo de enum */
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// ─── Tipos concretos de cada tabla ───────────────────────────────────────────

export type Profile            = Tables<'profiles'>
export type Zona               = Tables<'zonas'>
export type Familia            = Tables<'familias'>
export type UnidadMedida       = Tables<'unidades_medida'>
export type ListaPrecio        = Tables<'listas_precio'>
export type Cliente            = Tables<'clientes'>
export type Proveedor          = Tables<'proveedores'>
export type Producto           = Tables<'productos'>
export type ListaPrecioItem    = Tables<'lista_precio_items'>
export type Lote               = Tables<'lotes'>
export type Vehiculo           = Tables<'vehiculos'>
export type OrdenCompra        = Tables<'ordenes_compra'>
export type OrdenCompraItem    = Tables<'ordenes_compra_items'>
export type Compra             = Tables<'compras'>
export type CompraItem         = Tables<'compras_items'>
export type Stock              = Tables<'stock'>
export type MovimientoStock    = Tables<'movimientos_stock'>
export type Pedido             = Tables<'pedidos'>
export type PedidoItem         = Tables<'pedidos_items'>
export type Comprobante        = Tables<'comprobantes'>
export type ComprobanteItem    = Tables<'comprobantes_items'>
export type NotaCredito        = Tables<'notas_credito'>
export type Despacho           = Tables<'despachos'>
export type DespachoItem       = Tables<'despachos_items'>
export type Cobro              = Tables<'cobros'>
export type CajaSesion         = Tables<'caja_sesiones'>
export type CajaMovimiento     = Tables<'caja_movimientos'>
export type GpsCheckin         = Tables<'gps_checkins'>
export type GpsUbicacion       = Tables<'gps_ubicaciones'>
export type TipoCambio         = Tables<'tipo_cambio'>
export type ComisionRegla      = Tables<'comisiones_reglas'>
export type Configuracion      = Tables<'configuracion'>

// Tipos Insert
export type ProfileInsert         = TablesInsert<'profiles'>
export type ClienteInsert         = TablesInsert<'clientes'>
export type ProductoInsert        = TablesInsert<'productos'>
export type PedidoInsert          = TablesInsert<'pedidos'>
export type PedidoItemInsert      = TablesInsert<'pedidos_items'>
export type ComprobanteInsert     = TablesInsert<'comprobantes'>
export type CompraInsert          = TablesInsert<'compras'>
export type CompraItemInsert      = TablesInsert<'compras_items'>
export type DespachoInsert        = TablesInsert<'despachos'>
export type DespachoItemInsert    = TablesInsert<'despachos_items'>
export type CobroInsert           = TablesInsert<'cobros'>
export type MovimientoStockInsert = TablesInsert<'movimientos_stock'>
export type GpsCheckinInsert      = TablesInsert<'gps_checkins'>

// Tipos Update
export type PedidoUpdate      = TablesUpdate<'pedidos'>
export type ClienteUpdate     = TablesUpdate<'clientes'>
export type ProductoUpdate    = TablesUpdate<'productos'>
export type ComprobanteUpdate = TablesUpdate<'comprobantes'>
export type DespachoUpdate    = TablesUpdate<'despachos'>
export type StockUpdate       = TablesUpdate<'stock'>

// ─── Tipos compuestos (joins frecuentes) ─────────────────────────────────────

export interface PedidoConItems extends Pedido {
  items: (PedidoItem & { producto: Pick<Producto, 'id' | 'codigo' | 'nombre'> })[]
  cliente: Pick<Cliente, 'id' | 'ruc' | 'dni' | 'razon_social' | 'telefono' | 'direccion'>
  vendedor: Pick<Profile, 'id' | 'full_name' | 'telefono'>
}

export interface ComprobanteConItems extends Comprobante {
  items: ComprobanteItem[]
  cliente: Pick<Cliente, 'id' | 'razon_social' | 'ruc' | 'dni' | 'direccion'>
  pedido?: Pick<Pedido, 'id' | 'numero'> | null
}

export interface DespachoConItems extends Despacho {
  items: (DespachoItem & {
    pedido: Pick<Pedido, 'id' | 'numero' | 'total'>
    comprobante?: Pick<Comprobante, 'id' | 'tipo' | 'serie' | 'numero'> | null
  })[]
  vehiculo?: Pick<Vehiculo, 'id' | 'placa' | 'descripcion'> | null
  conductor?: Pick<Profile, 'id' | 'full_name' | 'telefono'> | null
}

export interface ProductoConStock extends Producto {
  stock?: Pick<Stock, 'cantidad' | 'cantidad_reservada' | 'costo_promedio'> | null
  familia?: Pick<Familia, 'id' | 'nombre'> | null
  unidad_medida?: Pick<UnidadMedida, 'id' | 'nombre' | 'simbolo'> | null
}

export interface ClienteConVendedor extends Cliente {
  vendedor?: Pick<Profile, 'id' | 'full_name' | 'telefono'> | null
  zona?: Pick<Zona, 'id' | 'nombre'> | null
  lista_precio?: Pick<ListaPrecio, 'id' | 'nombre'> | null
}
