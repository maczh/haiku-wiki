import type { MindNode } from "../types";
import { uid } from "../tree";
import type { FlatNode } from "./json";

/** XML 文本转义 */
export function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 解析 FreeMind / Freeplane 的 .mm XML。
 * 支持 TEXT / FOLDED / COLOR / LINK / ID 属性，<font>、<edge>、<icon>、<richcontent NOTE> 子节点。
 */
export function parseFreeMind(xml: string): MindNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("FreeMind XML 解析失败");
  }
  let rootEl =
    doc.querySelector("map")?.querySelector(":scope > node") ??
    doc.querySelector("node");
  if (!rootEl) throw new Error("FreeMind XML 中未找到 <node>");
  // map 下的第一个 node 才是根
  const mapEl = doc.querySelector("map");
  if (mapEl) {
    const first = Array.from(mapEl.children).find((el) => el.tagName === "node");
    if (first) rootEl = first;
  }

  const walk = (el: Element): MindNode => {
    const attrs = (name: string) => el.getAttribute(name) ?? undefined;
    const font = el.querySelector(":scope > font");
    const edge = el.querySelector(":scope > edge");
    const icons = Array.from(el.querySelectorAll(":scope > icon"))
      .map((i) => i.getAttribute("BUILTIN"))
      .filter(Boolean) as string[];
    const noteEl = el.querySelector(
      ':scope > richcontent[TYPE="NOTE"]'
    );
    const noteText = noteEl?.textContent?.trim() || undefined;

    const attrMap = new Map<string, string>();
    for (const a of Array.from(el.querySelectorAll(":scope > attribute"))) {
      const nm = a.getAttribute("NAME");
      const val = a.getAttribute("VALUE");
      if (nm) attrMap.set(nm, val ?? "");
    }
    const pa = attrMap.has("priority") ? parseFloat(attrMap.get("priority")!) : NaN;
    const pr = attrMap.has("progress") ? parseFloat(attrMap.get("progress")!) : NaN;
    const priority = Number.isFinite(pa)
      ? Math.min(9, Math.max(1, Math.round(pa)))
      : undefined;
    const progress = Number.isFinite(pr)
      ? Math.min(10, Math.max(0, Math.round(pr)))
      : undefined;
    const iconsAttr = attrMap.get("mm-icons");
    const mmIcons = iconsAttr
      ? iconsAttr.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const style: MindNode["style"] = {};
    const fontName = font?.getAttribute("NAME");
    if (fontName) style.fontFamily = fontName;
    const fontSize = font?.getAttribute("SIZE");
    if (fontSize) {
      const n = parseFloat(fontSize) * (fontSize.includes("px") ? 1 : 1.333);
      if (Number.isFinite(n)) style.fontSize = Math.round(n);
    }
    if (attrs("BOLD") === "true") style.bold = true;
    const italicAttr = attrs("ITALIC");
    if (italicAttr === "true") style.italic = true;
    const color = attrs("COLOR") ?? edge?.getAttribute("COLOR") ?? undefined;
    if (attrs("COLOR")) style.color = attrs("COLOR");
    const bg = attrs("BACKGROUND_COLOR");
    if (bg) style.background = bg;

    const kids = Array.from(el.children).filter((c) => c.tagName === "node");

    return {
      id: attrs("ID") ?? uid(),
      title: attrs("TEXT") ?? "",
      children: kids.map(walk),
      collapsed: attrs("FOLDED") === "true" ? true : undefined,
      color,
      style: Object.keys(style).length ? style : undefined,
      markers: icons.length ? icons : undefined,
      note: noteText,
      link: attrs("LINK"),
      priority,
      progress,
      icons: mmIcons,
    };
  };

  const root = walk(rootEl);
  root.isRoot = true;
  return root;
}

function fontAttr(node: MindNode): string {
  const s = node.style ?? {};
  const parts: string[] = [];
  if (s.fontFamily) parts.push(`NAME="${escapeXml(s.fontFamily.split(",")[0].replace(/"/g, ""))}"`);
  if (s.fontSize) parts.push(`SIZE="${Math.round(s.fontSize * 0.75)}"`);
  return parts.length ? `<font ${parts.join(" ")}/>` : "";
}

function nodeToXml(node: MindNode, indent: string): string {
  const attrs: string[] = [`TEXT="${escapeXml(node.title)}"`];
  attrs.push(`ID="${escapeXml(node.id)}"`);
  if (node.collapsed) attrs.push(`FOLDED="true"`);
  if (node.style?.color) attrs.push(`COLOR="${escapeXml(node.style.color)}"`);
  if (node.style?.background) attrs.push(`BACKGROUND_COLOR="${escapeXml(node.style.background)}"`);
  if (node.link) attrs.push(`LINK="${escapeXml(node.link)}"`);
  if (node.style?.bold) attrs.push(`BOLD="true"`);
  if (node.style?.italic) attrs.push(`ITALIC="true"`);

  const inner: string[] = [];
  const f = fontAttr(node);
  if (f) inner.push(f);
  const edgeColor = node.color ?? node.style?.borderColor;
  if (edgeColor) inner.push(`<edge COLOR="${escapeXml(edgeColor)}"/>`);
  for (const m of node.markers ?? []) {
    inner.push(`<icon BUILTIN="${escapeXml(m)}"/>`);
  }
  if (node.priority != null)
    inner.push(`<attribute NAME="priority" VALUE="${node.priority}"/>`);
  if (node.progress != null)
    inner.push(`<attribute NAME="progress" VALUE="${node.progress}"/>`);
  if (node.icons && node.icons.length)
    inner.push(`<attribute NAME="mm-icons" VALUE="${escapeXml(node.icons.join(","))}"/>`);
  if (node.note) {
    inner.push(
      `<richcontent TYPE="NOTE"><html><head></head><body><p>${escapeXml(
        node.note
      )}</p></body></html></richcontent>`
    );
  }
  for (const c of node.children) inner.push(nodeToXml(c, indent + "  "));

  if (inner.length === 0) return `${indent}<node ${attrs.join(" ")}/>`;
  return `${indent}<node ${attrs.join(" ")}>\n${inner
    .map((i) => (i.startsWith("<") && i.includes("<node") ? i : indent + "  " + i))
    .join("\n")}\n${indent}</node>`;
}

/** 导出成 FreeMind .mm XML */
export function exportFreeMind(root: MindNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">\n${nodeToXml(
    root,
    "  "
  )}\n</map>\n`;
}

/** 解析 KityMinder 的 .km / 老版 XMind content.xml（命名空间 xmap-content） */
export function parseKityMinderXml(xml: string): MindNode | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return null;
  const rootEl =
    doc.querySelector("xmap-content > sheet > topic") ??
    doc.querySelector("sheet > topic") ??
    doc.querySelector("xmap-content topic");
  if (!rootEl) return null;

  const walk = (el: Element): MindNode => {
    const title = el.querySelector(":scope > title")?.textContent?.trim() ?? "";
    const kids = Array.from(el.querySelectorAll(":scope > children > topics > topic"));
    const note = el.querySelector(":scope > notes > plain")?.textContent?.trim();
    const markers = Array.from(el.querySelectorAll(":scope > marker-refs > marker-ref"))
      .map((m) => m.getAttribute("marker-id"))
      .filter(Boolean) as string[];
    const attrs = (n: string) => el.getAttribute(n) ?? undefined;
    const style: MindNode["style"] = {};
    if (attrs("style-id")) {
      const sid = attrs("style-id")!;
      const styleEl = doc.querySelector(
        `styles > style[id="${sid}"]`
      );
      if (styleEl) {
        const fo = (k: string) => styleEl.querySelector(k)?.textContent?.trim();
        const fs = fo("font-size");
        if (fs) style.fontSize = Math.round(parseFloat(fs) * 1.333);
        const fam = fo("font-family");
        if (fam) style.fontFamily = fam;
        const col = fo("color");
        if (col) style.color = col;
        if (fo("font-weight") === "bold") style.bold = true;
        if (fo("font-style") === "italic") style.italic = true;
      }
    }
    const folded = el.querySelector(':scope > children[folded="true"]') != null;
    return {
      id: attrs("id") ?? uid(),
      title,
      children: kids.map(walk),
      collapsed: folded ? true : undefined,
      style: Object.keys(style).length ? style : undefined,
      markers: markers.length ? markers : undefined,
      note,
      link: attrs("xlink:href") ?? undefined,
    };
  };
  const root = walk(rootEl);
  root.isRoot = true;
  return root;
}

/** 导出 KityMinder / 有道通用的扁平 JSON */
export function exportYoudaoFlat(root: MindNode): string {
  const nodes: FlatNode[] = [];
  const walk = (n: MindNode, parentid: string | null) => {
    nodes.push({
      id: n.id,
      isroot: n.isRoot || undefined,
      topic: n.title,
      parentid,
      expanded: n.collapsed ? false : true,
      priority: n.priority,
      progress: n.progress,
      icons: n.icons && n.icons.length ? n.icons : undefined,
      style: n.style
        ? {
            fontSize: n.style.fontSize,
            fontFamily: n.style.fontFamily,
            fontWeight: n.style.bold ? "bold" : "normal",
            fontStyle: n.style.italic ? "italic" : "normal",
            textDecoration: [
              n.style.underline ? "underline" : "",
              n.style.strike ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" "),
            color: n.style.color,
          }
        : undefined,
      customStyle: {
        borderColor: n.color ?? n.style?.borderColor ?? undefined,
        background: n.style?.background,
      },
      markers: n.markers,
      note: n.note,
      hyperlink: n.link,
    });
    n.children.forEach((c) => walk(c, n.id));
  };
  walk(root, null);
  return JSON.stringify({ nodes, toolbar: { strategy: "default" } }, null, 2);
}

/** 导出 KityMinder 1.4 嵌套 JSON（百度脑图 / 有道可导入） */
export function exportKityMinder(root: MindNode): string {
  const walk = (n: MindNode): Record<string, unknown> => ({
    id: n.id,
    topic: n.title,
    expanded: !n.collapsed,
    ...(n.color || n.style?.borderColor
      ? { customStyle: { borderColor: n.color ?? n.style?.borderColor } }
      : {}),
    ...(n.style
      ? {
          style: {
            fontSize: n.style.fontSize,
            fontFamily: n.style.fontFamily,
            fontWeight: n.style.bold ? "bold" : undefined,
            fontStyle: n.style.italic ? "italic" : undefined,
            textDecoration: [
              n.style.underline ? "underline" : "",
              n.style.strike ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined,
            color: n.style.color,
            background: n.style.background,
          },
        }
      : {}),
    ...(n.markers ? { markers: n.markers } : {}),
    ...(n.note ? { note: n.note } : {}),
    ...(n.link ? { hyperlink: n.link } : {}),
    ...(n.priority != null ? { priority: n.priority } : {}),
    ...(n.progress != null ? { progress: n.progress } : {}),
    ...(n.icons && n.icons.length ? { icons: n.icons } : {}),
    children: n.children.map(walk),
  });

  return JSON.stringify(
    {
      root: walk(root),
      template: "default",
      theme: "fresh-blue",
      version: "1.4.43",
    },
    null,
    2
  );
}

/** 导出 simple-mind-map 的 .smm JSON */
export function exportSmm(root: MindNode): string {
  const walk = (n: MindNode): Record<string, unknown> => ({
    data: {
      uid: n.id,
      text: n.title,
      expand: !n.collapsed,
      note: n.note ?? "",
      hyperlink: n.link ?? "",
      icon: n.markers ?? [],
      fontSize: n.style?.fontSize,
      fontFamily: n.style?.fontFamily,
      fontWeight: n.style?.bold ? "bold" : undefined,
      fontStyle: n.style?.italic ? "italic" : undefined,
      textDecoration: [
        n.style?.underline ? "underline" : "",
        n.style?.strike ? "line-through" : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
      color: n.style?.color,
      fillColor: n.style?.background,
      borderColor: n.color ?? n.style?.borderColor,
    },
    ...(n.priority != null ? { priority: n.priority } : {}),
    ...(n.progress != null ? { progress: n.progress } : {}),
    ...(n.icons && n.icons.length ? { icons: n.icons } : {}),
    children: n.children.map(walk),
  });
  return JSON.stringify(
    { root: walk(root), layout: "logicalStructure", theme: { template: "default" } },
    null,
    2
  );
}
