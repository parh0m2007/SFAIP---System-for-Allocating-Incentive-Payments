# Spreadsheet Core and Basic Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable spreadsheet editor with a fully owned formula parser, evaluator, dependency graph, bilingual function package, undo/redo, and an editable virtualized grid.

**Architecture:** Keep the workbook model and formula engine as framework-free TypeScript. React consumes immutable snapshots through a workbook controller and renders only visible cells. Mutations are reversible commands; calculated values are always derived from raw cell inputs.

**Tech Stack:** Node.js 22, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Playwright 1.61.1, Lucide React 1.25.0, CSS.

## Global Constraints

- Do not use a spreadsheet formula library or dynamic JavaScript execution.
- Support Russian and English function names without case sensitivity.
- Accept `;` and `,` argument separators according to workbook locale.
- Work locally in the browser without registration or a server.
- Keep `sources/` read-only.
- Write failing tests before implementation.

## File Map

```text
src/core/model/{types,address}.ts             workbook contracts and A1 addressing
src/core/formula/{ast,tokenizer,parser,serializer,locale,errors}.ts
src/core/functions/{registry,core}.ts         first function package
src/core/engine/{evaluator,dependencyGraph,arrays,workbookEngine}.ts
src/core/commands/{commands,history}.ts       reversible transactions
src/app/{App,useWorkbook,app.css}.tsx         application composition
src/features/grid/{gridGeometry,SpreadsheetGrid}.tsx
src/features/{ribbon,formula,status,sheets}/* editing chrome
tests/editor.spec.ts                          browser milestone
```

---

### Task 1: Scaffold and Smoke Test

**Files:**
- Create: `package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/app.css`, `src/test/setup.ts`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element`
- Produces: scripts `dev`, `build`, `test`, `test:run`, `test:e2e`, `check`

- [ ] **Step 1: Create exact package scripts and dependencies**

Use React `19.2.7`, React DOM `19.2.7`, Lucide React `1.25.0`; development dependencies TypeScript `7.0.2`, Vite `8.1.5`, Vitest `4.1.10`, `@vitejs/plugin-react` `6.0.3`, Playwright `1.61.1`, Testing Library React `16.3.2`, jest-dom `6.9.1`, and jsdom `28.0.0`. Configure strict TypeScript with `noUncheckedIndexedAccess`.

- [ ] **Step 2: Install**

Run: `npm install`  
Expected: exit code 0 and `package-lock.json`.

- [ ] **Step 3: Write the failing shell test**

```tsx
render(<App />)
expect(screen.getByRole('application', { name: 'Редактор таблиц' })).toBeVisible()
expect(screen.getByText('Новая таблица')).toBeVisible()
```

- [ ] **Step 4: Verify failure**

Run: `npm run test:run -- src/app/App.test.tsx`  
Expected: FAIL because `App` does not exist.

- [ ] **Step 5: Implement the shell**

```tsx
export function App() {
  return (
    <main role="application" aria-label="Редактор таблиц" className="app-shell">
      <header className="titlebar">
        <span className="product-mark" aria-hidden="true" />
        <strong>Новая таблица</strong>
        <span className="save-state">Сохранено локально</span>
      </header>
      <section aria-label="Рабочая область таблицы" className="workspace" />
    </main>
  )
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- src/app/App.test.tsx && npm run build`  
Expected: PASS and successful build.

```bash
git add package.json package-lock.json index.html tsconfig.json vite.config.ts playwright.config.ts src
git commit -m "feat: scaffold spreadsheet application"
```

### Task 2: Workbook Types and A1 Addresses

**Files:**
- Create: `src/core/model/types.ts`, `src/core/model/address.ts`
- Test: `src/core/model/address.test.ts`

**Interfaces:**
- Produces: `CellAddress`, `CellRange`, `CellValue`, `CellError`, `ArrayValue`, `CellData`, `SheetData`, `WorkbookData`
- Produces: `parseA1`, `formatA1`, `translateA1`

- [ ] **Step 1: Write address tests**

```ts
expect(parseA1('$C$12')).toEqual({
  row: 11, column: 2, rowAbsolute: true, columnAbsolute: true,
})
expect(formatA1(parseA1('$B3'))).toBe('$B3')
expect(translateA1('$B3', 2, 4)).toBe('$B5')
expect(translateA1('B$3', 2, 4)).toBe('F$3')
expect(() => parseA1('A0')).toThrow('Некорректный адрес')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/model/address.test.ts`  
Expected: FAIL because model files do not exist.

- [ ] **Step 3: Define exact value and cell contracts**

```ts
export type CellScalar = string | number | boolean | null
export type CellErrorCode =
  | '#ДЕЛ/0!' | '#ИМЯ?' | '#ССЫЛКА!' | '#ЗНАЧ!'
  | '#Н/Д' | '#ЧИСЛО!' | '#РАЗЛИВ!' | '#ЦИКЛ!'
export interface CellError { kind: 'error'; code: CellErrorCode; message: string; origin?: CellKey }
export interface ArrayValue { kind: 'array'; rows: CellValue[][] }
export type CellValue = CellScalar | CellError | ArrayValue
export type CellKey = `${string}!${number}:${number}`
export interface CellRange { sheetId: string; start: CellAddress; end: CellAddress }
```

Add sparse `SheetData.cells: Map<string, CellData>` and `WorkbookData` with locale, sheets, active sheet ID, and revision.

- [ ] **Step 4: Implement addresses**

Parse with `/^(\$?)([A-Z]+)(\$?)([1-9]\d*)$/i`, use zero-based coordinates and base-26 columns, preserve absolute flags, and reject negative translated coordinates.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core/model && npm run build`  
Expected: PASS.

```bash
git add src/core/model
git commit -m "feat: define workbook model and cell addressing"
```

### Task 3: Owned Formula Parser

**Files:**
- Create: `src/core/formula/ast.ts`, `tokenizer.ts`, `parser.ts`, `serializer.ts`, `locale.ts`, `errors.ts`
- Test: `src/core/formula/tokenizer.test.ts`, `parser.test.ts`, `locale.test.ts`

**Interfaces:**
- Produces: `Expression`
- Produces: `tokenize(formula, locale): Token[]`
- Produces: `parseFormula(formula, locale): Expression`
- Produces: `serializeFormula(expression): string`
- Produces: `canonicalFunctionName(name): string`

- [ ] **Step 1: Write parser acceptance tests**

```ts
expect(parseFormula('=1+2*3', 'ru-RU')).toMatchObject({
  type: 'binary', operator: '+', right: { type: 'binary', operator: '*' },
})
expect(parseFormula('=ЕСЛИ(A1>0;СУММ(B1:B3);0)', 'ru-RU')).toMatchObject({
  type: 'function', name: 'IF',
})
expect(parseFormula("='План 2026'!$B2:C$9", 'ru-RU')).toMatchObject({ type: 'range' })
```

Add lexer cases for escaped quotes, decimal comma/point, comparisons, percent, mixed references, and invalid trailing input.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/formula`  
Expected: FAIL because parser files are missing.

- [ ] **Step 3: Define the AST**

```ts
export type Expression =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'reference'; sheetName?: string; address: CellAddress }
  | { type: 'range'; start: ReferenceExpression; end: ReferenceExpression }
  | { type: 'unary'; operator: '+' | '-'; operand: Expression }
  | { type: 'percent'; operand: Expression }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='; left: Expression; right: Expression }
  | { type: 'function'; name: string; args: Expression[] }
  | { type: 'namedRange'; name: string }
export type ReferenceExpression = Extract<Expression, { type: 'reference' }>
```

- [ ] **Step 4: Implement tokenizer and Pratt parser**

Use binding powers: comparisons 10, concatenation 20, addition 30, multiplication 40, power 50, unary 60, percent 70. Normalize every approved Russian alias to a canonical English name. Reject leftover tokens with source offset. Serialize the AST to one canonical English formula for diagnostics, reference transforms, and export while retaining the original user string separately.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core/formula`  
Expected: PASS.

```bash
git add src/core/formula
git commit -m "feat: parse bilingual spreadsheet formulas"
```

### Task 4: Registry and Scalar Evaluation

**Files:**
- Create: `src/core/functions/registry.ts`, `src/core/functions/core.ts`
- Create: `src/core/engine/evaluator.ts`
- Test: `src/core/functions/core.test.ts`, `src/core/engine/evaluator.test.ts`

**Interfaces:**
- Produces: `FunctionRegistry`, `createCoreFunctionRegistry`
- Produces: `evaluate(expression, context): CellValue`

- [ ] **Step 1: Write evaluator tests**

```ts
expect(evaluate(parseFormula('=(2+3)*4', 'ru-RU'), context)).toBe(20)
expect(evaluate(parseFormula('=СУММ(1;2;3)', 'ru-RU'), context)).toBe(6)
expect(evaluate(parseFormula('=1/0', 'ru-RU'), context)).toMatchObject({ code: '#ДЕЛ/0!' })
```

Add cases for explicit coercion, error propagation, wrong arity, lazy `IF`, `AND`, `OR`, and a fixed clock.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/engine/evaluator.test.ts`  
Expected: FAIL because evaluator files are missing.

- [ ] **Step 3: Implement the registry contract**

```ts
export interface FunctionDefinition {
  name: string
  minArgs: number
  maxArgs?: number
  evaluate(args: CellValue[], context: FunctionContext): CellValue
}
```

Unknown names return `#ИМЯ?`; wrong arity returns `#ЗНАЧ!`.

- [ ] **Step 4: Implement evaluator and first vertical slice**

Add explicit `toNumber`, `toText`, `toBoolean`, `flattenValues`, and `firstError`. Implement arithmetic, comparisons, references, ranges, `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `AND`, `OR`, `NOT`, `IFERROR`, `ABS`, `ROUND`, `MOD`, `POWER`, `SQRT`, `CONCAT`, `LEN`, `TODAY`, and `NOW`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:run -- src/core/functions src/core/engine/evaluator.test.ts`  
Expected: PASS.

```bash
git add src/core/functions src/core/engine
git commit -m "feat: evaluate core spreadsheet formulas"
```

### Task 5: Dependency Graph, Recalculation, and Function Completion

**Files:**
- Create: `src/core/engine/dependencyGraph.ts`, `arrays.ts`, `workbookEngine.ts`
- Modify: `src/core/functions/core.ts`, `src/core/engine/evaluator.ts`
- Test: `src/core/engine/dependencyGraph.test.ts`, `workbookEngine.test.ts`, `arrays.test.ts`
- Test: `src/core/functions/{criteria,lookup}.test.ts`

**Interfaces:**
- Produces: `DependencyGraph.setDependencies`, `getDependents`, `recalculationOrder`
- Produces: `WorkbookEngine.createEmpty`, `setCellInput`, `getCell`, `snapshot`
- Produces: complete approved first-package function registry

- [ ] **Step 1: Write recalculation tests**

```ts
const engine = WorkbookEngine.createEmpty()
const sheet = engine.snapshot().activeSheetId
engine.setCellInput(sheet, 'A1', 2)
engine.setCellInput(sheet, 'B1', '=A1*3')
engine.setCellInput(sheet, 'C1', '=B1+1')
engine.setCellInput(sheet, 'D1', '=99')
const mutation = engine.setCellInput(sheet, 'A1', 4)
expect(engine.getCell(sheet, 'C1').value).toBe(13)
expect(mutation.recalculated).not.toContain(`${sheet}!0:3`)
```

Add cycle membership, cross-sheet references, removed dependencies, invalid references, and stable ordering.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/engine/dependencyGraph.test.ts src/core/engine/workbookEngine.test.ts`  
Expected: FAIL because graph and engine are missing.

- [ ] **Step 3: Implement graph and engine**

Maintain forward/reverse adjacency maps, replace old edges atomically, detect cycles in the affected subgraph, calculate in topological order, parse formulas once, store raw and canonical forms, and increment revision once per public mutation.

- [ ] **Step 4: Write criteria, lookup, and spill tests**

Cover wildcard/relational criteria, dimension errors, exact and approximate `VLOOKUP`, `XLOOKUP` not found, `INDEX/MATCH`, stable `SORT`, order-preserving `UNIQUE`, empty `FILTER`, successful spills, and collision `#РАЗЛИВ!`.

- [ ] **Step 5: Implement the remaining first package**

Add `IFS`, conditional aggregates, lookups, `SUMPRODUCT`, all approved math/text/date/information functions, and array functions `FILTER`, `SORT`, `UNIQUE`. Track spill children by origin, clear old output before reevaluation, and block direct child edits.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- src/core && npm run build`  
Expected: every declared first-package function has normal, empty, error, and locale coverage; all pass.

```bash
git add src/core
git commit -m "feat: complete owned calculation engine"
```

### Task 6: Commands, Transactions, Undo, and Redo

**Files:**
- Create: `src/core/commands/commands.ts`, `src/core/commands/history.ts`
- Test: `src/core/commands/history.test.ts`
- Modify: `src/core/engine/workbookEngine.ts`

**Interfaces:**
- Produces: `SetCellCommand`, `SetRangeCommand`, `History.execute`, `undo`, `redo`, `transaction`

- [ ] **Step 1: Write history tests**

```ts
history.transaction('Вставка диапазона', [
  new SetCellCommand(sheet, 'A1', 1),
  new SetCellCommand(sheet, 'A2', 2),
])
history.undo()
expect(engine.getCell(sheet, 'A2').value).toBeNull()
history.redo()
expect(engine.getCell(sheet, 'A2').value).toBe(2)
```

Add failed-transaction rollback, formula/spill restoration, redo invalidation, and 200-entry bound.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/core/commands/history.test.ts`  
Expected: FAIL because history is missing.

- [ ] **Step 3: Implement reversible commands**

Capture full prior cell records. Suppress intermediate publication inside transactions and recalculate once. Failed commands do not enter history; new commands clear redo.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run -- src/core/commands src/core/engine`  
Expected: PASS.

```bash
git add src/core/commands src/core/engine/workbookEngine.ts
git commit -m "feat: add transactional undo and redo"
```

### Task 7: React Controller and Editable Virtualized Grid

**Files:**
- Create: `src/app/useWorkbook.ts`
- Create: `src/features/grid/gridGeometry.ts`, `SpreadsheetGrid.tsx`
- Test: `src/features/grid/gridGeometry.test.ts`, `SpreadsheetGrid.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/app.css`

**Interfaces:**
- Produces: `WorkbookController`, `useWorkbook`
- Produces: `visibleGridRange`, `SpreadsheetGrid`

- [ ] **Step 1: Write grid tests**

Test overscan geometry, click/drag selection, double-click edit, typing replacement, `Enter`, `Tab`, arrows, delete, visible headers, clipboard TSV, and displayed formula result.

```tsx
await user.click(screen.getByRole('gridcell', { name: 'A1' }))
await user.keyboard('2{Enter}')
await user.click(screen.getByRole('gridcell', { name: 'B1' }))
await user.keyboard('=A1*3{Enter}')
expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('6')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/features/grid`  
Expected: FAIL because grid modules are missing.

- [ ] **Step 3: Implement controller**

Use `useSyncExternalStore`. Expose snapshot, active sheet, selection, `setCell`, `setRange`, `undo`, `redo`, `setSelection`, and `displayValue`.

- [ ] **Step 4: Implement semantic virtualization**

Render visible cells plus two rows/columns overscan with absolute positioning. Use grid ARIA roles and one roving tab stop. Position a real `<input>` over the active cell during editing.

- [ ] **Step 5: Apply Volga geometry**

Use 36px title bar, 44px ribbon space, 30px formula bar, 24px rows, 88px columns, approved colors, visible focus, non-color error markers, and selection outline.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:run -- src/features/grid src/app && npm run build`  
Expected: PASS.

```bash
git add src/app src/features/grid
git commit -m "feat: render editable virtualized grid"
```

### Task 8: Editing Chrome and Browser Milestone

**Files:**
- Create: `src/features/ribbon/Ribbon.tsx`, `src/features/formula/FormulaBar.tsx`
- Create: `src/features/status/StatusBar.tsx`, `src/features/sheets/SheetTabs.tsx`
- Test: colocated component tests
- Create: `tests/editor.spec.ts`
- Create: `README.md`

**Interfaces:**
- Produces: ribbon, formula bar, status bar, sheet strip, verified browser flow

- [ ] **Step 1: Write component tests**

Test formula bar commit/cancel, original formula display, undo/redo states, active sheet name, numeric selection count/sum/average, and keyboard shortcuts.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- src/features`  
Expected: FAIL because editing chrome is missing.

- [ ] **Step 3: Implement components**

Add ribbon groups `Файл`, `Главная`, `Вставка`, `Данные`, `Формулы`, `Рецензирование`; formula address/input; sheet tab; status aggregates; shortcuts for undo/redo, copy/paste, delete, search, and F2. Disable unavailable later-phase commands with explicit tooltips rather than hiding them.

- [ ] **Step 4: Write and run browser flow**

```ts
test('creates formulas, recalculates, and undoes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('gridcell', { name: 'A1' }).click()
  await page.keyboard.type('10')
  await page.keyboard.press('Enter')
  await page.getByRole('gridcell', { name: 'B1' }).click()
  await page.keyboard.type('=СУММ(A1;5)')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'B1' })).toHaveText('15')
  await page.keyboard.press('ControlOrMeta+z')
})
```

Run: `npx playwright install chromium && npm run test:e2e -- tests/editor.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Document and run milestone gate**

Document setup, privacy, functions, locale behavior, shortcuts, and current milestone scope.

Run: `npm run check && npm run test:e2e -- tests/editor.spec.ts`  
Expected: unit tests, type check, build, and browser flow pass.

- [ ] **Step 6: Commit**

```bash
git add src/features src/app tests/editor.spec.ts README.md
git commit -m "test: verify core spreadsheet editor milestone"
```
