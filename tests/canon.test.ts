/**
 * canon 适配层 —— 断言全部打在**真实投影**上，不打在我脑补的形状上。
 *
 * `tests/fixtures/canon/` 里是 2026-07-30 从 `https://aihubmix.com/model-data/` 原样下载的
 * index + 两个 per-model 文件，一个字节都没删。为什么不写手搓的小 fixture：这一层的全部风险
 * 就在「真实数据长得和我以为的不一样」——手搓 fixture 会把我的假设固化成测试，两边一起错。
 *
 * 两个模型是特意挑的互补样本：
 *   - `claude-opus-5` —— 宣称 4 个协议，**只有 messages 有字段**（其余三个是「能用但没有
 *     可调参数记录」）。还带着投影里唯一一条 `override.status = do-not-send`。
 *   - `gpt-5.6-sol` —— chat 与 responses 都有大量字段，是「全量面板」那条路。
 *
 * 代价是这份快照不会自动跟着 canon 变。所以下面**不断言具体数字**（字段数、能力数），
 * 只断言**结构性质**（有/没有、顺序、冲突时谁赢）—— canon 填充新模型时这些仍该成立。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NO_CANON_RESOLVER,
  canonEntry,
  canonParams,
  canonProtocols,
  canonResolver,
  type CanonIndex,
  type CanonModelDoc,
} from '../src/canon.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'canon');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

const index = read<CanonIndex>('index.json');
const opus = read<CanonModelDoc>('claude-opus-5.9e8d2666.json');
const gpt = read<CanonModelDoc>('gpt-5.6-sol.92359903.json');

describe('index：必须走 entry.path，不许自己拼', () => {
  it('按 id 找得到条目', () => {
    expect(canonEntry(index, 'claude-opus-5')?.id).toBe('claude-opus-5');
    expect(canonEntry(index, '不存在的模型')).toBeNull();
    expect(canonEntry(null, 'claude-opus-5')).toBeNull();
  });

  it('path 是内容寻址的，拼 models/{id}.json 一定 404', () => {
    // 这条不是在测我们的代码，是把「为什么必须用 path」钉成可执行的事实：
    // 有人图省事拼 id 时，这里会提醒他文件名带哈希。
    const e = canonEntry(index, 'claude-opus-5');
    expect(e?.path).toMatch(/^models\/claude-opus-5\.[0-9a-f]+\.json$/);
    expect(e?.path).not.toBe('models/claude-opus-5.json');
  });
});

describe('协议维度：「宣称支持」与「有可调参数」是两件事', () => {
  it('claude-opus-5 宣称 4 个协议，但只有 messages 有字段', () => {
    const views = canonProtocols(opus);
    expect(views.map((v) => v.proto).sort()).toEqual(['chat', 'gemini', 'messages', 'responses']);
    const byProto = Object.fromEntries(views.map((v) => [v.proto, v]));
    expect(byProto.messages.fieldCount).toBeGreaterThan(0);
    // 这三个协议 canon 说能用（aihubmix 轴 tested-effective），但没有任何字段记录 ——
    // UI 要据此走「最基础对话形式」，而不是渲染一个空面板。
    for (const p of ['chat', 'responses', 'gemini'] as const) {
      expect(byProto[p].capabilityCount, p).toBeGreaterThan(0);
      expect(byProto[p].fieldCount, p).toBe(0);
    }
  });

  it('gpt-5.6-sol 的 chat 与 responses 都有字段（全量面板那条路）', () => {
    const byProto = Object.fromEntries(canonProtocols(gpt).map((v) => [v.proto, v]));
    expect(byProto.chat.fieldCount).toBeGreaterThan(0);
    expect(byProto.responses.fieldCount).toBeGreaterThan(0);
  });

  it('canon 有、codegen 没有的协议（dashscope）直接不出现，不报错', () => {
    const fake: CanonModelDoc = {
      domains: [{ capabilities: [{ key: 'x', protocols: [
        { protocol: 'dashscope', aihubmix: { verdict: 'tested-effective' }, fields: [{ name: 'foo' }] },
        { protocol: 'openai.chat_completions', aihubmix: { verdict: 'tested-effective' }, fields: [{ name: 'bar' }] },
      ] }] }],
    };
    expect(canonProtocols(fake).map((v) => v.proto)).toEqual(['chat']);
  });

  it('空 / null doc 不炸，返回空列表', () => {
    expect(canonProtocols(null)).toEqual([]);
    expect(canonProtocols({})).toEqual([]);
    expect(canonParams(undefined, 'chat')).toEqual([]);
  });
});

describe('参数面板：哪些字段能进', () => {
  const messagesParams = canonParams(opus, 'messages');

  it('扁平与点路径都进，模式字段不进', () => {
    expect(messagesParams.length).toBeGreaterThan(0);
    expect(messagesParams.some((p) => p.path === 'temperature')).toBe(true);
    expect(messagesParams.some((p) => p.path.includes('.'))).toBe(true); // 点路径确有
    // 模式字段（messages[].content[].type=image 这类）描述的是结构不是路径，
    // 放进取值框只会得到一个填不了的输入。
    for (const p of messagesParams) expect(p.path, p.path).not.toMatch(/[[\]=]/);
  });

  it('同名字段只保留第一条（canon 会在多条能力下各记一次）', () => {
    const paths = messagesParams.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('每项都带得回 canon 能力 key，UI 才能分组', () => {
    for (const p of messagesParams) expect(p.cap, p.path).not.toBe('');
  });
});

describe('可选性：字段级硬信号压过能力级 verdict', () => {
  it('override.do-not-send 直接不可选（投影里唯一一条：opus 的 temperature）', () => {
    // 这条最能说明为什么不能只看 verdict：temperature 所属能力的 aihubmix verdict
    // 并不是「不可用」，但 canon 专门给这个模型打了补丁说别发。放进面板 = 引导用户发 400。
    const temp = canonParams(opus, 'messages').find((p) => p.path === 'temperature');
    expect(temp).toBeDefined();
    expect(temp!.override?.status).toBe('do-not-send');
    expect(temp!.selectable).toBe(false);
    expect(temp!.reason).toBe('override-do-not-send');
    expect(temp!.level).toBe('unsupported');
  });

  it('deprecated 字段不可选', () => {
    const doc: CanonModelDoc = {
      domains: [{ capabilities: [{ key: 'sampling', protocols: [{
        protocol: 'openai.chat_completions',
        aihubmix: { verdict: 'tested-effective' },
        fields: [{ name: 'old_knob', status: 'deprecated' }, { name: 'new_knob' }],
      }] }] }],
    };
    const ps = canonParams(doc, 'chat');
    expect(ps.find((p) => p.path === 'old_knob')!.selectable).toBe(false);
    expect(ps.find((p) => p.path === 'old_knob')!.reason).toBe('deprecated');
    expect(ps.find((p) => p.path === 'new_knob')!.selectable).toBe(true);
  });

  it('model-specific 的 default / enum 覆盖掉通用值', () => {
    // canon 说「这个模型上默认是 high」时，面板得显示 high，不是协议通用默认。
    const effort = canonParams(opus, 'messages').find((p) => p.path === 'output_config.effort');
    expect(effort?.override?.status).toBe('model-specific-default');
    expect(effort?.default).toBe('high');

    const thinking = canonParams(opus, 'messages').find((p) => p.path === 'thinking');
    expect(thinking?.override?.status).toBe('model-specific-enum');
    expect(thinking?.enum).toEqual(['adaptive', 'disabled']);
  });

  it('非 body 字段不进面板', () => {
    const doc: CanonModelDoc = {
      domains: [{ capabilities: [{ key: 'x', protocols: [{
        protocol: 'openai.chat_completions',
        aihubmix: { verdict: 'tested-effective' },
        fields: [{ name: 'in_body', location: 'body' }, { name: 'in_header', location: 'header' }],
      }] }] }],
    };
    expect(canonParams(doc, 'chat').map((p) => p.path)).toEqual(['in_body']);
  });
});

describe('verdict 取哪条轴：默认 aihubmix，且这是有数据支撑的选择', () => {
  // 两条轴恒同时存在（实测 300/300）。取「较严的那条」看着安全，实则会把网关的跨协议
  // 转译整片划掉 —— 下面这个 ctx 就是真实冲突的形状：厂商文档里没这回事
  // （official=not-applicable），但 AIHubMix 转译之后实测能用（aihubmix=tested-effective）。
  const crossProtocol: CanonModelDoc = {
    domains: [{ capabilities: [{ key: 'basic-generation', protocols: [{
      protocol: 'openai.responses',
      official: { verdict: 'not-applicable', source: 'https://example.invalid/docs' },
      aihubmix: { verdict: 'tested-effective' },
      fields: [{ name: 'max_output_tokens' }],
    }] }] }],
  };

  it('默认按 aihubmix：转译出来的能力仍然可选', () => {
    const p = canonParams(crossProtocol, 'responses')[0];
    expect(p.verdict).toBe('tested-effective');
    expect(p.selectable).toBe(true);
    expect(p.level).toBe('ok');
  });

  it('official 侧仍随行返回，供展示出处', () => {
    const p = canonParams(crossProtocol, 'responses')[0];
    expect(p.official?.verdict).toBe('not-applicable');
    expect(p.official?.source).toBeTruthy();
  });

  it('显式切到 official 轴时结论翻面（对照视图用，不是日常路径）', () => {
    const p = canonParams(crossProtocol, 'responses', { axis: 'official' })[0];
    expect(p.verdict).toBe('not-applicable');
    expect(p.selectable).toBe(false);
  });
});

describe('resolver：喂给 generateFromCapabilities', () => {
  const resolve = canonResolver(opus);

  it('命中的能力带回 fields 与 verdict', () => {
    const r = resolve('system-instruction', 'messages');
    expect(r).not.toBeNull();
    expect(r!.fields).toContain('system');
    expect(r!.verdict).toBeTruthy();
  });

  it('没记录的返回 null —— 上游据此「不猜」，不是当成支持', () => {
    expect(resolve('function-calling', 'chat')).toBeNull();   // opus 的 chat 零字段
    expect(resolve('根本不存在的能力', 'messages')).toBeNull();
  });

  it('契约要求不抛异常：脏 doc 也只是查不到', () => {
    const dirty = canonResolver({ domains: [{ capabilities: [{ protocols: [{}] }] }] } as CanonModelDoc);
    expect(() => dirty('vision', 'chat')).not.toThrow();
    expect(dirty('vision', 'chat')).toBeNull();
    expect(() => canonResolver(null)('vision', 'chat')).not.toThrow();
  });

  it('fields 里不掺模式字段（那不是可写路径）', () => {
    for (const cap of ['vision', 'multimodal-input', 'explicit-cache', 'function-calling']) {
      const r = resolve(cap, 'messages');
      for (const f of r?.fields ?? []) expect(f, `${cap} → ${f}`).not.toMatch(/[[\]=]/);
    }
  });
});

describe('canon 未覆盖的模型：今天 374/380 走的就是这条', () => {
  it('NO_CANON_RESOLVER 对任何能力都答「没有记录」', () => {
    for (const cap of ['reasoning-effort', 'vision', 'function-calling', 'streaming']) {
      for (const proto of ['chat', 'messages', 'responses', 'gemini'] as const) {
        expect(NO_CANON_RESOLVER(cap, proto), `${cap}/${proto}`).toBeNull();
      }
    }
  });
});
