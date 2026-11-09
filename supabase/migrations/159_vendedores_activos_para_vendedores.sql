-- Un vendedor también puede elegir el vendedor al armar un pedido en el ERP.
--
-- Javier, 09/11/2026: en la interfaz del vendedor (escritorio) el selector de
-- vendedor del nuevo pedido salía vacío, "así como se hace en la interfaz de
-- caja". vendedores_activos solo devolvía la lista a administración, gerencia,
-- facturador, caja y contador. Ahora también al vendedor (son nombres de los
-- vendedores activos; crear_pedido_atomico ya guarda el vendedor elegido).

CREATE OR REPLACE FUNCTION public.vendedores_activos()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name::text
    FROM profiles p
   WHERE p.role::text = 'vendedor' AND p.activo
     AND EXISTS (SELECT 1 FROM profiles yo WHERE yo.id = auth.uid()
                 AND yo.activo AND yo.role::text IN ('administrador', 'gerente', 'facturador', 'caja', 'contador', 'vendedor'))
   ORDER BY p.full_name
$function$;
