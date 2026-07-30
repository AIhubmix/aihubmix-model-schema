/**
 * 能力注入层的示例值 —— 纯数据，调用方可整体覆盖。
 *
 * 与 codegen 的 `config/placeholders.ts` 的分工：placeholders 是「代码里必须留空让用户填」
 * 的占位（API key、base64 截断符），那是 wire 事实、住 codegen；这里是「为了让示例能直接
 * 跑通而预填的真实取值」，**按 canon 能力名索引**（effort / thinkingBudget / imageUrl…），
 * 所以住 model-schema。两者都是常量，但一个是给用户替换的、一个是照抄就能跑的。
 *
 * 后续方向（不在本刀）：canon 的 `field.enum` / `field.default` / `field.range` 本来就带
 * 取值信息，示例值应当从那里推，而不是在这里写死一份。这张表是过渡期的兜底。
 */
import type { StructuredCfg, ToolDef } from '@aihubmix/codegen';

export interface CapabilitySamples {
  /** system-instruction 的示例 system prompt。 */
  system: string;
  /** 纯文本示例的用户提问。 */
  user: string;
  /** 勾了 vision 时换成的提问（问的是图，不能还问文本那句）。 */
  imagePrompt: string;
  /** output-limit 的示例上限。 */
  maxTokens: number;
  /** reasoning-effort 的示例档位。 */
  effort: string;
  /**
   * messages 协议 `thinking:{type:'enabled'}` 的示例预算。
   *
   * Anthropic 要求：该字段**必填**、下限 1024、且必须小于 max_tokens。缺了它请求直接 400 ——
   * playground 那边是参数面板填，Quickstart 没有面板，只能给个能跑的默认值。
   */
  thinkingBudget: number;
  /** verbosity 的示例取值。 */
  verbosity: string;
  /** vision 的示例图片（http URL；四协议都支持 url 形态）。 */
  imageUrl: string;
  imageMime: string;
  /** cache-routing-key 的示例路由键。 */
  cacheKey: string;
  /** function-calling 的示例工具。 */
  tools: ToolDef[];
  /** structured-output-json 的示例 schema。 */
  structured: StructuredCfg;
}

export const DEFAULT_SAMPLES: CapabilitySamples = {
  system: 'You are a helpful assistant.',
  user: 'Hello, how are you?',
  imagePrompt: 'What is in this image?',
  maxTokens: 1024,
  effort: 'medium',
  thinkingBudget: 2048,
  verbosity: 'low',
  // 用 example.com：它是 RFC 2606 保留域名，永远不会变成别人的站，也不会给谁刷流量。
  // 用户照抄要换成自己的图 —— 这条示例的重点是 wire 形态，不是图本身。
  imageUrl: 'https://example.com/photo.jpg',
  imageMime: 'image/jpeg',
  cacheKey: 'my-cache-key',
  tools: [
    {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: JSON.stringify({
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      }),
    },
  ],
  structured: {
    format: 'json_schema',
    name: 'answer',
    schema: JSON.stringify({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }),
  },
};
