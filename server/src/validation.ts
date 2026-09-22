import { BadRequestException } from '@nestjs/common';
import { CriterionType, FieldType, Role, TeacherCategory } from '@prisma/client';

const OLYMPIAD_LEVELS = new Set(['municipal', 'regional', 'krai', 'federal', 'all-russian', 'international']);
const DIPLOMA_TYPES = new Set(['winner', 'prize']);
const VOCAB_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const parseVocab = (raw: string | null | undefined, fallback: Set<string>): Set<string> => {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return fallback;
    const ids = parsed.map((item: any) => String(item?.id || '')).filter((id: string) => VOCAB_ID_RE.test(id));
    return ids.length ? new Set(ids) : fallback;
  } catch { return fallback; }
};
const FIELD_TYPES = new Set(Object.values(FieldType));
const CRITERION_TYPES = new Set(Object.values(CriterionType));
const TEACHER_CATEGORIES = new Set(Object.values(TeacherCategory));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (code: string, message: string): never => { throw new BadRequestException({ code, message }); };

export function assertPeriodPayload(payload: any) {
  const label = String(payload?.label || '').trim();
  if (!label || label.length > 160) fail('PERIOD_INVALID', 'Укажите название периода (до 160 символов)');
  const startsAt = new Date(payload?.startsAt);
  const endsAt = new Date(payload?.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail('PERIOD_INVALID', 'Укажите даты начала и окончания периода');
  if (startsAt >= endsAt) fail('PERIOD_INVALID', 'Дата окончания должна быть позже даты начала');
  if (payload?.fundAmount != null && payload.fundAmount !== '') {
    const fund = Number(payload.fundAmount);
    if (!Number.isInteger(fund) || fund < 0 || fund > 1_000_000_000) fail('FUND_INVALID', 'Фонд должен быть целым числом от 0 до 1 000 000 000 ₽');
  }
}

export function assertTeacherRole(role: unknown): asserts role is typeof Role.TEACHER {
  if (role !== Role.TEACHER) fail('TEACHER_ONLY', 'Операция доступна только учителю');
}
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const amount = (value: unknown, max: number, code = 'AMOUNT_INVALID') => {
  if (!finiteNumber(value) || !Number.isInteger(value) || value < 0 || value > max) fail(code, `Сумма должна быть целым числом от 0 до ${max} ₽`);
};

export function assertRegisterPayload(payload: any) {
  const fullName = String(payload?.fullName || '').trim();
  const email = String(payload?.email || '').trim();
  const password = String(payload?.password || '');
  if (fullName.length < 2 || fullName.length > 120) fail('VALIDATION', 'Укажите корректные ФИО');
  if (!EMAIL_RE.test(email) || email.length > 160) fail('EMAIL_INVALID', 'Укажите корректный email');
  if (password.length < 8 || password.length > 128) fail('PASSWORD_INVALID', 'Пароль должен содержать от 8 до 128 символов');
  if (!String(payload?.schoolId || '').trim()) fail('SCHOOL_INVALID', 'Выберите школу');
  if (!Object.values(Role).includes(payload?.role)) fail('ROLE_INVALID', 'Недопустимая роль');
  if (payload?.teacherCategory != null && payload.teacherCategory !== '' && !TEACHER_CATEGORIES.has(payload.teacherCategory)) fail('CATEGORY_INVALID', 'Недопустимая категория педагога');
}

export function assertTeacherCategory(value: unknown) {
  if (value != null && value !== '' && !TEACHER_CATEGORIES.has(value as TeacherCategory)) fail('CATEGORY_INVALID', 'Недопустимая категория педагога');
}

export function assertCriterionPayload(payload: any) {
  const title = String(payload?.title || '').trim();
  const category = String(payload?.category || '').trim();
  const type = String(payload?.type || '').toUpperCase();
  const maxAmount = payload?.maxAmount;
  if (!title || title.length > 200 || !category || category.length > 120) fail('VALIDATION', 'Название и категория обязательны');
  if (!CRITERION_TYPES.has(type as CriterionType)) fail('TYPE_INVALID', 'Недопустимый тип критерия');
  if (!finiteNumber(maxAmount) || !Number.isInteger(maxAmount) || maxAmount < 0 || maxAmount > 1_000_000) fail('AMOUNT_INVALID', 'Максимум должен быть целым числом от 0 до 1 000 000 ₽');
  if (payload?.amount != null) amount(payload.amount, maxAmount);

  const fields = payload?.fields == null ? [] : payload.fields;
  if (!Array.isArray(fields) || fields.length > 30) fail('FIELDS_INVALID', 'Поля критерия заданы некорректно');
  const keys = new Set<string>();
  fields.forEach((field: any) => {
    const key = String(field?.key || '').trim();
    const label = String(field?.label || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || keys.has(key) || !label || label.length > 120 || !FIELD_TYPES.has(String(field?.type || 'TEXT').toUpperCase() as FieldType)) fail('FIELDS_INVALID', 'Проверьте ключи, подписи и типы полей');
    keys.add(key);
    if (String(field?.type || '').toUpperCase() === FieldType.SELECT && (!Array.isArray(field.options) || !field.options.length || field.options.length > 50)) fail('FIELDS_INVALID', 'Для списка добавьте варианты выбора');
  });

  const scales = payload?.scales == null ? [] : payload.scales;
  if (!Array.isArray(scales) || scales.length > 100) fail('SCALES_INVALID', 'Шкалы заданы некорректно');
  // Шкалы с диапазоном процентов (качество обученности) группируются по ключу —
  // категории педагога. Пересечения внутри одной категории недопустимы,
  // но диапазоны разных категорий могут совпадать.
  const grouped = new Map<string, any[]>();
  scales.forEach((scale: any) => {
    if (scale?.from == null && scale?.to == null) return;
    const key = String(scale?.key || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(scale);
  });
  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => Number(a.from ?? -Infinity) - Number(b.from ?? -Infinity));
    sorted.forEach((scale: any, index: number) => {
      const from = scale.from == null ? 0 : Number(scale.from);
      const to = scale.to == null ? 100 : Number(scale.to);
      if (!finiteNumber(from) || !finiteNumber(to) || from < 0 || to > 100 || from > to) fail('SCALES_INVALID', 'Диапазоны процентов должны быть от 0 до 100 без пересечений');
      amount(Number(scale.amount), maxAmount, 'SCALES_INVALID');
      const previous = sorted[index - 1];
      if (previous) {
        const previousTo = previous.to == null ? 100 : Number(previous.to);
        if (from < previousTo) fail('SCALES_INVALID', 'Диапазоны процентов не должны пересекаться');
      }
    });
  }
  // Ключевые шкалы (олимпиады: уровень и диплом) должны иметь уникальный ключ.
  // Повторяющиеся ключи диапазонов (категории педагога) разрешены — они
  // обрабатываются групповой проверкой пересечений выше.
  const scaleKeys = new Set<string>();
  scales.forEach((scale: any) => {
    if (scale?.from != null || scale?.to != null) return;
    const key = String(scale?.key || '').trim();
    if (!key) fail('SCALES_INVALID', 'Укажите ключ шкалы');
    if (scaleKeys.has(key)) fail('SCALES_INVALID', `Шкала «${key}» указана повторно`);
    scaleKeys.add(key);
    // Шкалы без диапазона (варианты пользовательского критерия, олимпиады)
    // тоже не должны превышать максимум выплаты.
    if (scale?.amount != null) amount(Number(scale.amount), maxAmount, 'SCALES_INVALID');
  });

  // Настраиваемые справочники олимпиадного критерия: уровни и степени диплома.
  // Когда справочник задан, каждая шкала должна ссылаться на объявленные элементы.
  if (type === CriterionType.OLYMPIAD) {
    const vocab = (items: any) => {
      if (!Array.isArray(items) || items.length > 50) fail('VOCAB_INVALID', 'Справочник должен содержать до 50 элементов');
      const ids = new Set<string>();
      items.forEach((item: any) => {
        const id = String(item?.id || '').trim();
        const label = String(item?.label || '').trim();
        if (!VOCAB_ID_RE.test(id) || ids.has(id) || !label || label.length > 120) fail('VOCAB_INVALID', 'Проверьте идентификаторы и названия справочника');
        ids.add(id);
      });
      return ids;
    };
    const levelIds = payload?.levels?.length ? vocab(payload.levels) : null;
    const diplomaIds = payload?.diplomas?.length ? vocab(payload.diplomas) : null;
    if (levelIds || diplomaIds) {
      scales.forEach((scale: any) => {
        if (scale?.from != null || scale?.to != null) return;
        const [level, diploma] = String(scale?.key || '').split(':');
        if (levelIds && !levelIds.has(level)) fail('SCALES_INVALID', `Уровень «${level}» отсутствует в справочнике`);
        if (diplomaIds && !diplomaIds.has(diploma)) fail('SCALES_INVALID', `Степень «${diploma}» отсутствует в справочнике`);
      });
    }
  }
}

export function assertCustomFields(fields: any[] = [], values: any = {}, strict = true) {
  if (!Array.isArray(fields)) fail('FIELDS_INVALID', 'Поля критерия заданы некорректно');
  fields.forEach((field: any) => {
    const value = values?.[field.key];
    if (strict && field.required && (value == null || String(value).trim() === '')) fail('FIELD_REQUIRED', `Заполните поле «${field.label}»`);
    if (value == null || value === '') return;
    if (String(field.type).toUpperCase() === FieldType.NUMBER && (!finiteNumber(Number(value)) || String(value).trim() === '')) fail('FIELD_INVALID', `Поле «${field.label}» должно быть числом`);
    if (String(field.type).toUpperCase() === FieldType.SELECT && Array.isArray(field.options) && !field.options.map(String).includes(String(value))) fail('FIELD_INVALID', `Выберите допустимое значение поля «${field.label}»`);
  });
}

export function assertOlympiadEntry(entry: any, levels: Set<string> = OLYMPIAD_LEVELS, diplomas: Set<string> = DIPLOMA_TYPES) {
  if (!levels.has(String(entry?.level || '')) || !diplomas.has(String(entry?.diploma || '')) || String(entry?.studentName || '').trim().length < 2 || String(entry?.olympiadName || '').trim().length < 2) fail('OLYMPIAD_ENTRY', 'Заполните уровень, степень, ФИО ученика и название олимпиады');
}

export function assertApplicationItems(items: any[], criteria: any[], schoolId: string, options: { strict?: boolean } = {}) {
  const strict = options.strict !== false;
  if (!Array.isArray(items)) fail('ITEMS_INVALID', 'Критерии заявки заданы некорректно');
  const seen = new Set<string>();
  items.forEach((item: any) => {
    const criterion = criteria.find((candidate: any) => candidate.id === item?.criterionId);
    if (!criterion || criterion.schoolId !== schoolId || seen.has(item.criterionId)) fail('CRITERION_INVALID', 'Критерий недоступен или добавлен повторно');
    seen.add(item.criterionId);
    const values = item.values || {};
    assertCustomFields((criterion.fields || []).map((field: any) => ({ ...field, options: field.options || (field.optionsJson ? parseOptions(field.optionsJson) : []) })), values, strict);
    if (criterion.type === CriterionType.QUALITY) {
      const percentage = Number(values.percentage);
      if (strict && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('QUALITY_PERCENTAGE', 'Процент обученности должен быть от 0 до 100');
      if (!strict && values.percentage !== '' && values.percentage != null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('QUALITY_PERCENTAGE', 'Процент обученности должен быть от 0 до 100');
    }
    if (criterion.type === CriterionType.OLYMPIAD) {
      const levels = parseVocab(criterion.levelsJson, OLYMPIAD_LEVELS);
      const diplomas = parseVocab(criterion.diplomasJson, DIPLOMA_TYPES);
      if (strict && (!Array.isArray(item.entries) || !item.entries.length)) fail('OLYMPIAD_ENTRY', 'Добавьте хотя бы одного участника олимпиады');
      if (Array.isArray(item.entries)) item.entries.forEach((entry: any) => {
        if (!strict && !entry?.studentName && !entry?.olympiadName) return;
        assertOlympiadEntry(entry, levels, diplomas);
      });
    }
    // Вариант выплаты пользовательского критерия обязан быть из объявленной шкалы.
    if (criterion.type === CriterionType.CUSTOM && values.scale != null && String(values.scale) !== '' && !(criterion.scales || []).some((scale: any) => scale.key === String(values.scale))) {
      fail('FIELD_INVALID', `Выберите допустимый вариант выплаты критерия «${criterion.title}»`);
    }
    // Процентная шкала пользовательского критерия: если заданы диапазоны,
    // процент обязателен — без него выплату определить невозможно.
    if (criterion.type === CriterionType.CUSTOM && (criterion.scales || []).some((scale: any) => scale.fromValue != null && scale.toValue != null)) {
      const percentage = Number(values.percentage);
      if (strict && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('PERCENTAGE_REQUIRED', `Укажите процент от 0 до 100 для критерия «${criterion.title}»`);
      if (!strict && values.percentage !== '' && values.percentage != null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('PERCENTAGE_REQUIRED', `Процент должен быть от 0 до 100 для критерия «${criterion.title}»`);
    }
  });
}

const parseOptions = (value: string) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

export function assertWritableEvidence(application: any, criterion: any, item: any, role: Role) {
  if (!item || item.applicationId !== application.id) fail('ITEM_INVALID', 'Элемент заявки не найден');
  if (!criterion?.allowEvidence) fail('EVIDENCE_DISABLED', 'Для этого критерия подтверждающий документ не требуется');
  if (role === Role.TEACHER && !['DRAFT', 'REJECTED'].includes(application.status)) fail('STATUS_LOCKED', 'Заявка уже отправлена на проверку');
}
