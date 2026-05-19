-- ============================================================================
-- DEMO: Aurora PostgreSQL como origen del Zero-ETL
-- Ejecutar conectado a Aurora (psql, DBeaver, pgAdmin, RDS Query Editor)
-- ============================================================================

-- IMPORTANTE: Zero-ETL exige que TODAS las tablas tengan PRIMARY KEY.
-- Sin PK la tabla se replica en estado "failed" y no aparece en Redshift.

-- ----------------------------------------------------------------------------
-- 1. Crear tablas de un mini e-commerce
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS order_items, orders, products, customers CASCADE;

CREATE TABLE customers (
    customer_id   SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     VARCHAR(200) NOT NULL,
    country       VARCHAR(2)   NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
    product_id    SERIAL PRIMARY KEY,
    sku           VARCHAR(50)  NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    category      VARCHAR(50)  NOT NULL,
    price_cents   INTEGER      NOT NULL,
    stock         INTEGER      NOT NULL DEFAULT 0
);

CREATE TABLE orders (
    order_id      SERIAL PRIMARY KEY,
    customer_id   INTEGER REFERENCES customers(customer_id),
    status        VARCHAR(20)  NOT NULL,
    total_cents   INTEGER      NOT NULL,
    placed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id      INTEGER REFERENCES orders(order_id),
    product_id    INTEGER REFERENCES products(product_id),
    quantity      INTEGER NOT NULL,
    unit_cents    INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- 2. Carga inicial (snapshot que verás replicado a Redshift en ~1-2 min)
-- ----------------------------------------------------------------------------

INSERT INTO customers (email, full_name, country) VALUES
  ('ana@example.com',   'Ana Gomez',      'CO'),
  ('luis@example.com',  'Luis Perez',     'MX'),
  ('maria@example.com', 'Maria Fernanda', 'CO'),
  ('john@example.com',  'John Doe',       'US'),
  ('sara@example.com',  'Sara Lopez',     'AR');

INSERT INTO products (sku, name, category, price_cents, stock) VALUES
  ('SKU-001', 'Camiseta CDK',         'apparel',    25000, 100),
  ('SKU-002', 'Mug Lambda',           'drinkware',  15000,  50),
  ('SKU-003', 'Sticker pack AWS',     'stickers',    5000, 500),
  ('SKU-004', 'Gorra serverless',     'apparel',    30000,  40),
  ('SKU-005', 'Libro Cloud Patterns', 'books',      80000,  20);

INSERT INTO orders (customer_id, status, total_cents) VALUES
  (1, 'paid',     40000),
  (2, 'paid',     30000),
  (3, 'pending',  85000),
  (1, 'paid',     15000),
  (4, 'shipped', 110000);

INSERT INTO order_items (order_id, product_id, quantity, unit_cents) VALUES
  (1, 1, 1, 25000), (1, 3, 3, 5000),
  (2, 4, 1, 30000),
  (3, 5, 1, 80000), (3, 3, 1, 5000),
  (4, 2, 1, 15000),
  (5, 1, 2, 25000), (5, 4, 2, 30000);

-- ----------------------------------------------------------------------------
-- 3. Verificar que el snapshot está completo en Aurora
-- ----------------------------------------------------------------------------

SELECT 'customers'    AS tabla, COUNT(*) FROM customers
UNION ALL SELECT 'products',    COUNT(*) FROM products
UNION ALL SELECT 'orders',      COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items;

-- ----------------------------------------------------------------------------
-- 4. PARA LA DEMO EN VIVO: ejecutar esto DESPUÉS de mostrar Redshift
-- Cambios incrementales que verás replicados en segundos
-- ----------------------------------------------------------------------------

-- INSERT en vivo (ejecuta esto durante la charla):
-- INSERT INTO customers (email, full_name, country)
-- VALUES ('demo-en-vivo@example.com', 'Demo Live', 'CO');

-- UPDATE en vivo:
-- UPDATE products SET stock = stock - 1 WHERE sku = 'SKU-001';

-- DELETE en vivo:
-- DELETE FROM order_items WHERE order_item_id = 8;
