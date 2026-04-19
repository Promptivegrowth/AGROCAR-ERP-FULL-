export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // El fondo con gradiente se aplica en la página de login directamente
  return <div className="min-h-screen">{children}</div>
}
