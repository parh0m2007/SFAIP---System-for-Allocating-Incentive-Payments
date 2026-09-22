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

test('интерфейс обращается к заместителю директора, а не к завучу', () => {
  assert.match(app, /Заместитель директора/);
  assert.doesNotMatch(app, /завуч/);
  assert.doesNotMatch(app, /Завуч/);
});

test('строки критериев в заявке кликабельны и открывают шкалу', () => {
  assert.match(app, /data-toggle-row="\$\{c\.id\}"/);
  assert.match(app, /role="button" tabindex="0"/);
  assert.match(styles, /\.criterion-row\{cursor:pointer/);
});

test('отклонённые и ошибочные заявки можно удалять', () => {
  assert.match(app, /api\.deleteApplication\(a\.id\)/);
  assert.match(app, /data-delete-application="\$\{app\.id\}"/);
  assert.match(app, /data-action="delete-application"/);
});

test('выплаты масштабируются коэффициентом фонда периода', () => {
  assert.match(app, /calculatePayouts\(/);
  assert.match(app, /data-action="save-fund"/);
  assert.match(app, /Фонд /);
  assert.match(app, /Коэффициент K/);
});

test('качество обученности зависит от категории педагога', () => {
  assert.match(app, /TEACHER_CATEGORIES/);
  assert.match(app, /DEFAULT_CATEGORY_BANDS/);
  assert.match(app, /categoryBands/);
  assert.match(app, /data-profile-category/);
});

test('конструктор олимпиадного критерия редактирует справочники уровней и степеней', () => {
  // справочники уровней и степеней подключены в конструктор
  assert.match(app, /vocabSection\('levels'/);
  assert.match(app, /vocabSection\('diplomas'/);
  assert.match(app, /data-add-builder-vocab=/);
  assert.match(app, /data-builder-vocab-list=/);
  assert.match(app, /data-vocab-id/);
  assert.match(app, /data-vocab-label/);
  // строки учеников берут варианты из справочника своего критерия
  assert.match(app, /criterion\?\.levels \|\| OLYMPIAD_LEVELS/);
  assert.match(app, /criterion\?\.diplomas \|\| DIPLOMA_TYPES/);
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

test('ключ поля генерируется из названия автоматически, кириллица транслитерируется', () => {
  assert.match(app, /const slugify = \(label\) => \{/);
  assert.match(app, /const CYRILLIC_MAP = \{ а: 'a'/);
  assert.match(app, /komentariy|nazvanie/);
  assert.match(app, /const uniqueKeys = \(fields\) => \{/);
  assert.match(app, /criterionEditor\.fields = uniqueKeys\(/);
  assert.doesNotMatch(app, /data-field-key value=/);
  assert.doesNotMatch(app, /name="fields"[^>]*textarea/);
});

test('одинаковые названия полей получают суффикс вместо ошибки', () => {
  assert.match(app, /\`\$\{base\}_\$\{count\}\`/);
  assert.doesNotMatch(app, /Два поля имеют одинаковое название/);
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

test('критерий можно удалить навсегда — он исчезает из списка и черновиков', () => {
  assert.match(app, /data-purge-criterion/);
  assert.match(app, /api\.purgeCriterion\(/);
  // Полное удаление вычищает критерий из состояния и из редактируемых заявок.
  assert.match(app, /state\.criteria = state\.criteria\.filter\(\(x\) => x\.id !== c\.id\)/);
  assert.match(app, /a\.items = a\.items\.filter\(\(x\) => x\.criterionId !== c\.id\)/);
  // Отправленные и утверждённые заявки хранят историю — удалять их критерий нельзя.
  assert.match(app, /Отправленные и утверждённые заявки хранят/);
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

test('кнопки добавления строк конструктора имеют корректные атрибуты', () => {
  // Лишняя кавычка после имени атрибута (data-add-builder-scale">) превращала его
  // в атрибут с другим именем — селектор в bind() переставал его находиться,
  // и кнопка «Добавить строку» в олимпиадном критерии не работала.
  assert.doesNotMatch(app, /data-add-builder-[a-z]+">/);
  assert.match(app, /data-add-builder-scale>/);
  assert.match(app, /data-add-builder-field>/);
});

test('новый обучающийся получает уровень и степень из справочника критерия', () => {
  // Захардкоженные municipal/winner отсутствуют в пользовательском справочнике:
  // строка визуально показывала первый вариант, а выплата считалась как 0.
  assert.match(app, /const levels = c\?\.levels \|\| OLYMPIAD_LEVELS; const diplomas = c\?\.diplomas \|\| DIPLOMA_TYPES;/);
  assert.match(app, /level: levels\[0\]\?\.id \|\| 'municipal', diploma: diplomas\[0\]\?\.id \|\| 'winner'/);
  assert.doesNotMatch(app, /\{ level: 'municipal', diploma: 'winner', studentName: '', olympiadName: '' \}/);
});

test('устаревшие уровень/степень записи олимпиады заживляются при перерасчёте', () => {
  assert.match(app, /const levels = criterion\.levels \|\| OLYMPIAD_LEVELS;\s*const diplomas = criterion\.diplomas \|\| DIPLOMA_TYPES;\s*\(item\.entries \|\| \[\]\)\.forEach\(\(entry\) => \{/);
  assert.match(app, /if \(entry && !levels\.some\(\(l\) => l\.id === entry\.level\)\) entry\.level = levels\[0\]\?\.id \|\| entry\.level;/);
});

test('при загрузке пересчитываются только редактируемые заявки', () => {
  // Утверждённые заявки не трогаем — их сумма уже авторитетна на сервере.
  assert.match(app, /state\.applications\.forEach\(\(a\) => \{ if \(\['draft', 'rejected'\]\.includes\(String\(a\.status \|\| ''\)\.toLowerCase\(\)\)\) recalculateApplication\(a\); \}\);/);
});

test('пробел и Enter в полях строки критерия не переключают сам критерий', () => {
  // preventDefault на keydown внутри полей глотал пробел в «Фамилии и имени».
  assert.match(app, /if \(event\.key !== 'Enter' && event\.key !== ' '\) return; if \(event\.target\.closest\('button, input, select, textarea, label, a'\)\) return; event\.preventDefault\(\); toggle\(event\);/);
  assert.match(app, /if \(event\.key !== 'Enter' && event\.key !== ' '\) return; if \(event\.target\.closest\('button, input, select, textarea, label, a'\)\) return; event\.preventDefault\(\); open\(event\);/);
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

test('детали заявки показывают заполненные поля каждого критерия', () => {
  // Поля критерия и файлы сохраняются в элементе заявки при маппинге.
  assert.match(app, /criterionFields: \(i\.criterion\?\.fields \|\| \[\]\)\.map/);
  assert.match(app, /files: \(i\.files \|\| \[\]\)\.map\(\(f\) => \(\{ id: f\.id, originalName: f\.originalName/);
  assert.match(app, /const fields = item\.criterionFields\?\.length \? item\.criterionFields : \(criterion\?\.fields \|\| \[\]\);/);
  // Значения полей выводятся с подписями из критерия.
  assert.match(app, /spec-cell/);
  assert.match(app, /fieldDisplayValue\(f, values\[f\.key\]\)/);
  // Процент обученности и записи олимпиад видны проверяющему.
  assert.match(app, /Процент обученности/);
  assert.match(app, /entry-table/);
  // Метки уровней берутся из разобранного критерия, а не из сырого levelsJson.
  assert.match(app, /const levels = criterion\?\.levels \|\| OLYMPIAD_LEVELS;/);
  assert.match(app, /const diplomas = criterion\?\.diplomas \|\| DIPLOMA_TYPES;/);
  // Сумма по строке выводится из записи, а при отсутствии — выводится шкалой критерия.
  assert.match(app, /const entryAmount = \(e\) => Number\(e\.amount\) \|\| getOlympiadReward\(criterion, e\);/);
});

test('документы заявки скачиваются прямо из панели деталей', () => {
  assert.match(app, /data-download-file="\$\{f\.id\}"/);
  assert.match(app, /api\.downloadFile\(el\.dataset\.downloadFile\)/);
  assert.match(app, /link\.download = el\.dataset\.fileName/);
  assert.match(styles, /\.file-chip\{[^}]*border-radius:999px/);
});

test('детали заявки раскрываются на всю ширину под таблицей', () => {
  assert.match(styles, /\.review-layout\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:15px\}/);
  assert.match(app, /id="review-detail"/);
  assert.match(app, /document\.querySelector\('#review-detail'\)\?\.scrollIntoView/);
});

test('из реестра сотрудников можно открыть заявку на проверку', () => {
  assert.match(app, /data-select-user="\$\{u\.id\}"/);
  assert.match(app, /view = 'review'; selectedAppId = app\.id; render\(\);/);
});

test('пользовательский тип критерия использует только процентные диапазоны', () => {
  // Конструктор пользовательского критерия не предлагает варианты выплат —
  // только процентные диапазоны: общие или по категориям педагогов.
  assert.doesNotMatch(app, /data-scale-kind/);
  assert.doesNotMatch(app, /data-scale-label/);
  assert.doesNotMatch(app, /uniqueScaleKeys/);
  assert.doesNotMatch(app, /data-custom-scale/);
  assert.doesNotMatch(app, /variants/);
  // При смене типа на пользовательский появляется первый диапазон на всю шкалу.
  assert.match(app, /if \(criterionEditor\.type === 'custom'\) \{ criterionEditor\.bandMode = 'common'; criterionEditor\.scales = \[\{ key: COMMON_BAND_KEY, from: 0, to: 100, amount: Number\(criterionEditor\.amount \?\? criterionEditor\.maxAmount\) \|\| 0 \}\]; \}/);
  // Сумма пользовательского критерия без процентной шкалы — фиксированная.
  assert.match(app, /item\.amount = criterion\.amount \?\? criterion\.maxAmount;/);
});

test('пользовательский критерий умеет считать выплату по процентным диапазонам', () => {
  // Режим процентов выбирается в конструкторе: общие проценты или по категориям
  // педагогов — как в качестве обученности.
  assert.match(app, /name="customBandMode" value="common" data-band-mode/);
  assert.match(app, /name="customBandMode" value="category" data-band-mode/);
  assert.match(app, /data-scale-band/);
  assert.match(app, /data-custom-percent="\$\{c\.id\}"/);
  assert.match(app, /item\.percentage = normalizeQualityPercentage\(el\.value\); recalculateApplication\(a\); persist\('Процент сохранён'\)/);
  // Расчёт суммы: процентная шкала имеет приоритет над фиксированной суммой.
  assert.match(app, /if \(hasBandScales\(criterion\)\) \{/);
});
