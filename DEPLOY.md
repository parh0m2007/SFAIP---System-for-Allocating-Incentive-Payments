# Развёртывание на Ubuntu (production)

Поэтапная инструкция: Docker, backend (NestJS + Prisma + SQLite), фронтенд (nginx), HTTPS, email-уведомления Brevo.

## 0. Что получится в итоге

- `http://ВАШ_ДОМЕН` — фронтенд (nginx) + API за тем же доменом (`/api` проксируется)
- Данные: SQLite-файл в Docker-томе `server-data`, загруженные файлы — в `server-storage`
- Email-уведомления завучу/учителю через Brevo (опционально)

## 1. Подготовка сервера (Ubuntu 22.04+)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl

# Защита базовая: ssh по ключу, firewall
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

## 2. Установка Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Выйдите и зайдите снова (чтобы группа docker применилась), затем проверка:
docker ps
```

## 3. Клонирование проекта

```bash
sudo mkdir -p /opt/sfaip && sudo chown $USER /opt/sfaip
git clone https://github.com/parh0m2007/SFAIP---System-for-Allocating-Incentive-Payments.git /opt/sfaip/app
cd /opt/sfaip/app
```

## 4. Настройка окружения

```bash
# Сгенерируйте два сильных секрета:
openssl rand -hex 32   # -> скопируйте, это JWT_ACCESS_SECRET
openssl rand -hex 32   # -> скопируйте, это JWT_REFRESH_SECRET

cat > .env << 'EOF'
JWT_ACCESS_SECRET=ВСТАВЬТЕ_СЕКРЕТ_1
JWT_REFRESH_SECRET=ВСТАВЬТЕ_СЕКРЕТ_2
HTTP_PORT=80

# Домен, если уже известен (через запятую можно несколько):
CORS_ORIGINS=https://ВАШ_ДОМЕН

# Brevo (необязательно): https://www.brevo.com -> SMTP & API -> API Keys
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Образовательная система
EOF

chmod 600 .env   # секреты не для чужих глаз
```

Важно: docker-compose берёт переменные из `.env` в корне проекта. Без `JWT_*` сервер откажется стартовать в prod-режиме (защита от секретов по умолчанию).

## 5. Первый запуск (автоматическая миграция + сиды)

```bash
docker compose up -d --build
```

При первом старте сервер **сам** выполнит миграции Prisma и сиды (создаст школы, демо-аккаунты, период, критерии). Журнал:

```bash
docker compose logs -f server
# дождитесь строк:
#   Database created and seeded automatically
#   API listening on http://localhost:3001
```

Проверка снаружи:

```bash
curl http://localhost/api/schools
# [{"id":"school-101","name":"МАОУ «СОШ №101» г. Перми"}, ...]
```

Фронтенд: откройте `http://IP_СЕРВЕРА`. Вход под демо-аккаунтами:
- завуч: `deputy@school101.local` / `demo1234`
- учитель: `teacher@school101.local` / `demo1234`

## 6. HTTPS через Let's Encrypt (если есть домен)

Ничего редактировать вручную не нужно — в репозитории есть готовый HTTPS-оверлей (`docker-compose.https.yml` + `nginx-ssl.conf`). Домен подставляется из `.env`.

Шаг 1. Выпустите сертификат (перед этим остановите всё, что занимает порт 80):

```bash
docker compose stop frontend 2>/dev/null   # освободить порт 80, если уже запущено
sudo apt install -y certbot
sudo certbot certonly --standalone -d ВАШ_ДОМЕН
```

Шаг 2. Добавьте домен в `.env` (файл в корне проекта):

```
DOMAIN=ВАШ_ДОМЕН
CORS_ORIGINS=https://ВАШ_ДОМЕН
```

Шаг 3. Запустите с HTTPS-оверлеем (два файла `-f` — единственное отличие от обычного запуска):

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Что произойдёт: nginx начнёт слушать 443 с сертификатами из `/etc/letsencrypt` (монтируется read-only), весь http-трафик будет редиректить на https, а путь `/.well-known/acme-challenge/` останется открытым для обновления сертификатов.

Проверка: `https://ВАШ_ДОМЕН` — замок в браузере, `curl -I http://ВАШ_ДОМЕН` — должен вернуть `301` на https.

Шаг 4. Автообновление сертификатов — в cron:

```bash
sudo crontab -e
# добавьте строку:
0 3 * * * certbot renew --quiet --deploy-hook "docker restart $(docker ps -qf name=frontend)"
```

## 6a. Вернуться с HTTPS на обычный HTTP

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml down
docker compose up -d
```

## 7. Email-уведомления Brevo (если нужен шаг)

1. Зарегистрируйтесь на brevo.com (300 писем/день бесплатно)
2. SMTP & API → API Keys → «Generate new key» → скопируйте `xkeysib-...`
3. Отправитель: Senders & IP → добавьте email-адрес и подтвердите его по письму
4. Впишите в `.env`:
   ```
   BREVO_API_KEY=xkeysib-ваш_ключ
   BREVO_SENDER_EMAIL=noreply@ваш_домен
   ```
5. `docker compose up -d server` — письма пойдут автоматически:
   - завучу при отправке заявки учителем («Новая заявка на проверку»)
   - учителю при утверждении/отклонении (с суммой или комментарием завуча)

Письма отправляются best-effort: сбой Brevo не блокирует основной сценарий, ошибка пишется в журнал сервера.

## 8. Обновление системы

```bash
cd /opt/sfaip/app
git pull
docker compose up -d --build
```

Миграции при обновлении применяются автоматически (если файл БД уже существует — сервер стартует сразу, изменения схемы подхватит `prisma migrate deploy` только на новой БД; для обновления схемы на существующей БД запустите разово:

```bash
docker compose exec server npx prisma migrate deploy
```

## 9. Резервные копии

```bash
# БД + загруженные файлы:
docker run --rm -v sfaip_server-data:/data -v $(pwd)/backup:/backup alpine \
  tar czf /backup/data-$(date +%F).tar.gz -C /data .
docker run --rm -v sfaip_server-storage:/data -v $(pwd)/backup:/backup alpine \
  tar czf /backup/storage-$(date +%F).tar.gz -C /data .
```

В cron: `0 4 * * * cd /opt/sfaip/app && <команда выше>`.

## 10. Диагностика

| Проблема | Команда |
|---|---|
| Сервер не стартует | `docker compose logs server` |
| «FATAL: JWT_...SECRET» | не заданы секреты в `.env` — см. шаг 4 |
| Пустой список школ | первый старт ещё идёт — дождитесь «seeded automatically» в журнале |
| Письма не приходят | проверьте `BREVO_*` в `.env` и журнал сервера: `[mailer] Brevo responded` |
| Перезапуск всего | `docker compose restart` |
| Полный сброс данных | `docker compose down -v` (⚠️ удалит БД и файлы) |

## 11. Чек-лист перед продом

- [ ] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` — сильные, уникальные
- [ ] `.env` имеет права 600
- [ ] `CORS_ORIGINS` указан (если фронтенд не за тем же доменом через nginx)
- [ ] UFW включён, открыты только 80/443/SSH
- [ ] Демо-аккаунты после релиза сменены на реальные (`demo1234` — только для теста)
- [ ] Настроен бэкап (шаг 9)
