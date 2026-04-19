'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserRole } from '@/types'

const roleRedirects: Record<UserRole, string> = {
  gerente: '/dashboard',
  administrador: '/dashboard',
  facturador: '/facturacion',
  almacenero: '/almacen',
  contador: '/contabilidad',
  vendedor: '/pwa/pedidos',
  repartidor: '/pwa/cobros',
}

// Credenciales de prueba para facilitar testing de cada rol
const CREDENCIALES_PRUEBA = [
  { rol: 'Administrador', email: 'admin@agrocar.pe', password: 'admin123' },
  { rol: 'Gerente', email: 'gerente@agrocar.pe', password: 'gerente123' },
  { rol: 'Facturador', email: 'facturador@agrocar.pe', password: 'facturador123' },
  { rol: 'Almacenero', email: 'almacen@agrocar.pe', password: 'almacen123' },
  { rol: 'Contador', email: 'contador@agrocar.pe', password: 'contador123' },
  { rol: 'Vendedor', email: 'vendedor1@agrocar.pe', password: 'vendedor123' },
  { rol: 'Repartidor', email: 'repartidor1@agrocar.pe', password: 'repartidor123' },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCredenciales, setShowCredenciales] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        let mensaje: string
        if (authError.message.includes('Invalid login credentials')) {
          mensaje = 'Correo o contraseña incorrectos. Verifica tus datos.'
        } else if (authError.message.includes('Email not confirmed')) {
          mensaje = 'Tu cuenta no ha sido confirmada. Revisa tu correo.'
        } else {
          mensaje = authError.message
        }
        setError(mensaje)
        toast.error('No se pudo iniciar sesión', { description: mensaje })
        return
      }

      if (!data.user) {
        const mensaje = 'No se pudo iniciar sesión. Intenta nuevamente.'
        setError(mensaje)
        toast.error('Error de autenticación', { description: mensaje })
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, role, activo')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profile) {
        const mensaje = 'No se encontró el perfil de usuario. Contacta al administrador.'
        setError(mensaje)
        toast.error('Perfil no encontrado', { description: mensaje })
        return
      }

      if (!profile.activo) {
        await supabase.auth.signOut()
        const mensaje = 'Tu cuenta está desactivada. Contacta al administrador.'
        setError(mensaje)
        toast.error('Cuenta desactivada', { description: mensaje })
        return
      }

      const destination = roleRedirects[profile.role as UserRole] ?? '/dashboard'
      toast.success(`Bienvenido, ${profile.full_name ?? email}`, {
        description: 'Redirigiendo...',
      })
      router.push(destination)
    } catch {
      const mensaje = 'Ocurrió un error inesperado. Intenta nuevamente.'
      setError(mensaje)
      toast.error('Error inesperado', { description: mensaje })
    } finally {
      setLoading(false)
    }
  }

  // Rellena las credenciales en el formulario al hacer clic en una fila de prueba
  const usarCredencial = (cred: typeof CREDENCIALES_PRUEBA[number]) => {
    setEmail(cred.email)
    setPassword(cred.password)
    setShowCredenciales(false)
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-br from-yellow-50 via-white to-yellow-100">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo y título con halo amarillo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            {/* Halo pulsante detrás del logo */}
            <div className="absolute inset-0 bg-yellow-300/40 rounded-3xl blur-2xl animate-pulse" />
            <div className="relative flex items-center justify-center">
              <Image
                src="/logo-agrocar.png"
                alt="AGROCAR"
                width={200}
                height={100}
                priority
                className="object-contain"
              />
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Sistema ERP Integral &middot; AGROCAR S.R.L.
          </p>
        </div>

        <Card className="shadow-2xl shadow-black/10 border-0 bg-white/95 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-gray-800">Iniciar Sesión</CardTitle>
            <CardDescription>Ingresa tus credenciales para acceder al sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Mensaje de error inline */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Correo electrónico
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="usuario@agrocar.pe"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 border-gray-200 focus:border-[#FBE600] focus:ring-[#FBE600]"
                />
              </div>

              {/* Contraseña */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Contraseña
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="h-11 pr-11 border-gray-200 focus:border-[#FBE600] focus:ring-[#FBE600]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Botón de envío */}
              <Button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full h-11 bg-[#FBE600] hover:bg-[#E5D100] text-black font-bold mt-2 shadow-md shadow-yellow-400/30 transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Iniciando sesión...
                  </>
                ) : (
                  'Iniciar Sesión'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Card colapsable con credenciales de prueba para testing */}
        <Card className="mt-4 border border-gray-200 bg-white/70 backdrop-blur">
          <button
            type="button"
            onClick={() => setShowCredenciales(!showCredenciales)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-700" />
              Ver credenciales de prueba
            </span>
            {showCredenciales ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {showCredenciales && (
            <div className="border-t border-gray-100 px-2 py-2 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
              {CREDENCIALES_PRUEBA.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  onClick={() => usarCredencial(c)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-yellow-50 transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-gray-800">{c.rol}</div>
                    <div className="text-xs text-gray-500 font-mono truncate">{c.email}</div>
                  </div>
                  <span className="text-xs text-gray-400 font-mono shrink-0 hidden sm:inline">
                    {c.password}
                  </span>
                </button>
              ))}
              <p className="text-[10px] text-gray-400 px-3 py-1 text-center">
                Haz clic en cualquier fila para autocompletar el formulario.
              </p>
            </div>
          )}
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">
          AGROCAR S.R.L. &middot; Tacna, Perú &middot; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
