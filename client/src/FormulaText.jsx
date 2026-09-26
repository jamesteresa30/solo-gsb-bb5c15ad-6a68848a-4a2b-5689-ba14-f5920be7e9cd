/** 将已验证的化学式中的数字渲染为下标。 */
export default function FormulaText({ formula }) {
  return formula.split(/(\d+)/g).map((part, i) =>
    /^\d+$/.test(part) ? <sub key={i}>{part}</sub> : <span key={i}>{part}</span>
  );
}
