/**
 * verdict 表 vs canon 公开投影里**实际出现**的取值。
 *
 * 这条测试挡的是一个很安静的失败：`verdictPolicy()` 对表外取值走 fail-open 兜底
 * （UNKNOWN_VERDICT_POLICY，可选 + 标未证实）。fail-open 本身是故意的 —— canon 加新 verdict
 * 时老版本包不该把用户能用的能力划掉。但代价是**漏一个取值不会报错**，只会让那一档的文案
 * 变成「Unrecognized verdict」，界面上看着像正常运行。
 *
 * 实测过一次就知道这不是假想：本表最初照着 `aihubmix` 轴写，漏掉了 `official` 轴专属的
 * `official-model-level` 与 `spec-only`，而前者是整个 canon 里出现次数最多的 verdict
 * （6 个模型 174 次）。调用方只要按 official 轴取值，界面上大半条目都会显示成「未知 verdict」。
 *
 * 下面的两份清单是 2026-07-30 对 `https://aihubmix.com/model-data/` 全量 6 个模型
 * （294 条 field 记录、约 600 条 verdict）跑出来的**实测全集**，按轴分开记。
 * 本包不联网（isomorphic 约束），所以清单是静态快照，不是运行时抓的 —— canon 新增取值时
 * 这里不会自动变红，要靠重新测量来更新。因此重点是下面第三条：**两条轴的取值都必须在表里**，
 * 谁都不许落进 UNKNOWN 兜底。
 */
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_VERDICT_POLICY,
  VERDICT_POLICY,
  verdictPolicy,
  type Verdict,
} from '../src/verdicts.js';

/** aihubmix.verdict —— 本网关实测轴。可选性的权威。 */
const AIHUBMIX_AXIS: Verdict[] = [
  'tested-effective',
  'accepted-unverified',
  'unverified',
  'silent-degrade',
  'rejected-or-unsupported',
  'not-applicable',
];

/** official.verdict —— 厂商文档轴。出处，不是网关行为。 */
const OFFICIAL_AXIS: Verdict[] = [
  'official-model-level',
  'spec-only',
  'unverified',
  'not-applicable',
  'rejected-or-unsupported',
  'do-not-send',
];

describe('verdict 表覆盖 canon 两条轴的实测取值', () => {
  it('aihubmix 轴的每个取值都在表里（不落 UNKNOWN 兜底）', () => {
    for (const v of AIHUBMIX_AXIS) {
      expect(VERDICT_POLICY[v], v).toBeDefined();
      expect(verdictPolicy(v), v).not.toBe(UNKNOWN_VERDICT_POLICY);
    }
  });

  it('official 轴的每个取值都在表里（曾经漏了最常见的那个）', () => {
    for (const v of OFFICIAL_AXIS) {
      expect(VERDICT_POLICY[v], v).toBeDefined();
      expect(verdictPolicy(v), v).not.toBe(UNKNOWN_VERDICT_POLICY);
    }
  });

  it('表里没有实测数据之外的取值（多出来的说明是臆造的，删掉或说明出处）', () => {
    const measured = new Set<string>([...AIHUBMIX_AXIS, ...OFFICIAL_AXIS]);
    const extra = Object.keys(VERDICT_POLICY).filter((k) => !measured.has(k));
    expect(extra, `这些 verdict 在 canon 公开投影里没出现过：${extra.join(', ')}`).toEqual([]);
  });
});

describe('verdict → 策略的语义约束', () => {
  it('只有本网关实测生效才给 ok —— 厂商文档背书最高只到 unverified', () => {
    // 「HTTP 200 ≠ 生效」的同一条道理：official-model-level 说的是厂商文档怎么写，
    // 不是这个字段在 AIHubMix 上真的有可观测行为差异。给 ok 就是拿文档冒充实测。
    expect(VERDICT_POLICY['tested-effective'].level).toBe('ok');
    for (const v of ['official-model-level', 'spec-only'] as const) {
      expect(VERDICT_POLICY[v].level, v).toBe('unverified');
    }
    const okOnes = Object.entries(VERDICT_POLICY)
      .filter(([, p]) => p.level === 'ok')
      .map(([k]) => k);
    expect(okOnes, 'ok 这一档只该有 tested-effective 一个').toEqual(['tested-effective']);
  });

  it('不可选的一档不许同时被当成可用（selectable 与 level 不许自相矛盾）', () => {
    for (const [v, p] of Object.entries(VERDICT_POLICY)) {
      if (!p.selectable) expect(p.level, v).toBe('unsupported');
      if (p.level === 'unsupported') expect(p.selectable, v).toBe(false);
    }
  });

  it('只有静默降级值得占用一行代码注释', () => {
    // inCodeComment 会把文案插进用户复制走的代码里。silent-degrade 是唯一「请求成功、
    // 字段被忽略」的一档 —— 不写在代码里用户根本无从发现。其余的要么界面上已经划掉，
    // 要么是信息级，不该污染示例。
    const commented = Object.entries(VERDICT_POLICY)
      .filter(([, p]) => p.inCodeComment)
      .map(([k]) => k);
    expect(commented).toEqual(['silent-degrade']);
  });

  it('未知取值仍走 fail-open（新 canon verdict 不该把能力划掉）', () => {
    const p = verdictPolicy('brand-new-verdict-from-the-future' as Verdict);
    expect(p).toBe(UNKNOWN_VERDICT_POLICY);
    expect(p.selectable).toBe(true);
    expect(p.level).toBe('unverified');
  });

  it('没有记录时不猜：直接不可选', () => {
    expect(verdictPolicy(null).selectable).toBe(false);
    expect(verdictPolicy(undefined).level).toBe('unsupported');
  });
});
