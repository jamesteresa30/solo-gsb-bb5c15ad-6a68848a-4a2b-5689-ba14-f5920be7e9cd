import { useEffect, useState } from 'react';
import FormulaText from './FormulaText.jsx';
import FracText from './FracText.jsx';

const blankObs = (n) => Array.from({ length: n }, () => ({ lower: '', upper: '' }));

/** 单个观测区间输入（上下限成对；同时留空表示未观测）。 */
function ObsFields({ value, errors, onChange }) {
  const errLower = errors.find((e) => e.field === 'lower');
  const errUpper = errors.find((e) => e.field === 'upper');
  const errRow = errors.find((e) => e.field === null);
  return (
    <>
      <div className="feed-fields">
        <label className={errLower ? 'field-error' : ''}>
          <span className="field-tag">下限</span>
          <input
            value={value.lower}
            inputMode="decimal"
            placeholder="未观测"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange('lower', e.target.value)}
          />
        </label>
        <span className="feed-sep">～</span>
        <label className={errUpper ? 'field-error' : ''}>
          <span className="field-tag">上限</span>
          <input
            value={value.upper}
            inputMode="decimal"
            placeholder="未观测"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange('upper', e.target.value)}
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
    </>
  );
}

function rangeText(rg) {
  return rg.lower.trim() !== '' && rg.upper.trim() !== ''
    ? `${rg.lower} ～ ${rg.upper}`
    : '未填写';
}

// 投料区间由父组件与投料区间分析共享：此处沿用同一组区间，不重复填写。
export default function ObservationCheck({ left, right, coefficients, ranges }) {
  const [remaining, setRemaining] = useState(() => blankObs(left.length));
  const [produced, setProduced] = useState(() => blankObs(right.length));
  const [loading, setLoading] = useState(false);
  const [check, setCheck] = useState(null);
  const [errors, setErrors] = useState([]);
  const [networkError, setNetworkError] = useState('');

  const clearResult = () => {
    setCheck(null);
    setErrors([]);
    setNetworkError('');
  };

  // 投料区间被修改后，上一次核验结论随之失效
  const rangesKey = JSON.stringify(ranges);
  useEffect(clearResult, [rangesKey]);

  const setObs = (setter) => (index, field, value) => {
    setter((list) => list.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    clearResult();
  };

  const rowErrors = (section, i) => errors.filter((e) => e.section === section && e.index === i);
  const globalErrors = errors.filter(
    (e) => e.index < 0 || e.section === 'feed' || e.section == null
  );

  const verify = async () => {
    setLoading(true);
    clearResult();
    try {
      const res = await fetch('/api/observation-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left, right, ranges, remaining, produced }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.ok) setCheck(json.result.check);
      else setErrors(json.errors ?? []);
    } catch (e) {
      setNetworkError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="feed-section obs-section">
      <h3>实验观测核验</h3>
      <p className="feed-intro">
        沿用上方配平结果与投料区间。为各生成物的<strong>实际生成量</strong>、各反应物的
        <strong>实际剩余量</strong>填写可选闭区间（mol，最多 6 位小数；上下限同时填写，
        <strong>留空表示未观测</strong>）。系统用精确有理数联合判断：是否存在
        <strong>同一组</strong>投料与反应进度 ξ，使生成量 = cⱼξ、剩余量 = nᵢ−cᵢξ，
        且至少一种反应物恰好耗尽（不会逐项独立比对观测范围）。
      </p>

      <div className="feed-rows">
        {left.map((formula, i) => (
          <div
            key={`r${i}`}
            className={`feed-row ${rowErrors('remaining', i).length ? 'has-error' : ''}`}
          >
            <span className="feed-name">
              <span className="feed-coef">{coefficients.left[i]}</span>
              <FormulaText formula={formula.trim()} />
              <span className="obs-feed-range">投料 {rangeText(ranges[i])} mol</span>
            </span>
            <ObsFields
              value={remaining[i]}
              errors={rowErrors('remaining', i)}
              onChange={(field, v) => setObs(setRemaining)(i, field, v)}
            />
          </div>
        ))}
        {right.map((formula, i) => (
          <div
            key={`p${i}`}
            className={`feed-row ${rowErrors('produced', i).length ? 'has-error' : ''}`}
          >
            <span className="feed-name">
              <span className="feed-coef">{coefficients.right[i]}</span>
              <FormulaText formula={formula.trim()} />
              <span className="obs-feed-range">生成物</span>
            </span>
            <ObsFields
              value={produced[i]}
              errors={rowErrors('produced', i)}
              onChange={(field, v) => setObs(setProduced)(i, field, v)}
            />
          </div>
        ))}
      </div>

      <div className="feed-action">
        <button type="button" className="analyze-btn obs-btn" disabled={loading} onClick={verify}>
          {loading ? '核验中…' : '核验观测'}
        </button>
        <span className="syntax-hint">
          可行时给出一组投料与进度见证；不可行时指出观测冲突；全部留空则提示补填。
        </span>
      </div>

      {globalErrors.length > 0 && (
        <ul className="feed-global-errors">
          {globalErrors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
      {networkError && <div className="notice notice-error">{networkError}</div>}

      {check && check.status === 'no-observation' && (
        <div className="notice notice-warn obs-verdict">
          <strong>未观测</strong>
          <p>{check.message}</p>
        </div>
      )}

      {check && check.status === 'infeasible' && (
        <div className="notice notice-error obs-verdict">
          <strong>不可行</strong>
          <p>{check.message}</p>
          <ul className="obs-reasons">
            {check.reasons.map((r, i) => (
              <li key={i}>{r.text}</li>
            ))}
          </ul>
        </div>
      )}

      {check && check.status === 'feasible' && (
        <div className="notice notice-ok obs-verdict">
          <strong>可行</strong>
          <p>{check.message}</p>
          <div className="xi-line">
            见证反应进度 ξ = <FracText v={check.witness.xi} /> mol
          </div>
          <table className="feed-table">
            <thead>
              <tr>
                <th>反应物</th>
                <th>见证投料 nᵢ（mol）</th>
                <th>见证剩余 nᵢ−cᵢξ（mol）</th>
                <th>是否耗尽</th>
              </tr>
            </thead>
            <tbody>
              {check.witness.feeds.map((n, i) => (
                <tr key={i}>
                  <td className="el-symbol">
                    <FormulaText formula={left[i].trim()} />
                  </td>
                  <td className="num-cell">
                    <FracText v={n} />
                  </td>
                  <td className="num-cell">
                    <FracText v={check.witness.remaining[i]} />
                  </td>
                  <td>{i === check.limitingIndex ? '✓ 耗尽（限量）' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="feed-table">
            <thead>
              <tr>
                <th>生成物</th>
                <th>见证生成量 cⱼξ（mol）</th>
              </tr>
            </thead>
            <tbody>
              {check.witness.produced.map((p, j) => (
                <tr key={j}>
                  <td className="el-symbol">
                    <FormulaText formula={right[j].trim()} />
                  </td>
                  <td className="num-cell">
                    <FracText v={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
