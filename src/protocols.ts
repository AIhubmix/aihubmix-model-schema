import type { CodeProto } from '@aihubmix/codegen';

/**
 * 代码协议 id ↔ canon 协议 id。
 *
 * **为什么住这儿而不是 codegen**：`'openai.chat_completions'` 是 canon（AIHubMix 模型知识库）
 * 的词，不是 wire 词 —— 它从来不出现在发给网关的 HTTP body 里。codegen 只认识 4 个短 id
 * 与它们的路由/鉴权/body 形态；canon 怎么给协议起名是知识库那侧的事，改名不该逼 codegen 发版。
 *
 * codegen 里留下的 `KIND_TO_PROTO`（网关 schema 的 endpoint.kind）与 `ENDPOINT_TO_PROTO`
 * （模型库 `mdl_info.endpoints`）是**另外两套**词表，喂的数据源不同，且今天各有真实消费端；
 * 它们不含 canon 词，所以不跟着搬。三套词表都不合并 —— 合并会让任一方改名时静默漏协议。
 */
export const PROTO_TO_CANON: Record<CodeProto, string> = {
  chat: 'openai.chat_completions',
  responses: 'openai.responses',
  messages: 'anthropic.messages',
  gemini: 'google.gemini',
};

/** canon 协议 id → 代码协议 id（PROTO_TO_CANON 的反表，自动导出，不手写第二份）。 */
export const CANON_TO_PROTO: Record<string, CodeProto> = Object.fromEntries(
  Object.entries(PROTO_TO_CANON).map(([proto, canon]) => [canon, proto as CodeProto]),
) as Record<string, CodeProto>;
