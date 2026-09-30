import type { MindNode, MindNodeStyle } from "./types";

let seq = 0;
/** 生成稳定的节点 id */
export function uid(prefix = "n"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function createNode(title = "分支主题"): MindNode {
  return { id: uid(), title, children: [] };
}

/** 深拷贝（含 id 重新映射可选） */
export function cloneTree(node: MindNode, remapIds = false): MindNode {
  const walk = (n: MindNode): MindNode => ({
    ...n,
    id: remapIds ? uid() : n.id,
    style: n.style ? { ...n.style } : undefined,
    markers: n.markers ? [...n.markers] : undefined,
    children: n.children.map(walk),
  });
  return walk(node);
}

export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findParent(
  root: MindNode,
  id: string
): { parent: MindNode; index: number } | null {
  const idx = root.children.findIndex((c) => c.id === id);
  if (idx >= 0) return { parent: root, index: idx };
  for (const c of root.children) {
    const hit = findParent(c, id);
    if (hit) return hit;
  }
  return null;
}

/** 返回从根到目标节点的路径（含目标本身） */
export function findPath(root: MindNode, id: string): MindNode[] {
  const path: MindNode[] = [];
  const walk = (n: MindNode): boolean => {
    path.push(n);
    if (n.id === id) return true;
    for (const c of n.children) if (walk(c)) return true;
    path.pop();
    return false;
  };
  return walk(root) ? path : [];
}

export function allNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (n: MindNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** 可见节点（受 collapsed 影响） */
export function visibleNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (n: MindNode) => {
    out.push(n);
    if (!n.collapsed) n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export interface TreeOpResult {
  tree: MindNode;
  /** 本次操作后应选中的节点 id */
  focusId: string;
  /** 是否真的产生了结构变化 */
  changed: boolean;
}

/** 在 selected 下新增子节点（Tab） */
export function opAddChild(root: MindNode, selectedId: string): TreeOpResult {
  const tree = cloneTree(root);
  const target = findNode(tree, selectedId);
  if (!target) return { tree: root, focusId: selectedId, changed: false };
  const child = createNode("分支主题");
  target.children.push(child);
  target.collapsed = false;
  return { tree, focusId: child.id, changed: true };
}

/** 在 selected 之后新增同级节点（Enter） */
export function opAddSibling(
  root: MindNode,
  selectedId: string,
  before = false
): TreeOpResult {
  const tree = cloneTree(root);
  const hit = findParent(tree, selectedId);
  if (!hit) return { tree: root, focusId: selectedId, changed: false };
  const node = createNode("分支主题");
  const at = before ? hit.index : hit.index + 1;
  hit.parent.children.splice(at, 0, node);
  return { tree, focusId: node.id, changed: true };
}

/** 计算节点深度：根节点为 0；找不到返回 -1（新增节点按深度套用字号时需要） */
export function depthOf(root: MindNode, id: string): number {
  let res = -1;
  const walk = (n: MindNode, d: number) => {
    if (n.id === id) {
      res = d;
      return;
    }
    for (const c of n.children) walk(c, d + 1);
  };
  walk(root, 0);
  return res;
}

/** 插入上级节点，把当前节点变成新节点的子节点 */
export function opAddParent(root: MindNode, selectedId: string): TreeOpResult {
  if (root.id === selectedId) {
    return { tree: root, focusId: selectedId, changed: false };
  }
  const tree = cloneTree(root);
  const hit = findParent(tree, selectedId);
  if (!hit) return { tree: root, focusId: selectedId, changed: false };
  const self = hit.parent.children[hit.index];
  const wrapper = createNode("分支主题");
  wrapper.children = [self];
  hit.parent.children[hit.index] = wrapper;
  return { tree, focusId: wrapper.id, changed: true };
}

/** 上移一层：把节点提升为其父节点的同级（Shift+Tab） */
export function opOutdent(root: MindNode, selectedId: string): TreeOpResult {
  if (root.id === selectedId) {
    return { tree: root, focusId: selectedId, changed: false };
  }
  const tree = cloneTree(root);
  const hit = findParent(tree, selectedId);
  if (!hit) return { tree: root, focusId: selectedId, changed: false };
  const parent = hit.parent;
  if (parent.id === root.id) {
    // 父节点已是根，无法再提升
    return { tree: root, focusId: selectedId, changed: false };
  }
  const gp = findParent(tree, parent.id);
  if (!gp) return { tree: root, focusId: selectedId, changed: false };
  const [node] = parent.children.splice(hit.index, 1);
  const at = gp.parent.children.indexOf(parent);
  gp.parent.children.splice(at + 1, 0, node);
  return { tree, focusId: node.id, changed: true };
}

/** 删除节点（根节点不可删） */
export function opDelete(root: MindNode, selectedId: string): TreeOpResult {
  if (root.id === selectedId) {
    return { tree: root, focusId: selectedId, changed: false };
  }
  const tree = cloneTree(root);
  const hit = findParent(tree, selectedId);
  if (!hit) return { tree: root, focusId: selectedId, changed: false };
  hit.parent.children.splice(hit.index, 1);
  const fallback =
    hit.parent.children[Math.min(hit.index, hit.parent.children.length - 1)] ??
    hit.parent;
  return { tree, focusId: fallback.id, changed: true };
}

/** 修改节点内容 / 样式 */
export function opUpdate(
  root: MindNode,
  id: string,
  patch: Partial<MindNode>,
  stylePatch?: Partial<MindNodeStyle>
): MindNode {
  const tree = cloneTree(root);
  const target = findNode(tree, id);
  if (!target) return root;
  const rest = { ...patch };
  delete rest.children;
  Object.assign(target, rest);
  if (stylePatch) {
    const next = { ...(target.style ?? {}), ...stylePatch };
    // 清理被显式置空的字段，保持导出文件干净
    (Object.keys(next) as (keyof MindNodeStyle)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    target.style = Object.keys(next).length ? next : undefined;
  }
  return tree;
}

/** 移动节点（拖拽换父 / 排序） */
export function opMove(
  root: MindNode,
  dragId: string,
  targetId: string,
  position: "before" | "after" | "child"
): TreeOpResult {
  if (dragId === targetId || root.id === dragId) {
    return { tree: root, focusId: dragId, changed: false };
  }
  const tree = cloneTree(root);
  // 禁止把节点移动到自己的子孙下
  const dragNode = findNode(tree, dragId);
  if (!dragNode) return { tree: root, focusId: dragId, changed: false };
  if (findNode(dragNode, targetId)) {
    return { tree: root, focusId: dragId, changed: false };
  }
  const src = findParent(tree, dragId);
  if (!src) return { tree: root, focusId: dragId, changed: false };
  const [moved] = src.parent.children.splice(src.index, 1);

  if (position === "child") {
    const t = findNode(tree, targetId)!;
    t.children.push(moved);
    t.collapsed = false;
  } else {
    const dst = findParent(tree, targetId);
    if (!dst) return { tree: root, focusId: dragId, changed: false };
    const at = position === "before" ? dst.index : dst.index + 1;
    dst.parent.children.splice(at, 0, moved);
  }
  return { tree, focusId: dragId, changed: true };
}

/** 切换收起 / 展开 */
export function opToggleCollapse(root: MindNode, id: string): MindNode {
  const tree = cloneTree(root);
  const target = findNode(tree, id);
  if (!target || target.children.length === 0) return root;
  target.collapsed = !target.collapsed;
  return tree;
}

/** 统计节点总数 */
export function countNodes(node: MindNode): number {
  return 1 + node.children.reduce((a, c) => a + countNodes(c), 0);
}

/** 生成示例数据（首次打开 / 新建空白导图时使用） */
export function sampleTree(): MindNode {
  const mk = (title: string, children: MindNode[] = []): MindNode => ({
    id: uid(),
    title,
    children,
  });
  const root = mk("海鲜火锅 · 包厢预订系统", [
    mk("桌台域", [
      mk("包厢/散台模型"),
      mk("桌台状态机：空闲→预订→开台→结账→清台"),
      mk("并台 / 拆台"),
    ]),
    mk("预订域", [
      mk("预订规则：时段、最低消费、超时释放"),
      mk("定金与退订"),
      mk("渠道：电话 / 小程序 / 门店"),
    ]),
    mk("对接 baseServ", [
      mk("桌台占用同步"),
      mk("开台消息（MQ）"),
      mk("幂等与重试"),
    ]),
    mk("技术选型", [mk("Go + Gin"), mk("Redis 分布式锁"), mk("MySQL 分表")]),
    mk("待办", [mk("压测：高峰期并发预订"), mk("对账：定金流水")]),
  ]);
  root.isRoot = true;
  return root;
}
