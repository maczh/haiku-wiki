import type { MindNode, StructureType } from "../types";
import { parseMindmapJson } from "./json";
import {
  exportFreeMind,
  exportKityMinder,
  exportSmm,
  exportYoudaoFlat,
  parseFreeMind,
  parseKityMinderXml,
} from "./freemind";
import { exportXmind, parseXmind } from "./xmind";

export * from "./json";
export * from "./freemind";
export * from "./xmind";

/** 可导入的扩展名 */
export const IMPORT_ACCEPT = ".km,.mindmap,.mm,.smm,.xmind,.json,.xml,.txt";

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // UTF-16 LE / BE BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  // XML 里显式声明了 gb2312 之类的编码时给出提示
  if (/encoding=["'](gb2312|gbk|gb18030)["']/i.test(text.slice(0, 200))) {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * 统一的导入入口：根据扩展名 + 内容自动识别格式。
 * 支持 .km / .mindmap（KityMinder、有道扁平）、.smm（simple-mind-map）、
 * .mm（FreeMind XML）、.xmind（XMind Zen / XMind 8）。
 */
/**
 * 解析结果：除树本身外，附带文件声明（若有）的结构类型。
 * 文件未声明结构时 structure 为 undefined，由调用方回落到「思维导图」。
 */
export interface ParsedMindmap {
  tree: MindNode;
  structure?: StructureType;
}

/**
 * 把各导入格式里出现的「结构标记」归一化为内部 StructureType。
 * 兼容 simple-mind-map 的 layout、KityMinder 的 template、XMind 的 structureClass。
 * 无法识别时返回 undefined（交由默认结构兜底）。
 */
export function mapFileStructure(token: string | undefined): StructureType | undefined {
  const t = (token ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (t.includes("fishbone")) return "fishbone";
  if (t.includes("timeline")) return "timeline";
  if (t.includes("catalog") || t.includes("spreadsheet")) return "catalog";
  if (t.includes("both") || t.includes("balance") || t.includes("map") || t.includes("mindmap"))
    return "mindmap";
  // KityMinder 的「default」模板即经典双向布局（其配置 defaultTemplate = "default"，
  // 对应 src/layout/mind.js 的放射状布局），与本项目默认结构一致
  if (t === "default") return "mindmap";
  if (t.includes("left")) return "logical-left";
  if (t.includes("right") || t.includes("logic")) return "logical-right";
  if (t.includes("org") || t.includes("structure")) return "org";
  return undefined;
}

/** 从 JSON 对象里读出结构标记（smm: layout / KityMinder: template） */
function detectJsonStructure(raw: unknown): StructureType | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const tok = obj.layout ?? obj.template;
  return mapFileStructure(typeof tok === "string" ? tok : undefined);
}

/** 从 KityMinder .km XML 里读出根 topic 的 template 属性 */
function detectKmXmlStructure(xml: string): StructureType | undefined {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return undefined;
    const rootTopic =
      doc.querySelector("xmap-content > sheet > topic") ??
      doc.querySelector("sheet > topic") ??
      doc.querySelector("xmap-content topic");
    if (!rootTopic) return undefined;
    const tpl =
      rootTopic.getAttribute("template") ??
      doc.querySelector("sheet")?.getAttribute("template") ??
      undefined;
    return mapFileStructure(tpl ?? undefined);
  } catch {
    return undefined;
  }
}

/** 动态加载 jszip（仅 .xmind 结构探测需要） */
type JSZipModule = typeof import("jszip");
async function loadJSZipForDetect(): Promise<JSZipModule> {
  const mod = (await import("jszip")) as JSZipModule & { default?: JSZipModule };
  return (mod.default ?? mod) as JSZipModule;
}

/** 从 .xmind 里读出根 topic 的 structureClass（content.json / 兜底 content.xml） */
async function detectXmindStructure(data: ArrayBuffer): Promise<StructureType | undefined> {
  try {
    const JSZip = await loadJSZipForDetect();
    const zip = await JSZip.loadAsync(data);
    const jf = zip.file("content.json");
    if (jf) {
      const parsed = JSON.parse(await jf.async("string")) as
        | Array<{ rootTopic?: { structureClass?: string } }>
        | { rootTopic?: { structureClass?: string } };
      const sheet = Array.isArray(parsed) ? parsed[0] : parsed;
      const cls = sheet?.rootTopic?.structureClass;
      if (typeof cls === "string") return mapFileStructure(cls);
    }
    const xf = zip.file("content.xml");
    if (xf) return detectKmXmlStructure(await xf.async("string"));
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * 统一的导入入口：根据扩展名 + 内容自动识别格式。
 * 支持 .km / .mindmap（KityMinder、有道扁平）、.smm（simple-mind-map）、
 * .mm（FreeMind XML）、.xmind（XMind Zen / XMind 8）。
 * 返回树与文件声明（若有）的结构类型，供调用方决定是否按文件结构绘制。
 */
export async function parseMindmapFile(
  fileName: string,
  buffer: ArrayBuffer
): Promise<ParsedMindmap> {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();

  if (ext === "xmind") {
    const tree = await parseXmind(buffer);
    const structure = await detectXmindStructure(buffer);
    tree.isRoot = true;
    return { tree, structure };
  }

  const text = decodeText(buffer).trim();
  const looksJson = text.startsWith("{") || text.startsWith("[");
  const looksXml = text.startsWith("<");

  const tryJson = (): ParsedMindmap | null => {
    try {
      const raw = JSON.parse(text);
      const tree = parseMindmapJson(raw);
      tree.isRoot = true;
      return { tree, structure: detectJsonStructure(raw) };
    } catch {
      return null;
    }
  };
  const tryXml = (): ParsedMindmap | null => {
    const fm = (() => {
      try {
        return parseFreeMind(text);
      } catch {
        return null;
      }
    })();
    if (fm) {
      fm.isRoot = true;
      return { tree: fm, structure: undefined };
    }
    const km = parseKityMinderXml(text);
    if (km) {
      km.isRoot = true;
      return { tree: km, structure: detectKmXmlStructure(text) };
    }
    return null;
  };

  let result: ParsedMindmap | null = null;
  if (looksJson) result = tryJson() ?? tryXml();
  else if (looksXml) result = tryXml() ?? tryJson();
  else result = tryJson() ?? tryXml();

  if (!result) {
    throw new Error(`无法解析文件 ${fileName}，请确认为 .km/.mindmap/.mm/.smm/.xmind 格式`);
  }
  return result;
}

export type ExportFormat = "png" | "svg" | "smm" | "km" | "json" | "mm" | "xmind";

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  png: "图片 PNG",
  svg: "矢量 SVG",
  json: "有道/KM 扁平 JSON",
  km: "KityMinder 脑图 .km",
  mm: "FreeMind 文档 .mm",
  smm: "SimpleMindMap .smm",
  xmind: "XMind 工作簿 .xmind",
};

export interface SvgPayload {
  /** 独立的 SVG 字符串（已内联样式与背景） */
  svg: string;
  width: number;
  height: number;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 把 SVG 字符串栅格化为 PNG Blob */
export async function svgToPngBlob(payload: SvgPayload, scale = 2): Promise<Blob> {
  const url =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(payload.svg);
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG 栅格化失败"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(payload.width * scale));
  canvas.height = Math.max(1, Math.round(payload.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 生成失败"));
    }, "image/png");
  });
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}

/** 按指定格式导出当前思维导图 */
export async function exportTree(
  root: MindNode,
  format: ExportFormat,
  getSvg: () => SvgPayload,
  baseName = "mindmap"
): Promise<ExportResult> {
  switch (format) {
    case "png":
      return {
        blob: await svgToPngBlob(getSvg(), 2),
        filename: `${baseName}.png`,
      };
    case "svg":
      return {
        blob: new Blob([getSvg().svg], { type: "image/svg+xml;charset=utf-8" }),
        filename: `${baseName}.svg`,
      };
    case "json":
      return {
        blob: new Blob([exportYoudaoFlat(root)], {
          type: "application/json;charset=utf-8",
        }),
        filename: `${baseName}.json`,
      };
    case "km":
      return {
        blob: new Blob([exportKityMinder(root)], {
          type: "application/json;charset=utf-8",
        }),
        filename: `${baseName}.km`,
      };
    case "smm":
      return {
        blob: new Blob([exportSmm(root)], { type: "application/json;charset=utf-8" }),
        filename: `${baseName}.smm`,
      };
    case "mm":
      return {
        blob: new Blob([exportFreeMind(root)], { type: "application/xml;charset=utf-8" }),
        filename: `${baseName}.mm`,
      };
    case "xmind":
      return { blob: await exportXmind(root), filename: `${baseName}.xmind` };
    default:
      throw new Error(`不支持的导出格式：${format}`);
  }
}
