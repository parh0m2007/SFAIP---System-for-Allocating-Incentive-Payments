import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');

test('Excel-выгрузка записывает аудит до закрытия HTTP-ответа', () => {
  const exportBody = main.slice(main.indexOf("@Get('reports/:periodId/export.xlsx')"), main.indexOf('\n  private onlyDeputy'));
  assert.ok(exportBody.indexOf("await this.audit(req.user.userId") < exportBody.indexOf('res.end()'));
});

test('статус критерия обновляется отдельным маршрутом, не удаляя критерий', () => {
  assert.match(main, /@Patch\('criteria\/:id\/status'\)/);
  assert.match(main, /data: \{ active: b\.active, version: c\.version \+ 1 \}/);
  assert.match(main, /CRITERION_STATUS_UPDATE/);
  assert.match(main, /@Delete\('criteria\/:id'\)/);
});
