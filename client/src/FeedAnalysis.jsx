import { useState } from 'react';
import FormulaText from './FormulaText.jsx';
import FracText from './FracText.jsx';

const LIMIT_META = {
  always: { text: '均限量', cls: 'limit-always', hint: '在所有允许投料组合中都是限量反应物' },
  partial: { text: '部分限量', cls: 'limit-partial', hint: '仅在部分允许投料组合中是限量反应物' },
  never: { text: '从不限量', cls: 'limit-never', hint: '在所有允许投料组合中都不是限量反应物' },
};

function RangeRow({ index, formula, coefficient, rg, errors, onChange }) {
  const errLower = errors.find((e) => e.field === 'lower');
  const errUpper = errors.find((e) => e.field === 'upper');
  const errRow = errors.find((e) => e.field === null);
  return (
    <div className={`feed-row ${errors.length ? 'has-error' : ''}`}>
      <span className="feed-name">
        <span className="feed-coef">{coefficient}</span>
        <FormulaText formula={formula} />
      </span>
      <div className="feed-fields">
        <label className={errLower ? 'field-error' : ''}>
          <span className="field-tag">下限</span>
          <input
            value={rg.lower}
            inputMode="decimal"
            placeholder="0.00"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange(index, 'lower', e.target.value)}
          />
        </label>
        <span className="feed-sep">～</span>
        <label className={errUpper ? 'field-error' : ''}>
          <span className="field-tag">上限</span>
          <input
            value={rg.upper}
            inputMode="decimal"
            placeholder="0.00"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange(index, 'upper', e.target.value)}
          />
        </label>
        <span className="feed-unit">mol</span>
      </div>
      <div className="feed-row-errors">
        {[...(errLower ? [errLower] : []), ...(errUpper ? [errUpper] : []), ...(errRow ? [errRow] : [])].map(
          (e, i) => (
            <span key={i} className="field-msg">
              {e.message}
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ranges / onRangesChange 由父组件托管：观测核验区沿用同一组投料区间。
export default function FeedAnalysis({ left, right, coefficients, ranges, onRangesChange }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState([]);
  const [networkError, setNetworkError] = useState('');

  const setField = (index, field, value) => {
    onRangesChange(index, field, value);
    // 修改投料即清除上一次分析结果
    setData(null);
    setErrors([]);
    setNetworkError('');
  };

  const errorsByIndex = (i) => errors.filter((e) => e.side === 'left' && e.index === i);
  const globalErrors = errors.filter((e) => e.side !== 'left' || e.index < 0);

  const analyze = async () => {
    setLoading(true);
    setData(null);
    setErrors([]);
    setNetworkError('');
    try {
      const res = await fetch('/api/feed-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right, ranges }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.ok) setData(json.result.analysis);
      else setErrors(json.errors ?? []);
    } catch (e) {
      setNetworkError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="feed-section">
      <h3>投料区间分析</h3>
      <p className="feed-intro">
        生成物初始量为 <strong>0</strong>，按<strong>完全反应</strong>计算：ξ = min(nᵢ/cᵢ)。
        为每种反应物填写以 <strong>mol</strong> 为单位的非负投料区间（下限 ≤ 上限，最多 6 位小数），
        各区间相互独立；系统在<strong>所有允许投料组合</strong>上用精确有理数联合求生成量、剩余量的可达范围
        （非端点独立相减）。
      </p>

      <div className="feed-rows">
        {left.map((formula, i) => (
          <RangeRow
            key={i}
            index={i}
            formula={formula.trim()}
            coefficient={coefficients.left[i]}
            rg={ranges[i]}
            errors={errorsByIndex(i)}
            onChange={setField}
          />
        ))}
      </div>

      <div className="feed-action">
        <button type="button" className="analyze-btn" disabled={loading} onClick={analyze}>
          {loading ? '计算中…' : '分析投料区间'}
        </button>
        <span className="syntax-hint">并列最小者均按限量反应物计；结果以约分分数展示，单位 mol。</span>
      </div>

      {globalErrors.length > 0 && (
        <ul className="feed-global-errors">
          {globalErrors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
      {networkError && <div className="notice notice-error">{networkError}</div>}

      {data && (
        <div className="feed-result">
          <div className="xi-line">
            反应进度 ξ 的可达范围：
            <FracText v={data.xi.min} /> ～ <FracText v={data.xi.max} /> mol
          </div>

          <table className="feed-table">
            <thead>
              <tr>
                <th>反应物</th>
                <th>系数 cᵢ</th>
                <th>剩余量最小值</th>
                <th>剩余量最大值</th>
                <th>限量情况</th>
              </tr>
            </thead>
            <tbody>
              {data.reactants.map((r, i) => {
                const meta = LIMIT_META[r.limiting];
                return (
                  <tr key={i}>
                    <td className="el-symbol">
                      <FormulaText formula={left[i].trim()} />
                    </td>
                    <td>{r.coefficient}</td>
                    <td className="num-cell">
                      <FracText v={r.remaining.min} />
                    </td>
                    <td className="num-cell">
                      <FracText v={r.remaining.max} />
                    </td>
                    <td>
                      <span className={`limit-badge ${meta.cls}`} title={meta.hint}>
                        {meta.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className="feed-table">
            <thead>
              <tr>
                <th>生成物（初始量 0）</th>
                <th>系数 cⱼ</th>
                <th>生成量最小值</th>
                <th>生成量最大值</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p, i) => (
                <tr key={i}>
                  <td className="el-symbol">
                    <FormulaText formula={right[i].trim()} />
                  </td>
                  <td>{p.coefficient}</td>
                  <td className="num-cell">
                    <FracText v={p.produced.min} />
                  </td>
                  <td className="num-cell">
                    <FracText v={p.produced.max} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="limit-legend">
            <span className="legend-label">限量说明：</span>
            {Object.values(LIMIT_META).map((m) => (
              <span key={m.cls} className="legend-item">
                <span className={`limit-badge ${m.cls}`}>{m.text}</span>
                <span className="legend-hint">{m.hint}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
