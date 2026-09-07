// Email notifications via the Brevo (Sendinblue) transactional REST API.
// Zero-dependency: uses native fetch, so no extra packages are needed.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface MailPayload {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
  text?: string;
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = String(env.BREVO_API_KEY || '').trim();
  const fromEmail = String(env.BREVO_SENDER_EMAIL || env.MAIL_FROM || '').trim();
  const fromName = String(env.BREVO_SENDER_NAME || 'Образовательная система').trim();
  const enabled = Boolean(apiKey && fromEmail);

  async function send(payload: MailPayload): Promise<boolean> {
    if (!enabled) return false;
    try {
      const response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        // Brevo's API expects htmlContent/textContent, not html/text.
        body: JSON.stringify({ sender: { email: fromEmail, name: fromName }, subject: payload.subject, to: payload.to, htmlContent: payload.html, ...(payload.text ? { textContent: payload.text } : {}) }),
      });
      if (!response.ok) {
        console.warn(`[mailer] Brevo responded ${response.status}: ${await response.text().catch(() => '')}`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('[mailer] Brevo request failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  return { enabled, send };
}

export function renderApplicationSubmitted(params: { teacherName: string; applicationId: string; periodLabel: string; schoolName: string; total: number }) {
  const rub = new Intl.NumberFormat('ru-RU').format(params.total);
  return {
    subject: `Новая заявка на проверку — ${params.teacherName}`,
    html: `<div style="font:14px/1.6 Arial,sans-serif;color:#17243a;max-width:520px"><h2 style="margin:0 0 12px">Новая заявка на проверку</h2><p>${params.teacherName} отправил(а) заявку на стимулирующие выплаты за период «${params.periodLabel}».</p><table style="border-collapse:collapse;margin:16px 0"><tr><td style="padding:4px 12px 4px 0;color:#6f7d91">Школа</td><td><b>${params.schoolName}</b></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6f7d91">Предварительная сумма</td><td><b>${rub} ₽</b></td></tr></table><p>Откройте очередь «На проверке» в системе, чтобы принять решение по заявке.</p></div>`,
    text: `${params.teacherName} отправил(а) заявку за период «${params.periodLabel}». Сумма: ${rub} ₽. Откройте систему, чтобы принять решение.`,
  };
}

export function renderApplicationDecided(params: { teacherName: string; approved: boolean; comment?: string; periodLabel: string; total: number }) {
  const rub = new Intl.NumberFormat('ru-RU').format(params.total);
  const header = params.approved ? 'Заявка утверждена' : 'Заявка отправлена на доработку';
  const details = params.approved
    ? `Ваша заявка за период «${params.periodLabel}» утверждена. Сумма к выплате: <b>${rub} ₽</b>. Заявка включена в реестр выплат.`
    : `Завуч вернул вашу заявку за период «${params.periodLabel}» на доработку.${params.comment ? `<p style="background:#fff4df;border-radius:8px;padding:10px 12px"><b>Комментарий:</b> ${params.comment}</p>` : ''}`;
  return {
    subject: header,
    html: `<div style="font:14px/1.6 Arial,sans-serif;color:#17243a;max-width:520px"><h2 style="margin:0 0 12px">${header}</h2><p>${details}</p><p>Откройте систему, чтобы ${params.approved ? 'посмотреть реестр выплат' : 'внести исправления и отправить заявку повторно'}.</p></div>`,
    text: `${header}. ${details}`,
  };
}
