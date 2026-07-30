/**
 * canon 公开投影（`/model-data/`）→ 本包的输入形状。**纯函数，不取数。**
 *
 * 分工要说清楚，否则很容易把 HTTP 也写进来：
 *   - **取数是消费端的事** —— 拉 index、按 `entry.path` 拉 per-model 文件、缓存、
 *     双域切换，全在消费端。本包 isomorphic（无网络 / 无 fs / 无 env），要能被
 *     inferera-web 的预渲染脚本直接 require。
 *   - **本模块只做「已经拿到的那份 JSON → 可用的结构」** —— 协议列表、能力+verdict、
 *     参数面板字段、以及喂给 `generateFromCapabilities()` 的 `resolve`。
 *
 * ## 三个已实测的取舍（改之前先看数据，别按直觉改）
 *
 * **1. verdict 取 `aihubmix` 轴，不取两轴较严的那个。**
 * 两条轴在投影里**恒同时存在**（实测 300/300 条记录都有）。取较严的那个看着更安全，
 * 实际会砍掉网关最核心的价值：54 条冲突里绝大多数是 `official=not-applicable` +
 * `aihubmix=tested-effective` —— 意思是「厂商文档里没这回事，但 AIHubMix 转译之后实测能用」
 * （如 gemini 模型走 `openai.responses`）。按 official 判就等于把跨协议转译整片划掉。
 * 所以：`aihubmix` 定可选性，`official` 只作出处（quote / source）随行展示。
 *
 * **2. `field.override.status === 'do-not-send'` 是硬信号，压过 verdict。**
 * override 是 canon 给**这个模型**打的补丁（实测 6 条：3 个 model-specific-default、
 * 2 个 model-specific-enum、1 个 do-not-send）。例：claude-opus-5 的 messages 协议上
 * `temperature` 被标 do-not-send。这类字段进了参数面板就是引导用户发 400，必须挡。
 *
 * **3. `field.name` 里带 `[` `]` `=` 的（实测 24/294）不进参数面板。**
 * 那是模式而非路径（`messages[].content[].type=image`、`tools[].google_search`），
 * 值放不进扁平取值框 —— 它们描述的是**结构**，由 codegen 按协议拼数组/内容块。
 * 剩下 92%（扁平 226 + 点路径 44）可以直接当 body 路径用，零映射。
 */
import type { CodeProto } from '@aihubmix/codegen';
import { CANON_TO_PROTO } from './protocols.js';
import type { CapLevel, Verdict, VerdictPolicy } from './verdicts.js';
import { verdictPolicy } from './verdicts.js';
import type { CapabilityResolution, CapabilityResolver } from './generate.js';

// ---------------------------------------------------------------------------
// canon 投影的形状。只声明本模块**真的读**的字段 —— canon 加字段不该让这里编不过，
// 所以一律可选，且不写 index signature 之外的约束。
// ---------------------------------------------------------------------------

/** canon 给某个字段打的、**仅对这个模型生效**的补丁。 */
export interface CanonFieldOverride {
  /** `do-not-send` 表示这个模型上发了会坏；另有 model-specific-default / model-specific-enum。 */
  status?: string;
  value?: unknown;
  enum?: unknown[];
  quote?: string;
  source?: string;
}

export interface CanonField {
  name: string;
  type?: string;
  description?: string;
  /** 实测 293/294 是 'body'，1 条 'nested'。非 body 的不进参数面板。 */
  location?: string;
  enum?: unknown[];
  default?: unknown;
  range?: { min?: number; max?: number };
  /** 'deprecated' 等。canon 标了废弃就不该再往面板上放。 */
  status?: string;
  override?: CanonFieldOverride;
}

export interface CanonVerdictSide {
  verdict?: string;
  quote?: string;
  source?: string;
}

export interface CanonProtocolEntry {
  /** canon 协议 id，如 `openai.chat_completions`。实测还有 `dashscope` —— 无对应代码协议。 */
  protocol?: string;
  official?: CanonVerdictSide;
  aihubmix?: CanonVerdictSide;
  fields?: CanonField[];
}

export interface CanonCapability {
  key?: string;
  name?: string;
  summary?: string;
  protocols?: CanonProtocolEntry[];
}

export interface CanonDomain {
  key?: string;
  name?: string;
  order?: number;
  capabilities?: CanonCapability[];
}

/** per-model 文件（`models/{id}.{hash}.json`）。 */
export interface CanonModelDoc {
  model_id?: string;
  vendor?: string;
  last_verified?: string;
  protocols?: string[];
  domains?: CanonDomain[];
}

/** index.json 里的一条。**`path` 必须用它** —— 文件名带内容哈希，拼 `models/{id}.json` 会 404。 */
export interface CanonIndexEntry {
  id?: string;
  vendor?: string;
  protocols?: string[];
  path?: string;
}

export interface CanonIndex {
  models?: CanonIndexEntry[];
}

// ---------------------------------------------------------------------------
// 输出形状
// ---------------------------------------------------------------------------

/** 一个协议在 canon 里的概况。`hasFields` 决定它是走全量还是走基础对话形式。 */
export interface CanonProtocolView {
  proto: CodeProto;
  /** 原始 canon 协议 id，排错时对得上源数据。 */
  canonProtocol: string;
  /** canon 为这个协议列过的能力条数（含零字段的）。 */
  capabilityCount: number;
  /** 真能进参数面板的字段数。为 0 ⇒ 该协议只出最基础对话形式。 */
  fieldCount: number;
}

/** 参数面板的一项。`path` 是 wire 路径，`'a.b.c'` 表示嵌套。 */
export interface CanonParam {
  path: string;
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  range?: { min?: number; max?: number };
  /** 所属 canon 能力 key，用来分组展示。 */
  cap: string;
  /** UI 是否允许调；false ⇒ 划掉。 */
  selectable: boolean;
  level: CapLevel;
  /** 不可选/降级的原因，稳定机器码，UI 按它查本地化文案。 */
  reason: CanonParamReason;
  /** 定可选性的那条 verdict（aihubmix 轴）。 */
  verdict: Verdict | null;
  /** 厂商侧出处，随行展示用。 */
  official?: CanonVerdictSide;
  override?: CanonFieldOverride;
}

export type CanonParamReason =
  | 'ok'
  /** verdict 本身要提醒或直接不可选。 */
  | 'verdict'
  /** canon 给这个模型标了 do-not-send。 */
  | 'override-do-not-send'
  /** canon 标了 deprecated。 */
  | 'deprecated';

export interface CanonReadOpts {
  /**
   * 用哪条轴定可选性。默认 `'aihubmix'` —— 理由见文件头第 1 条，别随手改成 official。
   * 留这个开关是为了让消费端能做「按厂商文档看」的对照视图，不是给日常路径用的。
   */
  axis?: 'aihubmix' | 'official';
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/** 模式字段（`a[].b`、`x=y`）：描述结构而非路径，进不了扁平取值框。 */
function isPatternName(name: string): boolean {
  return /[[\]=]/.test(name);
}

function sideOf(entry: CanonProtocolEntry, axis: 'aihubmix' | 'official'): CanonVerdictSide | undefined {
  return axis === 'official' ? entry.official : entry.aihubmix;
}

/**
 * index 里按模型 id 找条目。
 *
 * 独立成函数是因为**取文件路径这一步最容易写错** —— 直接拼 `models/${id}.json` 会 404
 * （文件名带内容哈希）。让调用方拿 `entry.path` 而不是自己拼。
 */
export function canonEntry(index: CanonIndex | null | undefined, modelId: string): CanonIndexEntry | null {
  return index?.models?.find((m) => m.id === modelId) ?? null;
}

/**
 * doc 里出现过、且能对应到代码协议的协议列表。
 *
 * 两件事一起给：`capabilityCount`（canon 提过几条能力）与 `fieldCount`（真有几个可调字段）。
 * 两者会差很多 —— claude-opus-5 宣称 4 个协议，只有 messages 有字段，其余三个是
 * 「能用，但没有可调参数记录」。UI 要据此决定出全量面板还是基础对话形式，所以不能只给一个数。
 *
 * canon 的 `dashscope` 这类没有代码协议对应的，直接不出现在结果里。
 */
export function canonProtocols(
  doc: CanonModelDoc | null | undefined,
  opts: CanonReadOpts = {},
): CanonProtocolView[] {
  const acc = new Map<CodeProto, CanonProtocolView>();
  for (const dom of doc?.domains ?? []) {
    for (const cap of dom.capabilities ?? []) {
      for (const entry of cap.protocols ?? []) {
        const canonProtocol = entry.protocol;
        if (!canonProtocol) continue;
        const proto = CANON_TO_PROTO[canonProtocol];
        if (!proto) continue; // canon 有、codegen 没有的协议（dashscope）
        let view = acc.get(proto);
        if (!view) {
          view = { proto, canonProtocol, capabilityCount: 0, fieldCount: 0 };
          acc.set(proto, view);
        }
        view.capabilityCount++;
        view.fieldCount += paramsOfEntry(entry, cap.key ?? '', opts).length;
      }
    }
  }
  return [...acc.values()];
}

/** 把一条 protocol entry 的 fields 摊成参数面板项（不含模式字段与非 body 字段）。 */
function paramsOfEntry(
  entry: CanonProtocolEntry,
  capKey: string,
  opts: CanonReadOpts,
): CanonParam[] {
  const axis = opts.axis ?? 'aihubmix';
  const side = sideOf(entry, axis);
  const verdict = (side?.verdict as Verdict | undefined) ?? null;
  const policy: VerdictPolicy = verdictPolicy(verdict);
  const out: CanonParam[] = [];

  for (const f of entry.fields ?? []) {
    if (!f?.name) continue;
    if (isPatternName(f.name)) continue;             // 结构，不是路径
    if (f.location && f.location !== 'body') continue; // 只有 body 字段能进面板

    // 三个来源合成一个可选性结论。override / deprecated 是**字段级**的硬信号，
    // 压过能力级的 verdict —— canon 专门给这个模型打了补丁说别发，就别放出来。
    let selectable = policy.selectable;
    let level = policy.level;
    let reason: CanonParamReason = policy.note ? 'verdict' : 'ok';
    if (f.status === 'deprecated') {
      selectable = false;
      level = 'unsupported';
      reason = 'deprecated';
    }
    if (f.override?.status === 'do-not-send') {
      selectable = false;
      level = 'unsupported';
      reason = 'override-do-not-send';
    }

    out.push({
      path: f.name,
      type: f.type,
      description: f.description,
      enum: f.override?.status === 'model-specific-enum' && f.override.enum ? f.override.enum : f.enum,
      default: f.override?.status === 'model-specific-default' ? f.override.value : f.default,
      range: f.range,
      cap: capKey,
      selectable,
      level,
      reason,
      verdict,
      official: entry.official,
      override: f.override,
    });
  }
  return out;
}

/**
 * 某协议下的参数面板字段，按 canon 的 domain / capability 顺序。
 *
 * 同名字段可能被多条能力各记一次（如 `max_tokens` 同时属于 output-limit 与校验类能力）。
 * 保留**第一条**：canon 的 domain 有 `order`，先出现的是更贴切的那条归属。
 */
export function canonParams(
  doc: CanonModelDoc | null | undefined,
  proto: CodeProto,
  opts: CanonReadOpts = {},
): CanonParam[] {
  const seen = new Set<string>();
  const out: CanonParam[] = [];
  for (const dom of doc?.domains ?? []) {
    for (const cap of dom.capabilities ?? []) {
      for (const entry of cap.protocols ?? []) {
        if (!entry.protocol || CANON_TO_PROTO[entry.protocol] !== proto) continue;
        for (const p of paramsOfEntry(entry, cap.key ?? '', opts)) {
          if (seen.has(p.path)) continue;
          seen.add(p.path);
          out.push(p);
        }
      }
    }
  }
  return out;
}

/**
 * doc → `generateFromCapabilities()` 要的 `resolve`。
 *
 * 契约要求它**不抛异常**；这里是纯查表，天然不抛。返回 null 表示 canon 没有这条记录 ——
 * 上游会按「不猜，直接不可选」处理，不是按「支持」处理。
 *
 * 注意 `fields` 只喂**非模式**字段：`generateFromCapabilities` 拿它做展示与落点校验，
 * 塞进去一条 `messages[].content[].type=image` 只会让人以为那是个可写路径。
 */
export function canonResolver(
  doc: CanonModelDoc | null | undefined,
  opts: CanonReadOpts = {},
): CapabilityResolver {
  const axis = opts.axis ?? 'aihubmix';
  const table = new Map<string, CapabilityResolution>();
  for (const dom of doc?.domains ?? []) {
    for (const cap of dom.capabilities ?? []) {
      if (!cap.key) continue;
      for (const entry of cap.protocols ?? []) {
        if (!entry.protocol) continue;
        const proto = CANON_TO_PROTO[entry.protocol];
        if (!proto) continue;
        const k = `${cap.key} ${proto}`;
        if (table.has(k)) continue; // 同上：保留第一条
        const fields = (entry.fields ?? [])
          .map((f) => f?.name)
          .filter((n): n is string => !!n && !isPatternName(n));
        const verdict = sideOf(entry, axis)?.verdict as Verdict | undefined;
        table.set(k, { fields, ...(verdict ? { verdict } : {}) });
      }
    }
  }
  return (cap, proto) => table.get(`${cap} ${proto}`) ?? null;
}

/**
 * canon 没覆盖这个模型时的兜底 resolver：对任何能力都答「没有记录」。
 *
 * **这是今天 374/380 个模型的实际路径，不是异常分支** —— canon 目前只覆盖 6 个。
 * 单独给个具名函数而不是让调用方写 `() => null`，是为了让这条路径在调用点上认得出来，
 * 也让它有地方挂这段注释。上游据此把每条能力都置为不可选，产出的就是
 * 「最基础对话形式」：只有 model + 一条用户消息，不注入任何能力参数。
 */
export const NO_CANON_RESOLVER: CapabilityResolver = () => null;
