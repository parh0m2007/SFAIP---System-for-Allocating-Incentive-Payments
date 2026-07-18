# Spreadsheet Workbook Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the core editor into a practical multi-sheet workbook with named ranges, formatting, structural editing, sorting, filtering, local persistence, XLSX/CSV exchange, and accessible charts.

**Architecture:** Add capabilities as reversible commands. Persist versioned snapshots through a repository backed by IndexedDB. Keep CSV, XLSX, and chart projection as adapters so formats and visualization never leak into formula evaluation.

**Tech Stack:** Existing stack, IDB 8.0.3, ExcelJS 4.4.0, native SVG.

## Global Constraints

- Begin after all gates in `2026-07-18-spreadsheet-core-editor.md` pass.
- Keep the owned engine as the only formula evaluator.
- Preserve unknown imported formulas verbatim and display `#ИМЯ?`.
- Never run imported macros, external links, or executable objects.
- Make every group/structural edit, import, sort, and repair reversible.
- Keep data on-device and `sources/` read-only.

## File Map

```text
src/core/commands/{sheet,structure,style}Commands.ts
src/core/model/{structuralEdits,namedRanges,clipboard,autofill}.ts
src/core/data/{search,sort,filter}.ts
src/persistence/{schema,workbookRepository,indexedDbRepository,autosave}.ts
src/interchange/{csv,xlsx,importReport}.ts
src/charts/{chartModel,chartProjector}.ts
src/features/dialogs/*  src/features/charts/ChartPanel.tsx
tests/workbook.spec.ts
```

---

### Task 1: Multi-Sheet Commands and Named Ranges

**Files:**
- Create: `src/core/commands/sheetCommands.ts`
- Create: `src/core/model/namedRanges.ts`
- Test: corresponding `.test.ts` files
- Modify: `src/core/model/types.ts`, `src/core/engine/{evaluator,workbookEngine}.ts`
- Modify: `src/features/sheets/SheetTabs.tsx`, `src/app/useWorkbook.ts`

**Interfaces:**
- Produces: `AddSheetCommand`, `RenameSheetCommand`, `DuplicateSheetCommand`, `MoveSheetCommand`, `HideSheetCommand`, `DeleteSheetCommand`
- Produces: `NamedRange`, `DefineNamedRangeCommand`, `DeleteNamedRangeCommand`

- [ ] **Step 1: Write failing tests**

```ts
history.execute(new AddSheetCommand('Отчёт'))
history.execute(new RenameSheetCommand(source, 'Данные'))
expect(engine.getCell(report, 'A1').value).toBe(7)
expect(engine.getCell(report, 'A1').canonicalFormula).toContain('Данные')
```

Add unique names, duplicate formulas/styles, order, hiding active sheet, only-visible-sheet protection, deletion references, undo, workbook/sheet-scoped named ranges, case-insensitive lookup, and `=Налог*B2`.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/commands/sheetCommands.test.ts src/core/model/namedRanges.test.ts`  
Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement sheets**

Use stable sheet IDs in AST references. Rename changes display/canonical serialization only. Delete converts affected references to `#ССЫЛКА!`; undo restores both.

- [ ] **Step 4: Implement named ranges**

Validate names with `/^[\\p{L}_][\\p{L}\\p{N}_.]*$/u`, prohibit A1 lookalikes and function collisions, resolve sheet scope before workbook scope, and add graph edges for referenced ranges.

- [ ] **Step 5: Connect tabs and verify**

Enable add, activate, rename, duplicate, reorder, hide, delete; use keyboard tab navigation and reference warning confirmation.

Run: `npm run test:run -- src/core src/features/sheets && npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core src/features/sheets src/app/useWorkbook.ts
git commit -m "feat: add sheets and named ranges"
```

### Task 2: Structural Edits and Reference Transforms

**Files:**
- Create: `src/core/model/structuralEdits.ts`, `src/core/commands/structureCommands.ts`
- Test: corresponding `.test.ts` files
- Modify: `src/core/engine/workbookEngine.ts`, `src/features/grid/SpreadsheetGrid.tsx`

**Interfaces:**
- Produces: `transformAddress`, `transformExpression`
- Produces: row/column insert/delete/resize, merge/unmerge, and freeze commands

- [ ] **Step 1: Write transform tests**

```ts
const transformed = transformExpression(parseFormula('=SUM(A1:A3)', 'en-US'), {
  kind: 'insertRows', sheetId: 'sheet-1', index: 1, count: 1,
})
expect(serializeFormula(transformed)).toBe('=SUM(A1:A4)')
```

Add before/inside/after range, deletion intersection, absolute references, named ranges, cross-sheet isolation, merge collision, and undo.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/model/structuralEdits.test.ts src/core/commands/structureCommands.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement AST coordinate transforms**

Transform reference nodes, return a reference-error node for deleted coordinates, rebuild affected graph edges, and recalculate once per command.

- [ ] **Step 4: Add grid controls**

Implement accessible row/column menus, 4px drag resize handles, merge/unmerge, and freeze controls with keyboard equivalents.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core src/features/grid && npm run build`  
Expected: PASS.

```bash
git add src/core src/features/grid
git commit -m "feat: add structural workbook editing"
```

### Task 3: Formatting, Clipboard, and Autofill

**Files:**
- Create: `src/core/commands/styleCommands.ts`
- Create: `src/core/model/clipboard.ts`, `src/core/model/autofill.ts`
- Test: corresponding `.test.ts` files
- Modify: `src/features/ribbon/Ribbon.tsx`, `src/features/grid/SpreadsheetGrid.tsx`, `src/app/app.css`

**Interfaces:**
- Produces: `PatchStyleCommand`, `copyRange`, `pasteRange`, `inferFillSeries`

- [ ] **Step 1: Write tests**

Cover partial style patches, multi-cell undo, TSV/internal clipboard, formula translation, numeric/date series, repeated text, drag preview, and spill-child rejection.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/commands/styleCommands.test.ts src/core/model/clipboard.test.ts src/core/model/autofill.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement styles**

Patch only requested style keys. Add general, number, currency, percent, date, time, and custom display masks without changing stored values. Reflect mixed selection state in ribbon controls.

- [ ] **Step 4: Implement clipboard/autofill**

Write `text/plain` TSV plus internal JSON MIME; prefer internal payload; translate relative references; infer linear numeric/date series; show fill preview before one transaction.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core src/features/grid src/features/ribbon && npm run build`  
Expected: PASS.

```bash
git add src/core src/features/ribbon src/features/grid src/app/app.css
git commit -m "feat: add formatting clipboard and autofill"
```

### Task 4: Search, Replace, Sort, and Filter

**Files:**
- Create: `src/core/data/search.ts`, `sort.ts`, `filter.ts`
- Test: corresponding `.test.ts` files
- Create: `src/features/dialogs/SearchDialog.tsx`, `SortDialog.tsx`, `FilterPopover.tsx`
- Modify: `src/features/grid/SpreadsheetGrid.tsx`, `src/features/ribbon/Ribbon.tsx`

**Interfaces:**
- Produces: `findMatches`, `replaceMatches`, `sortRows`, `filterRows`

- [ ] **Step 1: Write tests**

Cover case sensitivity, literal search, formula-text search, replace-all undo, stable multi-key sort, blanks last, locale strings, numeric comparison, selected values, condition filters, and hidden rows.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/data`  
Expected: FAIL.

- [ ] **Step 3: Implement pure operations**

Return row permutations and visibility sets without mutating inputs. Sort full row records in one transaction. Store filter state on the sheet without deleting rows.

- [ ] **Step 4: Implement accessible dialogs**

Add `Ctrl/Cmd+F`, result navigation, replace one/all, multi-key sort, filter search/select/condition, and focus restoration.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core/data src/features/dialogs && npm run build`  
Expected: PASS.

```bash
git add src/core/data src/features/dialogs src/features/grid src/features/ribbon
git commit -m "feat: add search sorting and filters"
```

### Task 5: Versioned IndexedDB Autosave

**Files:**
- Create: `src/persistence/schema.ts`, `workbookRepository.ts`, `indexedDbRepository.ts`, `autosave.ts`
- Test: `src/persistence/*.test.ts`
- Modify: `src/app/{useWorkbook,App}.tsx`, `package.json`

**Interfaces:**
- Produces: `serializeWorkbook`, `deserializeWorkbook`
- Produces: `WorkbookRepository.loadCurrent/save/loadPrevious`
- Produces: `AutosaveCoordinator.schedule/flush`

- [ ] **Step 1: Install storage dependencies**

Run: `npm install idb@8.0.3 && npm install -D fake-indexeddb@6.2.4`  
Expected: manifest and lock update.

- [ ] **Step 2: Write tests**

Test Map serialization, current/previous rotation, schema rejection, checksum mismatch, migration hook, 600ms debounce, explicit flush, save-error status, and previous-snapshot recovery.

- [ ] **Step 3: Verify failure**

Run: `npm run test:run -- src/persistence`  
Expected: FAIL.

- [ ] **Step 4: Implement storage**

Use database `volga-sheets`, store `workbooks`, keys `current`/`previous`, entry-array Maps, deterministic SHA-256 checksum, schema version, and previous-valid rotation.

- [ ] **Step 5: Connect app**

Load before controller creation; show `Сохранение…`, `Сохранено локально`, or `Не удалось сохранить`; debounce 600ms and flush on hidden `visibilitychange`; offer previous recovery on validation failure.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- src/persistence src/app && npm run build`  
Expected: PASS.

```bash
git add package.json package-lock.json src/persistence src/app
git commit -m "feat: persist workbooks locally"
```

### Task 6: CSV Preview, Import, and Export

**Files:**
- Create: `src/interchange/csv.ts`
- Test: `src/interchange/csv.test.ts`
- Create: `src/features/dialogs/CsvImportDialog.tsx`
- Modify: `src/features/ribbon/Ribbon.tsx`

**Interfaces:**
- Produces: `detectCsvOptions`, `parseCsv`, `serializeCsv`, `importCsv`

- [ ] **Step 1: Write tests**

Cover comma/semicolon/tab, quoted separators, escaped quotes, embedded newlines, UTF-8 BOM, CRLF, ragged rows, formula-like text, preview limit, and injection-safe export.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/interchange/csv.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement a state-machine parser**

Use explicit `field`, `quoted`, `afterQuote` states. Preserve values beginning with `=`, `+`, `-`, `@` as text unless `Распознавать формулы` is enabled.

- [ ] **Step 4: Implement preview UI**

Show encoding, delimiter, first 50 rows, destination, and formula toggle. Export active sheet as UTF-8 with optional BOM and chosen delimiter.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/interchange src/features/dialogs && npm run build`  
Expected: PASS.

```bash
git add src/interchange src/features/dialogs src/features/ribbon
git commit -m "feat: import and export csv files"
```

### Task 7: Safe XLSX Exchange

**Files:**
- Create: `src/interchange/xlsx.ts`, `importReport.ts`
- Test: `src/interchange/xlsx.test.ts`
- Create: `src/features/dialogs/XlsxImportDialog.tsx`
- Modify: `src/features/ribbon/Ribbon.tsx`, `package.json`

**Interfaces:**
- Produces: `importXlsx(buffer): Promise<XlsxImportResult>`
- Produces: `exportXlsx(snapshot): Promise<ArrayBuffer>`

- [ ] **Step 1: Install ExcelJS**

Run: `npm install exceljs@4.4.0`  
Expected: manifest and lock update.

- [ ] **Step 2: Write in-memory round-trip tests**

Include two sheets, values, bilingual/unknown formulas, styles, merges, dimensions, freeze panes, external links, macros, and unsupported objects. Assert supported preservation and zero execution.

- [ ] **Step 3: Verify failure**

Run: `npm run test:run -- src/interchange/xlsx.test.ts`  
Expected: FAIL.

- [ ] **Step 4: Implement guarded import/export**

Import into a temporary model, sanitize names, normalize supported formulas with the owned parser, preserve unknown raw strings, collect warnings, and publish only after validation. Export values, formulas, cached results, styles, dimensions, merges, and freezes; exclude macros/external relationships.

- [ ] **Step 5: Add confirmation UI and verify**

Show counts/warnings and `Открыть как новую книгу`.

Run: `npm run test:run -- src/interchange src/features/dialogs && npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/interchange src/features/dialogs src/features/ribbon
git commit -m "feat: add safe xlsx file exchange"
```

### Task 8: Accessible Native SVG Charts

**Files:**
- Create: `src/charts/chartModel.ts`, `chartProjector.ts`
- Test: `src/charts/chartProjector.test.ts`
- Create/Test: `src/features/charts/ChartPanel.tsx`
- Modify: `src/core/model/types.ts`, `src/features/ribbon/Ribbon.tsx`

**Interfaces:**
- Produces: `ChartDefinition`, `projectChart`, `chartSummary`, `ChartPanel`

- [ ] **Step 1: Write tests**

Cover headers, numeric series, missing values, structural range changes, column/line/bar/pie mapping, pie rejection above five categories, Russian text summaries, keyboard marks, and table-data toggle.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/charts src/features/charts`  
Expected: FAIL.

- [ ] **Step 3: Implement projection and renderers**

Store source-range definitions on sheets; project calculated values; render responsive SVG with labeled axes, legend, focusable marks, hover/focus tooltips, `aria-describedby` summary, and source table.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run -- src/charts src/features/charts && npm run build`  
Expected: PASS.

```bash
git add src/charts src/features/charts src/core/model/types.ts src/features/ribbon
git commit -m "feat: add accessible spreadsheet charts"
```

### Task 9: Workbook Browser Milestone

**Files:**
- Create: `tests/workbook.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: verified practical workbook

- [ ] **Step 1: Write the browser flow**

Create/rename second sheet; define a named range; reference both; format/fill a range; insert a row; sort/filter; reload autosave; export CSV; import XLSX fixture; create chart; undo structural edit; assert dialog focus restoration.

- [ ] **Step 2: Run Chromium flow**

Run: `npm run test:e2e -- tests/editor.spec.ts tests/workbook.spec.ts --project=chromium`  
Expected: PASS.

- [ ] **Step 3: Document features and safety**

Document multi-sheet editing, named ranges, formats, local recovery, CSV safety, XLSX limitations, and chart accessibility.

- [ ] **Step 4: Run milestone gate**

Run: `npm run check && npm run test:e2e -- tests/editor.spec.ts tests/workbook.spec.ts`  
Expected: all unit tests, types, build, and browser flows pass.

- [ ] **Step 5: Commit**

```bash
git add tests/workbook.spec.ts README.md
git commit -m "test: verify complete workbook milestone"
```
