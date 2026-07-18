# Spreadsheet Intelligence and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scenario branches, formula tracing, table health analysis, responsive accessibility, worker-based heavy computation, and release-grade browser verification.

**Architecture:** Reuse the owned AST and dependency graph as the source of truth for all three intelligence features. Scenarios apply sparse overlays to immutable base revisions. Formula tracing records deterministic evaluation steps, while health analysis runs pure rules over a snapshot and proposes reversible commands.

**Tech Stack:** Existing React/TypeScript stack, Web Workers, Vitest, Playwright, native SVG/CSS.

## Global Constraints

- This plan starts only after every gate in `2026-07-18-spreadsheet-workbook-features.md` passes.
- Scenario calculations, explanations, and health analysis work offline without external AI.
- Scenario changes never mutate the base workbook until explicit merge.
- Every proposed automatic repair shows the affected range and is reversible.
- Color is never the only indicator of scenario differences, health severity, or errors.
- Heavy work may be cancelled and stale worker responses must be discarded by workbook revision.
- The release gate covers current Chromium, Firefox, and WebKit engines.
- Source files under `sources/` are read-only.

---

## File Map

```text
src/core/scenarios/types.ts             scenario and overlay contracts
src/core/scenarios/scenarioEngine.ts    branch create/edit/compare/merge
src/core/scenarios/impactMap.ts         dependency impact summaries
src/features/scenarios/ScenarioPanel.tsx scenario management and merge UI
src/core/trace/types.ts                 evaluation trace contracts
src/core/trace/tracingEvaluator.ts      deterministic step recording
src/features/inspector/FormulaInspector.tsx trace and dependency UI
src/core/health/types.ts                issue and repair contracts
src/core/health/rules.ts                deterministic health rules
src/core/health/analyzer.ts             rule orchestration
src/features/health/HealthPanel.tsx     issues, navigation, and repair UI
src/workers/protocol.ts                 revisioned worker message contracts
src/workers/calculation.worker.ts       recalculation worker
src/workers/health.worker.ts            health worker
src/app/workerCoordinator.ts            cancellation and stale-result guard
src/app/app.css                         polished responsive Volga design
tests/intelligence.spec.ts              feature browser flow
tests/accessibility.spec.ts             keyboard and accessibility assertions
tests/performance.spec.ts               large workbook budgets
```

### Task 1: Sparse Scenario Model and Isolated Calculation

**Files:**
- Create: `src/core/scenarios/types.ts`
- Create: `src/core/scenarios/scenarioEngine.ts`
- Test: `src/core/scenarios/scenarioEngine.test.ts`
- Modify: `src/core/model/types.ts`
- Modify: `src/core/engine/workbookEngine.ts`

**Interfaces:**
- Produces: `Scenario`, `ScenarioChange`, `ScenarioComparison`, `MergeSelection`, `MergeConflict`
- Produces: `ScenarioEngine.create(name: string, scope?: CellRange): Scenario`
- Produces: `ScenarioEngine.setCell(scenarioId, sheetId, address, input): ScenarioComparison`
- Produces: `ScenarioEngine.getCell(scenarioId, sheetId, address): CellData`
- Produces: `ScenarioEngine.compare(scenarioId): ScenarioComparison[]`
- Produces: `ScenarioEngine.merge(scenarioId, selection): WorkbookCommand`

- [ ] **Step 1: Write isolated scenario tests**

```ts
it('recalculates dependents without changing the base workbook', () => {
  // workbookWithValues is a test-local factory returning a WorkbookEngine.
  const engine = workbookWithValues({ A1: 100, B1: '=A1*1.2' })
  const scenarios = new ScenarioEngine(engine)
  const scenario = scenarios.create('Скидка 10%')
  scenarios.setCell(scenario.id, 'sheet-1', 'A1', 90)

  expect(engine.getCell('sheet-1', 'A1').value).toBe(100)
  expect(engine.getCell('sheet-1', 'B1').value).toBe(120)
  expect(scenarios.getCell(scenario.id, 'sheet-1', 'B1').value).toBe(108)
})
```

Add tests for range scope, formula overrides, spill arrays, scenario copy/delete, base revision capture, and scenario serialization.

- [ ] **Step 2: Verify scenario tests fail**

Run: `npm run test:run -- src/core/scenarios/scenarioEngine.test.ts`  
Expected: FAIL because scenario modules are missing.

- [ ] **Step 3: Implement sparse overlays**

Store `Map<CellKey, CellInput>` plus style patches, base revision, name, scope, created time, and updated time. Resolve reads from overlay first and base second. Build a scenario calculation context with its own result cache and dependency invalidation.

- [ ] **Step 4: Implement compare and merge**

Compare base input/value with overlay input/value and include direct versus dependent changes. Merge selected overlay inputs as one `History.transaction`. Detect conflicts when the current base input differs from the captured base input.

- [ ] **Step 5: Run scenario verification**

Run: `npm run test:run -- src/core/scenarios src/core/engine && npm run build`  
Expected: isolation, recalculation, conflict, merge, undo, and build checks pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/scenarios src/core/model/types.ts src/core/engine/workbookEngine.ts
git commit -m "feat: add isolated scenario branches"
```

### Task 2: Scenario Impact Map and User Interface

**Files:**
- Create: `src/core/scenarios/impactMap.ts`
- Test: `src/core/scenarios/impactMap.test.ts`
- Create: `src/features/scenarios/ScenarioPanel.tsx`
- Test: `src/features/scenarios/ScenarioPanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/useWorkbook.ts`
- Modify: `src/features/grid/SpreadsheetGrid.tsx`
- Modify: `src/app/app.css`

**Interfaces:**
- Produces: `buildImpactMap(graph, changes, charts): ImpactGroup[]`
- Produces: `ScenarioPanel`
- Extends: `WorkbookController` with scenario actions and active scenario state

- [ ] **Step 1: Write impact and panel tests**

Test grouping by sheet, direct versus dependent cells, affected chart detection, no-impact cases, keyboard scenario creation, difference navigation, selective merge, conflict resolution, and discard confirmation.

- [ ] **Step 2: Verify focused tests fail**

Run: `npm run test:run -- src/core/scenarios/impactMap.test.ts src/features/scenarios`  
Expected: FAIL because impact map and panel are missing.

- [ ] **Step 3: Implement impact grouping**

Walk reverse dependency edges from changed cells, stop repeated visits, group results by sheet, and attach chart IDs whose source ranges intersect affected cells. Sort direct changes before dependent results.

- [ ] **Step 4: Implement scenario panel**

Add create, rename, copy, delete, activate, compare, select-for-merge, and merge actions. Display base and scenario values side-by-side. Use solid outline plus `Изменено` label for direct changes and dashed outline plus `Зависит от сценария` for dependent changes.

- [ ] **Step 5: Add scenario grid mode**

While a scenario is active, base values are read-only references, overlay edits are allowed, the title bar shows `Сценарий: <name>`, and `Escape` exits only after confirming unsaved overlay edits.

- [ ] **Step 6: Verify scenario UI**

Run: `npm run test:run -- src/core/scenarios src/features/scenarios src/features/grid && npm run build`  
Expected: impact map, panel, grid states, conflicts, accessibility, and build checks pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/scenarios src/features/scenarios src/features/grid src/app
git commit -m "feat: add scenario comparison and impact map"
```

### Task 3: Deterministic Formula Trace

**Files:**
- Create: `src/core/trace/types.ts`
- Create: `src/core/trace/tracingEvaluator.ts`
- Test: `src/core/trace/tracingEvaluator.test.ts`
- Modify: `src/core/engine/evaluator.ts`
- Modify: `src/core/functions/registry.ts`

**Interfaces:**
- Produces: `TraceNode`, `TraceStep`, `FormulaTrace`
- Produces: `traceFormula(expression, context): FormulaTrace`
- Extends: `evaluate(expression, context, recorder?: TraceRecorder): CellValue`

- [ ] **Step 1: Write trace tests**

```ts
it('records references, function arguments, and the error origin', () => {
  const trace = traceInWorkbook('=IF(A1>0;SUM(B1:B2);0)', {
    A1: 1,
    B1: 5,
    B2: '#ДЕЛ/0!',
  })
  expect(trace.steps.map(step => step.kind)).toEqual(
    expect.arrayContaining(['reference', 'comparison', 'range', 'function', 'error']),
  )
  expect(trace.result).toMatchObject({ code: '#ДЕЛ/0!' })
  expect(trace.errorOrigin).toBe('sheet-1!1:1')
})
```

Add tests proving IF does not trace the unused branch, range summaries do not emit thousands of UI steps, circular references link to cycle members, and Russian explanations are deterministic.

- [ ] **Step 2: Verify trace tests fail**

Run: `npm run test:run -- src/core/trace`  
Expected: FAIL because trace modules are missing.

- [ ] **Step 3: Add optional evaluator recording**

Emit immutable trace nodes before and after evaluation. Record expression label, input values, output value, and source cells. Summarize ranges with count, first five values, and error count. The non-tracing evaluator path must avoid allocations beyond one falsy recorder check per node.

- [ ] **Step 4: Generate Russian explanations**

Use fixed templates keyed by node kind and operator. Examples: `A1 содержит 12`, `Сравнение 12 > 0 даёт ИСТИНА`, `СУММ складывает 3 числовых значения`, and `Вычисление остановлено из-за ошибки в B2`.

- [ ] **Step 5: Verify trace behavior and evaluator parity**

Run: `npm run test:run -- src/core/trace src/core/engine/evaluator.test.ts`  
Expected: traced and normal evaluation return identical results; all trace tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/trace src/core/engine/evaluator.ts src/core/functions/registry.ts
git commit -m "feat: record deterministic formula traces"
```

### Task 4: Formula Inspector Panel

**Files:**
- Create: `src/features/inspector/FormulaInspector.tsx`
- Test: `src/features/inspector/FormulaInspector.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/useWorkbook.ts`
- Modify: `src/app/app.css`

**Interfaces:**
- Produces: `FormulaInspector`
- Extends: `WorkbookController.traceActiveCell(): FormulaTrace`
- Extends: `WorkbookController.navigateToCell(key: CellKey): void`

- [ ] **Step 1: Write inspector tests**

Test empty/non-formula states, original and canonical formula, collapsible steps, intermediate results, error origin, source/dependent lists, cross-sheet navigation, keyboard tree navigation, and copy explanation.

- [ ] **Step 2: Verify inspector tests fail**

Run: `npm run test:run -- src/features/inspector`  
Expected: FAIL because the inspector is missing.

- [ ] **Step 3: Implement the approved right panel**

Render tabs `Рентген`, `Здоровье`, and `Сценарии`. The Rентген tab shows original formula, canonical formula, plain-language summary, step tree, direct sources, direct consumers, and error recovery suggestion.

- [ ] **Step 4: Add navigation and focus behavior**

Clicking a cell reference activates its sheet, selects the cell, scrolls it into view, and leaves an accessible `Вернуться к формуле` action. Use a semantic tree with arrow-key navigation.

- [ ] **Step 5: Verify inspector UI**

Run: `npm run test:run -- src/features/inspector src/core/trace && npm run build`  
Expected: trace presentation, navigation, focus, errors, and build checks pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/inspector src/app
git commit -m "feat: add formula x-ray inspector"
```

### Task 5: Table Health Rules and Repair Commands

**Files:**
- Create: `src/core/health/types.ts`
- Create: `src/core/health/rules.ts`
- Create: `src/core/health/analyzer.ts`
- Test: `src/core/health/rules.test.ts`
- Test: `src/core/health/analyzer.test.ts`

**Interfaces:**
- Produces: `HealthIssue`, `HealthRule`, `HealthSeverity`, `HealthRepair`
- Produces: `createHealthRules(): HealthRule[]`
- Produces: `analyzeWorkbook(snapshot, options): HealthReport`
- Produces: `HealthRepair.createCommand(): WorkbookCommand`

- [ ] **Step 1: Write one positive and one negative fixture per rule**

Cover:

1. formula differing from neighboring pattern;
2. missing formula inside a computed column;
3. error hidden by formatting or condition;
4. discontinuous range;
5. duplicate candidate identifier;
6. mixed types in a homogeneous column;
7. number stored as text;
8. formula referencing blank or deleted range;
9. hard-coded constant inside formula series;
10. stale volatile date.

```ts
it('finds a missing middle formula and offers a safe repair', () => {
  // fixtureSheet is a test-local factory returning a WorkbookData snapshot.
  const snapshot = fixtureSheet([
    ['Цена', 'Количество', 'Итого'],
    [10, 2, '=A2*B2'],
    [12, 3, null],
    [8, 4, '=A4*B4'],
  ])
  const report = analyzeWorkbook(snapshot)
  const issue = report.issues.find(item => item.ruleId === 'missing-formula')
  expect(issue?.range).toEqual({ start: 'C3', end: 'C3', sheetId: 'sheet-1' })
  expect(issue?.repair?.preview).toContain('=A3*B3')
})
```

- [ ] **Step 2: Verify health tests fail**

Run: `npm run test:run -- src/core/health`  
Expected: FAIL because health modules are missing.

- [ ] **Step 3: Implement pure health rules**

Each rule receives an immutable snapshot and emits issues with `id`, `ruleId`, `severity`, `sheetId`, `range`, `title`, `explanation`, `evidence`, and optional repair. Use formula AST normalization for pattern comparison; do not compare formula strings directly.

- [ ] **Step 4: Implement scoring and repairs**

Compute a 0–100 score from weighted unique issues with a floor of 0. Repairs return existing reversible commands and include a before/after preview. Never offer a repair when the neighboring formula pattern is ambiguous.

- [ ] **Step 5: Verify rules and deterministic ordering**

Run: `npm run test:run -- src/core/health`  
Expected: every rule fixture passes, false-positive fixtures stay empty, issue IDs and ordering are deterministic.

- [ ] **Step 6: Commit**

```bash
git add src/core/health
git commit -m "feat: analyze spreadsheet health"
```

### Task 6: Health Panel and Safe Repair Flow

**Files:**
- Create: `src/features/health/HealthPanel.tsx`
- Test: `src/features/health/HealthPanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/useWorkbook.ts`
- Modify: `src/app/app.css`

**Interfaces:**
- Produces: `HealthPanel`
- Extends: `WorkbookController.healthReport`
- Extends: `WorkbookController.runHealthAnalysis(): void`
- Extends: `WorkbookController.applyHealthRepair(issueId: string): void`

- [ ] **Step 1: Write health panel tests**

Test score display, severity labels, filter by severity, issue navigation, repair preview, confirmation, repair undo, ignored issue persistence, no-issue state, and `aria-live` completion announcement.

- [ ] **Step 2: Verify panel tests fail**

Run: `npm run test:run -- src/features/health`  
Expected: FAIL because the health panel is missing.

- [ ] **Step 3: Implement the health panel**

Show score, counts, last analysis time, severity filters, issue cards, evidence, `Перейти`, `Исправить`, and `Игнорировать`. Use icon, text label, and color for severity. Repairs open a confirmation sheet with exact before/after values.

- [ ] **Step 4: Add idle analysis**

Schedule analysis after 1,000ms without input, cancel on the next mutation, and retain the previous report with `Обновляется…` status while a new analysis runs.

- [ ] **Step 5: Verify repair transactions**

Run: `npm run test:run -- src/features/health src/core/health src/core/commands && npm run build`  
Expected: analysis, navigation, repair, undo, cancellation, accessibility, and build checks pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/health src/app
git commit -m "feat: add table health guidance"
```

### Task 7: Revisioned Web Workers and Performance Budgets

**Files:**
- Create: `src/workers/protocol.ts`
- Create: `src/workers/calculation.worker.ts`
- Create: `src/workers/health.worker.ts`
- Create: `src/app/workerCoordinator.ts`
- Test: `src/app/workerCoordinator.test.ts`
- Modify: `src/core/engine/workbookEngine.ts`
- Modify: `src/app/useWorkbook.ts`
- Create: `tests/performance.spec.ts`

**Interfaces:**
- Produces: `WorkerRequest`, `WorkerResponse`
- Produces: `WorkerCoordinator.calculate(snapshot, changed): Promise<CalculationPatch>`
- Produces: `WorkerCoordinator.analyze(snapshot): Promise<HealthReport>`
- Produces: `WorkerCoordinator.cancel(kind): void`

- [ ] **Step 1: Write stale-result and cancellation tests**

Test increasing request IDs, revision echo, rejection of responses for older revisions, cancellation before completion, worker exception recovery, and fallback to same-thread calculation.

- [ ] **Step 2: Verify coordinator tests fail**

Run: `npm run test:run -- src/app/workerCoordinator.test.ts`  
Expected: FAIL because worker modules are missing.

- [ ] **Step 3: Implement serializable worker protocol**

Send stored workbook snapshots rather than Maps, include `requestId`, `revision`, and operation kind, and return patches rather than entire workbooks. Terminate and recreate a worker after an uncaught error.

- [ ] **Step 4: Route heavy work**

Keep direct edits and currently visible formula chains on the main thread when the affected set is below 500 cells. Route larger recalculation and all idle health analysis to workers. Apply a patch only when response revision equals current revision.

- [ ] **Step 5: Add performance browser fixtures**

Generate deterministic books with 100,000 populated cells and 10,000 formulas. Assert initial interactive shell within 3 seconds on the test machine, cell editing feedback within 100ms, and independent formula edits do not recalculate unrelated chains. Record timings in test output without using flaky single-frame thresholds.

- [ ] **Step 6: Run performance and correctness gates**

Run: `npm run test:run -- src/app/workerCoordinator.test.ts src/core && npm run test:e2e -- tests/performance.spec.ts --project=chromium`  
Expected: worker correctness passes and performance budgets meet their assertions.

- [ ] **Step 7: Commit**

```bash
git add src/workers src/app/workerCoordinator.ts src/app/useWorkbook.ts src/core/engine/workbookEngine.ts tests/performance.spec.ts
git commit -m "perf: move heavy workbook analysis to workers"
```

### Task 8: Responsive Volga Polish and Accessibility

**Files:**
- Modify: `src/app/app.css`
- Modify: `src/app/App.tsx`
- Modify: `src/features/**/*.tsx`
- Create: `tests/accessibility.spec.ts`

**Interfaces:**
- Produces: accessible layouts at 375, 768, 1024, and 1440 pixels

- [ ] **Step 1: Write browser accessibility checks**

Test skip link, title/ribbon/grid/right-panel focus order, visible focus outlines, icon button labels, dialogs returning focus, grid keyboard editing, 200% zoom, reduced motion, severity text labels, scenario difference text labels, and chart text summaries.

- [ ] **Step 2: Run checks and record current failures**

Run: `npm run test:e2e -- tests/accessibility.spec.ts --project=chromium`  
Expected: FAIL with explicit unmet accessibility assertions before polish.

- [ ] **Step 3: Apply final Volga tokens**

Use the approved colors: `#17335F`, `#2F6FED`, `#EAF1FF`, `#F5F7FB`, `#FFFFFF`, `#1F2937`, `#667085`, `#E2E7EE`, `#12845B`, and `#C7363F`. Keep shadows only on floating layers. Use one Lucide outline icon family and tabular numeric glyphs.

- [ ] **Step 4: Implement responsive behavior**

At 1024px keep full ribbon and collapsible right panel. At 768px collapse ribbon groups into labeled overflow menus and make the right panel a drawer. At 375px retain grid, formula input, sheet tabs, compact formatting, and an explicit panel button; prevent application-level horizontal overflow while allowing grid scrolling.

- [ ] **Step 5: Complete semantic and motion behavior**

Add skip link, headings, labeled regions, roving grid focus, live announcements, accessible names, `aria-sort`, modal focus traps, 150–200ms transitions, and a `prefers-reduced-motion` rule that removes nonessential motion.

- [ ] **Step 6: Verify all target sizes**

Run: `npm run test:e2e -- tests/accessibility.spec.ts --project=chromium && npm run build`  
Expected: accessibility assertions pass at all four viewports and build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src tests/accessibility.spec.ts
git commit -m "feat: polish accessible responsive interface"
```

### Task 9: Cross-Browser Intelligence Flow and Release Gate

**Files:**
- Create: `tests/intelligence.spec.ts`
- Modify: `README.md`
- Create: `docs/FORMULA_COMPATIBILITY.md`
- Create: `docs/PRIVACY.md`

**Interfaces:**
- Produces: release-ready first version

- [ ] **Step 1: Write the end-to-end intelligence flow**

The flow must create a budget table, build formulas, open the formula inspector, verify an intermediate result, create a `Скидка 10%` scenario, change an assumption, verify dependent values and chart impact, selectively merge, introduce a missing formula, run health analysis, preview and apply the repair, undo it, reload, and verify persistence.

- [ ] **Step 2: Run all browser engines**

Run: `npm run test:e2e -- tests/editor.spec.ts tests/workbook.spec.ts tests/intelligence.spec.ts tests/accessibility.spec.ts --project=chromium --project=firefox --project=webkit`  
Expected: all critical flows pass in Chromium, Firefox, and WebKit.

- [ ] **Step 3: Document formula compatibility**

List every canonical function and Russian alias, supported operators, reference forms, locale rules, dynamic array behavior, date system, known XLSX preservation behavior, and the exact meaning of each error code.

- [ ] **Step 4: Document privacy and recovery**

State that workbook data stays in the browser, describe IndexedDB snapshots, explain file import safety, list data-clearing steps, and document previous-snapshot recovery.

- [ ] **Step 5: Run the complete release gate**

Run: `npm run check && npm run test:e2e`  
Expected: all unit/component tests, type checks, production build, browser flows, accessibility checks, and performance checks pass.

- [ ] **Step 6: Perform visual QA**

Run the production preview at 375, 768, 1024, and 1440 pixels. Capture the blank workbook, populated workbook, scenario comparison, formula inspector, health report, import report, and chart views. Confirm no clipping, overlap, unreadable text, missing focus state, or unintended horizontal application scroll.

- [ ] **Step 7: Commit**

```bash
git add tests README.md docs/FORMULA_COMPATIBILITY.md docs/PRIVACY.md
git commit -m "test: complete spreadsheet first version release gate"
```

## Program Sequence and Specification Coverage

1. `2026-07-18-spreadsheet-core-editor.md` implements specification sections 3–6: model boundaries, owned parser/evaluator, bilingual functions, errors, dependency recalculation, transactions, the editable grid, formula bar, ribbon, status, and the first browser milestone.
2. `2026-07-18-spreadsheet-workbook-features.md` implements sections 6, 8, and 9: sheets, named ranges, structural editing, formatting, clipboard, autofill, search, sort, filters, IndexedDB recovery, CSV, XLSX, and four accessible chart types.
3. This plan implements sections 7 and 10–14: scenario branches, impact maps, formula x-ray, all ten health rules, safe repairs, workers, performance budgets, responsive Volga polish, accessibility, privacy documentation, compatibility documentation, and the cross-browser release gate.

The three plans together cover every first-version inclusion and criterion in the approved design specification. Items explicitly excluded from the first version remain outside these plans.
