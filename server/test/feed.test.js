import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBound, analyzeFeed } from '../chem/feed.js';

// 便于书写分数断言
const fr = (n, d = 1) => ({ num: String(n), den: String(d) });
const rng = (l, u) => ({ lower: parseBound(l), upper: parseBound(u) });

test('parseBound 精确解析十进制（最多 6 位小数）', () => {
  assert.equal(parseBound('0').n, 0n);
  assert.deepEqual([parseBound('1.5').n, parseBound('1.5').d], [3n, 2n]);
  assert.deepEqual([parseBound('0.25').n, parseBound('0.25').d], [1n, 4n]);
  // 1.123456 = 1123456/1000000 = 17554/15625（自动约分）
  assert.equal(parseBound('1.123456').n.toString(), '17554');
  assert.equal(parseBound('1.123456').d.toString(), '15625');
  const bad = ['', '-1', '01', '.5', '1.', '1.2.3', 'abc', '1.1234567', '1234567890123', '  '];
  for (const s of bad) assert.throws(() => parseBound(s), null, `“${s}” 应非法`);
});

test('氢气燃烧 2H2 + O2 -> 2H2O：H2 [2,4]，O2 [2,5]', () => {
  // x(H2)=n/2 ∈ [1,2]，x(O2)=n ∈ [2,5]
  const r = analyzeFeed([2, 1], [2], [rng('2', '4'), rng('2', '5')]);
  assert.deepEqual(r.xi, { min: fr(1), max: fr(2) });
  // H2O 生成量 [2,4]
  assert.deepEqual(r.products[0].produced, { min: fr(2), max: fr(4) });
  // H2 始终限量（2 ≤ 2）：剩余恒 0
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(0) });
  assert.equal(r.reactants[0].limiting, 'always');
  // O2 在 n=2 且 H2=4 时并列限量，其余组合过量 → 部分组合限量
  assert.equal(r.reactants[1].limiting, 'partial');
  // 联合角点：剩余最小 2 − 1·2 = 0；最大 5 − 1·1 = 4
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(4) });
});

test('部分组合限量：H2 [2,6]，O2 [1,3]', () => {
  // x(H2) ∈ [1,3]，x(O2) ∈ [1,3]，两区间重合
  const r = analyzeFeed([2, 1], [2], [rng('2', '6'), rng('1', '3')]);
  assert.deepEqual(r.xi, { min: fr(1), max: fr(3) });
  assert.equal(r.reactants[0].limiting, 'partial');
  assert.equal(r.reactants[1].limiting, 'partial');
  // H2 剩余 [0,4]；O2 剩余 [0,2]
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(4) });
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(2) });
});

test('合成氨 N2 + 3H2 -> 2NH3：含分数结果', () => {
  // N2 [1,2]：x ∈ [1,2]；H2 [3,6]：x ∈ [1,2]，恰好并列
  const r = analyzeFeed([1, 3], [2], [rng('1', '2'), rng('3', '6')]);
  assert.deepEqual(r.xi, { min: fr(1), max: fr(2) });
  assert.deepEqual(r.products[0].produced, { min: fr(2), max: fr(4) });
  // 两区间相同 → 两者均为“部分”，但在并列点各自都可能完全反应
  assert.equal(r.reactants[0].limiting, 'partial');
  assert.equal(r.reactants[1].limiting, 'partial');
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(1) });
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(3) });
});

test('分数剩余量：H2 [2.5,3]，O2 [2,2]', () => {
  // x(H2) ∈ [5/4,3/2]，x(O2)=2；H2 均限量（3/2 ≤ 2），O2 从不（2 > 5/4）
  const r = analyzeFeed([2, 1], [2], [rng('2.5', '3'), rng('2', '2')]);
  assert.deepEqual(r.xi, { min: fr(5, 4), max: fr(3, 2) });
  assert.deepEqual(r.products[0].produced, { min: fr(5, 2), max: fr(3) });
  assert.equal(r.reactants[0].limiting, 'always');
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(0) });
  assert.equal(r.reactants[1].limiting, 'never');
  // O2 最小剩余 2 − 1·(3/2) = 1/2；最大 2 − 1·(5/4) = 3/4
  assert.deepEqual(r.reactants[1].remaining, { min: fr(1, 2), max: fr(3, 4) });
});

test('含零投料：反应进度最小可为 0，生成物最小为 0', () => {
  const r = analyzeFeed([2, 1], [2], [rng('0', '2'), rng('0', '4')]);
  assert.deepEqual(r.xi, { min: fr(0), max: fr(1) });
  assert.deepEqual(r.products[0].produced, { min: fr(0), max: fr(2) });
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(2) });
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(4) });
  assert.equal(r.reactants[0].limiting, 'partial');
});

test('单点投料（唯一组合）：并列最小者均算限量', () => {
  // n(H2)=2, n(O2)=1 → ξ=1，恰好同时耗尽
  const r = analyzeFeed([2, 1], [2], [rng('2', '2'), rng('1', '1')]);
  assert.deepEqual(r.xi, { min: fr(1), max: fr(1) });
  assert.deepEqual(r.products[0].produced, { min: fr(2), max: fr(2) });
  assert.equal(r.reactants[0].limiting, 'always');
  assert.equal(r.reactants[1].limiting, 'always');
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(0) });
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(0) });
});

test('唯一反应物：永远限量、剩余恒 0', () => {
  // 2H2O2 -> 2H2O + O2
  const r = analyzeFeed([2], [2, 1], [rng('1', '3')]);
  assert.deepEqual(r.xi, { min: fr(1, 2), max: fr(3, 2) });
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(0) });
  assert.equal(r.reactants[0].limiting, 'always');
  assert.deepEqual(r.products[0].produced, { min: fr(1), max: fr(3) });
  assert.deepEqual(r.products[1].produced, { min: fr(1, 2), max: fr(3, 2) });
});

test('三反应物联合求界（不得独立相减）：铝热类系数 1:2:1 示意', () => {
  // 构造三个“反应物”系数全 1，生成物系数 1（纯数学验证联合角点）
  // A[1,4], B[2,5], C[3,6]
  const r = analyzeFeed([1, 1, 1], [1], [rng('1', '4'), rng('2', '5'), rng('3', '6')]);
  // x 区间：A[1,4] 均限量（4 ≤ min(2,3)=2? 否）→ 4>2，A 从不
  // A: a=1 > min b = min(5,6)=5? 否；b=4 ≤ min a = min(2,3)=2? 否 → partial
  // C: a=3 > min b = min(4,5)=4? 否；b=6 ≤ 2? 否 → partial；B 同理 partial
  assert.equal(r.reactants[0].limiting, 'partial');
  assert.equal(r.reactants[1].limiting, 'partial');
  assert.equal(r.reactants[2].limiting, 'partial');
  // ξ ∈ [min(1,2,3), min(4,5,6)] = [1,4]
  assert.deepEqual(r.xi, { min: fr(1), max: fr(4) });
  // C 剩余最小：自己取 3，其余取最大 min(4,5)=4 → 0
  // C 剩余最大：自己取 6，其余取最小 min(1,2)=1 → 5
  assert.deepEqual(r.reactants[2].remaining, { min: fr(0), max: fr(5) });
  // A 剩余最小：自己 1，其余上限 min(5,6)=5 → 0；最大：自己 4，其余下限 min(2,3)=2 → 2
  assert.deepEqual(r.reactants[0].remaining, { min: fr(0), max: fr(2) });
});

test('产物系数不影响限量判定，生成量随系数缩放', () => {
  // CH4 + 2O2 -> CO2 + 2H2O，CH4[1,2] x∈[1,2]，O2[4,8] x∈[2,4]
  const r = analyzeFeed([1, 2], [1, 2], [rng('1', '2'), rng('4', '8')]);
  assert.equal(r.reactants[0].limiting, 'always');
  // O2 的 x 下限 2 与 CH4 的 x 上限 2 相接：该点并列限量，故为“部分”
  assert.equal(r.reactants[1].limiting, 'partial');
  assert.deepEqual(r.xi, { min: fr(1), max: fr(2) });
  assert.deepEqual(r.products[0].produced, { min: fr(1), max: fr(2) });
  assert.deepEqual(r.products[1].produced, { min: fr(2), max: fr(4) });
  // O2 剩余：最小 4 − 2·2 = 0；最大 8 − 2·1 = 6
  assert.deepEqual(r.reactants[1].remaining, { min: fr(0), max: fr(6) });
});

test('严格分离的区间才判定为从不限量', () => {
  // H2 [2,4] x∈[1,2]，O2 [2.5,5] x∈[2.5,5]：2.5 > 2，O2 从不限量
  const r = analyzeFeed([2, 1], [2], [rng('2', '4'), rng('2.5', '5')]);
  assert.equal(r.reactants[0].limiting, 'always');
  assert.equal(r.reactants[1].limiting, 'never');
  // O2 最小剩余也大于 0：2.5 − 1·2 = 1/2；最大 5 − 1 = 4
  assert.deepEqual(r.reactants[1].remaining, { min: fr(1, 2), max: fr(4) });
});
