import { Router } from "express";
import { q } from "../db.js";

const r = Router();

r.get("/health", (req, res) => res.json({ status: "ok" }));

/** Папка с файлами как статика */
r.get("/uploads/:file", (req, res) => {
  // фактически статику отдаёт express.static в index.js — этот роут на всякий случай
  res.status(404).end();
});

/** GET /products/:slug — карточка товара */
r.get("/products/:slug", async (req, res) => {
  const { rows } = await q("SELECT * FROM products WHERE slug=$1 AND is_active=true", [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(rows[0]);
});

/** POST /orders — оформление заказа */
r.post("/orders", async (req, res) => {
  const { idempotency_key = null, customer_name, email, phone, comment, address_json = null, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "ITEMS_REQUIRED" });

  // идемпотентность (если ключ передан)
  if (idempotency_key) {
    const { rows: ex } = await q("SELECT id FROM orders WHERE idempotency_key=$1", [idempotency_key]);
    if (ex[0]) return res.status(200).json({ order_id: ex[0].id, status: "duplicate" });
  }

  // подтянем актуальные цены и проверим активность
  const ids = items.map(it => Number(it.product_id)).filter(Boolean);
  const { rows: prods } = await q(`SELECT id, price, is_active FROM products WHERE id = ANY($1::int[])`, [ids]);
  const map = new Map(prods.map(p => [p.id, p]));
  let total = 0;
  for (const it of items) {
    const p = map.get(Number(it.product_id));
    if (!p || !p.is_active) return res.status(400).json({ error: "INVALID_PRODUCT", product_id: it.product_id });
    const qty = Number(it.qty || 0);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "INVALID_QTY", product_id: it.product_id });
    total += p.price * qty;
  }

  // создаём заказ
  const { rows: ord } = await q(
    `INSERT INTO orders(customer_name,email,phone,comment,address_json,total_amount,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [customer_name, email, phone, comment, address_json, total, idempotency_key]
  );
  const orderId = ord[0].id;

  // позиции
  const values = [];
  const params = [];
  let i = 1;
  for (const it of items) {
    const p = map.get(Number(it.product_id));
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(orderId, Number(it.product_id), Number(it.qty), p.price);
  }
  await q(
    `INSERT INTO order_items(order_id, product_id, qty, price_at_purchase)
     VALUES ${values.join(",")}`, params
  );

  // TODO: отправка email (позже добавим SMTP)
  return res.status(201).json({ order_id: orderId, total_amount: total });
});

export default r;
