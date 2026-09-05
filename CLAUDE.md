# AGROCAR ERP — notas para trabajar en este repositorio

## Git: empujar SIEMPRE con la cuenta Promptivegrowth

En esta computadora hay **varias cuentas de GitHub** y cada una trabaja en
entornos distintos. **Nunca confiar en la cuenta activa por omisión.**

Este repositorio se empuja a `promptive`, y ese remoto pertenece a
**Promptivegrowth**. Vercel despliega desde ahí — desde `origin` no.

```bash
gh auth switch -u Promptivegrowth
git push promptive main
```

Si la cuenta activa es otra, el push falla con:

```
remote: Permission to Promptivegrowth/AGROCAR-ERP-FULL-.git denied to <otra cuenta>
fatal: ... The requested URL returned error: 403
```

Comprobar antes de empujar:

```bash
gh auth status          # cuál está activa
git remote -v           # promptive → Promptivegrowth/AGROCAR-ERP-FULL-
```

Después de empujar, verificar que llegó:

```bash
git rev-parse --short HEAD promptive/main    # los dos tienen que coincidir
```

## Remotos

| Remoto | Repositorio | Para qué |
|---|---|---|
| `promptive` | `Promptivegrowth/AGROCAR-ERP-FULL-` | **el que despliega Vercel** |
| `origin` | `bravoacamus-droid/Agrocar-SRL-ERP-MONOREPO` | espejo; puede no tener permiso |

## Secretos

Nunca entran al repositorio: el certificado digital (`*.pfx`, `*.p12`), su
contraseña, las credenciales SOL de SUNAT ni las llaves de Supabase. Van por
variables de entorno; `.env.local` y `.sunat/` están ignorados.
