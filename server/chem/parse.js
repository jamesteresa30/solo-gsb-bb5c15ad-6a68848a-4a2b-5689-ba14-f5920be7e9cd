// 化学式解析器：大小写区分的元素符号、正整数下标、最多三层圆括号。
// 不支持电荷、水合点号、前置系数。语法错误携带字符位置（0 基）。

export const ELEMENTS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
    'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba ' +
    'La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb ' +
    'Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs ' +
    'Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ')
);

export const MAX_DEPTH = 3;
export const MAX_SUBSCRIPT = 1000000;

export class ParseError extends Error {
  constructor(position, message) {
    super(message);
    this.name = 'ParseError';
    this.position = position; // 0 基字符下标
  }
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isUpper = (ch) => ch >= 'A' && ch <= 'Z';
const isLower = (ch) => ch >= 'a' && ch <= 'z';

/**
 * 解析单个化学式，返回 Map<元素符号, 原子数>。
 * 语法错误抛出 ParseError（含 position）。
 */
export function parseFormula(src) {
  if (typeof src !== 'string') throw new ParseError(0, '化学式必须是字符串');
  let i = 0;
  const fail = (pos, msg) => {
    throw new ParseError(pos, msg);
  };

  function parseNumber() {
    if (i >= src.length || !isDigit(src[i])) return 1;
    if (src[i] === '0') fail(i, '下标必须是正整数，不能以 0 开头');
    let n = 0;
    while (i < src.length && isDigit(src[i])) {
      n = n * 10 + (src.charCodeAt(i) - 48);
      if (n > MAX_SUBSCRIPT) fail(i, '下标数值过大');
      i++;
    }
    return n;
  }

  function parseSequence(depth) {
    const counts = new Map();
    while (i < src.length && src[i] !== ')') {
      const ch = src[i];
      if (isUpper(ch)) {
        const start = i;
        let sym = ch;
        i++;
        if (i < src.length && isLower(src[i])) {
          sym += src[i];
          i++;
        }
        if (!ELEMENTS.has(sym)) {
          fail(start, `未知元素符号“${sym}”（元素符号区分大小写）`);
        }
        const n = parseNumber();
        counts.set(sym, (counts.get(sym) || 0) + n);
      } else if (ch === '(') {
        if (depth + 1 > MAX_DEPTH) fail(i, `括号嵌套最多 ${MAX_DEPTH} 层`);
        const openPos = i;
        i++;
        const inner = parseSequence(depth + 1);
        if (i >= src.length) fail(openPos, '括号未闭合：缺少对应的“)”');
        if (inner.size === 0) fail(openPos, '括号内不能为空');
        i++; // 消费 ')'
        const n = parseNumber();
        for (const [el, c] of inner) {
          counts.set(el, (counts.get(el) || 0) + c * n);
        }
      } else if (isLower(ch)) {
        fail(i, `小写字母“${ch}”不能独立出现，元素符号须以大写字母开头`);
      } else if (isDigit(ch)) {
        fail(i, `数字“${ch}”位置错误：下标须紧跟元素符号或“)”，且不支持前置系数`);
      } else if (ch === '·' || ch === '.' || ch === '•') {
        fail(i, '不支持水合点号（如 CuSO4·5H2O 中的“·”）');
      } else if (ch === '^') {
        fail(i, '不支持电荷标注');
      } else if (ch === '+' || ch === '-') {
        fail(i, `不支持字符“${ch}”：每种物质请单独填写，且不支持电荷`);
      } else if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
        fail(i, '只支持圆括号“()”，不支持方括号或花括号');
      } else if (ch === ' ' || ch === '　') {
        fail(i, '化学式中不能包含空格');
      } else {
        fail(i, `无法识别的字符“${ch}”`);
      }
    }
    return counts;
  }

  const counts = parseSequence(0);
  if (counts.size === 0) fail(0, '化学式不能为空');
  if (i < src.length) fail(i, '多余的“)”，没有匹配的“(”');
  return counts;
}
