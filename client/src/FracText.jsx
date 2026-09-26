export default function FracText({ v }) {
  // 约分分数（服务端已约分）：整数直接显示，否则分子/分母竖排
  if (v.den === '1') return <span className="frac-int">{v.num}</span>;
  return (
    <span className="frac">
      <span className="frac-num">{v.num}</span>
      <span className="frac-bar" />
      <span className="frac-den">{v.den}</span>
    </span>
  );
}
