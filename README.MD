# LaserIO Backend

REST API для интернет-магазина на Node.js + Express + PostgreSQL.

## Запуск

```bash
docker compose up --build
```

API доступен на `http://localhost:8000`

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
- `GET /products` - поиск товаров
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
