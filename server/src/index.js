import "dotenv/config.js";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "node:path";
import adminRoutes from "./routes/admin.js";
import publicRoutes from "./routes/public.js";
import { q } from "./db.js";
import bcrypt from "bcryptjs";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// статика для загруженных файлов
app.use("/uploads", express.static(path.join("/app/uploads")));

app.use("/admin", adminRoutes);
app.use("/", publicRoutes);

// простая проверка соединения с БД на старте
q("SELECT 1").then(async () => {
  console.log("DB connected");
  await waitForUsersTable();
  await ensureAdminFromEnv();
}).catch((e) => {
  console.error("DB connect error", e);
  process.exit(1);
});

// авто-создание админа из переменных окружения (однократно)
async function ensureAdminFromEnv() {
  const email = process.env.ADMIN_MAIL?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) return;
  try {
    const { rows } = await q("SELECT id FROM users WHERE email=$1", [email]);
    if (rows[0]) {
      console.log("Admin exists:", email);
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await q(
      `INSERT INTO users(email, password_hash, role, is_active) VALUES($1,$2,'admin',true)`,
      [email, hash]
    );
    console.log("Admin created:", email);
  } catch (e) {
    console.error("Failed to ensure admin from env:", e);
  }
}

async function waitForUsersTable() {
  const deadline = Date.now() + 30000; // 30s
  while (Date.now() < deadline) {
    try {
      const { rows } = await q(
        `SELECT to_regclass('public.users') IS NOT NULL AS exists`);
      if (rows[0]?.exists) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  // если таблицы нет — попробуем продолжить, а создание админа просто пропустим
  console.warn("users table not found within timeout; skipping admin ensure for now");
}

const port = process.env.PORT || 8000;
app.listen(port, () => console.log(`API listening on :${port}`));
