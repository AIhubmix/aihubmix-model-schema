import type { CodeProto } from '@aihubmix/codegen';

/**
 * 面（face）id ↔ canon 协议 id。**与 `protocols.ts` 的四协议词表并列，永不合并。**
 *
 * ## 什么是「面」
 *
 * canon 里一个模型的能力挂在 `capabilities[].protocols[].protocol` 上，这个字段的取值
 * 并不全是「四协议」：`typesafe.systemone` 是 TypeSafe System One 的决策端点
 * （`POST /v1/systemone`，请求体 `{model, state, questions}`，返回类型化答案而非文本流）。
 * 它与 chat/responses/messages/gemini **不是同一维度上的第五个取值** —— 那四个是「同一件事
 * （生成文本）的四种协议写法」，互为替代；decision 是另一件事，没有替代关系。
 *
 * 所以面是与 `CodeProto` **正交的第二维度**。「面」这个词取自 canon 的 `endpoints[].face`，
 * 但注意两边存的**不是同一层的 id**：canon 的 `face` 存的是 canon 协议 id
 * （`"typesafe.systemone"`），本包的 `FaceId` 是它的短 id（`'decision'`，取自同条 endpoint 的
 * `modality`）—— 与 `CodeProto` 的 `'chat'` ↔ `'openai.chat_completions'` 完全同构。
 * 短 id 归代码、长 id 归知识库，这条分界和 `protocols.ts` 是同一条。
 *
 * ## 为什么不能把 `'decision'` 塞进 `CodeProto`
 *
 * 不是洁癖，是下游会当场造出畸形数据。`CodeProto` 是 codegen 渲染器二维表
 * （协议 × 语言）的索引，也是消费端一票 `Record<CodeProto, X>` 查找表的键 —— playground
 * `canonSchema.ts` 拿 `canonProtocols()` 的返回值去查 `PROTO_TO_KIND[v.proto]` /
 * `PROTO_ROUTES[v.proto]`，混进一个它不认识的 proto 就得到 `endpoint: undefined` 的 schema，
 * 且不报错。两张表分开之后，`canonProtocols()` 的返回值恒是四协议闭集，那条路径不用改也不会坏。
 *
 * ## 加新面时改哪里
 *
 * 只改这个文件（加一条映射 + 扩 `FaceId` 联合类型）。`canonFaces()` / `canonParams()` 是
 * 表驱动的，不认识具体的面。**不要**同时往 `PROTO_TO_CANON` 里加 —— 那会让
 * `canonProtocols()` 开始吐新面，正是上面那条要防的事。
 */
export type FaceId = 'decision';

export const FACE_TO_CANON: Record<FaceId, string> = {
  decision: 'typesafe.systemone',
};

/** canon 协议 id → 面 id（`FACE_TO_CANON` 的反表，自动导出，不手写第二份）。 */
export const CANON_TO_FACE: Record<string, FaceId> = Object.fromEntries(
  Object.entries(FACE_TO_CANON).map(([face, canon]) => [canon, face as FaceId]),
) as Record<string, FaceId>;

/**
 * 「四协议之一，或某个面」。只用在**按 id 取参数**这类两者都成立的地方
 * （`canonParams`）；返回值形状仍然分开（`CanonProtocolView` / `CanonFaceView`），
 * 否则调用方又得在运行时判这是协议还是面。
 */
export type ProtoOrFace = CodeProto | FaceId;
