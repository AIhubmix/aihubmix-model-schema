/**
 * generateFromCapabilities —— 「勾几个能力 → 一段能跑的示例」。
 *
 * 与 codegen 的 generateCode 是**两种输入模型**，不是一个函数的两种用法：
 *   - generateCode(proto, lang, ctx)  吃参数面板的具体取值 + paramKeys 门控（playground）
 *   - generateFromCapabilities(...)   吃能力键列表 + 示例值（模型详情页 Quickstart）
 * 合成一个函数两头不讨好，所以分层 —— 而且分在了包边界上：本层（model-schema）只把
 * canon 能力翻译成 codegen 的 ctx，真正的 body 与代码仍由 codegen 的 buildBody / RENDERERS 出，
 * 「Get Code 与真实请求同源」这条不变量跨包仍然成立（同一个 buildBody，没有第二份实现）。
 *
 *   capabilities: ['reasoning-effort', 'function-calling']
 *         │  ← 本层（薄，@aihubmix/model-schema）
 *         ▼
 *        ctx ──→ buildBody(proto, ctx) ──→ RENDERERS[lang] ──→ code   （@aihubmix/codegen）
 *
 * **本包也不读 canon**：字段名与 verdict 由调用方经 resolve() 注入，保住 isomorphic / 无网络
 * 约束（同 @aihubmix/media-adapters 的 capabilities-are-injected 模式）。取数（HTTP 拉
 * `/model-data/`、缓存、内容寻址路径）是消费端的事 —— 本包只认识 canon 的**词汇**，不认识它的**传输**。
 *
 * **本包不带 UI**：返回结构化 availability + notes，chip 行 / 划掉样式 / 警告条全留消费端。
 * 两端 UI 栈不同（antd + styled-components vs Tailwind + zustand），且包必须能在 node 里被
 * 预渲染脚本 require，带 React 就废了。
 */
import type { CodeGenCtx, CodeLang, CodeProto } from '@aihubmix/codegen';
import { buildBody, generateCode, langDef } from '@aihubmix/codegen';
import type { CapLevel, Verdict } from './verdicts.js';
import { verdictPolicy } from './verdicts.js';
import type { CapabilitySamples } from './samples.js';
import { DEFAULT_SAMPLES } from './samples.js';
import { CAPABILITY_PUTS, type CapDraft, type CapabilityPutDef } from './catalog.js';

/** note / status.reason 的稳定机器码。UI 要本地化就按它查表，别解析 text。 */
export type CapNoteCode =
  | 'ok'
  /** verdict 本身要提醒（silent-degrade / accepted-unverified / …）。 */
  | 'verdict'
  /** resolve() 说这个模型的这个协议没有该能力记录 —— 不猜，直接不可选。 */
  | 'no-canon-entry'
  /** canon 说支持，但包里还没有这个协议的 put（catalog.gap 有说明）。 */
  | 'no-put-for-proto'
  /** 先决能力没勾（如 responses 的 verbosity 依赖结构化输出）。 */
  | 'missing-prerequisite'
  /** apply 了但没落进 body —— 生成器的缺口，必须显式暴露而不是假装成功。 */
  | 'not-landed'
  /** capabilities 里传了本表没有的 key。 */
  | 'unknown-capability'
  /** 调用方的 resolve() 抛了异常 —— 按「查不到」处理，只影响这一条能力。 */
  | 'resolver-error';

export interface CapabilityNote {
  level: 'warn' | 'info';
  cap: string;
  code: CapNoteCode;
  /** 默认英文措辞；warn 且 verdict 要求时会原样插进生成的代码注释。 */
  text: string;
}

export interface CapabilityStatus {
  cap: string;
  label: string;
  proto: CodeProto;
  /** UI 是否允许勾选。false ⇒ 划掉。 */
  selectable: boolean;
  level: CapLevel;
  reason: CapNoteCode;
  verdict: Verdict | null;
  /** canon 报的字段名，**仅供展示**（可能是 `messages[].content[].type=image` 这类模式）。 */
  fields: string[];
  /** 本次调用是否勾选了它。 */
  requested: boolean;
  /** 是否真的落进了 body（经 landed() 校验，不是「调了 apply」）。 */
  applied: boolean;
}

/** 调用方从 canon（或任何数据源）取到的一条能力记录。 */
export interface CapabilityResolution {
  /** 单个字段名；与 fields 二选一。 */
  field?: string;
  /** 多个字段名（如 chat 的 output-limit 是 max_completion_tokens + max_tokens，顺序有意义）。 */
  fields?: string[];
  verdict?: Verdict;
}

/**
 * (能力 key, 协议) → 记录 | null。
 *
 * **契约上不得抛异常**：一次 resolve 失败不该让整行能力 chip 渲染不出来。
 * 但契约写给调用方、约束不了运行时（resolve 往往是调用方现写的 canon 查表，
 * 一个 `undefined.protocols` 就抛了），所以 generateFromCapabilities 内部对每条能力
 * 单独 try/catch 兜底：抛了的那条按 `resolver-error` 记账、置为不可选，其余照常。
 */
export type CapabilityResolver = (
  cap: string,
  proto: CodeProto,
) => CapabilityResolution | null | undefined;

export interface FromCapabilitiesOpts {
  /** 模型 id。 */
  model: string;
  protocol: CodeProto;
  lang: CodeLang;
  /** 勾选的能力 key（顺序不影响产物：应用顺序恒为 CAPABILITY_PUTS 表序）。 */
  capabilities: string[];
  /** 网关根地址，不带尾斜杠。必填，理由同 CodeGenCtx.baseUrl（双域构建）。 */
  baseUrl: string;
  resolve: CapabilityResolver;
  /** 覆盖示例值（示例提问、示例工具、示例图片…）。 */
  samples?: Partial<CapabilitySamples>;
}

export interface CapabilityGenResult {
  /** 生成的代码（silent-degrade 的能力会在顶部插一行警告注释）。 */
  code: string;
  /** 同一次生成的 wire body —— 与 code 同源，可直接用于真实请求。 */
  body: Record<string, unknown>;
  /** 真正落进 body 的能力 key（表序）。 */
  used: string[];
  notes: CapabilityNote[];
  /** **全部** 11 条能力的状态（不只勾选的那几条）——UI 要渲染整行 chip。 */
  availability: Record<string, CapabilityStatus>;
}

/** 异常 → 一行可读文字。note.text 会被塞进生成的代码注释，所以只取首行、掐长度。 */
function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return (m || 'unknown error').split('\n')[0].slice(0, 120);
}

/** resolve 的返回 → 字段名数组。 */
function fieldsOf(res: CapabilityResolution | null | undefined): string[] {
  if (!res) return [];
  if (res.fields?.length) return res.fields;
  return res.field ? [res.field] : [];
}

export function generateFromCapabilities(opts: FromCapabilitiesOpts): CapabilityGenResult {
  const { model, protocol, lang, baseUrl, resolve } = opts;
  const s: CapabilitySamples = { ...DEFAULT_SAMPLES, ...opts.samples };
  const requested = new Set(opts.capabilities);

  // 起点是「什么都不发」：sys 空、paramKeys 空集合（= 一个可选参数都不发）、stream 关。
  // 能力自己把需要的键 allow 进来 —— 没勾的能力绝不会有残留值漏进 body。
  const ctx: CodeGenCtx = {
    baseUrl,
    model: { id: model },
    sys: '',
    user: s.user,
    // temperature/top_p 取默认 1：buildBody 对等于默认的值不下发，
    // 保证 Quickstart 示例只出「勾了的能力 + 协议必需字段」。
    p: { max_tokens: s.maxTokens, temperature: 1, top_p: 1 },
    paramKeys: [],
    enums: {},
    objects: {},
    stream: false,
  };
  const draft: CapDraft = {
    ctx,
    s,
    allow(...keys) {
      for (const k of keys) if (!ctx.paramKeys!.includes(k)) ctx.paramKeys!.push(k);
    },
  };

  const notes: CapabilityNote[] = [];
  const availability: Record<string, CapabilityStatus> = {};
  const applied: Array<{ def: CapabilityPutDef; verdict: Verdict | null }> = [];

  // ---- 第一遍：定可用性，按表序应用可用且被勾选的能力 ----
  for (const def of CAPABILITY_PUTS) {
    // 逐能力隔离：调用方的 resolve 抛了，只废掉这一条，不掀掉整次生成（见 CapabilityResolver 注释）。
    let res: CapabilityResolution | null | undefined;
    let resolverError: unknown;
    try {
      res = resolve(def.key, protocol);
    } catch (e) {
      resolverError = e;
      res = null;
    }
    const fields = fieldsOf(res);
    const verdict = res?.verdict ?? null;
    const policy = verdictPolicy(verdict);
    const put = def.put[protocol];
    const isRequested = requested.has(def.key);

    const status: CapabilityStatus = {
      cap: def.key,
      label: def.label,
      proto: protocol,
      // resolve 抛了 = 查不到，一律不可选：拿不到字段名就无从判断该模型支不支持，
      // 猜着发比不发更糟（会把不支持的字段真发到网关）。
      selectable: !resolverError && policy.selectable && !!put,
      level: resolverError ? 'unsupported' : policy.level,
      reason: resolverError
        ? 'resolver-error'
        : !res
          ? 'no-canon-entry'
          : policy.selectable
            ? 'ok'
            : 'verdict',
      verdict,
      fields,
      requested: isRequested,
      applied: false,
    };

    if (resolverError && isRequested) {
      notes.push({
        level: 'warn',
        cap: def.key,
        code: 'resolver-error',
        text: `Could not look up "${def.key}" for ${protocol} (${errText(resolverError)}), so it was left out of the snippet.`,
      });
    }

    // canon 说支持、包里没有 put：这是生成器的缺口，等级降到 unsupported 并带上记账说明。
    if (res && policy.selectable && !put) {
      status.level = 'unsupported';
      status.reason = 'no-put-for-proto';
      if (isRequested) {
        notes.push({
          level: 'warn',
          cap: def.key,
          code: 'no-put-for-proto',
          text:
            def.gap?.[protocol] ??
            `This generator has no ${protocol} shape for "${def.key}" yet, so it was left out of the snippet.`,
        });
      }
    }

    availability[def.key] = status;
    if (!isRequested) continue;

    if (!status.selectable) {
      // 不可选却被勾了：按 verdict 的语气报，别静默丢。
      if (status.reason === 'verdict' || status.reason === 'no-canon-entry') {
        notes.push({
          level: policy.note ?? 'info',
          cap: def.key,
          code: status.reason,
          text: policy.text,
        });
      }
      continue;
    }

    // 先决能力：必须同时被勾选**且**自身可用，否则本条不应用。
    const missing = (put!.requires ?? []).filter(
      (r) => !requested.has(r) || !availability[r]?.selectable,
    );
    if (missing.length) {
      status.reason = 'missing-prerequisite';
      notes.push({
        level: 'warn',
        cap: def.key,
        code: 'missing-prerequisite',
        text: `"${def.key}" on ${protocol} is a sub-field of "${missing.join('", "')}" and was skipped; enable ${missing.length > 1 ? 'those capabilities' : 'that capability'} as well.`,
      });
      continue;
    }

    put!.apply(draft, fields);
    applied.push({ def, verdict });
    if (policy.note) {
      notes.push({ level: policy.note, cap: def.key, code: 'verdict', text: policy.text });
    }
  }

  // ---- 第二遍：出 body / code，校验每条能力真的落地了 ----
  const body = buildBody(protocol, ctx);
  const used: string[] = [];
  const codeComments: string[] = [];

  for (const { def, verdict } of applied) {
    if (!def.put[protocol]!.landed(body)) {
      // apply 调了但 body 里没有 —— 生成器的静默缺口。宁可报错也不让用户复制走一段不生效的代码。
      notes.push({
        level: 'warn',
        cap: def.key,
        code: 'not-landed',
        text: `"${def.key}" could not be expressed in the ${protocol} request body and was dropped from the snippet.`,
      });
      continue;
    }
    used.push(def.key);
    availability[def.key].applied = true;
    const policy = verdictPolicy(verdict);
    if (policy.inCodeComment) codeComments.push(`${def.key}: ${policy.text}`);
  }

  // ---- 勾了但表里没有的 key ----
  for (const key of requested) {
    if (availability[key]) continue;
    notes.push({
      level: 'warn',
      cap: key,
      code: 'unknown-capability',
      text: `Unknown capability "${key}" — this generator has no shape for it.`,
    });
  }

  let code = generateCode(protocol, lang, ctx);
  if (codeComments.length) {
    // 警告注释插在代码最顶部：silent-degrade 意味着「请求会成功但字段没效果」，
    // 用户复制走的那段代码里必须带着这句话，只在网页上提示是留不住的。
    const mark = langDef(lang)?.comment ?? '#';
    code = `${codeComments.map((c) => `${mark} WARNING: ${c}`).join('\n')}\n\n${code}`;
  }

  return { code, body, used, notes, availability };
}
