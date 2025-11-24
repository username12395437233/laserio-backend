# LaserIO Backend

REST API для интернет-магазина на Node.js + Express + PostgreSQL.

## Требования

- Docker
- Docker Compose

## Запуск

### Локально

```bash
docker compose up --build
```

API доступен на `http://localhost:8000`

### На сервере

```bash
# Клонировать репозиторий
git clone <repo-url>
cd laserio-backend

# Создать .env файл (см. раздел "Переменные окружения")
# Отредактировать .env с нужными значениями

# Запустить
docker compose up -d --build
```

**Важно для продакшена:**
- `PGHOST=postgres` (оставить как есть, т.к. это имя сервиса в docker-compose)
- Используйте сильный `JWT_SECRET`
- API слушает на `127.0.0.1:8000` (только localhost)
- Настройте nginx как reverse proxy (пример ниже)

### Nginx конфигурация

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Переменные окружения

Создайте файл `.env` в корне проекта:

```env
# Приложение
PORT=8000
JWT_SECRET=your-secret-key
JWT_TTL_SECONDS=86400

# PostgreSQL
PGHOST=postgres
PGPORT=5432
PGDATABASE=laserio
PGUSER=laserio
PGPASSWORD=laserio


# Админ (создается автоматически при первом запуске)
ADMIN_MAIL=admin@example.com
ADMIN_PASSWORD=secret
```

## API

### Публичные эндпоинты

- `GET /health` - проверка работоспособности
- `GET /categories/tree` - дерево категорий
- `GET /categories` - список категорий
- `GET /categories/:slug` - категория с товарами
- `GET /categories/:slug/products` - товары конкретной категории
- `GET /products` - поиск товаров (возвращает id, name, slug, image)
- `GET /products/:slug` - карточка товара
- `POST /orders` - создание заказа

### Админ эндпоинты

- `POST /admin/auth/login` - авторизация
- `GET /admin/categories` - CRUD категорий
- `GET /admin/products` - CRUD товаров
- `POST /admin/products/:id/images` - загрузка фото
- `PATCH /admin/products/:id/images/:imageId/primary` - установка главного фото
- `POST /admin/products/:id/doc` - загрузка PDF документа

Все админ эндпоинты требуют заголовок `Authorization: Bearer <token>`
