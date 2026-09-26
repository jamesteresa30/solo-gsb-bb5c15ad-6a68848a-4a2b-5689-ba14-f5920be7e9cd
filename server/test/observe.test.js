import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBound } from '../chem/feed.js';
import { checkObservation } from '../chem/observe.js';

const rng = (l, u) => ({ lower: parseBound(l), upper: parseBound(u) });
const O = (l, u) => ({ lower: parseBound(l), upper: parseBound(u) });

// 精确分数辅助：w = { num, den }（字符串），与 Frac（n,d 为 BigInt）比较
const ge = (w, f) => BigInt(w.num) * f.d >= f.n * BigInt(w.den);
const le = (w, f) => BigInt(w.num) * f.d <= f.n * BigInt(w.den);
const wGeW = (a, b) => BigInt(a.num) * BigInt(b.den) >= BigInt(b.num) * BigInt(a.den);
const wLeW = (a, b) => BigInt(a.num) * BigInt(b.den) <= BigInt(b.num) * BigInt(a.den);

// 观测 Frac 界 → JSON 形
const oj = (o, key) => ({ num: o[key].n.toString(), den: o[key].d.toString() });

// 验证见证：ξ = min(n/c)（至少一反应物耗尽），投料在区间内，剩余/生成在观测区间内。
function assertWitness(check, coef, ranges, remainingObs, producedObs) {
  assert.equal(check.status, 'feasible');
  const { xi, feeds, remaining, produced } = check.witness;

  let exhausted = false;
  feeds.forEach((n, i) => {
    const c = BigInt(coef[i]);
    // n/c ≥ ξ
    assert.ok(
      BigInt(n.num) * BigInt(xi.den) >= BigInt(xi.num) * BigInt(n.den) * c,
      `投料 ${i} 应满足 n/c ≥ ξ`
    );
    if (BigInt(n.num) * BigInt(xi.den) === BigInt(xi.num) * BigInt(n.den) * c) exhausted = true;
    // 投料在区间内
    assert.ok(ge(n, ranges[i].lower), `投料 ${i} 应 ≥ 下限`);
    assert.ok(le(n, ranges[i].upper), `投料 ${i} 应 ≤ 上限`);
  });
  assert.ok(exhausted, '至少一种反应物剩余为 0');

  feeds.forEach((n, i) => {
    const c = BigInt(coef[i]);
    // remaining = n − c·ξ，重算分数比较
    const lhs = BigInt(remaining[i].num) * BigInt(n.den) * BigInt(xi.den);
    const rhs =
      BigInt(n.num) * BigInt(xi.den) - BigInt(xi.num) * c * BigInt(n.den);
    assert.equal(lhs, rhs * BigInt(remaining[i].den), `剩余量 ${i} 应等于 n − cξ`);
    assert.ok(BigInt(remaining[i].num) >= 0n, `剩余量 ${i} 应非负`);
    const o = remainingObs[i];
    if (o) {
      assert.ok(wGeW(remaining[i], oj(o, 'lower')), `剩余 ${i} ≥ 观测下限`);
      assert.ok(wLeW(remaining[i], oj(o, 'upper')), `剩余 ${i} ≤ 观测上限`);
    }
  });

  producedObs.forEach((o, j) => {
    if (!o) return;
    assert.ok(wGeW(produced[j], oj(o, 'lower')), `生成 ${j} ≥ 观测下限`);
    assert.ok(wLeW(produced[j], oj(o, 'upper')), `生成 ${j} ≤ 观测上限`);
  });
}

test('没有任何观测：返回 no-observation', () => {
  const r = checkObservation([2, 1], [2], [rng('2', '4'), rng('2', '5')], [null, null], [null]);
  assert.equal(r.status, 'no-observation');
});

test('氢气燃烧：生成物单点观测 2H2O 可行，H2 耗尽', () => {
  // 2H2 + O2 -> 2H2O；H2[2,4]，O2[2,5]；测得 H2O = 2 ⇒ ξ=1
  const rem = [null, null];
  const prod = [O('2', '2')];
  const ranges = [rng('2', '4'), rng('2', '5')];
  const r = checkObservation([2, 1], [2], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.limitingIndex, 0);
  assert.equal(r.witness.xi.num, '1');
  assertWitness(r, [2, 1], ranges, rem, prod);
});

test('生成物观测与剩余量观测必须来自同一组 ξ（联合判定，不可逐项独立比对）', () => {
  // H2[2,4]，O2[2,5]；H2O 生成量 [3,4] ⇒ ξ ∈ [1.5,2]；
  // O2 剩余 [3,4] 且 n(O2) ≤ 5：n = ξ + r，ξ=2、r=3 时 n=5 恰可行（H2=4 耗尽）。
  const ranges = [rng('2', '4'), rng('2', '5')];
  const rem = [null, O('3', '4')];
  const prod = [O('3', '4')];
  const r = checkObservation([2, 1], [2], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.witness.remaining[1].num, '3');
  assertWitness(r, [2, 1], ranges, rem, prod);
});

test('观测冲突（联合矛盾）：要求 ξ=2 又要求 ξ≤1', () => {
  // H2O 生成量 [4,4] ⇒ ξ=2；O2 剩余 [4,4] 且 n(O2)≤5 ⇒ ξ ≤ 1。
  const r = checkObservation(
    [2, 1],
    [2],
    [rng('2', '4'), rng('2', '5')],
    [null, O('4', '4')],
    [O('4', '4')]
  );
  assert.equal(r.status, 'infeasible');
  assert.equal(r.stage, 'joint');
  assert.match(r.reasons[0].kind, /clash/);
});

test('两种反应物剩余都观测为严格正：没有任何物质能耗尽', () => {
  const r = checkObservation(
    [2, 1],
    [2],
    [rng('2', '4'), rng('2', '5')],
    [O('0.5', '1'), O('1', '2')],
    [null]
  );
  assert.equal(r.status, 'infeasible');
  assert.equal(r.stage, 'exhaustion');
  assert.equal(r.reasons.length, 2);
  assert.ok(r.reasons.every((x) => x.kind === 'remaining-positive'));
});

test('仅一种反应物（恒为限量者）：剩余观测必须包含 0', () => {
  // 2H2O2 -> 2H2O + O2；投料 [1,3]，生成 H2O [1,2] ⇒ ξ ∈ [0.5,1]：可行
  const ranges = [rng('1', '3')];
  const rem = [null];
  const prod = [O('1', '2'), null];
  const r = checkObservation([2], [2, 1], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.limitingIndex, 0);
  assertWitness(r, [2], ranges, rem, prod);

  // 剩余量观测为 [0.1, 1]（严格正）：唯一反应物无法耗尽
  const bad = checkObservation([2], [2, 1], [rng('1', '3')], [O('0.1', '1')], [O('1', '2'), null]);
  assert.equal(bad.status, 'infeasible');
  assert.equal(bad.stage, 'exhaustion');
});

test('投料上限阻止反应进度：观测要求 ξ 过大（joint 矛盾）', () => {
  // N2 + 3H2 -> 2NH3；N2[2,4]，H2[3,6]（ξ 上界 min(4,2)=2）
  // 观测 NH3 [5,6] ⇒ ξ ∈ [2.5,3] > 2 → 共同区间即空。
  const bad = checkObservation([1, 3], [2], [rng('2', '4'), rng('3', '6')], [null, null], [O('5', '6')]);
  assert.equal(bad.status, 'infeasible');
  assert.equal(bad.stage, 'joint');
});

test('剩余观测下限为 0 的闭区间允许该物质耗尽', () => {
  // H2[2,4]，O2[2,5]；H2O=2（ξ=1），H2 剩余 [0,0.5]
  const ranges = [rng('2', '4'), rng('2', '5')];
  const rem = [O('0', '0.5'), null];
  const prod = [O('2', '2')];
  const r = checkObservation([2, 1], [2], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.limitingIndex, 0);
  assertWitness(r, [2, 1], ranges, rem, prod);
});

test('小数观测精确为有理数：0.5 进度下 H2O 生成量恰为 1', () => {
  // CH4 + 2O2 -> CO2 + 2H2O；CH4[0.5,2]，O2[4,8]
  // CO2 [0.5,0.5] ⇒ ξ=0.5；CH4 投料下限 0.5 允许其恰好耗尽
  const ranges = [rng('0.5', '2'), rng('4', '8')];
  const rem = [null, null];
  const prod = [O('0.5', '0.5'), O('1', '1')];
  const r = checkObservation([1, 2], [1, 2], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.witness.xi.num, '1');
  assert.equal(r.witness.xi.den, '2');
  assertWitness(r, [1, 2], ranges, rem, prod);
});

test('耗尽候选的投料下限与共同上界冲突：该候选 blocked，另一候选可行', () => {
  // A[3,5]（c=2，x∈[1.5,2.5]），B[0,10]（c=1，x∈[0,10]）；产物 d=1
  // 观测生成量 [1,1] ⇒ ξ=1。A 耗尽要求 ξ ≥ 1.5，冲突 → A blocked；
  // B 耗尽：n_B = 1，r_A = n_A − 2 ≥ 3−2 = 1，可行。
  const ranges = [rng('3', '5'), rng('0', '10')];
  const rem = [null, null];
  const prod = [O('1', '1')];
  const r = checkObservation([2, 1], [1], ranges, rem, prod);
  assert.equal(r.status, 'feasible');
  assert.equal(r.limitingIndex, 1);
  assertWitness(r, [2, 1], ranges, rem, prod);

  // 提高 A 投料下限到 4（x≥2），则 B 耗尽时 r_A = n_A − 2 ≥ 2；
  // 再要求 A 剩余 [0,1] → 共同 ξ 下界 ≥ (4−1)/2 = 1.5 > 1，joint 矛盾。
  const bad = checkObservation(
    [2, 1],
    [1],
    [rng('4', '5'), rng('0', '10')],
    [O('0', '1'), null],
    [O('1', '1')]
  );
  assert.equal(bad.status, 'infeasible');
  assert.equal(bad.stage, 'joint');
});
