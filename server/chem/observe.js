// 实验观测核验（精确有理数）。
//
// 给定配平系数 c_i（反应物）、d_j（生成物）、初始投料区间 [L_i, U_i] 与
// 可选观测闭区间：
//     生成物实际生成量 p_j ∈ [a_j, b_j]（未观测则缺省）
//     反应物实际剩余量 r_i ∈ [a_i, b_i]（未观测则缺省）
// 判断是否存在【同一组】初始投料 n_i ∈ [L_i, U_i] 与【同一个】反应进度 ξ ≥ 0，使
//     p_j = d_j·ξ,  r_i = n_i − c_i·ξ ≥ 0, 且至少一个 r_i = 0
// （即 ξ = min_i n_i/c_i，完全反应）。所有观测必须与同一组 (n_i, ξ) 相容，
// 不能逐项独立比对观测范围。
//
// 求解方法：固定某个限量反应物 k（n_k = c_k·ξ，r_k = 0），全部约束化为 ξ 的
// 一维区间交：
//   · 生成物观测：ξ ∈ [a_j/d_j, b_j/d_j]
//   · 反应物 i 的投料区间与剩余观测（n_i = c_i ξ + r_i ∈ [L_i, U_i]）：
//       ξ ∈ [(L_i − b_i)/c_i, (U_i − a_i)/c_i]
//     未观测时取 a_i = 0、b_i = +∞（即只保留完全反应上界 ξ ≤ U_i/c_i）
//   · 限量者本身：ξ ∈ [L_k/c_k, U_k/c_k]，且其剩余观测闭区间必须包含 0
//     （界非负，故等价于 a_k = 0）
// 逐个候选 k 检查区间是否非空：任一非空即可行，取 ξ = 区间下界即可构造见证
// （n_k = c_k ξ；n_i = max(L_i, c_i ξ + a_i)，i ≠ k）。

import { Frac } from './fraction.js';

const ZERO = new Frac(0n);

const fracJSON = (f) => ({ num: f.n.toString(), den: f.d.toString() });

// 带“来源”的区间端点：v 为分数值，src 描述该约束来自哪项观测/投料
const maxEntry = (entries) =>
  entries.reduce((acc, e) => (e.v.sub(acc.v).sign() > 0 ? e : acc));
const minEntry = (entries) =>
  entries.reduce((acc, e) => (e.v.sub(acc.v).sign() < 0 ? e : acc));

/**
 * coefLeft / coefRight：配平返回的正整数系数（number 或十进制字符串均可）。
 * ranges：与反应物等长的 [{ lower: Frac, upper: Frac }]。
 * remainingObs / producedObs：与反应物/生成物等长，元素为
 *   null（未观测）或 { lower: Frac, upper: Frac }（观测闭区间，界非负）。
 *
 * 返回：
 *   { status: 'no-observation' }
 *   { status: 'feasible', limitingIndex, witness: { xi, feeds, remaining, produced } }
 *   { status: 'infeasible', stage: 'joint'|'exhaustion', reasons: [...] }
 */
export function checkObservation(coefLeft, coefRight, ranges, remainingObs, producedObs) {
  const m = coefLeft.length;
  if (m === 0) throw new Error('至少需要一种反应物');
  if (ranges.length !== m) throw new Error('区间数量与反应物数量不一致');
  if (remainingObs.length !== m) throw new Error('剩余观测数量与反应物数量不一致');
  if (producedObs.length !== coefRight.length) throw new Error('生成观测数量与生成物数量不一致');

  const cf = coefLeft.map((x) => new Frac(BigInt(x)));
  const df = coefRight.map((x) => new Frac(BigInt(x)));
  const lo = ranges.map((r) => Frac.of(r.lower));
  const hi = ranges.map((r) => Frac.of(r.upper));

  if (!remainingObs.some(Boolean) && !producedObs.some(Boolean)) {
    return { status: 'no-observation' };
  }

  // 不指定限量者时，所有约束对 ξ 的共同界（闭区间交，可能为空）。
  const lowerEntries = [{ v: ZERO, src: { kind: 'nonneg' } }];
  const upperEntries = [];

  producedObs.forEach((o, j) => {
    if (!o) return;
    lowerEntries.push({
      v: Frac.of(o.lower).div(df[j]),
      src: { kind: 'product', index: j, bound: 'lower' },
    });
    upperEntries.push({
      v: Frac.of(o.upper).div(df[j]),
      src: { kind: 'product', index: j, bound: 'upper' },
    });
  });

  remainingObs.forEach((o, i) => {
    const a = o ? Frac.of(o.lower) : ZERO;
    // n_i = c_i ξ + r_i ≤ U_i 且 r_i ≥ a_i → ξ ≤ (U_i − a_i)/c_i
    upperEntries.push({
      v: hi[i].sub(a).div(cf[i]),
      src: { kind: 'reactant', index: i, bound: 'upper', observed: !!o },
    });
    if (o) {
      // n_i = c_i ξ + r_i ≥ L_i 且 r_i ≤ b_i → ξ ≥ (L_i − b_i)/c_i
      lowerEntries.push({
        v: lo[i].sub(Frac.of(o.upper)).div(cf[i]),
        src: { kind: 'reactant', index: i, bound: 'lower', observed: true },
      });
    }
  });

  const xiLower = maxEntry(lowerEntries);
  const xiUpper = minEntry(upperEntries);

  // 共同区间已为空：无论谁耗尽都无解，属于观测之间（或观测与投料区间）的冲突。
  if (xiLower.v.sub(xiUpper.v).sign() > 0) {
    return {
      status: 'infeasible',
      stage: 'joint',
      reasons: [
        {
          kind: 'xi-clash',
          lower: { value: fracJSON(xiLower.v), source: xiLower.src },
          upper: { value: fracJSON(xiUpper.v), source: xiUpper.src },
        },
      ],
    };
  }

  // 逐个限量候选：r_k = 0，附加 ξ ∈ [L_k/c_k, U_k/c_k]（U_k/c_k 已在共同上界中）。
  const blocked = [];
  for (let k = 0; k < m; k++) {
    const obs = remainingObs[k];
    if (obs && Frac.of(obs.lower).sign() > 0) {
      // 剩余观测下限严格为正：0 不在观测闭区间内，该物质不可能恰好耗尽。
      blocked.push({
        kind: 'remaining-positive',
        index: k,
        lower: fracJSON(Frac.of(obs.lower)),
      });
      continue;
    }
    const feedLower = lo[k].div(cf[k]); // n_k = c_k ξ ≥ L_k
    if (feedLower.sub(xiUpper.v).sign() > 0) {
      blocked.push({
        kind: 'feed-lower',
        index: k,
        xiLower: fracJSON(feedLower),
        xiUpper: fracJSON(xiUpper.v),
        upperSource: xiUpper.src,
      });
      continue;
    }

    const xi = xiLower.v.sub(feedLower).sign() >= 0 ? xiLower.v : feedLower;
    const feeds = [];
    const remaining = [];
    for (let i = 0; i < m; i++) {
      let n;
      if (i === k) {
        n = cf[i].mul(xi);
      } else {
        const a = remainingObs[i] ? Frac.of(remainingObs[i].lower) : ZERO;
        const base = cf[i].mul(xi).add(a);
        // 取同时满足投料下限与剩余观测下限的最小值
        n = lo[i].sub(base).sign() > 0 ? lo[i] : base;
      }
      feeds.push(n);
      remaining.push(n.sub(cf[i].mul(xi)));
    }
    const produced = df.map((dj) => dj.mul(xi));

    return {
      status: 'feasible',
      limitingIndex: k,
      witness: {
        xi: fracJSON(xi),
        feeds: feeds.map(fracJSON),
        remaining: remaining.map(fracJSON),
        produced: produced.map(fracJSON),
      },
    };
  }

  // 共同区间非空，但没有任何反应物能在满足全部观测的同时耗尽。
  return { status: 'infeasible', stage: 'exhaustion', reasons: blocked };
}
