import { Router } from "express";
import bcrypt from "bcryptjs";
import { q } from "../db.js";
import { signAdminJwt, requireAdmin } from "../auth.js";
import { upload } from "../utils/multer.js";

const r = Router();

/** AUTH: POST /admin/auth/login */
r.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "EMAIL_PASSWORD_REQUIRED" });
  const { rows } = await q("SELECT id, email, password_hash, role, is_active FROM users WHERE email=$1", [email]);
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  const token = signAdminJwt(user);
  return res.json({ access_token: token, expires_in: Number(process.env.JWT_TTL_SECONDS || 86400) });
});

/** ADMIN-ONLY BELOW */
r.use(requireAdmin);

/** POST /admin/uploads (multipart) => { url, filename, mime, size } */
r.post("/uploads", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: "FILE_REQUIRED" });
  const base = process.env.PUBLIC_BASE_URL || "";
  const url = `${base}/uploads/${f.filename}`;
  return res.json({ url, filename: f.originalname, mime: f.mimetype, size: f.size });
});

/** CATEGORIES CRUD (минимум) */
r.post("/categories", async (req, res) => {
  const { name, slug, parent_id = null, is_active = true, featured_only = false, sort_order = 0 } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "NAME_SLUG_REQUIRED" });
  // path: берём path родителя + /slug или root/slug
  let path = `root/${slug}`;
  if (parent_id) {
    const { rows: pr } = await q("SELECT path FROM categories WHERE id=$1", [parent_id]);
    if (!pr[0]) return res.status(400).json({ error: "PARENT_NOT_FOUND" });
    path = `${pr[0].path}/${slug}`;
  }
  const { rows } = await q(
    `INSERT INTO categories(name,slug,parent_id,path,is_active,featured_only,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, slug, parent_id, path, is_active, featured_only, sort_order]
  );
  return res.status(201).json(rows[0]);
});

r.get("/categories", async (req, res) => {
  const { rows } = await q("SELECT * FROM categories ORDER BY parent_id NULLS FIRST, sort_order, id");
  res.json(rows);
});

/** PRODUCTS CRUD (минимум) */
r.post("/products", async (req, res) => {
  const {
    name, slug, sku = null, price, is_active = true, is_featured = false, category_id,
    primary_image_url = null, gallery = [], doc_url = null, doc_meta = null,
    content_html = null, specs_html = null
  } = req.body || {};
  if (!name || !slug || !Number.isInteger(price) || !category_id) {
    return res.status(400).json({ error: "REQUIRED_FIELDS: name, slug, price(int), category_id" });
  }
  const { rows } = await q(
    `INSERT INTO products(name,slug,sku,price,is_active,is_featured,category_id,
      primary_image_url,gallery,doc_url,doc_meta,content_html,specs_html)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [name, slug, sku, price, is_active, is_featured, category_id,
     primary_image_url, JSON.stringify(gallery), doc_url, doc_meta, content_html, specs_html]
  );
  return res.status(201).json(rows[0]);
});

r.get("/products", async (req, res) => {
  const { q: qq, category_id, is_active } = req.query;
  const params = [];
  let sql = "SELECT * FROM products WHERE 1=1";
  if (qq) { params.push(`%${qq}%`); sql += ` AND name ILIKE $${params.length}`; }
  if (category_id) { params.push(Number(category_id)); sql += ` AND category_id = $${params.length}`; }
  if (is_active !== undefined) { params.push(is_active === "true"); sql += ` AND is_active = $${params.length}`; }
  sql += " ORDER BY id DESC LIMIT 200";
  const { rows } = await q(sql, params);
  res.json(rows);
});

export default r;
