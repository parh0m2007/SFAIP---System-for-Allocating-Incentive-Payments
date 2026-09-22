# Заметки по проекту (для будущих сессий)

MVP стимулирующих выплат образовательной системы. Фронтенд — vanilla JS (`src/`), бэкенд — NestJS + Prisma + SQLite (`server/`).

## Главное: тесты и запуск

- **Тесты (обязательно оба набора):** `npm test` (фронтенд, 71) и `npm run server:test` (сервер, 14, включает e2e smoke). Всё должно быть зелёным.
- **Запуск локально:** `npm run server:dev` (API `:3001`; при отсутствии `data/dev.db` сам мигрирует + сидит) и `python3 -m http.server 4173` (фронтенд). Фронт ходит на `http://localhost:3001` (`src/api.js:3`), CORS включён.
- **Важно после изменения схемы:** сервер применяет миграции только при отсутствии `data/dev.db`. Если база уже существует, новая колонка не появится — будет рантайм-ошибка `The column ... does not exist`. Лечится: `cd server && DATABASE_URL="file:../data/dev.db" npx prisma migrate deploy` (данные не теряет).
- **Аккаунты после seed:** `deputy@school101.local` / `teacher@school101.local`, пароль `demo1234`.
- Серверные скрипты: `server:install`, `db:migrate`, `seed`, `server:start`.

## Ключевые места кода

- **Фонд и коэффициент K (требование 5):** `src/domain.js:107` `calculatePayouts` — K = Фонд/Потенциал при превышении, иначе 1; применяется в Excel-выгрузке `server/src/main.ts:274` и в реестре `src/app.js:441`.
- **Качество обученности по категории педагога:** `src/domain.js:22` `DEFAULT_CATEGORY_BANDS` (начальные 65–79/80–100, предметник 50–69/70–100, ИЗО-физкультура 90–100); сервер выбирает шкалу по категории учителя в `server/src/main.ts:286` `calculateItem`.
- **Настраиваемые справочники олимпиадного критерия:** на `Criterion` добавлены `levelsJson`/`diplomasJson` (массивы `{id,label}`; миграция `20260918130000_olympiad_vocab`). Если их нет — справочники стандартные (`OLYMPIAD_LEVELS`/`DIPLOMA_TYPES`). Разбор: `criterionLevels`/`criterionDiplomas` в `src/domain.js`. Валидация записей учеников и шкал использует справочник критерия: `server/src/validation.ts` (`assertOlympiadEntry`, `assertCriterionPayload`).
- Категория педагога хранится на пользователе (`teacherCategory`), валидируется в `server/src/validation.ts` (`assertTeacherCategory`).
- **Пользовательский критерий (CUSTOM) с процентной шкалой:** кроме вариантов выплат (`variants` — шкалы без диапазона, ключ хранится в `metadataJson.label`), заместитель может выбрать в конструкторе тип шкалы «Процентные диапазоны» и режим — «Общие проценты» (все диапазоны с ключом `COMMON`) или «По категориям педагогов» (ключи `ELEMENTARY`/`SUBJECT`/`CREATIVE`, как в качестве обученности). Хелперы: `hasBandScales`/`customBandMode`/`COMMON_BAND_KEY` в `src/domain.js`; режим определяется по данным шкал, отдельная колонка не нужна. Расчёт: `calculateItem` (`server/src/main.ts`) и `recalculateApplication` (`src/app.js`) используют диапазоны через `getQualityBands`/`getQualityBand`. Валидация: процент обязателен при отправке (`custom-percentage` на фронте, `PERCENTAGE_REQUIRED` на сервере), диапазоны проверяются на пересечения и максимум уже существующей общей проверкой шкал.
- Схема БД: `server/prisma/schema.prisma`; после изменения схемы — `npm run db:generate` и создать миграцию.

## Текущее состояние (на 2026-09-19)

- Последний коммит: `786c5d8 feat: teacher category payout scale and period fund coefficient` на `main`.
- **Незакоммичено:**
  - реализация варианта 2 — настраиваемые справочники уровней/степеней для олимпиадного критерия (схема + миграция + сервер + фронтенд + тесты). Позволяет заводить через конструктор критерий «баллы ОГЭ/ЕГЭ/ВПР за каждого обучающегося». Конструктор олимпиады: секции «Уровни → Степени → Шкалы выплат» (`vocabSection`/`builder-vocab-row`/`builder-scale-row` в `src/app.js`); при смене типа формы захват идёт по СТАРОМУ типу (`captureCriterionEditorForm(forType)`), иначе диапазоны качества схлопываются в мусорный `municipal:winner`.
  - процентные шкалы для пользовательского критерия (см. выше) — конструктор (`customScaleSection`/`bandGroups`/`bandRow` в `src/app.js`), расчёт на сервере и клиенте, валидация процента, e2e- и доменные тесты. Проверено вживую на :3001/:4173.
  - артефакты ручной проверки: `__preview.html`, `__preview2.html` (харнесы для headless-Chrome).
- **Открытые решения (не делал без явного указания):**
  - Коммит `6e1c793` с мусорным сообщением «ыы» лежит в истории `main` и уже в `origin/main`. Переименование = force-push.
  - Ветка `publish` отстаёт от `main` на 9 коммитов; зависший rebase над ней уже очищен.
