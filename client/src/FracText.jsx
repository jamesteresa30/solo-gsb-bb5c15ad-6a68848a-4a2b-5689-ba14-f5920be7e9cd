/** 服务端返回的约分分数（{num,den} 字符串）：整数直接显示，否则分子/分母竖排。 */
export default function FracText({ v }) {
  if (v.den === '1') return <span className="frac-int">{v.num}</span>;
  return (
    <span className="frac">
      <span className="frac-num">{v.num}</span>
      <span className="frac-bar" />
      <span className="frac-den">{v.den}</span>
    </span>
  );
}
