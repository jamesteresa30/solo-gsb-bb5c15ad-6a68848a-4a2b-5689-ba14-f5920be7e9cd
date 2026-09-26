// 投料区间分析（精确有理数）。
//
// 反应物 i 的配平系数为 c_i（正整数），投料量 n_i 可在独立区间 [L_i, U_i]
// （L_i ≥ 0）内任意取值；生成物初始量为 0，按完全反应计算，反应进度
//
//     ξ = min_i (n_i / c_i)
//
// 生成物 j 的生成量为 d_j·ξ，反应物 i 的剩余量为 n_i − c_i·ξ。
// 所有最小值/最大值都在整个区间直积（盒子）上联合求取：各剩余量关于自身
// 投料量单调不减、关于他人投料量单调不增，故极值必在盒子角点取得，不能用
// 各区间端点独立相减代替。并列最小时并列者均算限量反应物。

import { Frac } from './fraction.js';

const ZERO = new Frac(0n);

// 非负十进制：整数部分最多 12 位（不许前导零），小数部分最多 6 位。
const BOUND_RE = /^(0|[1-9]\d{0,11})(?:\.(\d{1,6}))?$/;

/** 解析投料量/观测量字符串为精确分数；非法时抛出带中文说明的 Error。 */
export function parseBound(raw, label = '投料量') {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`请输入${label}（mol）`);
  }
  const s = raw.trim();
  const m = BOUND_RE.exec(s);
  if (!m) {
    throw new Error('必须为非负十进制数，整数部分最多 12 位、小数部分最多 6 位');
  }
  const intPart = m[1];
  const fracPart = m[2] ?? '';
  const den = 10n ** BigInt(fracPart.length);
  return new Frac(BigInt(intPart + fracPart), den);
}

const minFrac = (arr) =>
  arr.reduce((acc, x) => (x.sub(acc).sign() < 0 ? x : acc));

const fracJSON = (f) => ({ num: f.n.toString(), den: f.d.toString() });

/**
 * coefLeft / coefRight：配平返回的正整数系数（number 或十进制字符串均可）。
 * ranges：与反应物等长的 [{ lower: Frac, upper: Frac }]，要求 0 ≤ lower ≤ upper。
 *
 * 返回反应进度区间、各反应物剩余量可达区间与限量判定、各生成物生成量区间。
 */
export function analyzeFeed(coefLeft, coefRight, ranges) {
  const m = coefLeft.length;
  if (m === 0) throw new Error('至少需要一种反应物');
  if (ranges.length !== m) throw new Error('区间数量与反应物数量不一致');

  const c = coefLeft.map((x) => BigInt(x));
  const d = coefRight.map((x) => BigInt(x));
  const lo = ranges.map((r) => Frac.of(r.lower));
  const hi = ranges.map((r) => Frac.of(r.upper));

  // x_i = n_i / c_i 的可达区间
  const xLo = lo.map((v, i) => v.div(new Frac(c[i])));
  const xHi = hi.map((v, i) => v.div(new Frac(c[i])));

  // ξ 关于每个 n_i 都单调不减：整体最小取全下限、整体最大取全上限。
  const xiMin = minFrac(xLo);
  const xiMax = minFrac(xHi);

  const reactants = c.map((ci, i) => {
    // 除 i 外各反应物 x_k 的下限/上限中的最小值
    const othersLo = m === 1 ? null : minFrac(xLo.filter((_, k) => k !== i));
    const othersHi = m === 1 ? null : minFrac(xHi.filter((_, k) => k !== i));

    // 剩余量 r_i = n_i − c_i ξ：关于 n_i 不减、关于其余 n_k 不增。
    // 联合角点：最小 = 自身下限且其余全上限；最大 = 自身上限且其余全下限。
    // 唯一反应物时恒为限量反应物，剩余恒为 0。
    const remMin =
      m === 1 ? ZERO : max0(lo[i].sub(new Frac(ci).mul(othersHi)));
    const remMax =
      m === 1 ? ZERO : max0(hi[i].sub(new Frac(ci).mul(othersLo)));

    // 限量判定（x_i 与其余物质的可达区间比较，并列最小算限量）：
    //   均限量：即使自己取最大、其余取最小，x_i 仍不大于任一他人（b_i ≤ min a_k）
    //   从不限量：即使自己取最小、其余取最大，仍有他人严格更小（a_i > min b_k）
    //   其余情形仅在部分组合中限量
    let limiting;
    if (m === 1) {
      limiting = 'always';
    } else if (xHi[i].sub(othersLo).sign() <= 0) {
      limiting = 'always';
    } else if (xLo[i].sub(othersHi).sign() > 0) {
      limiting = 'never';
    } else {
      limiting = 'partial';
    }

    return {
      coefficient: ci.toString(),
      remaining: { min: fracJSON(remMin), max: fracJSON(remMax) },
      limiting,
    };
  });

  // 生成物初始量为 0：终态量即生成量 d_j·ξ。
  const products = d.map((dj) => {
    const djf = new Frac(dj);
    return {
      coefficient: dj.toString(),
      produced: {
        min: fracJSON(djf.mul(xiMin)),
        max: fracJSON(djf.mul(xiMax)),
      },
    };
  });

  return {
    xi: { min: fracJSON(xiMin), max: fracJSON(xiMax) },
    reactants,
    products,
  };
}

function max0(f) {
  return f.sign() > 0 ? f : ZERO;
}
