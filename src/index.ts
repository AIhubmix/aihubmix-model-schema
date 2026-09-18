/**
 * @aihubmix/model-schema —— canon 词汇层，唯一公共出口。
 *
 * ## 它和 @aihubmix/codegen 的分工（这是整个拆分的判据，改动前先读）
 *
 *   canon /model-data/*.json          ← 唯一源（知识库产物，**开集**，每周在长）
 *          │
 *          ▼  调用方取数（HTTP / 缓存 / 内容寻址路径）—— 两个包都不碰
 *   @aihubmix/model-schema            ← 本包：只认识 canon 的**词汇**
 *     · verdict → 可选性 / 等级 / 注释文案
 *     · 能力 key（reasoning-effort / vision / …）→ 往 ctx 上写什么
 *     · 按能力名索引的示例值
 *     · 代码协议 id ↔ canon 协议 id
 *          │
 *          ▼  只说 wire 词：CodeGenCtx（baseUrl / paramKeys / p / enums / objects / tools / …）
 *   @aihubmix/codegen                 ← 只认识 wire 与 7 门语言，**闭集**（4 个协议）
 *     · buildBody(proto, ctx) → RENDERERS[lang] → code
 *
 * 依赖方向是单向的：本包 import codegen，codegen **不** import 本包。codegen 里搜不到
 * 任何 canon 能力键 / verdict / canon 协议 id 字面量，这条由它自己的
 * `tests/vocabulary-isolation.test.ts` 机器守着 —— 不是靠约定。
 *
 * ## 本包不做的事
 *
 * - **不取数**：无网络、无 fs、无环境变量（isomorphic，要能被 node 预渲染脚本 require）。
 * - **不带 UI**：返回结构化 availability + notes，样式映射留给消费端。
 * - **不拼 body**：apply() 只改 ctx，body 恒由 codegen 的 buildBody 出，不存在第二份实现。
 */

// ---- verdict 语义 ----
export {
  NO_ENTRY_POLICY,
  UNKNOWN_VERDICT_POLICY,
  VERDICT_POLICY,
  verdictPolicy,
  type CapLevel,
  type Verdict,
  type VerdictPolicy,
} from './verdicts.js';

// ---- canon 协议 id 换算 ----
export { CANON_TO_PROTO, PROTO_TO_CANON } from './protocols.js';

// ---- 面（与四协议正交的第二维度，见 faces.ts）----
export { CANON_TO_FACE, FACE_TO_CANON, type FaceId, type ProtoOrFace } from './faces.js';

// ---- 示例值 ----
export { DEFAULT_SAMPLES, type CapabilitySamples } from './samples.js';

// ---- 能力 key → wire 形态 ----
export {
  CAPABILITY_PUTS,
  capabilityPut,
  type CapDraft,
  type CapPut,
  type CapabilityPutDef,
} from './catalog.js';

// ---- 能力键列表 → ctx → 同一个 buildBody / RENDERERS ----
export {
  generateFromCapabilities,
  type CapNoteCode,
  type CapabilityGenResult,
  type CapabilityNote,
  type CapabilityResolution,
  type CapabilityResolver,
  type CapabilityStatus,
  type FromCapabilitiesOpts,
} from './generate.js';

// ---- canon 投影 → 本包输入（纯解析，不取数） ----
export {
  NO_CANON_RESOLVER,
  canonEntry,
  usableVerdict,
  canonFaces,
  canonParams,
  canonProtocols,
  canonResolver,
  canonStandaloneOverrides,
  type CanonCapability,
  type CanonDomain,
  type CanonFaceView,
  type CanonField,
  type CanonFieldOverride,
  type CanonIndex,
  type CanonIndexEntry,
  type CanonModelDoc,
  type CanonParam,
  type CanonParamReason,
  type CanonProtocolEntry,
  type CanonProtocolView,
  type CanonReadOpts,
  type CanonStandaloneOverride,
  type CanonSubfieldOverride,
  type CanonVerdictSide,
} from './canon.js';
