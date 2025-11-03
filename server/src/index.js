import "dotenv/config.js";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "node:path";
import adminRoutes from "./routes/admin.js";
import publicRoutes from "./routes/public.js";
import { q } from "./db.js";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// статика для загруженных файлов
app.use("/uploads", express.static(path.join("/app/uploads")));

app.use("/admin", adminRoutes);
app.use("/", publicRoutes);

// простая проверка соединения с БД на старте
q("SELECT 1").then(() => console.log("DB connected")).catch((e) => {
  console.error("DB connect error", e);
  process.exit(1);
});

const port = process.env.PORT || 8000;
app.listen(port, () => console.log(`API listening on :${port}`));
