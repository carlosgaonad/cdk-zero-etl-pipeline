-- ============================================================================
-- DEMO: Redshift Serverless como destino del Zero-ETL
-- Ejecutar conectado al workgroup (Redshift Query Editor v2)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL ÚLTIMO PASO MANUAL (no se puede hacer desde CDK/CFN)
-- Ejecutar UNA VEZ tras el deploy del ZeroEtlStack.
-- ----------------------------------------------------------------------------

-- Obtener el integration_id de la integración recién creada:
SELECT integration_id, source, target_database
FROM svv_integration;
-- Copia el integration_id de la fila correspondiente.

-- Crear la base de datos destino apuntando a la integración.
-- Reemplaza <INTEGRATION_ID> con el valor de arriba.
-- El nombre 'demodb' debe COINCIDIR con el defaultDatabaseName de Aurora.
CREATE DATABASE aurora_data
  FROM INTEGRATION '<INTEGRATION_ID>'
  DATABASE demodb;

-- Verificar el estado de la replicación inicial:
SELECT integration_id, target_database, state, last_commit_timestamp
FROM svv_integration_table_state
ORDER BY last_commit_timestamp DESC;
-- Estados esperados: Synced (ok), ResyncInitiated, ResyncRequired, Failed.

-- ----------------------------------------------------------------------------
-- 2. Una vez en estado Synced: consultas analíticas
-- Las tablas son READ-ONLY en Redshift. Las queries van en milisegundos.
-- ----------------------------------------------------------------------------

-- Ingresos totales por país (join entre tablas replicadas)
SELECT c.country,
       COUNT(DISTINCT o.order_id) AS num_orders,
       SUM(o.total_cents) / 100.0 AS revenue_usd
FROM   aurora_data.public.orders     o
JOIN   aurora_data.public.customers  c USING (customer_id)
WHERE  o.status IN ('paid', 'shipped')
GROUP  BY c.country
ORDER  BY revenue_usd DESC;

-- Top productos por unidades vendidas
SELECT p.name,
       p.category,
       SUM(oi.quantity)          AS units_sold,
       SUM(oi.quantity * oi.unit_cents) / 100.0 AS revenue_usd
FROM   aurora_data.public.order_items oi
JOIN   aurora_data.public.products    p USING (product_id)
GROUP  BY p.name, p.category
ORDER  BY units_sold DESC;

-- ----------------------------------------------------------------------------
-- 3. DEMO EN VIVO: tras ejecutar el INSERT en Aurora, reconsulta:
-- ----------------------------------------------------------------------------

-- Buscar el cliente recién insertado (debe aparecer en ~5-30 segundos)
SELECT customer_id, email, full_name, created_at
FROM   aurora_data.public.customers
WHERE  email LIKE 'demo-en-vivo%';

-- ----------------------------------------------------------------------------
-- 4. Lo que NO se puede hacer (importante para la charla)
-- ----------------------------------------------------------------------------

-- Estas operaciones FALLAN porque las tablas Zero-ETL son read-only:
--   INSERT INTO aurora_data.public.customers ...        -- ERROR
--   CREATE TABLE x AS SELECT ... FROM aurora_data...    -- ERROR
--   UPDATE aurora_data.public.products SET ...          -- ERROR

-- Si quieres transformar los datos, debes crear una base local de Redshift
-- y materializar ahí:
CREATE DATABASE analytics;

-- Luego desde analytics puedes hacer CTAS leyendo del cross-database read:
-- CREATE TABLE analytics.public.daily_revenue AS
-- SELECT DATE(placed_at) AS day, SUM(total_cents)/100.0 AS revenue
-- FROM aurora_data.public.orders
-- GROUP BY DATE(placed_at);
