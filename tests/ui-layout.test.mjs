import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('блок фиксированной выплаты не переполняет колонку загрузки документов', () => {
  assert.match(styles, /\.criterion-detail\{[^}]*grid-template-columns:minmax\(150px,180px\) minmax\(0,1fr\) 30px/);
  assert.match(styles, /\.file-field\{min-width:0\}/);
});

test('карточка дедлайна закреплена вместе с предварительным расчётом', () => {
  assert.match(styles, /\.application-layout > aside\{[^}]*position:sticky;top:100px/);
  assert.match(styles, /\.side-summary\{position:static\}/);
  assert.match(styles, /@media\(max-width:850px\)\{\.application-layout > aside\{position:static/);
});

test('реестр выплат удерживает сумму и счётчик внутри карточки', () => {
  assert.match(app, /class="panel report-table-panel"/);
  assert.match(app, /class="muted-text report-count"/);
  assert.match(app, /class="report-table"/);
  assert.match(styles, /\.report-table-panel \.panel-head\{[^}]*padding:/);
  assert.match(styles, /\.report-count\{[^}]*white-space:nowrap/);
  assert.match(styles, /\.report-table\{[^}]*table-layout:fixed/);
  assert.match(styles, /\.report-table td:nth-child\(3\)\{[^}]*white-space:nowrap/);
});

test('таблица очереди не растягивается по высоте панели деталей', () => {
  assert.match(styles, /\.review-layout\{[^}]*align-items:start/);
});

test('денежные значения и блок очереди сохраняют читаемые отступы', () => {
  assert.match(styles, /\.evidence-list strong\{[^}]*white-space:nowrap/);
  assert.match(styles, /\.review-layout\{[^}]*margin-top:15px/);
});

test('интерфейс использует нейтральное название образовательной системы', () => {
  assert.match(app, /brand-mark">ОС<\/div>/);
  assert.match(app, /<b>Образовательная<\/b><span>система<\/span>/);
  assert.doesNotMatch(app, /ЭПОС/);
  assert.match(index, /<title>Образовательная система · Стимулирующие выплаты<\/title>/);
  assert.doesNotMatch(index, /ЭПОС/);
  assert.match(styles, /\.brand b\{font:600 15px\/1\.15 'DM Sans';letter-spacing:-\.02em\}/);
  assert.match(styles, /\.brand span\{font-size:11px;letter-spacing:\.08em;margin-top:3px\}/);
});

test('завучские решения и документы подключены к API', () => {
  assert.match(app, /api\.approveReview\(a\.id\)/);
  assert.match(app, /api\.rejectReview\(a\.id, comment\)/);
  assert.match(app, /api\.uploadFile\(file, a\.id, item\.id\)/);
});

test('конструктор критериев содержит форму создания и редактирования', () => {
  assert.match(app, /data-action="new-criterion"/);
  assert.match(app, /data-criterion-form/);
  assert.match(app, /api\.createCriterion\(/);
  assert.match(app, /api\.updateCriterion\(/);
});

test('конструктор показывает статистику использования и версию критерия', () => {
  assert.match(app, /usageCount/);
  assert.match(app, /не использовался/);
  assert.match(app, /версия \$\{c\.version\}/);
});

test('ключ поля генерируется из названия автоматически', () => {
  assert.match(app, /const slugify = \(label\) =>/);
  assert.match(app, /key: slugify\(/);
  assert.doesNotMatch(app, /data-field-key value=/);
  assert.doesNotMatch(app, /name="fields"[^>]*textarea/);
});

test('олимпиадные шкалы не допускают дубликаты уровней и дипломов', () => {
  assert.match(app, /Шкала олимпиады указана повторно/);
});

test('экранирование HTML применяется к значениям конструктора', () => {
  assert.match(app, /const escapeHtml = \(value\) =>/);
  assert.match(app, /value="\$\{escapeHtml\(c\.title \|\| ''\)\}"/);
  assert.match(app, /value="\$\{escapeHtml\(field\.label \|\| ''\)\}"/);
});

test('клиентская валидация конструктора срабатывает до отправки', () => {
  assert.match(app, /function criterionEditorErrors\(/);
  assert.match(app, /Диапазоны процентов не должны пересекаться/);
  assert.match(app, /const validation = criterionEditorErrors\(draft\);/);
  assert.match(app, /if \(validation\.form\) \{ criterionEditor = draft; render\(\); showToastError\(validation\.form\); return; \}/);
});

test('поданные заявки сохраняют прежнюю шкалу при изменении критерия', () => {
  assert.match(app, /builder-warning/);
  assert.match(app, /Уже отправленные заявки сохранят прежнюю шкалу выплат/);
});

test('удаление критерия отключает его вместо исчезновения из списка', () => {
  assert.match(app, /const updated = await api\.deleteCriterion\(c\.id\); Object\.assign\(c, mapCriterion\(updated\)\);/);
  assert.doesNotMatch(app, /state\.criteria = state\.criteria\.filter\(\(x\) => x\.id !== c\.id\)/);
});

test('фильтр и поиск по критериям работают живьём', () => {
  assert.match(app, /data-criteria-search/);
  assert.match(app, /data-criteria-category/);
  assert.match(app, /criteriaSearch = event\.target\.value/);
  assert.match(app, /Показано \$\{visible\.length\} из \$\{state\.criteria\.length\}/);
});

test('критерий можно отключить и вернуть без удаления', () => {
  assert.match(app, /active: c\.active !== false/);
  assert.match(app, /badge\(c\.active \? 'approved' : 'draft'\)/);
  assert.match(app, /data-toggle-criterion/);
  assert.match(app, /api\.updateCriterionStatus\(/);
  assert.match(app, /data-delete-criterion/);
  assert.match(app, /api\.deleteCriterion\(/);
});

test('конструктор не требует ввода JSON для полей и шкал', () => {
  assert.doesNotMatch(app, /name="fields"[^>]*textarea/);
  assert.doesNotMatch(app, /name="scales"[^>]*textarea/);
  assert.match(app, /data-builder-field/);
  assert.match(app, /data-builder-scale/);
});

test('новый критерий создаётся без поля для учителя по умолчанию', () => {
  assert.match(app, /criterionEditor = \{ type: 'fixed',[^}]*fields: \[\]/);
  assert.match(app, /const fields = c\.fields \|\| \[\];/);
  assert.doesNotMatch(app, /key: 'field_1', label: '', type: 'TEXT'/);
});

test('добавление поля сохраняет ранее введённые значения конструктора', () => {
  assert.match(app, /function captureCriterionEditorForm\(/);
  assert.match(app, /captureCriterionEditorForm\(\); criterionEditor\.fields = \[/);
});

test('кастомные поля имеют единое адаптивное оформление', () => {
  assert.match(styles, /\.custom-fields\{[^}]*display:grid/);
  assert.match(styles, /\.custom-field\{[^}]*min-width:0/);
  assert.match(styles, /\.custom-field input/);
  assert.match(styles, /\.custom-field select/);
  assert.match(styles, /@media\(max-width:700px\)\{\.custom-fields\{grid-template-columns:1fr/);
});

test('кастомные поля сохраняются после завершения ввода, без перерисовки на каждый символ', () => {
  assert.match(app, /querySelectorAll\('\[data-custom-field\]'\)\.forEach\(\(el\) => el\.addEventListener\('change'/);
  assert.doesNotMatch(app, /querySelectorAll\('\[data-custom-field\]'\)\.forEach\(\(el\) => el\.addEventListener\('input'/);
});

test('отправка заявки защищена от устаревшего фонового автосохранения', () => {
  assert.match(app, /let submitInFlight = false/);
  assert.match(app, /submitInFlight = true/);
  assert.match(app, /submitInFlight = false/);
});

test('ошибка автосохранения не переводит отправку заявки в локальный режим', () => {
  assert.match(app, /void scheduleApplicationSync\(\)\.catch\(\(\) => \{\}\);/);
  const queueStart = app.indexOf('applicationSyncPromise = applicationSyncPromise');
  const queueCatch = app.indexOf('.catch(() => {})', queueStart);
  const queueThen = app.indexOf('.then(() => syncCurrentApplication())', queueCatch);
  assert.ok(queueStart >= 0 && queueCatch > queueStart && queueThen > queueCatch);
  assert.match(app, /catch \(error\) \{[\s\S]*?throw error;[\s\S]*?finally \{ backendSyncBusy = false; \}/);
});

test('после отправки заявка синхронизируется с API перед сохранением локального состояния', () => {
  assert.match(app, /await api\.listApplications\(\)/);
  assert.match(app, /hydrateBackend\(\)/);
});

test('экран входа и регистрации не зависит от демо-переключателя', () => {
  assert.match(app, /authView/);
  assert.match(app, /data-auth-submit/);
  assert.match(app, /data-auth-mode/);
  assert.doesNotMatch(app, /Демо: \$\{isTeacher \? 'Завуч' : 'Учитель'\}/);
});

test('интерфейс не содержит захардкоженных фиктивных данных', () => {
  assert.doesNotMatch(app, /12:42/);
  assert.doesNotMatch(app, /18,5/);
  assert.doesNotMatch(app, /из 40 возможных/);
  assert.doesNotMatch(app, /Табельн/);
  assert.doesNotMatch(app, /27 августа 2026/);
  assert.doesNotMatch(app, /Добавлен 12\.08/);
  assert.doesNotMatch(app, /в течение 5 рабочих дней/);
  assert.doesNotMatch(app, /<em>2<\/em>/);
  assert.doesNotMatch(app, /00\$\{i \+ 17\}/);
  assert.doesNotMatch(app, /ИЗ 7 БЛОКОВ/);
  assert.doesNotMatch(app, /осталось 16 дней/);
  assert.doesNotMatch(app, /блоков/);
});

test('счётчик в заявке и дедлайн считаются от реальных данных', () => {
  assert.match(app, /ВЫБРАНО \$\{items\.length\} ИЗ \$\{criteria\.length\} КРИТЕРИЕВ/);
  assert.match(app, /const daysLeft = \(\(\) => \{ try \{ return Math\.ceil\(\(new Date\(state\.activePeriod\.endsAt\)/);
  assert.match(app, /До окончания приёма осталось \$\{daysLeft\}/);
});

test('процент в кольце прогресса читается на залитом фоне', () => {
  assert.match(styles, /\.progress-ring:before\{[^}]*background:rgba\(13,31,66,\.45\)/);
  assert.match(styles, /\.progress-ring b\{[^}]*text-shadow/);
});

test('тосты различают успех, ошибку и подсказку, и закрываются', () => {
  assert.match(app, /const TOAST_ICONS = \{ success:/);
  assert.match(app, /function showToast\(message, type = 'success'\)/);
  assert.match(app, /const showToastError = \(message\) => showToast\(message, 'error'\)/);
  assert.match(app, /const showToastInfo = \(message\) => showToast\(message, 'info'\)/);
  assert.match(app, /data-action="close-toast"/);
  assert.match(app, /showToastError\(validation\.form\)/);
  assert.match(styles, /\.toast-error \.toast-icon\{background:#d9545433/);
  assert.match(styles, /\.toast-success \.toast-icon\{background:#1da87833/);
  assert.match(index, /id="toast"/);
});

test('модальные окна поддерживают Esc и фокус-ловушку', () => {
  assert.match(app, /role="dialog" aria-modal="true"/);
  assert.match(app, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); criterionEditor = null; periodEditor = null; render\(\); return; \}/);
  assert.match(app, /if \(event\.shiftKey && document\.activeElement === first\) \{ event\.preventDefault\(\); last\.focus\(\); \}/);
  assert.match(app, /firstInput\?\.focus\(\)/);
});

test('блок помощи в сайдбаре работает и зависит от роли', () => {
  assert.match(app, /data-action="open-help"/);
  assert.match(app, /let helpOpen = false;/);
  assert.match(app, /helpOpen = !helpOpen; render\(\);/);
  assert.match(app, /Как это работает/);
  assert.match(app, /isTeacher \? \[\['Выберите критерии'/);
  assert.match(app, /\[\['Настройте критерии'/);
  assert.doesNotMatch(app, /Нужна помощь\?/);
});

test('текстовые глифы заменены на SVG-иконки', () => {
  assert.match(app, /search: '<svg viewBox="0 0 24 24"/);
  assert.match(app, /clock: '<svg/);
  assert.match(app, /inbox: '<svg/);
  assert.match(app, /arrowUpRight: '<svg/);
  assert.match(app, /pencil: '<svg/);
  assert.match(app, /\$\{icons\.search\}/);
  assert.match(app, /\$\{icons\.clock\}/);
  assert.doesNotMatch(app, /<span>⌕<\/span>/);
  assert.doesNotMatch(app, /<span class="spark">✦<\/span>/);
  assert.doesNotMatch(app, /<span class="deadline-icon">◷<\/span>/);
  assert.doesNotMatch(app, /<div class="empty-detail"><span>[✓↗✎⌕]<\/span>/);
});

test('таблицы показывают скелетоны при первой загрузке', () => {
  assert.match(app, /let initialLoading = true;/);
  assert.match(app, /initialLoading = false;/);
  assert.match(app, /const skeletonRows = \(cells, count = 4\)/);
  assert.match(app, /initialLoading \? skeletonRows\(6, 5\)/);
  assert.match(app, /initialLoading \? skeletonRows\(6, 4\)/);
  assert.match(app, /initialLoading \? skeletonRows\(5, 4\)/);
  assert.match(app, /!initialLoading && review\.length/);
  assert.match(styles, /@keyframes shimmer/);
});

test('вкладка браузера имеет favicon', () => {
  assert.match(index, /rel="icon" href="data:image\/svg\+xml/);
});

test('прогресс заявки считается от числа активных критериев', () => {
  assert.match(app, /const totalCriteria = state\.criteria\.length \|\| 1;/);
  assert.match(app, /Math\.round\(\(chosen \/ totalCriteria\) \* 100\)/);
  assert.doesNotMatch(app, /app\.items\.length \/ 7/);
});

test('даты в интерфейсе берутся из данных заявки', () => {
  assert.match(app, /const relativeTime = \(value\) =>/);
  assert.match(app, /relativeTime\(a\.updatedAt\)/);
  assert.match(app, /app\.submittedAt \? `Подана \$\{formatDateTime\(app\.submittedAt\)\}`/);
  assert.match(app, /app\?\.updatedAt \? `Обновлено \$\{relativeTime\(app\.updatedAt\)\}`/);
});

test('счётчик очереди в меню отражает реальные заявки на проверке', () => {
  assert.match(app, /const pendingReviewCount = \(state\.applications \|\| \[\]\)\.filter\(\(a\) => a\.schoolId === state\.currentAdmin\?\.schoolId && a\.status === 'review'\)\.length;/);
  assert.match(app, /id === 'review' && pendingReviewCount > 0 \? ` <em>\$\{pendingReviewCount\}<\/em>` : ''/);
});

test('поиск и фильтры очереди и сотрудников работают', () => {
  assert.match(app, /data-review-search/);
  assert.match(app, /data-review-status/);
  assert.match(app, /data-staff-search/);
  assert.match(app, /reviewSearch = event\.target\.value/);
  assert.doesNotMatch(app, /class="filter-btn"/);
  assert.doesNotMatch(app, /‹ &nbsp; 1 &nbsp; ›/);
});

test('герой-блок показывает реальный прогресс через кольцо', () => {
  assert.match(app, /class="progress-ring"/);
  assert.match(styles, /conic-gradient/);
  assert.match(app, /statusLabel\[app\?\.status \|\| 'draft'\]/);
  assert.doesNotMatch(app, /hero-orbit|orbit-ring|orbit-core/);
});

test('панель обзора рекомендует действия из состояния заявки', () => {
  assert.match(app, /const nextStep = !app \|\| app\.status === 'draft' \?/);
  assert.match(app, /Осталось выбрать критерии: \$\{totalCriteria - chosen\} из \$\{totalCriteria\}/);
  assert.doesNotMatch(app, /Заполните ещё 4 блока/);
});

test('таблицы выравнивают суммы по правому краю табличными цифрами', () => {
  assert.match(styles, /\.td-amount\{text-align:right;font-variant-numeric:tabular-nums\}/);
  assert.match(styles, /font-variant-numeric:tabular-nums/);
});

test('панели плоские, заголовки таблиц закреплены, фокус видим', () => {
  assert.match(styles, /\.panel\{[^}]*box-shadow:0 1px 2px #243c640a\}/);
  assert.match(styles, /thead th\{position:sticky;top:0;background:#fff;z-index:2/);
  assert.match(styles, /:focus-visible\{outline:2px solid var\(--blue\);outline-offset:2px;border-radius:4px\}/);
  assert.doesNotMatch(styles, /transform:translateY\(-1px\)/);
});
