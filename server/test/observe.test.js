import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBound } from '../chem/feed.js';
import { checkObservations, fracText } from '../chem/observe.js';

const rng = (l, u) => ({ lower: parseBound(l), upper: parseBound(u) });
// 已观测闭区间；未观测直接给 null
const obs = (l, u) => (l === null && u === null ? { lower: null, upper: null } : { lower: parseBound(l), upper: parseBound(u) });
const NONE = { lower: null, upper: null };

// 断言见证确实满足：生成量 = d·ξ、剩余量 = n − c·ξ、投料在区间内、且有人耗尽
function assertWitness(verdict, coefLeft, coefRight, ranges) {
  assert.equal(verdict.feasible, true);
  const w = verdict.witness;
  const num = (f) => BigInt(f.num);
  const den = (f) => BigInt(f.den);
  const eq = (a, b) => num(a) * den(b) === num(b) * den(a);
  const le = (a, b) => num(a) * den(b) <= num(b) * den(a);
  const ge = (a, b) => le(b, a);

  let anyZero = false;
  coefLeft.forEach((c, i) => {
    // n − c·ξ = remaining
    const expectRem = {
      num: (num(w.feeds[i]) * den(w.xi) - BigInt(c) * num(w.xi) * den(w.feeds[i])).toString(),
      den: (den(w.feeds[i]) * den(w.xi)).toString(),
    };
    assert.ok(eq(w.remaining[i], expectRem), `剩余量 #${i} 应满足 n − cξ`);
    assert.ok(ge(w.feeds[i], { num: ranges[i].lower.n.toString(), den: ranges[i].lower.d.toString() }));
    assert.ok(le(w.feeds[i], { num: ranges[i].upper.n.toString(), den: ranges[i].upper.d.toString() }));
    assert.ok(ge(w.remaining[i], { num: '0', den: '1' }), '剩余量非负');
    if (eq(w.remaining[i], { num: '0', den: '1' })) anyZero = true;
    assert.equal(w.exhausted[i], eq(w.remaining[i], { num: '0', den: '1' }));
  });
  coefRight.forEach((d, j) => {
    const expectProd = {
      num: (BigInt(d) * num(w.xi)).toString(),
      den: den(w.xi).toString(),
    };
    assert.ok(eq(w.produced[j], expectProd), `生成量 #${j} 应满足 dξ`);
  });
  assert.ok(anyZero, '至少一种反应物剩余为 0');
  assert.ok(eq(w.remaining[w.exhaustedIndex], { num: '0', den: '1' }));
}

test('无任何观测：提示补填，feasible 为 empty', () => {
  const v = checkObservations([2, 1], [2], [rng('2', '4'), rng('2', '5')], {
    reactants: [NONE, NONE],
    products: [NONE],
  });
  assert.equal(v.feasible, 'empty');
  assert.match(v.message, /补填/);
});

test('可行：2H2 + O2 -> 2H2O，观测 H2O∈[2,4]、O2剩余∈[0.5,3]', () => {
  // H2 [2,4] x∈[1,2]，O2 [2,5] x∈[2,5]，H2 均限量，ξ∈[1,2]
  const v = checkObservations(
    [2, 1],
    [2],
    [rng('2', '4'), rng('2', '5')],
    { reactants: [NONE, obs('0.5', '3')], products: [obs('2', '4')] },
    { reactants: ['H2', 'O2'], products: ['H2O'] }
  );
  assertWitness(v, [2, 1], [2], [rng('2', '4'), rng('2', '5')]);
  assert.equal(v.witness.exhaustedIndex, 0); // H2 耗尽
  // 见证落在观测闭区间内
  const w = v.witness;
  assert.ok(BigInt(w.xi.num) >= BigInt(1) && BigInt(w.xi.num) <= BigInt(2) * BigInt(w.xi.den));
});

test('可行：耗尽反应物由非默认候选承担（O2 被精确限制）', () => {
  // 2H2 + O2 -> 2H2O，H2 [10,10] x=5，O2 [2,2] x=2 → O2 耗尽，ξ=2
  const v = checkObservations(
    [2, 1],
    [2],
    [rng('10', '10'), rng('2', '2')],
    { reactants: [NONE, NONE], products: [obs('4', '4')] },
    { reactants: ['H2', 'O2'], products: ['H2O'] }
  );
  assertWitness(v, [2, 1], [2], [rng('10', '10'), rng('2', '2')]);
  assert.equal(v.witness.exhaustedIndex, 1);
  assert.deepEqual([v.witness.xi.num, v.witness.xi.den], ['2', '1']);
  assert.deepEqual([v.witness.remaining[0].num, v.witness.remaining[0].den], ['6', '1']);
});

test('不可行：生成物观测超出反应进度可达范围（观测冲突）', () => {
  // ξ 最大为 2（H2 n=4,c=2），H2O 最多 4；要求 H2O∈[5,6]
  const v = checkObservations(
    [2, 1],
    [2],
    [rng('2', '4'), rng('2', '5')],
    { reactants: [NONE, NONE], products: [obs('5', '6')] },
    { reactants: ['H2', 'O2'], products: ['H2O'] }
  );
  assert.equal(v.feasible, false);
  assert.match(v.message, /观测冲突/);
  assert.match(v.message, /H2O/);
});

test('不可行：剩余量观测与投料区间联合矛盾（非耗尽者剩余过大）', () => {
  // O2 投料 [2,2]：ξ ≤ 2 时剩余 = 2 − ξ ≥ 0；却观测 O2 剩余 ∈ [1.5,2]
  //   需 ξ ≤ 0.5，而 H2 投料 [2,4]、耗尽候选要求 ξ ≥ 1 → 冲突
  const v = checkObservations(
    [2, 1],
    [2],
    [rng('2', '4'), rng('2', '2')],
    { reactants: [NONE, obs('1.5', '2')], products: [NONE] },
    { reactants: ['H2', 'O2'], products: ['H2O'] }
  );
  assert.equal(v.feasible, false);
  assert.match(v.message, /观测冲突/);
  assert.match(v.message, /O2/);
});

test('不可行：耗尽者剩余观测下限严格为正（硬性冲突）', () => {
  // 唯一反应物 H2O2：2H2O2 -> 2H2O + O2，其剩余恒为 0；却观测剩余 ∈ [1,2]
  const v = checkObservations(
    [2],
    [2, 1],
    [rng('3', '3')],
    { reactants: [obs('1', '2')], products: [NONE, NONE] },
    { reactants: ['H2O2'], products: ['H2O', 'O2'] }
  );
  assert.equal(v.feasible, false);
  assert.match(v.message, /耗尽/);
  assert.match(v.message, /H2O2/);
});

test('可行：小数 6 位精度，唯一反应物，见证分数精确', () => {
  // 2H2O2 -> 2H2O + O2，H2O2 ∈ [1.123456,1.123456]，ξ=0.561728，H2O=1.123456
  const v = checkObservations(
    [2],
    [2, 1],
    [rng('1.123456', '1.123456')],
    { reactants: [obs('0', '0')], products: [obs('1.123456', '1.123456'), NONE] },
    { reactants: ['H2O2'], products: ['H2O', 'O2'] }
  );
  assertWitness(v, [2], [2, 1], [rng('1.123456', '1.123456')]);
  // 1.123456 = 17554/15625
  assert.deepEqual([v.witness.produced[0].num, v.witness.produced[0].den], ['17554', '15625']);
});

test('可行：观测耗尽者剩余为闭区间 [0,0] 时也可作为耗尽候选', () => {
  const v = checkObservations(
    [1, 3],
    [2],
    [rng('1', '2'), rng('3', '6')],
    { reactants: [obs('0', '0'), NONE], products: [obs('2', '2')] },
    { reactants: ['N2', 'H2'], products: ['NH3'] }
  );
  assertWitness(v, [1, 3], [2], [rng('1', '2'), rng('3', '6')]);
  assert.equal(v.witness.exhaustedIndex, 0);
});

test('fracText 分数展示', () => {
  assert.equal(fracText(parseBound('0.5')), '1/2');
  assert.equal(fracText(parseBound('3')), '3');
});
