# Стимулирующие выплаты MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать автономный браузерный MVP кабинета стимулирующих выплат для учителя и единственного завуча.

**Architecture:** Визуальный SPA без сборщика: семантический HTML, CSS-дизайн система и ES-модули. Доменная модель отделена от UI; `localStorage` имитирует persistence, роли и модерация работают на клиенте как прототип, чтобы быстро проверить сценарии до подключения API.

**Tech Stack:** HTML5, CSS3, JavaScript ES2022 modules, Node.js built-in test runner.

**Spec:** Требования из `/Users/parhom/Downloads/TZ.doc` и уточнения пользователя от 2026-08-30.

## Global Constraints

- Один завуч; много ролей: Учитель и Завуч.
- Один черновик/заявка на отчётный период; после отклонения разрешена повторная отправка.
- Завуч задаёт фиксированную сумму каждого критерия в диапазоне `0…maxAmount`; учитель видит назначенное значение и не редактирует его.
- Интеграций нет; подтверждение загружается вручную как файл.
- История и документы хранятся бессрочно (в MVP — в localStorage).
- Школа обязательна в профиле/регистрации; завуч видит только заявки с тем же `schoolId`.
- Адаптивность: 375, 768, 1024 и 1440 px; WCAG AA-контраст.

### Task 1: Domain model and tests

**Files:**
- Create: `src/domain.js`
- Create: `tests/domain.test.mjs`
- Create: `package.json`

- [x] Написать тесты для максимального лимита, единственной заявки на период и повторной отправки после отклонения.
- [x] Реализовать чистые функции домена и сериализацию состояния.
- [x] Добавить ограниченное редактирование фиксированной суммы критерия (только завуч).
- [x] Запустить `npm test` и убедиться, что тесты проходят.

### Task 2: MVP interface

**Files:**
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/styles.css`

- [x] Создать каркас кабинета с переключением роли, шапкой, навигацией и responsive layout.
- [x] Реализовать teacher dashboard: метрики, прогресс, критерии, черновик и отправка.
- [x] Реализовать завуч dashboard: очередь, фильтры, approve/reject с комментарием, вкладки критериев/сотрудников/аудита.
- [x] Подключить localStorage и чистые функции домена.
- [x] Добавить доступные статусы, focus-visible, SVG-иконки Lucide-подобного вида и reduced-motion.
- [x] Добавить профиль/регистрацию с обязательной школой и фильтрацию очереди по `schoolId`.
- [x] Показать учителю read-only сумму и обновлять суммы заявок при изменении критерия завучем.

### Task 3: Verification

**Files:**
- Modify: `README.md`

- [x] Запустить `npm test`.
- [x] Выполнить smoke-проверку через локальный `python3 -m http.server` и проверить отсутствие синтаксических ошибок.
- [x] Описать запуск и границы MVP в README.
