// 元素守恒矩阵 + 精确有理数消元求解。
// 仅当零空间一维且系数可全部取严格正数时给出最简整数系数。

import { Frac, gcdAbs } from './fraction.js';

/** 对 Frac 矩阵做行最简形消元，返回 { rref, pivots }。 */
export function rref(matrix) {
  const m = matrix.map((row) => row.slice());
  const rows = m.length;
  const cols = m[0].length;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1;
    for (let i = r; i < rows; i++) {
      if (!m[i][c].isZero()) {
        p = i;
        break;
      }
    }
    if (p === -1) continue;
    [m[r], m[p]] = [m[p], m[r]];
    const pv = m[r][c];
    m[r] = m[r].map((x) => x.div(pv));
    for (let i = 0; i < rows; i++) {
      if (i !== r && !m[i][c].isZero()) {
        const f = m[i][c];
        m[i] = m[i].map((x, j) => x.sub(f.mul(m[r][j])));
      }
    }
    pivots.push(c);
    r++;
  }
  return { rref: m, pivots };
}

const toJsonNumber = (x) =>
  x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= BigInt(-Number.MAX_SAFE_INTEGER)
    ? Number(x)
    : x.toString();

/**
 * leftCounts / rightCounts：parseFormula 返回的 Map 数组。
 * 返回 { status: 'balanced' | 'no-positive-solution' | 'not-unique', ... }
 */
export function balanceEquation(leftCounts, rightCounts) {
  const all = [...leftCounts, ...rightCounts];
  const nLeft = leftCounts.length;
  const cols = all.length;

  // 元素按首次出现顺序排列
  const elements = [];
  const elIndex = new Map();
  for (const counts of all) {
    for (const el of counts.keys()) {
      if (!elIndex.has(el)) {
        elIndex.set(el, elements.length);
        elements.push(el);
      }
    }
  }

  // 守恒矩阵：反应物列为正，生成物列为负，M·c = 0
  const M = Array.from({ length: elements.length }, () =>
    Array.from({ length: cols }, () => new Frac(0n))
  );
  all.forEach((counts, j) => {
    const sign = j < nLeft ? 1n : -1n;
    for (const [el, c] of counts) {
      M[elIndex.get(el)][j] = new Frac(sign * BigInt(c));
    }
  });

  const { rref: R, pivots } = rref(M);
  const pivotSet = new Set(pivots);
  const freeCols = [];
  for (let c = 0; c < cols; c++) if (!pivotSet.has(c)) freeCols.push(c);

  if (freeCols.length !== 1) {
    // 零空间维数 ≠ 1：>1 时解不唯一；=0 时只有零解，归入无正解
    return freeCols.length > 1
      ? { status: 'not-unique', nullity: freeCols.length }
      : { status: 'no-positive-solution', reason: 'only-trivial' };
  }

  // 零空间一维：取自由变量为 1，回代主元变量
  const f = freeCols[0];
  const vec = Array.from({ length: cols }, () => new Frac(0n));
  vec[f] = new Frac(1n);
  pivots.forEach((pc, r) => {
    vec[pc] = R[r][f].neg();
  });

  // 通乘分母最小公倍数化为整数
  let lcm = 1n;
  for (const v of vec) lcm = (lcm / gcdAbs(lcm, v.d)) * v.d;
  let ints = vec.map((v) => v.n * (lcm / v.d));

  // 必须全部严格为正（全负则整体取反；有零或异号则无正解）
  const signs = ints.map((x) => (x > 0n ? 1 : x < 0n ? -1 : 0));
  if (signs.every((s) => s === -1)) {
    ints = ints.map((x) => -x);
  } else if (signs.some((s) => s <= 0)) {
    return {
      status: 'no-positive-solution',
      reason: signs.some((s) => s === 0) ? 'zero-coefficient' : 'mixed-signs',
    };
  }

  // 约去最大公约数，使 gcd = 1
  let g = 0n;
  for (const x of ints) g = gcdAbs(g, x);
  if (g > 1n) ints = ints.map((x) => x / g);

  // 各元素两侧原子总数
  const elementRows = elements.map((el) => {
    let l = 0n;
    let rr = 0n;
    leftCounts.forEach((counts, j) => {
      l += BigInt(counts.get(el) || 0) * ints[j];
    });
    rightCounts.forEach((counts, j) => {
      rr += BigInt(counts.get(el) || 0) * ints[nLeft + j];
    });
    return { symbol: el, left: toJsonNumber(l), right: toJsonNumber(rr) };
  });

  return {
    status: 'balanced',
    coefficients: {
      left: ints.slice(0, nLeft).map(toJsonNumber),
      right: ints.slice(nLeft).map(toJsonNumber),
    },
    elements: elementRows,
  };
}
