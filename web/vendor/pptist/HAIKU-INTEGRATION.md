# Haiku PPTist integration

Upstream: https://github.com/pipipi-pikachu/PPTist
Revision: 04e06cb397b7f146c6e3e4f62ccddc0b72c041d2
License: AGPL-3.0, retained in LICENSE. This directory contains the corresponding source.

Haiku entry: src/haiku/HaikuApp.vue. The editor runs in a separate same-origin iframe;
each mount receives one document, never restores a previous document, and validates
the parent origin and window for every message. React owns authorization and persistence.
Read mode uses non-editable slide renderers and supports entering the slideshow.

Local changes: replace main entry, build into public/pptist, await PPTX imports with
error propagation, embed imported media as base64 so saved snapshots survive reload,
export Blob for saving, disable remote font loading. Online AI/material services are
not configured. PPTX fidelity is limited by PPTist/pptxtojson; originals are retained.

Build: npm ci --ignore-scripts && npm run build-only. The root web scripts automate this.
