import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(rootDir, 'node_modules/.haiku-fortune-lifecycle')
await mkdir(directory, { recursive: true })
const outfile = path.join(directory, 'dirty.mjs')
const dom = new JSDOM('<div id="root"></div>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const frames = new Map()
let frameId = 0
globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
globalThis.cancelAnimationFrame = id => frames.delete(id)
const warnings = []
const originalError = console.error
console.error = (...args) => { warnings.push(args.join(' ')); originalError(...args) }
let root
try {
  await build({ entryPoints: [path.join(rootDir, 'src/components/office/useSheetDirty.ts')], outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external' })
  const { useSheetDirty } = await import(pathToFileURL(outfile).href)
  const h = React.createElement
  function WorkbookMock({ onOp }) {
    const [revision, setRevision] = useState(0)
    const previous = useRef(0)
    // Reproduce the upstream callback timing rather than invoking it from an effect.
    if (previous.current !== revision) { previous.current = revision; onOp() }
    return h('button', { id: 'edit', onClick: () => setRevision(value => value + 1) }, 'edit')
  }
  function Harness({ readOnly = false }) {
    const { dirty, markDirty, clearDirty } = useSheetDirty(readOnly)
    return h('div', null, h('span', { id: 'status' }, dirty ? 'dirty' : 'clean'), h(WorkbookMock, { onOp: markDirty }), h('button', { id: 'clear', onClick: clearDirty }, 'saved'))
  }
  const click = async id => act(() => document.getElementById(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  const render = async (key, readOnly = false) => act(() => root.render(h(React.StrictMode, null, h(Harness, { key, readOnly }))))
  root = createRoot(document.getElementById('root'))
  await render('editable')
  await click('edit')
  assert.equal(document.getElementById('status').textContent, 'clean')
  assert.equal(frames.size, 1, 'render-phase callback must defer the parent update')
  await act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) })
  assert.equal(document.getElementById('status').textContent, 'dirty')
  await click('clear')
  assert.equal(document.getElementById('status').textContent, 'clean')
  await click('edit')
  await click('clear')
  assert.equal(frames.size, 0, 'successful save must cancel pending dirty status')
  await click('edit')
  await render('readonly', true)
  assert.equal(frames.size, 0, 'unmount must cancel pending updates')
  await click('edit')
  assert.equal(frames.size, 0, 'read-only operations must not mark the document dirty')
  assert.equal(document.getElementById('status').textContent, 'clean')
  assert.equal(warnings.length, 0, 'no cross-component render warning')
  console.log('FortuneSheet lifecycle: deferred parent update, save reset, unmount cleanup and read-only mode passed')
} finally {
  if (root) await act(() => root.unmount())
  console.error = originalError
  dom.window.close()
  await rm(directory, { recursive: true, force: true })
}
