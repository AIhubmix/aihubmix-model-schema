/**
 * 能力 put 表 —— 「怎么把一条 canon 能力放进 codegen 的 ctx」。
 *
 * ## 为什么这张表住 model-schema，不住 codegen
 *
 * 它上一版住在 codegen 里，理由写的是「这是协议知识、闭集，与 canon 无关」。**那半句是错的**：
 * 形态（vision 在 chat 是 `image_url`、responses 是 `input_image`、messages 是 `source`）确实
 * 是协议知识，但**键**（`vision` / `reasoning-effort` / `explicit-cache`）是 canon 的词，是开集
 * ——canon 现有 64 个能力键，这里只覆盖其中 11 个，而且还在长。整张表本质是
 * 「canon 词 → wire 词」的翻译，翻译表当然该住在认识 canon 的那一侧。
 *
 * 留在 codegen 的后果很具体：canon 加一条能力 → 改 codegen → 发版 → 两端升级。搬过来之后，
 * 加一条能力只动本包，codegen 一行不改。**协议形态本身仍然全部由 codegen 出**：下面的 apply()
 * 只往 `CodeGenCtx` 上写 wire 词（`ctx.tools` / `ctx.images` / `ctx.enums.prompt_cache_key`），
 * 真正拼 body 的还是 codegen 的 `buildBody` —— 「Get Code 与真实请求同源」不受影响。
 *
 * ## 为什么 put 不用 canon 给的 field 名去写 body
 *
 * canon 的 field 是**描述性路径/模式**，不都是可赋值的键。实测取值里就有：
 *   - `output_config.effort`                 —— 嵌套路径
 *   - `messages[].content[].image_url`       —— 数组下标通配
 *   - `messages[].content[].type=image`      —— 连值都写进去了
 * 拿它当 `body[field] = value` 的键会直接产出错误 body。所以 put 是写死的协议形态，
 * canon 的 field 只用于**展示**与 `used` 上报；仅在它能消歧时才被读（目前只有 output-limit
 * 的 `max_completion_tokens` vs `max_tokens`）。
 *
 * ## 每条 put 都要带 landed()
 *
 * apply() 改的是 ctx，真正决定 body 的是 buildBody —— 中间隔着 schema 门控、能力互斥、
 * 协议分支。只写 apply 不校验，就会出现「报告说应用了、body 里其实没有」的静默假阳性
 * （responses 的 verbosity 就是活例子：它是 `text` 组的子字段，而 `text` 只在结构化输出
 * 开启时下发）。landed() 让这类缺口变成显式的 note，而不是用户复制走一段不生效的代码。
 *
 * ## 顺序
 *
 * 应用顺序 = 本表顺序，**不是调用方传 capabilities 的顺序** —— 同一组能力无论怎么排，
 * 产物字节必须一致。structured-output-json 排在 verbosity 前面是必需的：后者依赖前者。
 */
import type { CodeGenCtx, CodeProto } from '@aihubmix/codegen';
import { parseSchemaSafe } from '@aihubmix/codegen';
import type { CapabilitySamples } from './samples.js';

type Body = Record<string, unknown>;

/** put 可改写的 ctx 草稿（buildBody 之前）。 */
export interface CapDraft {
  ctx: CodeGenCtx;
  s: CapabilitySamples;
  /** 声明本能力用到的 schema 参数键 —— 只有进了 paramKeys，buildBody 的门控才放行。 */
  allow(...keys: string[]): void;
}

export interface CapPut {
  /** 把能力写进 ctx。 */
  apply: (d: CapDraft, fields: string[]) => void;
  /** 校验它真的落进了 body。返回 false ⇒ 上报 not-landed，不计入 used。 */
  landed: (body: Body) => boolean;
  /** 先决能力：未同时勾选则本条不应用，并产 warn note。 */
  requires?: string[];
}

export interface CapabilityPutDef {
  /** canon 的 capability key（两端与 canon 用同一套 key，不另起名字）。 */
  key: string;
  label: string;
  /** 有 put 实现的协议；缺该协议 = 包还写不出这个形态。 */
  put: Partial<Record<CodeProto, CapPut>>;
  /**
   * 已知缺口说明：canon 说该协议支持、但包里没有 put 时，把这句话带给调用方。
   * 有值就说明「这是个记了账的缺口」，不是「忘了写」。
   */
  gap?: Partial<Record<CodeProto, string>>;
}

// ---------- landed 小工具 ----------

function asObj(v: unknown): Body | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : undefined;
}

/** gemini 的采样/生成配置组（buildBody 把 enum/object/数值都收在这里）。 */
function genCfg(b: Body): Body {
  return asObj(b.generationConfig) ?? {};
}

/** 深度查找 body 里是否存在满足条件的对象节点（多模态、缓存断点这类嵌在内容块里的形态用）。 */
function deepFind(v: unknown, pred: (o: Body) => boolean): boolean {
  if (Array.isArray(v)) return v.some((x) => deepFind(x, pred));
  const o = asObj(v);
  if (!o) return false;
  if (pred(o)) return true;
  return Object.values(o).some((x) => deepFind(x, pred));
}

/** 往 ctx.objects 的某个组里合并子字段（组可能已被别的能力写过，不能整块覆盖）。 */
function mergeGroup(ctx: CodeGenCtx, key: string, patch: Body): void {
  const objs = (ctx.objects ??= {});
  objs[key] = { ...(asObj(objs[key]) ?? {}), ...patch };
}

// ---------- 各能力的 put ----------

/** think 系三协议 apply 一致（形态差异在 wire/capabilities.ts 的 CAPABILITIES 里）。 */
function applyThink(d: CapDraft): void {
  d.ctx.think = true;
  d.ctx.thinkLevel = d.s.effort;
  d.allow('reasoning_effort');
}

function applyVision(d: CapDraft): void {
  d.ctx.user = d.s.imagePrompt;
  d.ctx.images = [
    {
      id: 'sample-image',
      kind: 'url',
      src: d.s.imageUrl,
      mime: d.s.imageMime,
      modality: 'image',
    },
  ];
}

function applyTools(d: CapDraft): void {
  d.ctx.tools = d.s.tools;
  d.allow('tools', 'tool_choice');
}
const toolsLanded = (b: Body) => Array.isArray(b.tools) && b.tools.length > 0;

/**
 * 11 条能力 —— key 与 canon 同一套（canon 现有 64 个，这里覆盖 11 个）。
 * 加一条能力 = 在这里加一条记录；不用碰 generateFromCapabilities，
 * 更不用碰 @aihubmix/codegen（它压根不认识这些 key）。
 */
export const CAPABILITY_PUTS: CapabilityPutDef[] = [
  {
    key: 'system-instruction',
    label: 'System instruction',
    put: {
      chat: {
        apply: (d) => {
          d.ctx.sys = d.s.system;
        },
        landed: (b) =>
          Array.isArray(b.messages) &&
          b.messages.some((m) => asObj(m)?.role === 'system'),
      },
      messages: {
        apply: (d) => {
          d.ctx.sys = d.s.system;
        },
        landed: (b) => b.system !== undefined,
      },
      responses: {
        apply: (d) => {
          d.ctx.sys = d.s.system;
        },
        landed: (b) => !!b.instructions,
      },
      gemini: {
        apply: (d) => {
          d.ctx.sys = d.s.system;
        },
        landed: (b) => !!b.systemInstruction,
      },
    },
  },
  {
    key: 'output-limit',
    label: 'Max output tokens',
    put: {
      chat: {
        // 唯一读 canon field 的地方：OpenAI 已软弃用 max_tokens，canon 会把
        // max_completion_tokens 排在前面。buildBody 按 paramKeys 二选一，这里据此放行。
        apply: (d, fields) => {
          d.ctx.p.max_tokens = d.s.maxTokens;
          d.allow(fields[0] === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens');
        },
        landed: (b) => 'max_tokens' in b || 'max_completion_tokens' in b,
      },
      messages: {
        apply: (d) => {
          d.ctx.p.max_tokens = d.s.maxTokens;
        },
        landed: (b) => 'max_tokens' in b,
      },
      responses: {
        apply: (d) => {
          d.ctx.p.max_tokens = d.s.maxTokens;
        },
        landed: (b) => 'max_output_tokens' in b,
      },
      gemini: {
        // gemini 的参数面板是扁平原生名，buildBody 再嵌回 generationConfig。
        apply: (d) => {
          d.ctx.p.maxOutputTokens = d.s.maxTokens;
          d.allow('maxOutputTokens');
        },
        landed: (b) => 'maxOutputTokens' in genCfg(b),
      },
    },
  },
  {
    key: 'streaming',
    label: 'Streaming',
    put: {
      chat: { apply: (d) => void (d.ctx.stream = true), landed: (b) => b.stream === true },
      messages: { apply: (d) => void (d.ctx.stream = true), landed: (b) => b.stream === true },
      responses: { apply: (d) => void (d.ctx.stream = true), landed: (b) => b.stream === true },
    },
    gap: {
      // gemini 的流式不是 body 字段，是另一个端点（`:streamGenerateContent`）。
      // endpointPath 目前只出非流式端点，加它要动路由表 + 7 个 renderer 的响应读取，另开一步。
      gemini: 'Gemini streaming uses a separate endpoint (:streamGenerateContent), which this generator does not emit yet.',
    },
  },
  {
    key: 'reasoning-effort',
    label: 'Reasoning effort',
    put: {
      chat: { apply: applyThink, landed: (b) => !!b.reasoning_effort },
      responses: { apply: applyThink, landed: (b) => !!asObj(b.reasoning)?.effort },
      messages: {
        // Anthropic 的 thinking 是 `{type:'enabled', budget_tokens}`，budget_tokens 必填、
        // 下限 1024 —— 只发 type 会 400。playground 那边由参数面板填，Quickstart 没有面板，
        // 这里补上示例预算。
        //
        // 「max_tokens 必须严格大于 budget_tokens」那条**不在这里管**：它是 wire 级不变量，
        // 已下沉到 codegen 的 buildBody（enforceThinkingBudget）。留在这儿只保护代码示例、
        // 保护不了真实请求 —— 参数面板照样能配出 400 的组合。
        apply: (d) => {
          applyThink(d);
          mergeGroup(d.ctx, 'thinking', { budget_tokens: d.s.thinkingBudget });
        },
        landed: (b) => !!asObj(b.thinking)?.budget_tokens,
      },
      gemini: {
        // gemini 的思考档位走 generationConfig.thinkingConfig；它没进 wire/capabilities.ts
        // 的能力表（参数面板还没接），所以经通用 object 通道下发 —— 落点与 canon 报的
        // `generationConfig.thinkingConfig.thinkingLevel` 一致。
        apply: (d) => {
          mergeGroup(d.ctx, 'thinkingConfig', { thinkingLevel: d.s.effort });
          d.allow('thinkingConfig');
        },
        landed: (b) => !!asObj(genCfg(b).thinkingConfig)?.thinkingLevel,
      },
    },
  },
  {
    key: 'function-calling',
    label: 'Function calling',
    put: {
      chat: { apply: applyTools, landed: toolsLanded },
      messages: { apply: applyTools, landed: toolsLanded },
      responses: { apply: applyTools, landed: toolsLanded },
      gemini: { apply: applyTools, landed: toolsLanded },
    },
  },
  {
    key: 'structured-output-json',
    label: 'Structured output (JSON)',
    put: {
      chat: {
        apply: (d) => void (d.ctx.structured = d.s.structured),
        landed: (b) => !!b.response_format,
      },
      responses: {
        apply: (d) => void (d.ctx.structured = d.s.structured),
        landed: (b) => !!asObj(b.text)?.format,
      },
      messages: {
        apply: (d) => void (d.ctx.structured = d.s.structured),
        landed: (b) => !!asObj(b.output_config)?.format,
      },
      gemini: {
        // gemini 的结构化输出不经能力表，走 generationConfig 的 enum + object 通道。
        apply: (d) => {
          (d.ctx.enums ??= {}).responseMimeType = 'application/json';
          (d.ctx.objects ??= {}).responseSchema = parseSchemaSafe(d.s.structured.schema);
          d.allow('responseMimeType', 'responseSchema');
        },
        landed: (b) => !!genCfg(b).responseMimeType && !!genCfg(b).responseSchema,
      },
    },
  },
  {
    // 必须排在 structured-output-json 之后：responses 的 verbosity 依赖它。
    key: 'verbosity',
    label: 'Verbosity',
    put: {
      chat: {
        apply: (d) => {
          (d.ctx.enums ??= {}).verbosity = d.s.verbosity;
          d.allow('verbosity');
        },
        landed: (b) => !!b.verbosity,
      },
      responses: {
        // canon 报的字段是 `text.verbosity`。`text` 整组由结构化输出能力门控下发
        // （关掉能力还发残留子字段是个已修的 bug，不能为这里退回去），所以单勾 verbosity
        // 在 responses 上没有落点 —— 用 requires 显式表达，而不是让它静默不生效。
        requires: ['structured-output-json'],
        apply: (d) => {
          mergeGroup(d.ctx, 'text', { verbosity: d.s.verbosity });
        },
        landed: (b) => !!asObj(b.text)?.verbosity,
      },
    },
  },
  {
    key: 'vision',
    label: 'Vision (image input)',
    put: {
      chat: { apply: applyVision, landed: (b) => deepFind(b, (o) => 'image_url' in o) },
      responses: { apply: applyVision, landed: (b) => deepFind(b, (o) => o.type === 'input_image') },
      messages: { apply: applyVision, landed: (b) => deepFind(b, (o) => o.type === 'image') },
      gemini: {
        apply: applyVision,
        landed: (b) => deepFind(b, (o) => 'fileData' in o || 'inlineData' in o),
      },
    },
  },
  {
    key: 'explicit-cache',
    label: 'Explicit prompt cache',
    put: {
      messages: {
        apply: (d) => {
          d.ctx.sys = d.ctx.sys || d.s.system; // 缓存断点打在 system 块上，没 system 就打 user 块
          d.ctx.cache = true;
        },
        landed: (b) => deepFind(b, (o) => 'cache_control' in o),
      },
    },
    gap: {
      // 这三个的字段名 canon 给了（chat/responses 是 prompt_cache_options、gemini 是
      // cachedContent），但**形状没给** —— 前者是网关自定义字段、后者要先建一个 cache 资源
      // 再引用它的资源名。凭字段名猜形状会产出跑不通的示例，宁可显式报缺口。
      chat: 'Explicit cache on chat/completions needs a gateway-specific prompt_cache_options payload whose shape is not modeled here yet.',
      responses:
        'Explicit cache on responses needs a gateway-specific prompt_cache_options payload whose shape is not modeled here yet.',
      gemini:
        'Gemini explicit cache requires creating a cachedContent resource first and referencing its name; that two-step flow is out of scope for a single snippet.',
    },
  },
  {
    key: 'cache-routing-key',
    label: 'Cache routing key',
    put: {
      chat: {
        apply: (d) => {
          (d.ctx.enums ??= {}).prompt_cache_key = d.s.cacheKey;
          d.allow('prompt_cache_key');
        },
        landed: (b) => !!b.prompt_cache_key,
      },
      responses: {
        apply: (d) => {
          (d.ctx.enums ??= {}).prompt_cache_key = d.s.cacheKey;
          d.allow('prompt_cache_key');
        },
        landed: (b) => !!b.prompt_cache_key,
      },
    },
  },
  {
    key: 'background-mode',
    label: 'Background mode',
    put: {
      responses: {
        apply: (d) => {
          (d.ctx.objects ??= {}).background = true;
          d.allow('background');
        },
        landed: (b) => b.background === true,
      },
    },
  },
];

/** 按 key 取能力定义（未知 key 返回 undefined，调用方按 unknown-capability 处理）。 */
export function capabilityPut(key: string): CapabilityPutDef | undefined {
  return CAPABILITY_PUTS.find((c) => c.key === key);
}
