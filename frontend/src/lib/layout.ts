/**
 * 树 → 坐标。纯函数，不依赖 React。
 *
 * ⚑ 这是 ADR-6 点名的「本项目最大的一块成本」—— 参考项目为此在 Java 和 TS
 *   【各实现了一遍】，约 14 文件 × 2。本模块是它的前端唯一实现。
 *
 * ── 唯一容易搞错的地方 ──────────────────────────────────────
 *
 * d3.tree() 返回的 x / y 【不是像素】，是"节点单位"：
 *
 *     d.y  = 深度，整数 0, 1, 2, ...        （第几层）
 *     d.x  = 该层内的横向位置，单位是"节点间距"，范围约 [0, 叶子数-1]
 *
 * 必须自己缩放成像素。而"左右布局"和"上下布局"的差别就是这两行互换 ——
 * 这也是我敢说「随时可改」的原因。
 *
 * ── d3.tree() 到底在解什么约束 ──────────────────────────────
 *
 * 它跑的是 Reingold–Tilford 算法，同时满足两条会打架的约束：
 *
 *   ① 父节点要【居中于】它的子节点（美观）
 *   ② 同层的节点【不能重叠】（可读）
 *
 * 树不平衡时这两条会冲突：为了居中就得把某棵子树推过去，而推过去又可能
 * 撞上邻居。算法用"轮廓 + 线程"（contour + thread）在 O(n) 内解决，
 * 这也是为什么值得用库而不是手写。
 */
import { hierarchy, tree } from 'd3-hierarchy'
import type { OutlineNode } from '../types/outline'
import type { TreeNode } from './outline'

export interface LayoutOptions {
  /** 节点盒子的宽 / 高（像素） */
  nodeWidth: number
  nodeHeight: number
  /** 层级之间的水平间距 */
  gapX: number
  /** 同层兄弟之间的垂直间距 */
  gapY: number
  /** 画布四周留白 */
  padding: number
}

export interface PositionedNode {
  id: string
  data: OutlineNode
  /**
   * 节点【中心】的像素坐标（不是左上角 —— 连线要连中心）。
   *
   * ⚠️ 正因为是中心，画的时候要减半个节点尺寸才是盒子左上角。
   *    而最外层节点的中心至少要在 `padding + 半个节点尺寸` 处，
   *    否则盒子会挂出画布边缘 —— 这个坑 D2/D3 的测试抓到过一次。
   */
  x: number
  y: number
  depth: number
}

export interface LayoutResult {
  nodes: PositionedNode[]
  edges: { from: PositionedNode; to: PositionedNode }[]
  /** 内容总尺寸，用于设置 SVG 的 viewBox */
  width: number
  height: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  // 168px 是能容下 §7.2 上限的 12 个中文字（E_TITLE_TOO_LONG）的最小宽度
  nodeWidth: 168,
  // 68px 放得下三行：标题 / 状态元信息 / 产出摘要（result_summary）。
  // ⚠️ 节点尺寸必须【统一】—— d3.tree 的 nodeSize 假定等高，
  //    做成变高需要自定义 separation，不值得。
  //    所以没有摘要的节点会留白，这是这个取舍的代价。
  nodeHeight: 68,
  gapX: 64,
  gapY: 16,
  padding: 32,
}

/** 多根之间的额外间隔（只有坏数据才会触发多根，见 §7.2 的 E_MULTIPLE_ROOTS） */
const ROOT_GAP = 40

/**
 * 布局一棵或多棵树。
 *
 * 多根的处理：d3.tree 只能吃【一个】根，所以这里逐棵布局、再纵向堆叠。
 * 为什么不用"造一个虚拟根把它们连起来"：那会在视觉上引入一个不存在的
 * 父节点，用户会以为它真的存在 —— 对坏数据更不能这样。
 */
export function layout(
  roots: TreeNode[],
  opts: LayoutOptions = DEFAULT_LAYOUT,
): LayoutResult {
  const nodes: PositionedNode[] = []
  const edges: LayoutResult['edges'] = []

  // 空输入：返回一个不小于 padding 的画布，避免 SVG 退化成 0×0
  if (roots.length === 0) {
    return { nodes: [], edges: [], width: opts.padding * 2, height: opts.padding * 2 }
  }

  const stepX = opts.nodeWidth + opts.gapX // 每深一层，向右走的像素
  const stepY = opts.nodeHeight + opts.gapY // 每个兄弟，向下走的像素

  let cursorY = opts.padding // 当前这棵树的【内容上边缘】
  let maxCenterX = 0

  for (const root of roots) {
    const h = hierarchy<TreeNode>(root, (d) => d.children)

    // nodeSize([1, 1])：让 d3 用"1 个节点"为间距单位来算，
    // 缩放交给我们自己做 —— 这样坐标系是可控、可解释的。
    tree<TreeNode>()
      .nodeSize([1, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4))(h)

    const all = h.descendants()

    // d3 把 HierarchyNode 的 x/y 标成可选 —— 因为只有 tree()/cluster()
    // 这类布局函数才会给它们赋值。我们刚刚跑过 tree()，所以一定有值。
    // 这里用 `?? 0` 而不是 `!`：万一将来有人漏掉 tree() 调用，
    // 宁可所有节点叠在原点（一眼可见的错），也不要一个非空断言炸掉整页。
    const bx = (d: (typeof all)[number]) => d.x ?? 0
    const by = (d: (typeof all)[number]) => d.y ?? 0

    // 先算这棵树的纵向范围，才能知道该把它放在哪。
    // ⚑ 两个 "+ 半个尺寸" 都是必须的：坐标存的是【中心】，
    //    所以最上/最左的那个节点要让出半个身子，否则会挂出画布。
    const rawYs = all.map((d) => bx(d) * stepY)
    const minY = Math.min(...rawYs)
    const offsetY = cursorY + opts.nodeHeight / 2 - minY

    const byId = new Map<string, PositionedNode>()

    for (const d of all) {
      const placed: PositionedNode = {
        id: d.data.node.id,
        data: d.data.node,
        // ⚑ 缩放就在这里。注意 x 用 d.y、y 用 d.x —— d3 里 x 是"横向
        //（同层铺开的方向）"，而我们选了【左右布局】，所以它变成了纵向。
        x: by(d) * stepX + opts.padding + opts.nodeWidth / 2,
        y: bx(d) * stepY + offsetY,
        depth: d.depth,
      }
      byId.set(placed.id, placed)
      nodes.push(placed)
      maxCenterX = Math.max(maxCenterX, placed.x)
    }

    // 连线：从父到子。用 id 回查是为了拿到【已经平移过】的坐标
    for (const d of all) {
      if (!d.parent) continue
      const from = byId.get(d.parent.data.node.id)
      const to = byId.get(d.data.node.id)
      if (from && to) edges.push({ from, to })
    }

    cursorY += Math.max(...rawYs) - minY + opts.nodeHeight + ROOT_GAP
  }

  return {
    nodes,
    edges,
    // 最右节点的【右边缘】再加一个 padding
    width: maxCenterX + opts.nodeWidth / 2 + opts.padding,
    height: cursorY - ROOT_GAP + opts.padding,
  }
}
