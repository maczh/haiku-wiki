# XLSX editor: FortuneSheet

The sheet/excel editors, readers, attachment previews, share readers and H5 readers
use `@fortune-sheet/react` 1.0.4. The editor is a React component with per-instance
state, replacing LuckySheet's singleton and global jQuery/Spectrum/touch patches.
FortuneSheet and ExcelJS use MIT licenses. Neither needs a document server or a
commercial import/export service.

The editor has an Excel-style green title bar, native formatting toolbar, formula
bar, row/column headers and workbook tabs. Read mode disables edits and mutation
menus. The grid has an explicit responsive height in both edit and read modes.
The component and ExcelJS are loaded on demand.

New XLSX imports retain the uploaded original and create one `excel` document for
the complete workbook. ExcelJS imports all sheets, including blank sheets; it does
not compress empty rows or split the workbook into child documents. Supported
conversion covers values, formulas/cached results, common font/fill/border/alignment
styles, number/date formats, hyperlinks, merges, row/column dimensions, hidden
rows/columns and frozen panes. Source cell styles are retained for export.

The sparse v3 sheet storage contract is retained for old data compatibility.
FortuneSheet uses string sheet IDs; the adapter maps legacy numeric indexes and
preserves current data matrix edits when serializing back to sparse cells.
Saved content uses `haiku.sheet/1`, `editor: fortune-sheet`, a v3 `workbook`, the
original `url`, and `edited_url` pointing to a freshly generated standard XLSX.
The editor save/export buttons, global export and knowledge-base ZIP use the
current workbook. `.xls`/CSV retain the existing legacy import path.

FortuneSheet is an Excel-like editor, not a full Excel 365 implementation.
Pivot tables, charts, macros and some advanced workbook features are not supported
by this integration. Imported conditional formatting and validation rules are not
fully mapped by the XLSX adapter. Keep the original for workflows requiring those
features; exporting a modified workbook can lose unsupported Excel objects.

Verification: `npm run verify:fortune` exercises an XLSX round trip with multiple
sheets (including a blank sheet), cross-sheet formulas, sparse rows, merges, dates,
styles, dimensions and frozen panes; it also checks that current edits and formulas
without cached values survive save. `npm run verify:sheet` checks legacy formats.
The Go `TestFortuneSheetExportsLatestWorkbook` checks current XLSX file export and
knowledge-base ZIP packaging.
