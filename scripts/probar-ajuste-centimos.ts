/**
 * Prueba sin red del ajuste de medio céntimo (ubl.ts, ajusteDeCentimos).
 *   npx tsx scripts/probar-ajuste-centimos.ts
 */
import { ajusteDeCentimos } from '../src/lib/sunat/ubl'

const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const suma = (c: number[]) => c.reduce((a, x) => a + x, 0) / 100

// B002-615 real: impreso 641.22
const b615 = [
  { cantidad: 25.35, precio_unitario: 12 }, { cantidad: 3.05, precio_unitario: 17.7 },
  { cantidad: 3.28, precio_unitario: 49.7 }, { cantidad: 6.35, precio_unitario: 18.9 },
]
const sin = ajusteDeCentimos(b615)
const con = ajusteDeCentimos(b615, 641.22)
check('Sin total impreso: queda como antes (641.21)', suma(sin) === 641.21, `${suma(sin)}`)
check('Con total impreso: suma lo impreso (641.22)', suma(con) === 641.22, `${suma(con)}`)
check('Solo cambia un céntimo en una línea', con.filter((c, i) => c !== sin[i]).length === 1, con.map((c, i) => c !== sin[i] ? `línea ${i + 1}: ${sin[i] / 100}→${c / 100}` : '').filter(Boolean).join(', '))
check('Ninguna línea se aparta más de un céntimo de cantidad × precio', con.every((c, i) => Math.abs(c - b615[i].cantidad * b615[i].precio_unitario * 100) <= 1))

// Si ya coincide, no se toca nada
const ok = [{ cantidad: 25, precio_unitario: 14.24 }]
check('Si ya coincide, no toca nada', JSON.stringify(ajusteDeCentimos(ok, 356)) === JSON.stringify([35600]))
// Diferencia grande: no se "arregla" (la barrera de totales la sigue frenando)
check('Diferencia de más de 2 céntimos: no se ajusta', suma(ajusteDeCentimos(b615, 641.30)) === 641.21)
// Para abajo
check('Si el impreso es menor, resta un céntimo', suma(ajusteDeCentimos(b615, 641.20)) === 641.20)

console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
if (res.some((v) => !v)) process.exit(1)
