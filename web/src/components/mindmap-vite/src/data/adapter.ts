import type { MindNode } from "../components/MindMap/types";

/**
 * 有道云笔记思维导图原始数据格式（KityMinder 风格）。
 * 节点以扁平数组存储，通过 parentid 关联父子关系。
 */
export interface YoudaoNode {
  id: string;
  isroot?: boolean;
  topic: string;
  parentid: string | null;
  customStyle?: { borderColor?: string; [key: string]: unknown };
  expanded?: boolean;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface YoudaoMindmap {
  nodes: YoudaoNode[];
  toolbar?: { strategy?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * 将有道云笔记思维导图（扁平 nodes 数组）转换为嵌套树结构。
 *
 * 映射规则：
 *  - id        -> 节点唯一标识
 *  - topic     -> 节点标题
 *  - parentid  -> 构建父子关系（root 的 parentid 为 null）
 *  - expanded  -> 未展开（false）时标记为 collapsed
 *  - customStyle.borderColor -> 节点强调色（连线与描边）
 */
export function adaptYoudaoMindmap(data: YoudaoMindmap): MindNode {
  if (!data || !Array.isArray(data.nodes)) {
    throw new Error("Youdao mindmap: invalid data, expected { nodes: [...] }");
  }

  const map = new Map<string, MindNode>();
  let rootId: string | undefined;

  for (const n of data.nodes) {
    map.set(n.id, {
      id: n.id,
      title: n.topic ?? "",
      children: [],
      collapsed: n.expanded === false,
      color: n.customStyle?.borderColor as string | undefined,
      isRoot: Boolean(n.isroot),
    });
    if (n.isroot) rootId = n.id;
  }

  for (const n of data.nodes) {
    if (n.parentid && map.has(n.parentid)) {
      map.get(n.parentid)!.children.push(map.get(n.id)!);
    }
  }

  const root = rootId ? map.get(rootId) : undefined;
  if (!root) {
    throw new Error("Youdao mindmap: no root node (isroot) found");
  }
  return root;
}
