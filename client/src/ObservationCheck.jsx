import { useEffect, useState } from 'react';
import FormulaText from './FormulaText.jsx';
import FracText from './FracText.jsx';

const BOUND_RE = /^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

/** 一行物质的可选观测闭区间；两栏都留空表示未观测。 */
function ObservationRow({ side, index, formula, coefficient, tag, ob, errors, onChange }) {
  const errLower = errors.find((e) => e.field === 'lower');
  const errUpper = errors.find((e) => e.field === 'upper');
  const errRow = errors.find((e) => e.field === null);
  return (
    <div className={`feed-row obs-row ${errors.length ? 'has-error' : ''}`}>
      <span className="feed-name">
        <span className="feed-coef">{coefficient}</span>
        <FormulaText formula={formula} />
      </span>
      <div className="feed-fields">
        <label className={errLower ? 'field-error' : ''}>
          <span className="field-tag">观测{tag}下限</span>
          <input
            value={ob.lower}
            inputMode="decimal"
            placeholder="留空未观测"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange(side, index, 'lower', e.target.value)}
          />
        </label>
        <span className="feed-sep">～</span>
        <label className={errUpper ? 'field-error' : ''}>
          <span className="field-tag">上限</span>
          <input
            value={ob.upper}
            inputMode="decimal"
            placeholder="留空未观测"
            spellCheck="false"
            autoComplete="off"
            onChange={(e) => onChange(side, index, 'upper', e.target.value)}
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

export default function ObservationCheck({ left, right, coefficients, ranges }) {
  const [reactantObs, setReactantObs] = useState(() =>
    left.map(() => ({ lower: '', upper: '' }))
  );
  const [productObs, setProductObs] = useState(() =>
    right.map(() => ({ lower: '', upper: '' }))
  );
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [errors, setErrors] = useState([]);
  const [networkError, setNetworkError] = useState('');

  // 上方投料区间一旦修改，上一次核验结论即失效（核验沿用同一组投料区间）。
  const rangeSig = JSON.stringify(ranges);
  useEffect(() => {
    setVerdict(null);
    setErrors([]);
    setNetworkError('');
  }, [rangeSig]);

  const setObs = (side, index, field, value) => {
    const setter = side === 'left' ? setReactantObs : setProductObs;
    setter((list) => list.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
    setVerdict(null);
    setErrors([]);
    setNetworkError('');
  };

  const obsErrors = errors.filter((e) => e.scope === 'observation');
  const globalErrors = errors.filter((e) => e.scope !== 'observation');
  const errorsFor = (side, i) =>
    obsErrors.filter((e) => e.side === side && e.index === i);

  /** 提交前先在页面上确认上方投料区间已完整且合法（服务端仍会权威校验）。 */
  const precheckRanges = () => {
    const problems = [];
    ranges.forEach((rg, i) => {
      if (rg.lower.trim() === '' || rg.upper.trim() === '') {
        problems.push(`反应物“${left[i]}”的投料区间上下限必须都填写`);
      } else if (!BOUND_RE.test(rg.lower.trim()) || !BOUND_RE.test(rg.upper.trim())) {
        problems.push(`反应物“${left[i]}”的投料区间数值不合法`);
      } else {
        const l = parseLoose(rg.lower);
        const u = parseLoose(rg.upper);
        if (l !== null && u !== null && l > u) problems.push(`反应物“${left[i]}”的投料下限大于上限`);
      }
    });
    return problems;
  };

  const check = async () => {
    setLoading(true);
    setVerdict(null);
    setErrors([]);
    setNetworkError('');

    const localFeedProblems = precheckRanges();
    if (localFeedProblems.length > 0) {
      setErrors([
        {
          side: 'left',
          index: -1,
          field: null,
          scope: 'feed',
          message: '实验观测核验沿用上方各反应物的投料区间，请先补全并修正投料区间',
        },
        ...localFeedProblems.map((m) => ({ side: 'left', index: -1, field: null, scope: 'feed', message: m })),
      ]);
      setLoading(false);
      return;
    }

    const blank = (v) => v.trim() === '';
    // 页面即时提示“只填了一个界”的行，不发请求。
    const halfFilled = [];
    const scan = (list, side, tag) =>
      list.forEach((o, i) => {
        if (blank(o.lower) !== blank(o.upper)) {
          halfFilled.push({
            side,
            index: i,
            field: blank(o.lower) ? 'lower' : 'upper',
            scope: 'observation',
            message: `${tag}观测区间的下限与上限必须同时填写（都留空表示未观测）`,
          });
        }
      });
    scan(reactantObs, 'left', '剩余量');
    scan(productObs, 'right', '生成量');
    if (halfFilled.length > 0) {
      setErrors(halfFilled);
      setLoading(false);
      return;
    }

    const toWire = (list) =>
      list.map((o) =>
        blank(o.lower) && blank(o.upper)
          ? { lower: null, upper: null }
          : { lower: o.lower.trim(), upper: o.upper.trim() }
      );

    try {
      const res = await fetch('/api/observe-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          left,
          right,
          ranges,
          observations: { reactants: toWire(reactantObs), products: toWire(productObs) },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.ok) setVerdict(json.result.verdict);
      else setErrors(json.errors ?? []);
    } catch (e) {
      setNetworkError(`请求失败：${e.message}。请确认后端服务已启动。`);
    } finally {
      setLoading(false);
    }
  };

  const w = verdict?.feasible === true ? verdict.witness : null;

  return (
    <div className="obs-section">
      <h4>实验观测核验</h4>
      <p className="feed-intro">
        沿用已配平反应式与上方投料区间，为各<strong>生成物实际生成量</strong>、各
        <strong>反应物实际剩余量</strong>填写可选观测闭区间（mol，最多 6 位小数；
        <strong>整行留空表示未观测</strong>，上下限须成对填写）。服务端在
        <strong>同一组初始投料与同一个反应进度 ξ</strong> 上联合精确求解，判断是否存在
        生成量 = cⱼξ、剩余量 = nᵢ − cᵢξ 且<strong>至少一种反应物剩余为 0</strong>
        的相容取值（非逐项独立比对）。
      </p>

      <div className="obs-group-label">反应物 · 实际剩余量</div>
      <div className="feed-rows">
        {left.map((formula, i) => (
          <ObservationRow
            key={`l${i}`}
            side="left"
            index={i}
            formula={formula.trim()}
            coefficient={coefficients.left[i]}
            tag="剩余"
            ob={reactantObs[i]}
            errors={errorsFor('left', i)}
            onChange={setObs}
          />
        ))}
      </div>

      <div className="obs-group-label">生成物 · 实际生成量（初始量 0）</div>
      <div className="feed-rows">
        {right.map((formula, j) => (
          <ObservationRow
            key={`r${j}`}
            side="right"
            index={j}
            formula={formula.trim()}
            coefficient={coefficients.right[j]}
            tag="生成"
            ob={productObs[j]}
            errors={errorsFor('right', j)}
            onChange={setObs}
          />
        ))}
      </div>

      <div className="feed-action">
        <button type="button" className="observe-btn" disabled={loading} onClick={check}>
          {loading ? '核验中…' : '核验观测'}
        </button>
        <span className="syntax-hint">全部留空将提示补填；结果以精确约分分数给出。</span>
      </div>

      {globalErrors.length > 0 && (
        <ul className="feed-global-errors">
          {globalErrors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}
      {networkError && <div className="notice notice-error">{networkError}</div>}

      {verdict?.feasible === true && w && (
        <div className="obs-result obs-feasible">
          <div className="obs-verdict">
            <span className="obs-badge obs-badge-ok">可行</span>
            存在与全部观测相容的同一组投料与反应进度，见证如下（耗尽反应物已标出）：
          </div>
          <div className="xi-line">
            反应进度 ξ =
            <FracText v={w.xi} /> mol
          </div>
          <table className="feed-table">
            <thead>
              <tr>
                <th>反应物</th>
                <th>初始投料 nᵢ（mol）</th>
                <th>实际剩余量（mol）</th>
                <th>是否耗尽</th>
              </tr>
            </thead>
            <tbody>
              {left.map((formula, i) => (
                <tr key={i} className={i === w.exhaustedIndex ? 'witness-exhausted' : ''}>
                  <td className="el-symbol">
                    <FormulaText formula={formula.trim()} />
                  </td>
                  <td className="num-cell">
                    <FracText v={w.feeds[i]} />
                  </td>
                  <td className="num-cell">
                    <FracText v={w.remaining[i]} />
                  </td>
                  <td>{w.exhausted[i] ? <span className="obs-badge obs-badge-ex">耗尽</span> : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="feed-table">
            <thead>
              <tr>
                <th>生成物</th>
                <th>实际生成量 cⱼξ（mol）</th>
              </tr>
            </thead>
            <tbody>
              {right.map((formula, j) => (
                <tr key={j}>
                  <td className="el-symbol">
                    <FormulaText formula={formula.trim()} />
                  </td>
                  <td className="num-cell">
                    <FracText v={w.produced[j]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verdict?.feasible === false && (
        <div className="obs-result obs-infeasible">
          <div className="obs-verdict">
            <span className="obs-badge obs-badge-bad">不可行</span>
          </div>
          <p className="obs-conflict">{verdict.message}</p>
        </div>
      )}

      {verdict?.feasible === 'empty' && (
        <div className="obs-result obs-empty notice notice-warn">
          <div className="obs-verdict">
            <span className="obs-badge obs-badge-empty">缺少观测</span>
          </div>
          <p className="obs-conflict">{verdict.message}</p>
        </div>
      )}
    </div>
  );
}

// 仅供提交前本地预检比较大小（服务端始终使用精确有理数）。
function parseLoose(s) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  return Number(`${m[1]}.${m[2] ?? '0'}`);
}
