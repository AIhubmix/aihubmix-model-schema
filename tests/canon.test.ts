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
import { CAPABILITY_PUTS } from '../src/catalog.js';
import { generateFromCapabilities, type CapabilityResolver } from '../src/generate.js';
import {
  NO_CANON_RESOLVER,
  canonEntry,
  canonFaces,
  canonParams,
  canonProtocols,
  canonResolver,
  canonStandaloneOverrides,
  usableVerdict,
  type CanonIndex,
  type CanonModelDoc,
} from '../src/canon.js';
import { CANON_TO_FACE } from '../src/faces.js';
import { CANON_TO_PROTO } from '../src/protocols.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'canon');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

const index = read<CanonIndex>('index.json');
const opus = read<CanonModelDoc>('claude-opus-5.9e8d2666.json');
const gpt = read<CanonModelDoc>('gpt-5.6-sol.92359903.json');
// 下面两份是 2026-08-14 原样下载的（schema 1.1.0，带 override 全挂载新结构）：
//   https://aihubmix.com/model-data/models/coding-glm-5.3.a3105283.json —— 字段级 subfield_overrides 的线上实例
//   https://aihubmix.com/model-data/models/grok-4.6.1b41e7ae.json —— 模型级 standalone_overrides 的线上实例（9 条）
// path 取自同日的 https://aihubmix.com/model-data/index.json。文件名去哈希存，避免每次内容变动都改测试代码。
const glm = read<CanonModelDoc>('coding-glm-5.3.json');
const grok = read<CanonModelDoc>('grok-4.6.json');
// gemini-3.7-flash（同日下载，https://aihubmix.com/model-data/models/gemini-3.7-flash.*.json）：
// 10 个 override 全部是传统 exact 挂载（无 subfield/standalone）的对照组 —— 用它钉
// 「新消费代码不扰动存量形态」。
const gem37 = read<CanonModelDoc>('gemini-3.7-flash.json');
// jev-1.13（2026-09-18 原样下载，https://aihubmix.com/model-data/models/jev-1.13.c175cf75.json）：
// 目前**唯一**一个不带任何四协议条目的模型 —— 4 条能力全挂在 `typesafe.systemone`
// （decision 面，`POST /v1/systemone`）。它是 face 维度的真实样本，也是「新面不污染
// canonProtocols()」这条向后兼容承诺的实证。
const jev = read<CanonModelDoc>('jev-1.13.json');
// gpt-6-luna（2026-10-09 原样下载，https://aihubmix.com/model-data/models/gpt-6-luna.728e3740.json，
// 同日 index 的 canon_git_sha 6cf8c126；文件 sha256 前 8 位即 728e3740，与内容寻址文件名一致）：
// 第一个**四协议与面并存**的模型 —— chat / responses / messages 之外，另有 6 条能力挂在
// `openai.decisions`（OpenAI Decisions，`POST /v1/decisions`）。
const luna = read<CanonModelDoc>('gpt-6-luna.json');

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

  it('basicGeneration 轴:claude-opus-5 的 gemini 是实测被拒,不该出 tab', () => {
    const byProto = Object.fromEntries(canonProtocols(opus).map((v) => [v.proto, v]));
    // chat/responses 零字段但 basic-generation 实测通过 → 可用(基础对话形式)
    expect(byProto.chat.basicGeneration).toBe('tested-effective');
    expect(usableVerdict(byProto.chat.basicGeneration)).toBe(true);
    // gemini 实测被拒 → 不可用,消费端据此不出协议 tab
    expect(byProto.gemini.basicGeneration).toBe('rejected-or-unsupported');
    expect(usableVerdict(byProto.gemini.basicGeneration)).toBe(false);
    // canon 没记 basic-generation 的按可用处理(fail-open)
    expect(usableVerdict(null)).toBe(true);
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

describe('面（face）维度：与四协议正交，两张词表互不重叠', () => {
  it('两张词表零交集 —— 一个 canon 协议 id 只会落在其中一边', () => {
    // 这条是 canonProtocols/canonFaces「返回值互不重叠」的前提。合并两张表（或往
    // PROTO_TO_CANON 里塞 decision）会先在这里红，而不是等到 playground 造出
    // endpoint: undefined 的畸形 schema 才发现。
    const overlap = Object.keys(CANON_TO_PROTO).filter((k) => k in CANON_TO_FACE);
    expect(overlap).toEqual([]);
  });

  it('jev 走 decision 面：canonProtocols 返回空数组（向后兼容的核心断言）', () => {
    // 下游靠「views 为空 ⇒ 没有 LLM 形态」做判断（playground canonSchema.ts 的
    // `if (!views.length) return null`）。新面一旦漏进四协议表，那里会拿到一个它不认识的
    // proto 去查 PROTO_TO_KIND，得到 undefined 且不报错。
    expect(canonProtocols(jev)).toEqual([]);
  });

  it('canonFaces(jev) 给出唯一的 decision 面，计数与真实投影对齐', () => {
    const faces = canonFaces(jev);
    expect(faces.map((f) => f.face)).toEqual(['decision']);
    expect(faces[0].canonProtocol).toBe('typesafe.systemone');
    expect(faces[0].capabilityCount).toBe(4);
    // fieldCount **不去重**（同一路径在多条能力下各记一次），canonParams 才按 path 收敛。
    // jev 是 8 / 6：`questions{}.criteria` 在 noul/choice/score 三条原语能力下各记了一次。
    expect(faces[0].fieldCount).toBe(8);
    // canon 没记 basic-generation 这条能力 → null（fail-open，与四协议同口径）。
    expect(faces[0].basicGeneration).toBe(null);
  });

  it('四协议模型的 canonFaces 是空的（反向不污染）', () => {
    for (const [name, doc] of [['opus', opus], ['gpt', gpt], ['gem37', gem37]] as const) {
      expect(canonFaces(doc), name).toEqual([]);
    }
  });

  it('canonParams(jev, "decision") 恰好 6 行，逐字核对路径与枚举', () => {
    const ps = canonParams(jev, 'decision');
    expect(ps.map((p) => p.path)).toEqual([
      'state',
      'model',
      'questions',
      'questions{}.type',
      'questions{}.instructions',
      'questions{}.criteria',
    ]);
    // 三原语枚举来自 canon，不是 codegen 写死的那份 —— 两边必须一致（同源缝在 wire 侧，
    // 这里钉的是知识库侧）。
    expect(ps.find((p) => p.path === 'questions{}.type')?.enum).toEqual(['noul', 'choice', 'score']);
    // 公网投影不带 aihubmix 轴 → 走 axisAbsent 分支判 unverified（可选 + 标注），
    // 不是 NO_ENTRY（不可选）。参数表要真的能渲染出这 6 行。
    for (const p of ps) {
      expect(p.verdict, p.path).toBe('unverified');
      expect(p.selectable, p.path).toBe(true);
    }
    // response 侧字段（answers{}.* / usage.* / detail[].*）不进参数面板。
    expect(ps.some((p) => p.path.startsWith('answers'))).toBe(false);
    expect(ps.some((p) => p.path.startsWith('usage'))).toBe(false);
  });

  it('按面取参数与按协议取参数互不串味', () => {
    // 面 id 去查四协议模型 → 空；协议 id 去查纯 decision 模型 → 空。
    expect(canonParams(gpt, 'decision')).toEqual([]);
    expect(canonParams(jev, 'chat')).toEqual([]);
    expect(canonParams(jev, 'responses')).toEqual([]);
  });

  it('四协议路径零漂移：加入面表前后，既有模型的取数逐字不变', () => {
    // 面表只多认识了 typesafe.systemone 一个键，四协议模型身上没有这个键，所以
    // canonProtocols/canonParams 的输出理应完全没动。这里用「协议数 + 各协议字段路径」
    // 做指纹，任何一处被面逻辑扰动都会红。
    // 下面这三份 snapshot 不是「新代码跑出来什么就存什么」—— 落盘前拿 0.1.4（引入 face
    // 之前那版 canon.ts）对同样三份 fixture 算了一遍，逐字相同才留下的。
    const fingerprint = (doc: CanonModelDoc) =>
      canonProtocols(doc)
        .map((v) => `${v.proto}:${v.capabilityCount}:${v.fieldCount}:${canonParams(doc, v.proto).map((p) => p.path).join(',')}`)
        .sort();
    expect(fingerprint(opus)).toMatchSnapshot('opus');
    expect(fingerprint(gpt)).toMatchSnapshot('gpt-5.6-sol');
    expect(fingerprint(gem37)).toMatchSnapshot('gemini-3.7-flash');
  });
});

describe('openai-decision 面：四协议与面并存（gpt-6-luna）', () => {
  it('canonFaces(luna) 给出唯一的 openai-decision 面，计数与真实投影对齐', () => {
    const faces = canonFaces(luna);
    expect(faces.map((f) => f.face)).toEqual(['openai-decision']);
    expect(faces[0].canonProtocol).toBe('openai.decisions');
    // 6 条能力：structured-decision + predicate / choice / score 三题型 + vision + retention-metadata。
    expect(faces[0].capabilityCount).toBe(6);
    // 只数顶层 body 字段（model / input / questions / safety_identifier）：`questions[].*`
    // 这类带 `[]` 的嵌套路径是结构不是可填的参数，answers / usage 是响应侧，都不进面板。
    expect(faces[0].fieldCount).toBe(4);
    expect(faces[0].basicGeneration).toBe(null);
  });

  it('canonProtocols(luna) 仍只给它的三个对话协议 —— 面不漏进四协议视图', () => {
    // 消费端（inferera-web 详情页、playground）靠 canonProtocols 出对话协议 tab；面漏进来
    // 就会拿一个它不认识的 proto 去查 Record<CodeProto, X>。
    expect(canonProtocols(luna).map((v) => v.proto).sort()).toEqual(['chat', 'messages', 'responses']);
  });

  it('canonParams(luna, "openai-decision") 恰好 4 行顶层 body 字段', () => {
    const ps = canonParams(luna, 'openai-decision');
    // 顺序跟 canon 的 domain 顺序：service 域（retention-metadata）排在 media-generation 域之前。
    expect(ps.map((p) => p.path)).toEqual(['safety_identifier', 'model', 'input', 'questions']);
    // 公网投影不带 aihubmix 轴 → unverified（可选 + 标注），与 jev 同口径。
    for (const p of ps) {
      expect(p.verdict, p.path).toBe('unverified');
      expect(p.selectable, p.path).toBe(true);
    }
  });

  it('两个 decision 面互不串味：按 FaceId 取参数只命中自己那一面', () => {
    expect(canonParams(luna, 'decision')).toEqual([]);
    expect(canonParams(jev, 'openai-decision')).toEqual([]);
    expect(canonFaces(jev).map((f) => f.face)).toEqual(['decision']);
  });

  it('加面前后 luna 的四协议取数逐字不变', () => {
    // 落盘前拿 0.2.0（尚不认识 openai.decisions 的那版 faces.ts）对同一份 fixture 算了一遍，
    // 逐字相同才留下的 —— 证明加一条面映射没有扰动这个模型的对话协议面板。
    const fingerprint = canonProtocols(luna)
      .map((v) => `${v.proto}:${v.capabilityCount}:${v.fieldCount}:${canonParams(luna, v.proto).map((p) => p.path).join(',')}`)
      .sort();
    expect(fingerprint).toMatchSnapshot('gpt-6-luna');
  });
});

describe('公网投影撤 aihubmix 轴后的缺席语义（2026-08-04）', () => {
  it('条目在、aihubmix 块缺席 → unverified（可选+标注），不是 NO_ENTRY（不可选）', () => {
    const doc = JSON.parse(JSON.stringify(opus)) as typeof opus;
    for (const d of (doc as { domains?: Array<{ capabilities?: Array<{ protocols?: Array<Record<string, unknown>> }> }> }).domains ?? [])
      for (const c of d.capabilities ?? [])
        for (const pr of c.protocols ?? []) delete pr.aihubmix;
    const ps = canonParams(doc, 'messages');
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps.filter((x) => x.reason === 'ok' || x.reason === 'verdict')) {
      expect(p.verdict).toBe('unverified');
      expect(p.selectable).toBe(true);
    }
  });

  it('显式请求 official 轴时缺席仍是 null（语义不变）', () => {
    const doc = JSON.parse(JSON.stringify(opus)) as typeof opus;
    for (const d of (doc as { domains?: Array<{ capabilities?: Array<{ protocols?: Array<Record<string, unknown>> }> }> }).domains ?? [])
      for (const c of d.capabilities ?? [])
        for (const pr of c.protocols ?? []) delete pr.official;
    const ps = canonParams(doc, 'messages', { axis: 'official' });
    for (const p of ps) expect(p.verdict).toBe(null);
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

  it('同名字段只保留一条（canon 会在多条能力下各记一次）', () => {
    const paths = messagesParams.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('同路径结论冲突时可选压过不可选,与文档顺序无关(qwen responses reasoning.effort 的真实形状)', () => {
    // rejected 条目先到:原「先到先得」会把可用的那条吞掉 —— 面板凭空少一个参数
    const mk = (first: 'rejected-or-unsupported' | 'accepted-unverified', second: typeof first): CanonModelDoc => ({
      domains: [{ capabilities: [
        { key: 'thinking-toggle', protocols: [{ protocol: 'openai.responses', aihubmix: { verdict: first }, fields: [{ name: 'reasoning.effort' }] }] },
        { key: 'reasoning-effort', protocols: [{ protocol: 'openai.responses', aihubmix: { verdict: second }, fields: [{ name: 'reasoning.effort', enum: ['low', 'high'] }] }] },
      ] }],
    });
    for (const doc of [mk('rejected-or-unsupported', 'accepted-unverified'), mk('accepted-unverified', 'rejected-or-unsupported')]) {
      const ps = canonParams(doc, 'responses');
      expect(ps).toHaveLength(1);
      expect(ps[0].selectable, '两种顺序都必须是可选那条赢').toBe(true);
    }
    // 同为不可选时不涉及择优,保留先到的(顺序稳定)
    const both = canonParams(mk('rejected-or-unsupported', 'rejected-or-unsupported'), 'responses');
    expect(both).toHaveLength(1);
    expect(both[0].selectable).toBe(false);
    expect(both[0].cap).toBe('thinking-toggle');
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

  it('字段级出处单独给，不与能力级的 verdict 出处混在一起', () => {
    // 展示面要的是**字段自己**那条 quote:canon 的 description 只有中文,
    // 双语站点的英文侧只能靠厂商英文原话。两条 official 语义不同,不能合并。
    const mt = canonParams(opus, 'messages').find((p) => p.path === 'max_tokens')!;
    expect(mt.fieldOfficial?.quote, 'max_tokens 在真数据里有厂商原话').toContain(
      'maximum number of tokens',
    );
    expect(mt.fieldOfficial?.source).toContain('http');
    // 覆盖率不满是常态(实测 12/25),拿不到就该是 undefined,不许拿能力级的顶上。
    const noQuote = canonParams(opus, 'messages').filter((p) => !p.fieldOfficial?.quote);
    expect(noQuote.length, '真数据里就该有一批字段没有 quote').toBeGreaterThan(0);
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

describe('override 全挂载（schema 1.1.0）：subfield_overrides 透传 + standalone_overrides 消费', () => {
  it('subfield_overrides 原样透传：path 在，父字段 enum 不被子路径值域污染（glm 的 chat thinking）', () => {
    const thinking = canonParams(glm, 'chat').find((p) => p.path === 'thinking');
    expect(thinking, '线上实例：coding-glm-5.3 chat 面的 thinking 带 subfield_overrides').toBeDefined();
    expect(thinking!.subfieldOverrides?.length).toBeGreaterThan(0);
    for (const so of thinking!.subfieldOverrides!) expect(so.path, 'path 是相对父字段的剩余路径').toBeTruthy();
    // 生产者契约：thinking.type 的 enum 属于**子路径**，不许提升为父字段本体的 enum/default。
    // 提升会把「type 只能是 enabled」错标成「thinking 只能是 enabled」。
    const sub = thinking!.subfieldOverrides!.find((s) => s.path === 'type');
    expect(sub?.enum?.length).toBeGreaterThan(0);
    expect(thinking!.enum, '父字段本体没有 enum，透传后也不该凭空长出来').toBeUndefined();
    expect(thinking!.default).toBeUndefined();
  });

  it('canonStandaloneOverrides：类型化清单 + 按协议过滤 + 空/缺席回 []', () => {
    const all = canonStandaloneOverrides(grok);
    expect(all.length, '线上实例：grok-4.6 带 standalone_overrides').toBeGreaterThan(0);
    for (const o of all) {
      expect(o.protocol, 'protocol 是 canon 协议 id').toBeTruthy();
      expect(o.field).toBeTruthy();
    }
    const chat = canonStandaloneOverrides(grok, 'chat');
    expect(chat.length).toBeGreaterThan(0);
    for (const o of chat) expect(o.protocol).toBe('openai.chat_completions');
    // 过滤是真过滤，不是全量照抄
    expect(chat.length).toBeLessThan(all.length);
    // 缺席（老投影 / 没有声明的模型）与空 doc 一律 []，调用方不用判空
    expect(canonStandaloneOverrides(opus)).toEqual([]);
    expect(canonStandaloneOverrides(null)).toEqual([]);
    expect(canonStandaloneOverrides(grok, 'gemini')).toEqual([]);
  });

  it('canonResolver 剔除 standalone 勿传字段：grok 的 standalone 字段名不出现在 resolver 输出', () => {
    const resolve = canonResolver(grok);
    const capKeys = (grok.domains ?? []).flatMap((d) => (d.capabilities ?? []).map((c) => c.key!)).filter(Boolean);
    for (const proto of ['chat', 'responses', 'messages', 'gemini'] as const) {
      const banned = new Set(
        canonStandaloneOverrides(grok, proto)
          .filter((o) => o.status === 'do-not-send' || o.status === 'unsupported-by-model')
          .map((o) => o.field),
      );
      for (const cap of capKeys) {
        for (const f of resolve(cap, proto)?.fields ?? []) {
          expect(banned.has(f), `${proto}/${cap}/${f} 是勿传字段，不该喂给代码生成`).toBe(false);
        }
      }
    }
  });

  it('canonResolver 剔除字段级 override.do-not-send（真数据：opus messages 的 temperature）', () => {
    // paramsOfEntry 会把它以「划掉」形态留在面板上（用户该看见为什么不可用），
    // 但 resolver 是喂**代码生成**的 —— 生成的请求体里出现它就是引导用户发 400。
    const r = canonResolver(opus)('sampling-deprecated', 'messages');
    expect(r).not.toBeNull();
    expect(r!.fields).not.toContain('temperature');
  });

  it('剔除逻辑合成 doc 全景：do-not-send/unsupported-by-model 剔、别协议的不剔、deprecated 不剔', () => {
    const doc: CanonModelDoc = {
      standalone_overrides: [
        { protocol: 'openai.chat_completions', field: 'logprobs', status: 'unsupported-by-model' },
        { protocol: 'openai.chat_completions', field: 'stop', status: 'do-not-send' },
        // 别的协议的声明不能误伤 chat
        { protocol: 'anthropic.messages', field: 'top_p', status: 'unsupported-by-model' },
      ],
      domains: [{ capabilities: [{ key: 'sampling', protocols: [{
        protocol: 'openai.chat_completions',
        aihubmix: { verdict: 'tested-effective' },
        fields: [
          { name: 'temperature' },
          { name: 'logprobs' },                                    // ② standalone unsupported-by-model → 剔
          { name: 'stop' },                                        // ② standalone do-not-send → 剔
          { name: 'top_p' },                                       // messages 侧的声明，chat 不剔
          { name: 'bad_field', override: { status: 'do-not-send' } }, // ① 字段级 do-not-send → 剔
          { name: 'old_knob', status: 'deprecated' },              // deprecated 是「能用但不建议」→ 不剔
        ],
      }] }] }],
    };
    expect(canonResolver(doc)('sampling', 'chat')!.fields).toEqual(['temperature', 'top_p', 'old_knob']);
  });
});

describe('对照组：只有 exact 挂载的模型（gemini-3.7-flash）不被新结构消费代码扰动', () => {
  const protos = ['chat', 'responses', 'messages', 'gemini'] as const;

  it('无 standalone、无 subfield：传统形态不凭空长出新结构', () => {
    expect(canonStandaloneOverrides(gem37)).toEqual([]);
    for (const proto of protos) {
      for (const p of canonParams(gem37, proto)) {
        expect(p.subfieldOverrides, `${proto}/${p.path} 不该有 subfieldOverrides`).toBeUndefined();
      }
    }
  });

  it('model-specific-enum 的收窄照常落到字段本体（存量行为回归）', () => {
    const narrowed = protos.flatMap((proto) =>
      canonParams(gem37, proto).filter((p) => p.override?.status === 'model-specific-enum'),
    );
    // 线上实例：serviceTier / reasoning_effort / service_tier 等 —— manifest 里 10 键中
    // 多数是 model-specific-enum，至少几条会以可见参数出现在面板上
    expect(narrowed.length).toBeGreaterThanOrEqual(3);
    for (const p of narrowed) {
      expect(p.enum, `${p.path} 的本体 enum 应等于 override.enum`).toEqual(p.override!.enum);
    }
  });

  it('resolver 不误剔：没有勿传声明的模型，字段全量喂给代码生成', () => {
    const resolve = canonResolver(gem37);
    const capKeys = (gem37.domains ?? []).flatMap((d) => (d.capabilities ?? []).map((c) => c.key!)).filter(Boolean);
    let total = 0;
    for (const proto of protos) for (const cap of capKeys) total += resolve(cap, proto)?.fields?.length ?? 0;
    expect(total, '无 standalone/do-not-send 的模型不该有任何字段被剔').toBeGreaterThan(0);
    // 抽查一条具体能力：reasoning-effort × chat 的 reasoning_effort 仍在
    expect(resolve('reasoning-effort', 'chat')?.fields).toContain('reasoning_effort');
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

describe('最基础对话形式：端到端（这是 374/380 个模型今天的产物）', () => {
  const ALL_CAPS = CAPABILITY_PUTS.map((p) => p.key);

  /** 三条会走到基础形式的路：canon 没这个模型、canon 有但该协议零字段、resolve 抛异常。 */
  const PATHS: [string, CapabilityResolver][] = [
    ['canon 未覆盖该模型', NO_CANON_RESOLVER],
    ['canon 覆盖但该协议零字段', canonResolver(opus)], // opus 的 chat/responses/gemini
    ['resolve 抛异常', () => { throw new Error('调用方的查表炸了'); }],
  ];

  for (const [label, resolve] of PATHS) {
    it(`${label} → 不注入任何能力,但仍出一段能跑的请求`, () => {
      for (const protocol of ['chat', 'responses', 'gemini'] as const) {
        const r = generateFromCapabilities({
          model: 'claude-opus-5', protocol, lang: 'curl',
          capabilities: ALL_CAPS, baseUrl: 'https://aihubmix.com', resolve,
        });
        // 一条能力都不许落地 —— 查不到就不猜,这正是兜底的定义。
        expect(r.used, `${label}/${protocol}`).toEqual([]);
        // 但不是空产物:模型 + 一条用户消息必须在,否则页面上就是个空代码块。
        expect(r.code, `${label}/${protocol}`).toContain('claude-opus-5');
        expect(r.code, `${label}/${protocol}`).toContain('Hello');
        // gemini 的模型 id 在 URL 路径里（/gemini/v1beta/models/{model}:generateContent）,
        // 不在 body 里 —— 所以只对另外三个协议查 body。
        if (protocol !== 'gemini') {
          expect(JSON.stringify(r.body), `${label}/${protocol}`).toContain('claude-opus-5');
        }
        expect(r.code.length).toBeGreaterThan(50);
        // 每条能力都得有说法,不能静默消失。
        for (const cap of ALL_CAPS) expect(r.availability[cap], `${label}/${protocol}/${cap}`).toBeDefined();
      }
    });
  }

  it('resolve 抛异常只影响记账,不掀掉整次生成', () => {
    const r = generateFromCapabilities({
      model: 'gpt-4o', protocol: 'chat', lang: 'curl', capabilities: ALL_CAPS,
      baseUrl: 'https://aihubmix.com', resolve: () => { throw new Error('boom'); },
    });
    expect(r.code).toContain('gpt-4o');
    for (const cap of ALL_CAPS) expect(r.availability[cap].reason, cap).toBe('resolver-error');
  });

  it('兜底与 canon 命中走的是同一个 buildBody（没有第二份实现）', () => {
    // 兜底路径最容易被写成「另拼一个简单 body」,那样「Get Code == 真实请求」就断了。
    // 判据:两条路的 body 都带 model,且 code 里出现的就是 body 里的那个值。
    const hit = generateFromCapabilities({
      model: 'claude-opus-5', protocol: 'messages', lang: 'curl', capabilities: ALL_CAPS,
      baseUrl: 'https://aihubmix.com', resolve: canonResolver(opus),
    });
    const miss = generateFromCapabilities({
      model: 'claude-opus-5', protocol: 'messages', lang: 'curl', capabilities: ALL_CAPS,
      baseUrl: 'https://aihubmix.com', resolve: NO_CANON_RESOLVER,
    });
    expect(hit.used.length).toBeGreaterThan(0);
    expect(miss.used).toEqual([]);
    for (const r of [hit, miss]) {
      expect(r.body.model).toBe('claude-opus-5');
      // messages 协议 max_tokens 是**必填**（Anthropic 硬要求），所以两条路都必须有它 ——
      // 「基础形式 = 只有 model + messages」那句话在这个协议上做不到,也不该做到。
      expect(r.body.max_tokens, 'messages 缺 max_tokens 会 400').toBeTypeOf('number');
    }
  });
});
