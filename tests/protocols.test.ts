/**
 * canon 协议 id 换算 —— 从 @aihubmix/codegen 搬过来的那一段（原 tests/vocab.test.ts）。
 *
 * codegen 那边还留着另外两套词表（endpoint.kind / mdl_info.endpoints）及其测试；
 * 三套不合并，理由见 src/protocols.ts 的注释。
 */
import { describe, expect, it } from 'vitest';
import { CANON_TO_PROTO, PROTO_TO_CANON } from '../src/index.js';

describe('PROTO_TO_CANON（canon 投影的 protocol 字段）', () => {
  it('四协议都有 canon 全名', () => {
    expect(PROTO_TO_CANON.chat).toBe('openai.chat_completions');
    expect(PROTO_TO_CANON.responses).toBe('openai.responses');
    expect(PROTO_TO_CANON.messages).toBe('anthropic.messages');
    expect(PROTO_TO_CANON.gemini).toBe('google.gemini');
  });

  it('反表由正表自动导出，来回转换是恒等 —— 不手写第二份', () => {
    for (const [proto, canon] of Object.entries(PROTO_TO_CANON)) {
      expect(CANON_TO_PROTO[canon]).toBe(proto);
    }
    expect(Object.keys(CANON_TO_PROTO)).toHaveLength(Object.keys(PROTO_TO_CANON).length);
  });
});
