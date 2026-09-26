import { useState } from 'react';
import FormulaText from './FormulaText.jsx';
import BalanceTools from './BalanceTools.jsx';

const EXAMPLES = [
  { name: '氢气燃烧', left: ['H2', 'O2'], right: ['H2O'] },
  { name: '甲烷燃烧', left: ['CH4', 'O2'], right: ['CO2', 'H2O'] },
  { name: '实验室制氯气', left: ['KMnO4', 'HCl'], right: ['KCl', 'MnCl2', 'Cl2', 'H2O'] },
  { name: '磷酸钙（括号）', left: ['Ca(OH)2', 'H3PO4'], right: ['Ca3(PO4)2', 'H2O'] },
  { name: '两层括号', left: ['K4(Fe(CN)6)', 'H2SO4', 'H2O'], right: ['K2SO4', 'FeSO4', '(NH4)2SO4', 'CO'] },
  { name: '铜与稀硝酸', left: ['Cu', 'HNO3'], right: ['Cu(NO3)2', 'NO', 'H2O'] },
  { name: '无正解示例', left: ['H2', 'O2'], right: ['CO2'] },
  { name: '解不唯一示例', left: ['H2', 'O2'], right: ['H2O', 'H2O2'] },
];

function SubstancePanel({ title, accent, items, onChange, onRemove, onAdd }) {
  return (
    <section className={`panel panel-${accent}`}>
      <h2>{title}</h2>
      <div className="rows">
        {items.map((value, index) => (
          <div className="row" key={index}>
            <span className="row-index">{index + 1}</span>
            <input
              value={value}
              spellCheck="false"
              autoComplete="off"
              placeholder="如 Ca(OH)2"
              onChange={(e) => onChange(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
              }}
            />
            <button
              type="button"
              className="icon-btn"
              title="删除该物质"
              disabled={items.length <= 1}
              onClick={() => onRemove(index)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add-btn" onClick={onAdd}>
        ＋ 添加物质
      </button>
    </section>
  );
}

/** 语法错误条目（含物质序号与字符位置）。 */
function ErrorItem({ err }) {
  const sideLabel = err.side === 'left' ? '左侧' : '右侧';
  const which = err.index >= 0 ? `第 ${err.index + 1} 个物质` : '整体';
  const pointer =
    err.position != null && err.formula != null ? (
      <pre className="pointer">
        {err.formula}
        {'\n'}
        {' '.repeat(err.position - 1)}^
      </pre>
    ) : null;
  return (
    <li>
      <div className="error-head">
        <strong>{sideLabel}</strong> · {which}
        {err.position != null ? ` · 第 ${err.position} 个字符` : ''}：{err.message}
      </div>
      {pointer}
    </li>
  );
}

function EquationTerm({ coefficient, formula }) {
  return (
    <span className="term">
      {Number(coefficient) > 1 && <span className="coef">{coefficient}</span>}
      <FormulaText formula={formula} />
    </span>
  );
}

export default function App() {
  const [left, setLeft] = useState(['H2', 'O2']);
  const [right, setRight] = useState(['H2O']);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);
  const [networkError, setNetworkError] = useState('');

  const updateSide = (setter) => (index, value) =>
    setter((list) => list.map((v, i) => (i === index ? value : v)));
  const addSide = (setter) => () => setter((list) => [...list, '']);
  const removeSide = (setter) => (index) =>
    setter((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list));

  const loadExample = (ex) => {
    setLeft(ex.left.slice());
    setRight(ex.right.slice());
    setResp(null);
    setNetworkError('');
  };

  const handleBalance = async () => {
    setLoading(true);
    setResp(null);
    setNetworkError('');
    try {
      const res = await fetch('/api/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResp(await res.json());
    } catch (e) {
      setNetworkError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setLoading(false);
    }
  };

  const result = resp?.ok ? resp.result : null;

  return (
    <div className="page">
      <header>
        <h1>化学反应式配平</h1>
        <p className="subtitle">
          精确有理数消元 · 元素守恒矩阵 · 零空间一维且系数全为正时才给出解
        </p>
      </header>

      <div className="examples">
        <span className="examples-label">可编辑示例：</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.name} type="button" className="chip" onClick={() => loadExample(ex)}>
            {ex.name}
          </button>
        ))}
      </div>

      <div className="panels">
        <SubstancePanel
          title="左侧：反应物"
          accent="left"
          items={left}
          onChange={updateSide(setLeft)}
          onRemove={removeSide(setLeft)}
          onAdd={addSide(setLeft)}
        />
        <div className="arrow" aria-hidden="true">
          ⇌
        </div>
        <SubstancePanel
          title="右侧：生成物"
          accent="right"
          items={right}
          onChange={updateSide(setRight)}
          onRemove={removeSide(setRight)}
          onAdd={addSide(setRight)}
        />
      </div>

      <div className="action">
        <button type="button" className="balance-btn" disabled={loading} onClick={handleBalance}>
          {loading ? '求解中…' : '配平'}
        </button>
        <span className="syntax-hint">
          语法：元素符号区分大小写（Na ≠ na）、正整数下标、圆括号最多三层；不支持电荷、水合点号和前置系数
        </span>
      </div>

      {networkError && <div className="notice notice-error">{networkError}</div>}

      {resp && !resp.ok && (
        <div className="result notice notice-error">
          <h2>语法错误</h2>
          <ul className="error-list">
            {resp.errors.map((err, i) => (
              <ErrorItem key={i} err={err} />
            ))}
          </ul>
        </div>
      )}

      {result && result.status === 'balanced' && (
        <div className="result">
          <h2>配平结果</h2>
          <div className="equation">
            {left.map((formula, i) => (
              <span key={`l${i}`} className="joined">
                {i > 0 && <span className="plus"> + </span>}
                <EquationTerm coefficient={result.coefficients.left[i]} formula={formula.trim()} />
              </span>
            ))}
            <span className="eq-arrow"> ⟶ </span>
            {right.map((formula, i) => (
              <span key={`r${i}`} className="joined">
                {i > 0 && <span className="plus"> + </span>}
                <EquationTerm coefficient={result.coefficients.right[i]} formula={formula.trim()} />
              </span>
            ))}
          </div>

          <h3>各元素原子总数</h3>
          <table className="atom-table">
            <thead>
              <tr>
                <th>元素</th>
                <th>左侧</th>
                <th>右侧</th>
                <th>是否守恒</th>
              </tr>
            </thead>
            <tbody>
              {result.elements.map((row) => (
                <tr key={row.symbol}>
                  <td className="el-symbol">{row.symbol}</td>
                  <td>{row.left}</td>
                  <td>{row.right}</td>
                  <td>{String(row.left) === String(row.right) ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/*
            投料区间分析 / 实验观测核验均仅对唯一正系数解开放；key 随反应式变化，
            一旦修改反应式（含增删物质、载入示例）即整体重挂载，清除投料输入与结果。
          */}
          <BalanceTools
            key={`${left.map((f) => f.trim()).join('|')}#${right.map((f) => f.trim()).join('|')}`}
            left={left.map((f) => f.trim())}
            right={right.map((f) => f.trim())}
            coefficients={result.coefficients}
          />
        </div>
      )}

      {result && result.status === 'no-positive-solution' && (
        <div className="result notice notice-warn">
          <h2>无正解</h2>
          <p>
            该物质组合不存在一组<strong>全部严格为正整数</strong>的配平系数
            {result.reason === 'only-trivial'
              ? '：元素无法守恒，零空间只有零解。'
              : result.reason === 'zero-coefficient'
                ? '：唯一成比例的解中某些物质系数为 0。'
                : '：唯一成比例的解中系数存在异号，说明有物质应放到等式另一侧。'}
          </p>
          <p className="note">系统不会从无解或多解的情形中任意挑选系数。</p>
        </div>
      )}

      {result && result.status === 'not-unique' && (
        <div className="result notice notice-warn">
          <h2>解不唯一</h2>
          <p>
            该反应配平系数的<strong>零空间维数为 {result.nullity}</strong>，
            存在无穷多组（线性无关的）正整数系数，无法唯一配平。
          </p>
          <p className="note">请检查是否漏写/多写了物质，或该反应本身无法唯一确定。系统不会任意挑选一组解。</p>
        </div>
      )}

      <footer>
        <small>
          系数为最大公约数等于 1 的最简正整数；数值采用 BigInt 有理数精确计算。
        </small>
      </footer>
    </div>
  );
}
