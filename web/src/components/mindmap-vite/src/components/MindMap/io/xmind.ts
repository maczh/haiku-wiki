import type { MindNode, MindNodeStyle } from "../types";
import { uid } from "../tree";
import { parseKityMinderXml } from "./freemind";

/**
 * 动态加载 jszip：只有真正读写 .xmind 时才拉取该依赖，
 * 保证不使用 xmind 的场景不会加载这部分体积（库模式下 jszip 为外部依赖）。
 */
type JSZipCtor = typeof import("jszip");
async function loadJSZip(): Promise<JSZipCtor> {
  try {
    const mod = (await import("jszip")) as JSZipCtor & { default?: JSZipCtor };
    return mod.default ?? mod;
  } catch {
    throw new Error(
      "读写 .xmind 需要 jszip 依赖，请先执行 npm install jszip"
    );
  }
}

/** XMind Zen 的 topic 结构（content.json） */
interface XTopic {
  id?: string;
  class?: string;
  title?: string;
  href?: string;
  structureClass?: string;
  branch?: string;
  markers?: { markerId?: string }[];
  notes?: { plain?: { content?: string } };
  style?: { properties?: Record<string, string> };
  children?: { attached?: XTopic[]; detached?: XTopic[] };
  [key: string]: unknown;
}

const pxToPt = (px: number) => `${Math.round((px * 3) / 4)}pt`;
const ptToPx = (pt: string) => Math.round(parseFloat(pt) * 1.333);

function readXStyle(props: Record<string, string> | undefined): MindNodeStyle | undefined {
  if (!props) return undefined;
  const s: MindNodeStyle = {};
  let has = false;
  const fs = props["fo:font-size"];
  if (fs) (s.fontSize = ptToPx(fs)), (has = true);
  const ff = props["fo:font-family"];
  if (ff) (s.fontFamily = `"${ff.replace(/"/g, "")}", sans-serif`), (has = true);
  const fc = props["fo:color"];
  if (fc) (s.color = fc), (has = true);
  if (props["fo:font-weight"] === "bold") (s.bold = true), (has = true);
  if (props["fo:font-style"] === "italic") (s.italic = true), (has = true);
  const td = props["fo:text-decoration"] ?? "";
  if (td.includes("underline")) (s.underline = true), (has = true);
  if (td.includes("line-through")) (s.strike = true), (has = true);
  const fill = props["svg:fill"] ?? props["fill"];
  if (fill && fill !== "none") (s.background = fill), (has = true);
  const border = props["border-line-color"];
  if (border) (s.borderColor = border), (has = true);
  return has ? s : undefined;
}

function xTopicToNode(t: XTopic, isRoot = false): MindNode {
  const attached = t.children?.attached ?? [];
  const style = readXStyle(t.style?.properties);
  const markers = Array.isArray(t.markers)
    ? (t.markers.map((m) => m.markerId).filter(Boolean) as string[])
    : undefined;
  const props = t.style?.properties ?? {};
  const pa = props["mm-priority"];
  const pr = props["mm-progress"];
  const priority = pa ? Math.min(9, Math.max(1, Math.round(parseFloat(pa)))) : undefined;
  const progress = pr ? Math.min(10, Math.max(0, Math.round(parseFloat(pr)))) : undefined;
  const icons = props["mm-icons"]
    ? String(props["mm-icons"]).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    id: t.id ?? uid(),
    title: t.title ?? "",
    children: attached.map((c) => xTopicToNode(c, false)),
    collapsed: t.branch === "folded" ? true : undefined,
    style,
    markers: markers?.length ? markers : undefined,
    note: t.notes?.plain?.content,
    link: t.href,
    priority: Number.isFinite(priority as number) ? priority : undefined,
    progress: Number.isFinite(progress as number) ? progress : undefined,
    icons,
    isRoot: isRoot || undefined,
  };
}

/** 读取 .xmind：优先 content.json（XMind Zen），回退 content.xml（XMind 8） */
export async function parseXmind(data: ArrayBuffer): Promise<MindNode> {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(data);

  const jsonFile = zip.file("content.json");
  if (jsonFile) {
    const text = await jsonFile.async("string");
    const parsed = JSON.parse(text) as
      | XTopic[]
      | { rootTopic?: XTopic };
    const sheet = Array.isArray(parsed) ? parsed[0] : parsed;
    const rootTopic = (sheet as { rootTopic?: XTopic } | undefined)?.rootTopic;
    if (rootTopic) {
      const root = xTopicToNode(rootTopic, true);
      root.isRoot = true;
      return root;
    }
  }

  const xmlFile = zip.file("content.xml");
  if (xmlFile) {
    const text = await xmlFile.async("string");
    const direct = parseKityMinderXml(text);
    if (direct) return direct;
    // 兜底：直接找第一个 topic
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const first =
      doc.getElementsByTagNameNS("*", "topic")[0] ?? doc.getElementsByTagName("topic")[0];
    if (first) {
      const walk = (el: Element): MindNode => {
        const title = el.getElementsByTagNameNS("*", "title")[0]?.textContent ?? "";
        const kids = Array.from(el.getElementsByTagNameNS("*", "topic")).filter(
          (k) => k !== el
        );
        // 只取直接子级：通过最近的 topic 祖先过滤
        const directKids = kids.filter((k) => {
          let p: Element | null = k.parentElement;
          while (p && p !== el) {
            if (p.tagName === "topic" || p.localName === "topic") return false;
            p = p.parentElement;
          }
          return true;
        });
        return { id: uid(), title, children: directKids.map(walk) };
      };
      const r = walk(first);
      r.isRoot = true;
      return r;
    }
  }

  throw new Error("不是有效的 .xmind 文件（缺少 content.json / content.xml）");
}

let styleSeq = 0;
function styleOf(node: MindNode, isRoot: boolean): Record<string, unknown> | undefined {
  const props: Record<string, string> = {};
  const s = node.style ?? {};
  const fill = s.background ?? (isRoot ? "#2f6fed" : "#ffffff");
  props["svg:fill"] = fill;
  props["fo:color"] = s.color ?? (isRoot ? "#ffffff" : "#1f2329");
  if (s.fontFamily)
    props["fo:font-family"] = s.fontFamily.split(",")[0].replace(/"/g, "").trim();
  if (s.fontSize) props["fo:font-size"] = pxToPt(s.fontSize);
  if (s.bold) props["fo:font-weight"] = "bold";
  if (s.italic) props["fo:font-style"] = "italic";
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""]
    .filter(Boolean)
    .join(" ");
  if (deco) props["fo:text-decoration"] = deco;
  const border = node.color ?? s.borderColor;
  if (border) props["border-line-color"] = border;
  if (node.priority != null) props["mm-priority"] = String(node.priority);
  if (node.progress != null) props["mm-progress"] = String(node.progress);
  if (node.icons && node.icons.length) props["mm-icons"] = node.icons.join(",");
  styleSeq += 1;
  return { id: `style-${styleSeq}`, properties: props };
}

function nodeToXTopic(node: MindNode, isRoot: boolean): Record<string, unknown> {
  const kids = node.children.map((c) => nodeToXTopic(c, false));
  return {
    id: node.id,
    class: "topic",
    title: node.title,
    ...(isRoot ? { structureClass: "org.xmind.ui.logic.right" } : {}),
    ...(node.link ? { href: node.link } : {}),
    ...(node.collapsed ? { branch: "folded" } : {}),
    ...(node.note ? { notes: { plain: { content: node.note } } } : {}),
    ...(node.markers?.length
      ? { markers: node.markers.map((m) => ({ markerId: m })) }
      : {}),
    style: styleOf(node, isRoot),
    ...(kids.length ? { children: { attached: kids } } : {}),
  };
}

/** 导出为 .xmind（XMind Zen 兼容的 zip 包） */
export async function exportXmind(root: MindNode): Promise<Blob> {
  const JSZip = await loadJSZip();
  styleSeq = 0;
  const sheet = {
    id: uid("sheet"),
    class: "sheet",
    title: "画布 1",
    rootTopic: nodeToXTopic(root, true),
    topicPositioning: "fixed",
    theme: {},
  };
  const zip = new JSZip();
  zip.file("content.json", JSON.stringify([sheet], null, 2));
  zip.file(
    "metadata.json",
    JSON.stringify({ creator: { name: "MindMap Editor", version: "1.0.0" } }, null, 2)
  );
  zip.file(
    "manifest.json",
    JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }, null, 2)
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/x-xmind",
  });
}
