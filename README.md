# Backend (Node.js + Express + Prisma)

Бэкенд для многофункционального чат-бота (Telegram + MAX) и операторской панели.

## Что уже реализовано

- Модульная API-структура (`auth`, `users`, `roles`, `clients`, `chats`, `leads`, `faq`, `analytics`, `integrations`, `webhooks`)
- JWT авторизация + refresh token
- RBAC через роли и permissions
- База на PostgreSQL через Prisma
- Хранение клиентов, чатов, сообщений, лидов, FAQ, логов вебхуков, аудита
- Общая бизнес-логика входящих сообщений
- Подключение ботов:
  - Telegram через `telegraf`
  - MAX через официальный `@maxhub/max-bot-api`
- Медицинские правила из ТЗ:
  - дисклеймер в автоответах
  - детект срочных запросов и перевод в `WAITING_MANAGER`

## Запуск

1. Скопировать env:

```bash
cp .env.example .env
```

2. Установить зависимости:

```bash
npm install
```

3. Сгенерировать Prisma client и выполнить миграцию:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Заполнить роли/права и администратора:

```bash
npm run prisma:seed
```

Стартовый пользователь:
- email: `admin@local.dev`
- password: `admin12345`

5. Запуск dev-сервера:

```bash
npm run dev
```

## Каналы

- Webhook endpoints:
  - `POST /api/webhooks/telegram`
  - `POST /api/webhooks/max`
- Опционально можно запускать polling-ботов через токены:
  - `TELEGRAM_BOT_TOKEN`
  - `MAX_BOT_TOKEN`

## Примечания

- Это первый backend-инкремент по ТЗ: уже рабочий API-скелет с ключевыми доменными сущностями.
- Следующим шагом можно добавлять полноценный сценарный движок (quiz/flows), SLA-таймеры, CRM-коннекторы и real-time слой (WebSocket).
