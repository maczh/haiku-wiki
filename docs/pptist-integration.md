# PPTX editor: PPTist

Haiku uses a self-hosted PPTist page at `/pptist/index.html` for PPTX creation,
import, editing, reading, slideshow, sharing and H5. No external document server is
required. The browser does not send document data to PPTist's public demo/AI service.

Source: `web/vendor/pptist`, upstream revision and changes are recorded in
`HAIKU-INTEGRATION.md`. PPTist is licensed under AGPL-3.0; its license and
corresponding source are retained. Account for that license when distributing or
providing a modified network service.

`npm run dev` and `npm run build` build the isolated Vue app before the main React
app. Node 22 is recommended; the build script uses npm's Node 22 package when the
host Node is older. Vendor dependencies use their own committed lockfile.

React owns permissions, uploads, history and document saves. The same-origin iframe
owns one Pinia store per mounted document and accepts only messages from its parent.
Read mode renders non-editable pages and supports slideshow entry. No previous
document is restored from browser storage.

Saved content schema: `haiku.pptist/1`, with `presentation` containing `slides`,
`theme`, `viewportSize`, and `viewportRatio`. `url` retains the imported original;
`edited_url` points at the latest standard PPTX generated on save. Imported media
object URLs are converted to persistent data URLs. Both the editor's export button
and the server export endpoint return PPTX rather than converting slide JSON to text.

Historical `haiku.pptx/1` EFLink snapshots are converted to PPTX once in the browser
and imported into PPTist. EFLink remains a lazy compatibility dependency only; its
editor is not mounted. Saving migrates the document to the new schema. Historical
information already lost by EFLink cannot be reconstructed by migration; the original
file remains separately downloadable where available.

PPTist/pptxtojson do not guarantee pixel-perfect PowerPoint compatibility. Verify
complex master layouts, custom fonts, animations, and charts against real documents.
Parsing success and a production build do not constitute a visual-fidelity test.
