import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, ParseError } from '../chem/parse.js';
import { balanceEquation } from '../chem/balance.js';

const obj = (src) => Object.fromEntries(parseFormula(src));
const solve = (left, right) =>
  balanceEquation(left.map((s) => parseFormula(s)), right.map((s) => parseFormula(s)));

// ---------- 解析器 ----------

test('解析简单化学式', () => {
  assert.deepEqual(obj('H2O'), { H: 2, O: 1 });
  assert.deepEqual(obj('O2'), { O: 2 });
  assert.deepEqual(obj('C6H12O6'), { C: 6, H: 12, O: 6 });
});

test('元素符号区分大小写', () => {
  assert.deepEqual(obj('Co'), { Co: 1 }); // 钴
  assert.deepEqual(obj('CO'), { C: 1, O: 1 }); // 一氧化碳
  assert.throws(() => parseFormula('cO'), (e) => e instanceof ParseError && e.position === 0);
  assert.throws(() => parseFormula('na'), ParseError);
});

test('解析括号与多层嵌套（最多三层）', () => {
  assert.deepEqual(obj('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(obj('K4(Fe(CN)6)'), { K: 4, Fe: 1, C: 6, N: 6 }); // 两层
  assert.deepEqual(obj('H(He(Li(Be)2)3)4'), { H: 1, He: 4, Li: 12, Be: 24 }); // 三层
  assert.throws(
    () => parseFormula('H(He(Li(Be(B)2)3)4)'), // 四层
    (e) => e instanceof ParseError && /3 层/.test(e.message)
  );
});

test('未知元素符号报错并定位', () => {
  assert.throws(
    () => parseFormula('H2XxO'),
    (e) => e instanceof ParseError && e.position === 2 && /Xx/.test(e.message)
  );
});

test('非法语法均携带字符位置', () => {
  const cases = [
    ['2H2O', 0], // 前置系数
    ['H2O)', 3], // 多余右括号
    ['(H2O', 0], // 未闭合
    ['H0', 1], // 下标为 0
    ['H02', 1], // 前导零
    ['CuSO4·5H2O', 5], // 水合点号
    ['Fe^3+', 2], // 电荷
    ['H2 O', 2], // 空格
    ['Fe(OH', 2], // 未闭合括号定位到 '('
    ['H2[]', 2], // 方括号
  ];
  for (const [src, pos] of cases) {
    assert.throws(
      () => parseFormula(src),
      (e) => e instanceof ParseError && e.position === pos,
      `${src} 应在位置 ${pos} 报错`
    );
  }
});

// ---------- 配平求解 ----------

test('氢气燃烧', () => {
  const r = solve(['H2', 'O2'], ['H2O']);
  assert.equal(r.status, 'balanced');
  assert.deepEqual(r.coefficients, { left: [2, 1], right: [2] });
  assert.deepEqual(r.elements, [
    { symbol: 'H', left: 4, right: 4 },
    { symbol: 'O', left: 2, right: 2 },
  ]);
});

test('甲烷燃烧', () => {
  const r = solve(['CH4', 'O2'], ['CO2', 'H2O']);
  assert.deepEqual(r.coefficients, { left: [1, 2], right: [1, 2] });
});

test('高锰酸钾与盐酸（系数 gcd=1）', () => {
  const r = solve(['KMnO4', 'HCl'], ['KCl', 'MnCl2', 'Cl2', 'H2O']);
  assert.equal(r.status, 'balanced');
  assert.deepEqual(r.coefficients, { left: [2, 16], right: [2, 2, 5, 8] });
});

test('含括号：磷酸与氢氧化钙', () => {
  const r = solve(['Ca(OH)2', 'H3PO4'], ['Ca3(PO4)2', 'H2O']);
  assert.deepEqual(r.coefficients, { left: [3, 2], right: [1, 6] });
});

test('庚烷燃烧（较大系数）', () => {
  const r = solve(['C7H16', 'O2'], ['CO2', 'H2O']);
  assert.deepEqual(r.coefficients, { left: [1, 11], right: [7, 8] });
});

test('系数约到 gcd=1', () => {
  const r = solve(['H2O2'], ['H2O', 'O2']);
  assert.deepEqual(r.coefficients, { left: [2], right: [2, 1] });
});

test('元素不守恒：无正解（只有零解）', () => {
  const r = solve(['H2', 'O2'], ['CO2']);
  assert.equal(r.status, 'no-positive-solution');
});

test('系数出现异号：无正解', () => {
  const r = solve(['O2', 'H2O'], ['H2']);
  assert.equal(r.status, 'no-positive-solution');
});

test('零空间维数大于一：解不唯一，不任意挑选', () => {
  const r = solve(['H2', 'O2'], ['H2O', 'H2O2']);
  assert.equal(r.status, 'not-unique');
  assert.equal(r.nullity, 2);
});

test('配平后每种元素两侧原子数相等', () => {
  const r = solve(['Cu', 'HNO3'], ['Cu(NO3)2', 'NO', 'H2O']);
  assert.equal(r.status, 'balanced');
  for (const row of r.elements) assert.equal(row.left, row.right);
});
