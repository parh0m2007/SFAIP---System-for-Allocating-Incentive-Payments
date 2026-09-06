import test from 'node:test';
import assert from 'node:assert/strict';
import { mailerFromEnv, renderApplicationSubmitted, renderApplicationDecided } from '../src/mailer.js';

test('mailer отключён без ключей Brevo и не падает при отправке', async () => {
  const mailer = mailerFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(mailer.enabled, false);
  assert.equal(await mailer.send({ to: [{ email: 'a@b.ru' }], subject: 'x', html: 'x' }), false);
});

test('mailer включён только при наличии ключа и отправителя', () => {
  assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k' } as NodeJS.ProcessEnv).enabled, false);
  assert.equal(mailerFromEnv({ BREVO_SENDER_EMAIL: 'a@b.ru' } as NodeJS.ProcessEnv).enabled, false);
  assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'a@b.ru' } as NodeJS.ProcessEnv).enabled, true);
  // MAIL_FROM is accepted as an alias for the sender address
  assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.ru' } as NodeJS.ProcessEnv).enabled, true);
});

test('письмо о новой заявке содержит имя учителя, период и сумму', () => {
  const rendered = renderApplicationSubmitted({ teacherName: 'Кристина Обухова', applicationId: 'app-1', periodLabel: '2 полугодие', schoolName: 'СОШ №101', total: 10300 });
  assert.match(rendered.subject, /Кристина Обухова/);
  assert.match(rendered.html, /2 полугодие/);
  // ru-RU number formatting uses a non-breaking space as the group separator
  assert.match(rendered.html, /10[\s\u00A0]300/);
  assert.match(rendered.html, /СОШ №101/);
  assert.match(rendered.text, /10[\s\u00A0]300/);
});

test('письмо об утверждении содержит сумму, об отклонении — комментарий', () => {
  const approved = renderApplicationDecided({ teacherName: 'Иван Иванов', approved: true, periodLabel: '1 полугодие', total: 5000 });
  assert.match(approved.subject, /утверждена/i);
  assert.match(approved.html, /5[\s\u00A0]000/);
  const rejected = renderApplicationDecided({ teacherName: 'Иван Иванов', approved: false, comment: 'Приложите документ', periodLabel: '1 полугодие', total: 5000 });
  assert.match(rejected.subject, /доработку/i);
  assert.match(rejected.html, /Приложите документ/);
  // No comment section when the deputy left no comment
  const rejectedNoComment = renderApplicationDecided({ teacherName: 'И.И.', approved: false, periodLabel: 'п.', total: 1 });
  assert.ok(!rejectedNoComment.html.includes('Комментарий:'));
});
