import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = 'PEN'): string {
  if (currency === 'PEN') {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: 'PEN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export function formatDatetime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

export const ROLES_LABELS: Record<string, string> = {
  gerente: 'Gerente',
  administrador: 'Administrador',
  facturador: 'Facturador',
  almacenero: 'Almacenero',
  vendedor: 'Vendedor',
  repartidor: 'Repartidor',
  contador: 'Contador',
}

export const ESTADO_CLIENTE_COLORS: Record<string, string> = {
  activo: 'success',
  inactivo: 'secondary',
  deudor: 'warning',
  de_baja: 'destructive',
}
