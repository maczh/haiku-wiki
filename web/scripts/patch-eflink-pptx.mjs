import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jsFile = path.join(root, 'node_modules/@eflink-tech/pptx/dist/index.js')
const dtsFile = path.join(root, 'node_modules/@eflink-tech/pptx/dist/types/index.d.ts')

async function patch(file, update) {
  const before = await readFile(file, 'utf8')
  const after = update(before)
  if (after !== before) await writeFile(file, after)
}

await patch(jsFile, (source) => {
  // Legacy snapshot migration only; the EFLink editor is no longer mounted.
  source = source.replace('async function mo(e, t) {', 'async function mo(e, t, returnBlob = false) {')
  source = source.replace('await n.write({ outputType: "blob" }).then((e) => {\n\t\tqa(e,', 'return n.write({ outputType: "blob" }).then((e) => {\n\t\tif (returnBlob) return e;\n\t\tqa(e,')
  if (source.includes('ko as importPPTX')) return source
  return source.replace(
    'export { Ot as PX_PER_INCH,',
    'export { ko as importPPTX, mo as exportPPTX, Ot as PX_PER_INCH,',
  )
})

await patch(dtsFile, (source) => {
  if (source.includes("from './core/import/pptx'")) return source
  return `${source.trimEnd()}\nexport { importPPTX } from './core/import/pptx';\nexport { exportPPTX } from './core/export/pptx';\n`
})

