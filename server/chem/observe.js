// 实验观测核验（精确有理数）。
//
// 已配平反应：反应物系数 c_i、生成物系数 d_j；反应物初始投料
// n_i ∈ [L_i, U_i]（0 ≤ L_i ≤ U_i），生成物初始量为 0，完全反应时
//
//     生成物生成量 = d_j·ξ，反应物剩余量 = n_i − c_i·ξ，ξ = min_i n_i / c_i
//
// 即至少有一种反应物剩余为 0。给定每项可选的观测闭区间（反应物剩余量
// [a_i, b_i]、生成物生成量 [a_j, b_j]，缺省表示未观测），判断是否存在
// “同一组”投料与同一个反应进度 ξ 同时落入全部区间。
//
// 不能逐项独立比对：剩余量区间同时牵涉 n_i 与 ξ，必须联合求解。做法：
// 枚举耗尽反应物 k（n_k = c_k·ξ，故 ξ ∈ [L_k/c_k, U_k/c_k]），其余每种
// 反应物 i 联立 n_i ∈ [L_i,U_i] 与 n_i − c_i·ξ ∈ [a_i,b_i]（未观测时
// a=0、b=∞），生成物联立 d_j·ξ ∈ [a_j,b_j]，全部化为对 ξ 的线性区间
// 约束取交集；任一候选 k 的交集非空即整体可行，并在交集中取一点构造
// 一组投料与进度见证。所有候选均为空时给出最接近可行的冲突说明。

import { Frac } from './fraction.js';

const ZERO = new Frac(0n);

const fracJSON = (f) => ({ num: f.n.toString(), den: f.d.toString() });

/** 分数的展示形式：整数直接显示，否则 a/b。 */
export function fracText(f) {
  return f.d === 1n ? f.n.toString() : `${f.n.toString()}/${f.d.toString()}`;
}

const maxFrac = (a, b) => (b.sub(a).sign() > 0 ? b : a);

/**
 * coefLeft / coefRight：配平返回的正整数系数（number 或十进制字符串均可）。
 * ranges：与反应物等长的 [{ lower: Frac, upper: Frac }]，0 ≤ lower ≤ upper。
 * observations：
 *   { reactants: [{ lower: Frac|null, upper: Frac|null }],
 *     products:  [{ lower: Frac|null, upper: Frac|null }] }
 *   lower/upper 同时为 null 表示该物质未观测（由调用方保证成对出现）。
 * names：可选 { reactants: [名称], products: [名称] }，仅用于冲突文案。
 *
 * 返回：
 *   { feasible: 'empty', message }                         无任何观测
 *   { feasible: true, witness: { xi, feeds, remaining,
 *                                produced, exhausted, exhaustedIndex } }
 *   { feasible: false, message }                           观测冲突
 */
export function checkObservations(coefLeft, coefRight, ranges, observations, names = {}) {
  const m = coefLeft.length;
  const p = coefRight.length;
  if (m === 0) throw new Error('至少需要一种反应物');
  if (ranges.length !== m) throw new Error('投料区间数量与反应物数量不一致');
  if (
    !observations ||
    !Array.isArray(observations.reactants) ||
    !Array.isArray(observations.products) ||
    observations.reactants.length !== m ||
    observations.products.length !== p
  ) {
    throw new Error('观测区间数量与物质数量不一致');
  }

  const c = coefLeft.map((x) => new Frac(BigInt(x)));
  const d = coefRight.map((x) => new Frac(BigInt(x)));
  const lo = ranges.map((r) => Frac.of(r.lower));
  const hi = ranges.map((r) => Frac.of(r.upper));
  const remObs = observations.reactants;
  const prodObs = observations.products;

  const anyObserved =
    remObs.some((o) => o.lower !== null) || prodObs.some((o) => o.lower !== null);
  if (!anyObserved) {
    return {
      feasible: 'empty',
      message:
        '尚未填写任何观测区间：请至少补填一项生成物生成量或反应物剩余量的观测闭区间后再核验（留空表示未观测）。',
    };
  }

  const rname = (i) => names?.reactants?.[i] ?? `反应物 #${i + 1}`;
  const pname = (j) => names?.products?.[j] ?? `生成物 #${j + 1}`;

  // 不可行候选中“最接近可行”者：gap 为 ξ 下界超出上界的距离；
  // gap = null 表示硬性冲突（耗尽者剩余观测下限 > 0），排在有限差距之后。
  let best = null;

  for (let k = 0; k < m; k++) {
    // 候选 k 耗尽：n_k = c_k·ξ，投料区间直接给出 ξ 的区间。
    let low = lo[k].div(c[k]);
    let lowSrc = `反应物“${rname(k)}”投料下限`;
    let up = hi[k].div(c[k]);
    let upSrc = `反应物“${rname(k)}”投料上限（耗尽约束 n = c·ξ）`;
    let hard = null;

    const raiseLow = (v, src) => {
      if (v.sub(low).sign() > 0) {
        low = v;
        lowSrc = src;
      }
    };
    const lowerUp = (v, src) => {
      if (up.sub(v).sign() > 0) {
        up = v;
        upSrc = src;
      }
    };

    // 耗尽者自身剩余必须为 0：观测下限必须允许 0（观测下界非负，即下限须为 0）。
    if (remObs[k].lower !== null && remObs[k].lower.sign() > 0) {
      hard = `反应物“${rname(k)}”耗尽时其剩余量必须为 0，但其剩余量观测下限为 ${fracText(
        remObs[k].lower
      )} > 0`;
    }

    if (hard === null) {
      for (let i = 0; i < m; i++) {
        if (i === k) continue;
        const ob = remObs[i];
        // n_i ∈ [L_i,U_i] 与 r_i = n_i − c_i·ξ ∈ [a_i,b_i] 联立：
        //   n_i ∈ [max(L_i, c_i·ξ + a_i), min(U_i, c_i·ξ + b_i)] 非空
        // 未观测时 a_i = 0、b_i = ∞（仅剩 r_i ≥ 0）。
        const a = ob.lower ?? ZERO;
        lowerUp(
          hi[i].sub(a).div(c[i]),
          ob.lower === null
            ? `反应物“${rname(i)}”投料上限（其剩余量不能为负）`
            : `反应物“${rname(i)}”剩余量观测下限与其投料上限`
        );
        if (ob.upper !== null) {
          raiseLow(
            lo[i].sub(ob.upper).div(c[i]),
            `反应物“${rname(i)}”剩余量观测上限与其投料下限`
          );
        }
      }
      for (let j = 0; j < p; j++) {
        const ob = prodObs[j];
        if (ob.lower === null) continue; // 成对缺省 = 未观测
        // d_j·ξ ∈ [a_j, b_j]
        raiseLow(ob.lower.div(d[j]), `生成物“${pname(j)}”生成量观测下限`);
        lowerUp(ob.upper.div(d[j]), `生成物“${pname(j)}”生成量观测上限`);
      }
    }

    if (hard !== null) {
      // 仅当还没有任何候选记录（含硬性冲突）时保留，后续有限差距候选会覆盖。
      if (best === null) best = { gap: null, message: hard };
      continue;
    }

    const gap = low.sub(up);
    if (gap.sign() > 0) {
      if (best === null || best.gap === null || gap.sub(best.gap).sign() < 0) {
        best = {
          gap,
          message: `观测冲突：反应进度 ξ 必须 ≥ ${fracText(low)}（${lowSrc}），又必须 ≤ ${fracText(
            up
          )}（${upSrc}），两者矛盾，不存在相容的同一组投料与反应进度。`,
        };
      }
      continue;
    }

    // 可行：取交集的最大下界作为见证点，逐一选取落在各区间内的投料量。
    const xi = low;
    const feeds = [];
    const remaining = [];
    const exhausted = [];
    for (let i = 0; i < m; i++) {
      let n;
      let r;
      if (i === k) {
        n = c[i].mul(xi);
        r = ZERO;
      } else {
        const a = remObs[i].lower ?? ZERO;
        // 取联立区间下界：max(L_i, c_i·ξ + a_i)，可行性已保证其不超过各上界。
        n = maxFrac(lo[i], c[i].mul(xi).add(a));
        r = n.sub(c[i].mul(xi));
      }
      feeds.push(fracJSON(n));
      remaining.push(fracJSON(r));
      exhausted.push(r.isZero());
    }
    const produced = d.map((dj) => fracJSON(dj.mul(xi)));

    return {
      feasible: true,
      witness: {
        xi: fracJSON(xi),
        feeds,
        remaining,
        produced,
        exhausted,
        exhaustedIndex: k,
      },
    };
  }

  return { feasible: false, message: best.message };
}
