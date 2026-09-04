const now = () => new Date().toISOString();

export const QUALITY_BANDS = [
  { from: 0, to: 50, amount: 2000 },
  { from: 50, to: 75, amount: 3000 },
  { from: 75, to: 90, amount: 4000 },
];

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

export const calculateReward = ({ maxAmount = 0, requestedAmount = 0 }) =>
  Math.min(Math.max(Number(requestedAmount) || 0, 0), Math.max(Number(maxAmount) || 0));

export const updateCriterionAmount = (criterion, amount) => ({
  ...criterion,
  amount: calculateReward({ maxAmount: criterion.maxAmount, requestedAmount: amount }),
});

// Build the complete criterion payload used by quick inline edits. The API
// replaces nested fields/scales on PATCH, so omitting them would silently
// erase a deputy's existing configuration.
export const criterionUpdatePayload = (criterion, overrides = {}) => {
  const merged = { ...criterion, ...overrides };
  const scalesSource = merged.qualityBands?.length ? merged.qualityBands : (merged.scales || []);
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
  };
};

export const getQualityBand = (bands = QUALITY_BANDS, percentage) => {
  if (percentage === '' || percentage === null || percentage === undefined) return null;
  const value = Number(percentage);
  if (!Number.isFinite(value) || value < 0) return null;
  return bands.find((band, index) => value <= band.to && (index === 0 ? value >= band.from : value > band.from)) || null;
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
    if (criterion?.type === 'quality' && !getQualityBand(criterion.qualityBands, item.percentage)) {
      errors.push({ criterionId: item.criterionId, code: 'quality-percentage' });
    }
    if (criterion?.type === 'olympiad') {
      const entries = item.entries || [];
      if (!entries.length || entries.some((entry) => !entry?.studentName?.trim() || !entry?.olympiadName?.trim())) {
        errors.push({ criterionId: item.criterionId, code: 'olympiad-entry' });
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
  activePeriod: { id: '2025-2', label: '2 полугодие 2025–2026 уч. г.', due: '15 сентября 2026' },
  currentUser: { id: 'teacher-1', name: 'Кристина Обухова', initials: 'КО', position: 'Учитель математики', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми' },
  currentAdmin: { id: 'admin-1', name: 'Алексей Воронов', initials: 'АВ', position: 'Заместитель директора', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми' },
  schools: [
    { id: 'school-101', name: 'МАОУ «СОШ №101» г. Перми' },
    { id: 'school-12', name: 'МАОУ «Гимназия №12» г. Перми' },
    { id: 'school-44', name: 'МБОУ «СОШ №44» г. Перми' },
  ],
  applications: [
    {
      id: 'app-101', periodId: '2025-2', teacherId: 'teacher-1', schoolId: 'school-101', status: 'draft', total: 7600, comment: '',
      items: [
        { criterionId: '1.1', title: 'Качество обученности', category: 'Учебная деятельность', amount: 4000, maxAmount: 4000, percentage: 82, evidence: 'Выгрузка из журнала', progress: 100 },
        { criterionId: '2.2', title: 'Подготовка победителей и призёров предметных олимпиад', category: 'Результаты обучающихся', amount: 2600, maxAmount: 7000, entries: [{ level: 'municipal', diploma: 'winner', studentName: 'Иванов Иван', olympiadName: 'Олимпиада по математике' }, { level: 'regional', diploma: 'prize', studentName: 'Петрова Анна', olympiadName: 'Олимпиада по физике' }], evidence: 'diplom_2.pdf', progress: 72 },
        { criterionId: '4.4', title: 'Обобщение опыта', category: 'Методическая работа', amount: 1000, maxAmount: 2000, evidence: 'Сертификат НПК.pdf', progress: 50 },
      ], createdAt: '2026-08-29T10:00:00Z', updatedAt: '2026-08-29T10:00:00Z',
    },
    {
      id: 'app-098', periodId: '2025-2', teacherId: 'teacher-2', schoolId: 'school-101', status: 'review', total: 12800, comment: '',
      items: [{ criterionId: '4.1', title: 'Учитель года', category: 'Методическая работа', amount: 12800, maxAmount: 25000, evidence: 'diplom_teacher_year.pdf', progress: 80 }],
      createdAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-28T08:30:00Z',
    },
    {
      id: 'app-094', periodId: '2025-2', teacherId: 'teacher-3', schoolId: 'school-101', status: 'approved', total: 9300, comment: '',
      items: [{ criterionId: '3.2', title: 'Выездные мероприятия', category: 'Классное руководство', amount: 9300, maxAmount: 10000, evidence: 'Справка ВР.pdf', progress: 93 }],
      createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-26T12:00:00Z',
    },
  ],
  users: [
    { id: 'teacher-1', name: 'Кристина Обухова', initials: 'КО', position: 'Учитель математики', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-2', name: 'Артём Соколов', initials: 'АС', position: 'Учитель физики', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-3', name: 'Елена Мельникова', initials: 'ЕМ', position: 'Учитель начальных классов', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
    { id: 'teacher-4', name: 'Наталья Королёва', initials: 'НК', position: 'Учитель русского языка', schoolId: 'school-101', schoolName: 'МАОУ «СОШ №101» г. Перми', status: 'active' },
  ],
  criteria: [
    { id: '1.1', type: 'quality', title: 'Качество обученности', category: 'Учебная деятельность', amount: 4000, maxAmount: 4000, qualityBands: QUALITY_BANDS, usage: '18 заявок' },
    { id: '2.2', type: 'olympiad', title: 'Подготовка победителей и призёров предметных олимпиад', category: 'Результаты обучающихся', amount: 2600, maxAmount: 7000, olympiadAmounts: { municipal: { winner: 1500, prize: 1000 }, regional: { winner: 2500, prize: 1800 }, krai: { winner: 3500, prize: 2600 }, federal: { winner: 4500, prize: 3500 }, 'all-russian': { winner: 6000, prize: 4500 }, international: { winner: 7000, prize: 5500 } }, usage: '12 заявок' },
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
