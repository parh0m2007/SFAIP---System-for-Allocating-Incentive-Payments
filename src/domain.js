const now = () => new Date().toISOString();

export const QUALITY_BANDS = [
  { from: 0, to: 50, amount: 2000 },
  { from: 50, to: 75, amount: 3000 },
  { from: 75, to: 90, amount: 4000 },
];

// Категории педагогов, для которых настраивается шкала качества обученности.
export const TEACHER_CATEGORIES = [
  { id: 'elementary', label: 'Учитель начальных классов' },
  { id: 'subject', label: 'Учитель-предметник' },
  { id: 'creative', label: 'Учитель ИЗО, музыки, технологии, физкультуры' },
];
const CATEGORY_IDS = TEACHER_CATEGORIES.map((category) => category.id);
export const categoryLabel = (id) => TEACHER_CATEGORIES.find((category) => category.id === id)?.label || 'Категория не указана';

// Шкалы качества обученности по умолчанию зависят от категории педагога:
// учитель начальных классов — 80–100% и 65–79%;
// учитель-предметник — 70–100% и 50–69%;
// учитель ИЗО, физкультуры, технологии, музыки — 90–100%.
export const DEFAULT_CATEGORY_BANDS = {
  elementary: [{ from: 65, to: 79, amount: 1000 }, { from: 80, to: 100, amount: 2000 }],
  subject: [{ from: 50, to: 69, amount: 1000 }, { from: 70, to: 100, amount: 2000 }],
  creative: [{ from: 90, to: 100, amount: 1500 }],
};

export const OLYMPIAD_LEVELS = [
  { id: 'municipal', label: 'Муниципальный' },
  { id: 'regional', label: 'Региональный' },
  { id: 'krai', label: 'Краевой' },
  { id: 'federal', label: 'Федеральный' },
  { id: 'all-russian', label: 'Всероссийский' },
  { id: 'international', label: 'Международный' },
];

export const DIPLOMA_TYPES = [
  { id: 'winner', label: 'Победитель' },
  { id: 'prize', label: 'Призёр' },
];

// Справочники олимпиадного критерия настраиваются для каждого критерия свои.
// Если уровни/степени не заданы, используются стандартные значения.
const vocabOf = (raw, fallback) => {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch { return fallback; }
};
export const criterionLevels = (criterion) => vocabOf(criterion?.levelsJson, OLYMPIAD_LEVELS);
export const criterionDiplomas = (criterion) => vocabOf(criterion?.diplomasJson, DIPLOMA_TYPES);

// Процентная шкала пользовательского критерия хранится среди его шкал так же,
// как шкалы качества обученности: диапазон процентов и выплата. В режиме
// «по категориям» ключом шкалы служит категория педагога, в режиме «общие
// проценты» — общий ключ, применяемый к педагогу любой категории.
export const COMMON_BAND_KEY = 'COMMON';
const hasBandRange = (scale) => scale?.from != null || scale?.to != null || scale?.fromValue != null || scale?.toValue != null;
export const hasBandScales = (criterion) => (criterion?.scales || []).some(hasBandRange);
export const customBandMode = (criterion) =>
  (criterion?.scales || []).some((scale) => hasBandRange(scale) && CATEGORY_IDS.includes(String(scale.key || '').toLowerCase())) ? 'category' : 'common';

export const calculateReward = ({ maxAmount = 0, requestedAmount = 0 }) =>
  Math.min(Math.max(Number(requestedAmount) || 0, 0), Math.max(Number(maxAmount) || 0));

export const updateCriterionAmount = (criterion, amount) => ({
  ...criterion,
  amount: calculateReward({ maxAmount: criterion.maxAmount, requestedAmount: amount }),
});

// Build the complete criterion payload used by quick inline edits. The API
// replaces nested fields/scales on PATCH, so omitting them would silently
// erase a deputy's existing configuration.
export const categoryBandScales = (categoryBands = {}) =>
  TEACHER_CATEGORIES.flatMap((category) =>
    (categoryBands[category.id] || []).map((band) => ({ key: category.id.toUpperCase(), from: band.from, to: band.to, amount: band.amount })));

export const criterionUpdatePayload = (criterion, overrides = {}) => {
  const merged = { ...criterion, ...overrides };
  // Источник шкал зависит от типа: качество — диапазоны по категориям, олимпиады и
  // пользовательские — их собственные шкалы. Общий fallback на qualityBands иначе
  // отправил бы пользовательские варианты в мусорные диапазоны качества.
  const type = String(merged.type || 'fixed').toUpperCase();
  const bandsByCategory = Object.values(merged.categoryBands || {}).filter((bands) => bands?.length);
  const scalesSource = type === 'QUALITY'
    ? categoryBandScales(bandsByCategory.length ? merged.categoryBands : { subject: merged.qualityBands || [] })
    : (merged.scales || []);
  return {
    title: merged.title,
    category: merged.category,
    type: String(merged.type || 'fixed').toUpperCase(),
    amount: merged.amount == null ? null : Number(merged.amount),
    maxAmount: Number(merged.maxAmount || 0),
    allowEvidence: Boolean(merged.allowEvidence),
    fields: (merged.fields || []).map((field) => {
      const normalized = { ...field };
      if (field.options == null) delete normalized.options;
      return normalized;
    }),
    scales: scalesSource.map((scale) => {
      const normalized = {
        key: scale.key,
        from: scale.from ?? scale.fromValue,
        to: scale.to ?? scale.toValue,
        amount: Number(scale.amount || 0),
      };
      if (scale.metadata != null) normalized.metadata = scale.metadata;
      return normalized;
    }),
    levels: (merged.levels || (merged.levelsJson ? criterionLevels(merged) : [])),
    diplomas: (merged.diplomas || (merged.diplomasJson ? criterionDiplomas(merged) : [])),
  };
};

// Шкалы качества обученности для категории педагога. Если у критерия есть шкалы
// под категорию — берём их; иначе доступны шкалы по умолчанию.
export const getQualityBands = (criterion, category) => {
  const groups = criterion?.categoryBands || {};
  if (category && groups[category]?.length) return groups[category];
  return groups.default || groups.subject || criterion?.qualityBands || QUALITY_BANDS;
};

export const getQualityBand = (criterion, percentage, category) => {
  if (percentage === '' || percentage === null || percentage === undefined) return null;
  const value = Number(percentage);
  if (!Number.isFinite(value) || value < 0) return null;
  const bands = (Array.isArray(criterion) ? criterion : getQualityBands(criterion, category)).slice().sort((a, b) => a.from - b.from);
  // Диапазоны включительные; при пересечении на границе побеждает первый (нижний).
  return bands.find((band) => value >= band.from && value <= band.to) || null;
};

// Расчёт итоговых выплат с учётом фонда стимулирующих выплат периода:
// K = 1, если потенциальная сумма не превышает фонд, иначе K = Фонд / Потенциальная сумма.
// Итоговая выплата каждого сотрудника = его потенциальная выплата × K.
export const calculatePayouts = (applications = [], fund = 0) => {
  const rows = (applications || []).map((application) => ({ application, potential: Number(application?.total) || 0 }));
  const potential = rows.reduce((sum, row) => sum + row.potential, 0);
  const fundValue = Number(fund) || 0;
  const coefficient = fundValue > 0 && potential > fundValue ? fundValue / potential : 1;
  return {
    fund: fundValue,
    potential,
    coefficient,
    total: Math.round(potential * coefficient),
    rows: rows.map((row) => ({ ...row.application, potential: row.potential, payout: Math.round(row.potential * coefficient) })),
  };
};

export const normalizeQualityPercentage = (percentage) => {
  if (percentage === '' || percentage === null || percentage === undefined) return null;
  const value = Number(percentage);
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 100);
};

export const getOlympiadReward = (criterion, entry) =>
  Number(criterion?.olympiadAmounts?.[entry?.level]?.[entry?.diploma]) || 0;

export const calculateOlympiadTotal = (criterion, entries = []) =>
  entries.reduce((sum, entry) => {
    const hasDetails = entry?.studentName?.trim() && entry?.olympiadName?.trim();
    return sum + (hasDetails ? getOlympiadReward(criterion, entry) : 0);
  }, 0);

export const getApplicationValidationErrors = (application, criteria = []) => {
  const errors = [];
  (application?.items || []).forEach((item) => {
    const criterion = criteria.find((candidate) => candidate.id === item.criterionId);
    const values = item.values || {};
    (criterion?.fields || []).forEach((field) => {
      const value = values[field.key];
      if (field.required && (value == null || String(value).trim() === '')) errors.push({ criterionId: item.criterionId, fieldKey: field.key, code: 'field-required' });
      if (value == null || value === '') return;
      const type = String(field.type || 'TEXT').toUpperCase();
      if (type === 'NUMBER' && !Number.isFinite(Number(value))) errors.push({ criterionId: item.criterionId, fieldKey: field.key, code: 'field-number' });
      if (type === 'SELECT') {
        let options = field.options;
        if (!options && field.optionsJson) { try { options = JSON.parse(field.optionsJson); } catch { options = []; } }
        if (Array.isArray(options) && options.length && !options.map(String).includes(String(value))) errors.push({ criterionId: item.criterionId, fieldKey: field.key, code: 'field-select' });
      }
    });
    if (criterion?.type === 'quality') {
      const percentage = item.percentage;
      if (percentage === '' || percentage === null || percentage === undefined || !Number.isFinite(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100) {
        errors.push({ criterionId: item.criterionId, code: 'quality-percentage' });
      }
    }
    if (criterion?.type === 'olympiad') {
      const entries = item.entries || [];
      if (!entries.length || entries.some((entry) => !entry?.studentName?.trim() || !entry?.olympiadName?.trim())) {
        errors.push({ criterionId: item.criterionId, code: 'olympiad-entry' });
      }
    }
    // Процентная шкала пользовательского критерия: процент обязателен — без него
    // выплату по диапазону определить невозможно (как в качестве обученности).
    if (criterion?.type === 'custom' && hasBandScales(criterion)) {
      const percentage = item.percentage;
      if (percentage === '' || percentage === null || percentage === undefined || !Number.isFinite(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100) {
        errors.push({ criterionId: item.criterionId, code: 'custom-percentage' });
      }
    }
  });
  return errors;
};

export const canCreateApplication = (state, teacherId, periodId) =>
  !(state.applications || []).some((app) => app.teacherId === teacherId && app.periodId === periodId);

export const getReviewableApplications = (state, schoolId) =>
  (state.applications || []).filter((app) => app.schoolId === schoolId);

export const createApplication = ({ id = `app-${Date.now()}`, periodId, teacherId, schoolId = '' }) => ({
  id,
  periodId,
  teacherId,
  schoolId,
  status: 'draft',
  comment: '',
  total: 0,
  items: [],
  createdAt: now(),
  updatedAt: now(),
});

export const submitApplication = (application) => ({
  ...application,
  status: 'review',
  comment: '',
  updatedAt: now(),
});

export const decideApplication = (application, status, comment = '') => ({
  ...application,
  status,
  comment: status === 'rejected' ? comment.trim() : '',
  updatedAt: now(),
});

export const defaultState = () => ({
  activeRole: 'teacher',
  activePeriod: { id: '2025-2', label: '2 полугодие 2025–2026 уч. г.', due: '15 сентября 2026', fund: 300000 },
  currentUser: { id: 'teacher-1', name: 'Кристина Обухова', initials: 'КО', position: 'Учитель математики', teacherCategory: 'subject', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми' },
  currentAdmin: { id: 'admin-1', name: 'Алексей Воронов', initials: 'АВ', position: 'Заместитель директора', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми' },
  schools: [
    { id: 'school-101', name: 'МАОУ «СОШ №101» г. Перми' },
    { id: 'school-12', name: 'МАОУ «Гимназия №12» г. Перми' },
    { id: 'school-44', name: 'МБОУ «СОШ №44» г. Перми' },
  ],
  applications: [
    {
      id: 'app-101', periodId: '2025-2', teacherId: 'teacher-1', schoolId: 'school-101', status: 'draft', total: 6300, comment: '',
      items: [
        { criterionId: '1.1', title: 'Качество обученности', category: 'Учебная деятельность', amount: 2000, maxAmount: 2000, percentage: 82, evidence: 'Выгрузка из журнала', progress: 100 },
        { criterionId: '2.2', title: 'Подготовка победителей и призёров предметных олимпиад', category: 'Результаты обучающихся', amount: 3300, maxAmount: 7000, entries: [{ level: 'municipal', diploma: 'winner', studentName: 'Иванов Иван', olympiadName: 'Олимпиада по математике' }, { level: 'regional', diploma: 'prize', studentName: 'Петрова Анна', olympiadName: 'Олимпиада по физике' }], evidence: 'diplom_2.pdf', progress: 72 },
        { criterionId: '4.4', title: 'Обобщение опыта', category: 'Методическая работа', amount: 1000, maxAmount: 2000, evidence: 'Сертификат НПК.pdf', progress: 50 },
      ], createdAt: '2026-08-29T10:00:00Z', updatedAt: '2026-08-29T10:00:00Z',
    },
    {
      id: 'app-098', periodId: '2025-2', teacherId: 'teacher-2', schoolId: 'school-101', status: 'review', total: 12800, comment: '',
      items: [{ criterionId: '4.1', title: 'Учитель года', category: 'Методическая работа', amount: 12800, maxAmount: 25000, evidence: 'diplom_teacher_year.pdf', progress: 80 }],
      createdAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-28T08:30:00Z',
    },
    {
      id: 'app-094', periodId: '2025-2', teacherId: 'teacher-3', schoolId: 'school-101', status: 'approved', total: 1000, comment: '',
      items: [{ criterionId: '3.2', title: 'Выездные мероприятия', category: 'Классное руководство', amount: 1000, maxAmount: 1000, evidence: 'Справка ВР.pdf', progress: 93 }],
      createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-26T12:00:00Z',
    },
    {
      id: 'app-091', periodId: '2025-2', teacherId: 'teacher-4', schoolId: 'school-101', status: 'rejected', total: 10000, comment: 'Приложите копию диплома конкурса',
      items: [{ criterionId: '4.1', title: 'Конкурс профессионального мастерства', category: 'Методическая работа', amount: 10000, maxAmount: 25000, evidence: 'Диплом.pdf', progress: 100 }],
      createdAt: '2026-08-24T10:00:00Z', updatedAt: '2026-08-25T09:00:00Z',
    },
  ],
  users: [
    { id: 'teacher-1', name: 'Кристина Обухова', initials: 'КО', position: 'Учитель математики', teacherCategory: 'subject', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-2', name: 'Артём Соколов', initials: 'АС', position: 'Учитель физики', teacherCategory: 'subject', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-3', name: 'Елена Мельникова', initials: 'ЕМ', position: 'Учитель начальных классов', teacherCategory: 'elementary', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-4', name: 'Наталья Королёва', initials: 'НК', position: 'Учитель русского языка', teacherCategory: 'subject', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
  ],
  criteria: [
    { id: '1.1', type: 'quality', title: 'Качество обученности', category: 'Учебная деятельность', amount: 2000, maxAmount: 2000, categoryBands: DEFAULT_CATEGORY_BANDS, scales: categoryBandScales(DEFAULT_CATEGORY_BANDS), usage: '18 заявок' },
    { id: '2.2', type: 'olympiad', title: 'Подготовка победителей и призёров предметных олимпиад', category: 'Результаты обучающихся', amount: 3300, maxAmount: 7000, olympiadAmounts: { municipal: { winner: 1500, prize: 1000 }, regional: { winner: 2500, prize: 1800 }, krai: { winner: 3500, prize: 2600 }, federal: { winner: 4500, prize: 3500 }, 'all-russian': { winner: 6000, prize: 4500 }, international: { winner: 7000, prize: 5500 } }, scales: Object.entries({ municipal: { winner: 1500, prize: 1000 }, regional: { winner: 2500, prize: 1800 }, krai: { winner: 3500, prize: 2600 }, federal: { winner: 4500, prize: 3500 }, 'all-russian': { winner: 6000, prize: 4500 }, international: { winner: 7000, prize: 5500 } }).flatMap(([level, values]) => Object.entries(values).map(([diploma, amount]) => ({ key: `${level}:${diploma}`, amount }))), usage: '12 заявок' },
    { id: '3.2', title: 'Выездные мероприятия за пределы СМО', category: 'Классное руководство', amount: 1000, maxAmount: 1000, usage: '6 заявок' },
    { id: '4.1', title: 'Конкурс профессионального мастерства', category: 'Методическая работа', amount: 10000, maxAmount: 25000, usage: '4 заявки' },
  ],
  audit: [
    { action: 'Заявка сохранена', target: 'Кристина Обухова · #app-101', time: 'Сегодня, 12:42', tone: 'blue' },
    { action: 'Заявка отправлена на проверку', target: 'Артём Соколов · #app-098', time: 'Вчера, 16:20', tone: 'amber' },
    { action: 'Заявка утверждена', target: 'Елена Мельникова · #app-094', time: '26 авг, 12:00', tone: 'green' },
  ],
});

export const loadState = () => {
  try {
    const stored = localStorage.getItem('epos-mvp-state');
    return stored ? { ...defaultState(), ...JSON.parse(stored) } : defaultState();
  } catch { return defaultState(); }
};

export const saveState = (state) => {
  try { localStorage.setItem('epos-mvp-state', JSON.stringify(state)); } catch { /* demo fallback */ }
};
