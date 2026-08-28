-- ═══════════════════════════════════════════════════════════════════════════
-- 105 · Los históricos no se declaran
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El ERP tiene 409 comprobantes emitidos antes de conectarse a SUNAT. No se
-- van a declarar: la sincronización arranca el día que el sistema entra en
-- línea, y lo anterior queda como está.
--
-- Que eso dependa de que nadie apriete el botón equivocado es frágil —una
-- pantalla con un filtro mal puesto, un "seleccionar todo", y se declaran
-- cuatrocientos comprobantes de golpe, cada uno fuera de plazo y ninguno
-- reversible sin su propia nota de crédito—. Así que la fecha de corte vive
-- acá y la respeta el servidor, no la pantalla.
--
-- Arranca en NULL a propósito: mientras no haya fecha, producción no acepta
-- ningún comprobante. Hay que ponerla a conciencia el día del arranque.
--
-- El corte no aplica a beta: ahí nada queda declarado y conviene poder probar
-- con cualquier comprobante.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO configuracion (clave, valor, descripcion)
VALUES
  ('sunat_sincronizar_desde', '',
   'Fecha (AAAA-MM-DD) desde la que se declaran comprobantes a SUNAT. Vacio: no se declara ninguno. Lo anterior a esta fecha nunca se envia.')
ON CONFLICT (clave) DO NOTHING;
