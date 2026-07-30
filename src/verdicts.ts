/**
 * verdict 语义 —— 纯数据表，**唯一真源**。
 *
 * 为什么进包而不留在 UI：原型把这套判定写在 `cgAvail()` 里（前端函数），意味着模型详情页
 * 与 playground 各写一遍「哪个 verdict 算可用」。那是同一条业务事实的两份实现，迟早分叉 ——
 * 一边把 `silent-degrade` 当可用、另一边当不可用，用户看到的能力集就不一致了。
 * 本包返回结构化 availability，两端 UI 只把 level 映射成 class。
 *
 * 为什么住 model-schema 而不是 codegen：verdict 是 canon（AIHubMix 模型知识库）的词表，
 * 是开集 —— canon 加一个 verdict，如果这张表住在 codegen 里，codegen 就得跟着发版。
 * codegen 只该认识 wire（发到网关的 body 长什么样），不该认识「这个字段验没验过」。
 *
 * verdict 取值来自 canon 对「这个字段在本网关上到底生不生效」的实测结论。词表以 canon 公开
 * 投影 `/model-data/` 实际出现的取值为准，另加原型用过的 `do-not-send`。
 * **本包也不读 canon**（isomorphic / 无网络）：verdict 由调用方经 resolve() 注入，这里只定语义。
 */

/** canon 对「字段在本网关是否生效」的实测结论。 */
export type Verdict =
  /** 实测生效：发了有可观测的行为差异。 */
  | 'tested-effective'
  /** 上游接受（HTTP 200）但未观测到行为差异 —— 「200 ≠ 生效」，只能算未证实。 */
  | 'accepted-unverified'
  /** 尚未测过。 */
  | 'unverified'
  /** 静默降级：请求不报错，字段被忽略。最坑的一档，必须显式警告。 */
  | 'silent-degrade'
  /** 上游明确拒绝或不支持（报错 / 文档声明不支持）。 */
  | 'rejected-or-unsupported'
  /** 该协议上这条能力不适用（概念上就不存在，不是「支持不了」）。 */
  | 'not-applicable'
  /** 已知会把请求搞坏，别发。 */
  | 'do-not-send';

/** 能力可用性等级 —— UI 只把它映射成样式（正常 / 加标记 / 划掉）。 */
export type CapLevel = 'ok' | 'unverified' | 'degraded' | 'unsupported';

export interface VerdictPolicy {
  /** UI 是否允许勾选；false = 划掉，勾了也不会被应用。 */
  selectable: boolean;
  level: CapLevel;
  /** 该能力被勾选时要产的提示等级；null = 不产提示。 */
  note: 'warn' | 'info' | null;
  /** 是否在生成的代码里插一行警告注释（只有静默降级值得占用代码行）。 */
  inCodeComment: boolean;
  /**
   * 默认英文措辞。产物代码里的注释直接用它 —— 代码示例是英文优先的产品内容，
   * 不往用户复制走的代码里塞中文。UI 侧要本地化就按 note.code + cap 自己查表，
   * 不要解析这段文本。
   */
  text: string;
}

export const VERDICT_POLICY: Record<Verdict, VerdictPolicy> = {
  'tested-effective': {
    selectable: true,
    level: 'ok',
    note: null,
    inCodeComment: false,
    text: 'Verified effective on this gateway.',
  },
  'accepted-unverified': {
    selectable: true,
    level: 'unverified',
    note: 'info',
    inCodeComment: false,
    text: 'Accepted by the upstream API, but no observable effect has been confirmed yet.',
  },
  unverified: {
    selectable: true,
    level: 'unverified',
    note: 'info',
    inCodeComment: false,
    text: 'Not verified yet on this gateway.',
  },
  'silent-degrade': {
    selectable: true,
    level: 'degraded',
    note: 'warn',
    inCodeComment: true,
    text: 'Silently ignored by the upstream API: the request succeeds but this field has no effect.',
  },
  'rejected-or-unsupported': {
    selectable: false,
    level: 'unsupported',
    note: 'warn',
    inCodeComment: false,
    text: 'Rejected or unsupported on this protocol.',
  },
  'not-applicable': {
    selectable: false,
    level: 'unsupported',
    note: 'info',
    inCodeComment: false,
    text: 'Not applicable to this protocol.',
  },
  'do-not-send': {
    selectable: false,
    level: 'unsupported',
    note: 'warn',
    inCodeComment: false,
    text: 'Known to break the request on this protocol — do not send.',
  },
};

/**
 * resolve() 给了个词表外的 verdict 时的兜底。
 *
 * **故意选「可选 + 未证实」而不是「不可选」**：canon 将来加新 verdict 是常态，
 * 老版本包不该因此把用户能用的能力划掉（fail-open）。但要显式标未证实，不冒充已验证。
 */
export const UNKNOWN_VERDICT_POLICY: VerdictPolicy = {
  selectable: true,
  level: 'unverified',
  note: 'info',
  inCodeComment: false,
  text: 'Unrecognized verdict from the caller — treated as unverified.',
};

/** resolve() 返回 null（canon 没这条记录）时的兜底：不猜，直接不可选。 */
export const NO_ENTRY_POLICY: VerdictPolicy = {
  selectable: false,
  level: 'unsupported',
  note: null,
  inCodeComment: false,
  text: 'No capability record for this model/protocol.',
};

/** 取 verdict 对应的策略；未知取值走 fail-open 兜底。 */
export function verdictPolicy(verdict: Verdict | null | undefined): VerdictPolicy {
  if (!verdict) return NO_ENTRY_POLICY;
  return VERDICT_POLICY[verdict] ?? UNKNOWN_VERDICT_POLICY;
}
