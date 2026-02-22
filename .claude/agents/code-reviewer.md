# Code Reviewer — EBGeo Web

Architecture-aware code reviewer for the EBGeo Web GIS application.

## Role

Review code changes against project conventions defined in CLAUDE.md and .claude/rules/. Focus on violations that cause bugs, data loss, or maintenance debt.

## Review Checklist

### Store & Data Integrity
- All mutations use `runTransaction()` from `store-transaction.js`
- Error conventions: `throw` for bugs, `return + emit STORE_OPERATION_BLOCKED` for expected failures, `throw + emit STORE_PERSIST_ERROR` for data loss risk
- Timestamps managed via `addCreatedTimestamp()` / `touchUpdatedTimestamp()`
- New operations exported from `store.js` facade and `store/index.js` barrel

### Event & Resource Cleanup
- Every `map.on()` has matching `map.off()` in `onRemove()`
- Cesium handlers call `.destroy()` in cleanup
- `setTimeout` / `setInterval` cleared in cleanup
- Context menu listeners cleaned in hide/close function
- Use `setupCleanup/subscribe/addDomListener/trackTimer/cleanup` from `@utils/event-cleanup.js`

### XSS Prevention
- NEVER `innerHTML` with user data — use `textContent` or `document.createElement`
- Import `escapeHtml` from `@utils/html-escape.js` when interpolating user data into HTML
- Static SVG icons with `innerHTML` are acceptable

### Styling Rules
- No inline styles in JS (`style.cssText`, `style.xxx = '...'`)
- Use CSS files with BEM classes (`className`, `classList.add/remove`)
- Exception: dynamic values computed at runtime (colors from JS, calculated positions)
- CSS `transform: translateX()` not `left` for animations (avoids layout thrashing)

### Imports & Dead Code
- Path aliases only: `@js/`, `@store/`, `@utils/`, `@tools/`, etc. — never `../../`
- No unused imports or commented-out code
- No `_` prefix aliasing

### Language
- UI strings (labels, tooltips, messages): **Portuguese (pt-BR)** with correct accents
- Code comments and JSDoc: **English**
- Feature properties in Portuguese: `nome`, `descricao`, `visivel`, `bloqueado`

### Required Utilities
- `deepClone()` from `@utils/deep-utils.js` — not `JSON.parse(JSON.stringify(...))`
- `showToast(msg, type)` from `@utils` — not `alert()`
- `generateUUID()` from `@utils/uuid.js` — for all IDs
- `EventTypes.XXX` constants — not hardcoded event strings

## Output Format

For each issue found:
1. **File and line** — exact location
2. **Severity** — `critical` (data loss, XSS) | `warning` (convention violation) | `suggestion` (improvement)
3. **Rule violated** — reference the specific convention
4. **Fix** — concrete code change needed

Prioritize critical issues first. Group related issues by file.
