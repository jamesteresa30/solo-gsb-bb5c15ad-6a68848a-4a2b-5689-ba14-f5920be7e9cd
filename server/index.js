import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFormula, ParseError } from './chem/parse.js';
import { balanceEquation } from './chem/balance.js';
import { parseBound, analyzeFeed } from './chem/feed.js';
import { checkObservation } from './chem/observe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '64kb' }));

const MAX_SUBSTANCES = 20;
const MAX_FORMULA_LEN = 200;

/** 校验并解析两侧化学式；错误推入 errors（携带 side/index/position 定位）。 */
function parseSides(body) {
  const errors = [];
  const parsed = {};

  for (const side of ['left', 'right']) {
    const list = body[side];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push({ side, index: -1, position: null, message: '每侧至少填写一种物质' });
      continue;
    }
    if (list.length > MAX_SUBSTANCES) {
      errors.push({ side, index: -1, position: null, message: `每侧物质数量不能超过 ${MAX_SUBSTANCES}` });
      continue;
    }
    parsed[side] = list.map((formula, index) => {
      if (typeof formula !== 'string' || formula.trim() === '') {
        errors.push({ side, index, position: null, message: '化学式不能为空' });
        return null;
      }
      const trimmed = formula.trim();
      if (trimmed.length > MAX_FORMULA_LEN) {
        errors.push({ side, index, position: null, message: `化学式过长（最多 ${MAX_FORMULA_LEN} 个字符）` });
        return null;
      }
      try {
        return parseFormula(trimmed);
      } catch (e) {
        if (e instanceof ParseError) {
          errors.push({
            side,
            index,
            position: e.position + 1, // 转为 1 基，便于用户定位
            message: e.message,
            formula: trimmed,
          });
          return null;
        }
        throw e;
      }
    });
  }

  return { errors, parsed };
}

// 投料区间（与反应物等长）校验：返回 { ranges: Frac 区间数组 } 或 { errors }。
function parseRanges(body, count) {
  const errors = [];
  const rawRanges = body.ranges;
  if (!Array.isArray(rawRanges) || rawRanges.length !== count) {
    errors.push({
      side: 'left',
      index: -1,
      section: 'feed',
      field: null,
      message: '投料区间数量必须与反应物数量一致',
    });
    return { errors, ranges: null };
  }

  const ranges = [];
  rawRanges.forEach((rg, i) => {
    const push = (field, message) =>
      errors.push({ side: 'left', index: i, section: 'feed', field, message });

    if (rg === null || typeof rg !== 'object') {
      push(null, '投料区间格式不正确');
      ranges.push(null);
      return;
    }
    let lower;
    let upper;
    try {
      lower = parseBound(rg.lower);
    } catch (e) {
      push('lower', `下限无效：${e.message}`);
    }
    try {
      upper = parseBound(rg.upper);
    } catch (e) {
      push('upper', `上限无效：${e.message}`);
    }
    if (lower !== undefined && upper !== undefined && upper.sub(lower).sign() < 0) {
      push('upper', '上限不能小于下限');
    }
    ranges.push(lower !== undefined && upper !== undefined ? { lower, upper } : null);
  });

  if (errors.length > 0) return { errors, ranges: null };
  return { errors: [], ranges };
}

// 观测区间列表校验：每项必须上下界同时填写或同时留空（留空 = 未观测）。
// section: 'remaining'（反应物剩余）/ 'produced'（生成物生成）。
function parseObservations(raw, count, side, section, label) {
  const errors = [];
  if (!Array.isArray(raw) || raw.length !== count) {
    errors.push({
      side,
      index: -1,
      section,
      field: null,
      message: '观测区间数量必须与物质数量一致',
    });
    return { errors, obs: null };
  }

  const obs = [];
  raw.forEach((rg, i) => {
    const push = (field, message) => errors.push({ side, index: i, section, field, message });

    if (rg === null || typeof rg !== 'object') {
      push(null, '观测区间格式不正确');
      obs.push(null);
      return;
    }
    const hasLower = typeof rg.lower === 'string' && rg.lower.trim() !== '';
    const hasUpper = typeof rg.upper === 'string' && rg.upper.trim() !== '';
    if (!hasLower && !hasUpper) {
      obs.push(null);
      return;
    }
    if (hasLower !== hasUpper) {
      push(hasLower ? 'upper' : 'lower', '观测需上下限同时填写；仅留空一项表示未观测');
      obs.push(null);
      return;
    }
    let lower;
    let upper;
    try {
      lower = parseBound(rg.lower, label);
    } catch (e) {
      push('lower', `下限无效：${e.message}`);
    }
    try {
      upper = parseBound(rg.upper, label);
    } catch (e) {
      push('upper', `上限无效：${e.message}`);
    }
    if (lower !== undefined && upper !== undefined && upper.sub(lower).sign() < 0) {
      push('upper', '上限不能小于下限');
    }
    obs.push(lower !== undefined && upper !== undefined ? { lower, upper } : null);
  });

  if (errors.length > 0) return { errors, obs: null };
  return { errors: [], obs };
}

const fracText = ({ num, den }) => (den === '1' ? num : `${num}/${den}`);

// 把核验算法返回的结构化来源转成中文短语（化学式由调用方按 index 补全）。
function reasonText(reason, left, right) {
  const name = (side, i) => (side === 'left' ? left[i] : right[i]);
  switch (reason.kind) {
    case 'xi-clash': {
      const s = reason.lower.source;
      const t = reason.upper.source;
      return (
        `观测共同要求反应进度 ξ ≥ ${fracText(reason.lower.value)}` +
        `（${describeSource(s, left, right)}），` +
        `又要求 ξ ≤ ${fracText(reason.upper.value)}（${describeSource(t, left, right)}），二者无法同时成立。`
      );
    }
    case 'remaining-positive':
      return `${name('left', reason.index)} 的剩余量观测下限为 ${fracText(reason.lower)} mol > 0，` +
        '该物质不可能恰好耗尽，不能作为限量反应物。';
    case 'feed-lower':
      return `若 ${name('left', reason.index)} 耗尽，要求 ξ ≥ ${fracText(reason.xiLower)}，` +
        `但其余观测共同要求 ξ ≤ ${fracText(reason.xiUpper)}` +
        `（${describeSource(reason.upperSource, left, right)}），该物质无法在满足全部观测时耗尽。`;
    default:
      return '观测与投料区间不相容。';
  }
}

function describeSource(src, left, right) {
  switch (src.kind) {
    case 'nonneg':
      return '反应进度非负';
    case 'product':
      return `${right[src.index]} 生成量观测的${src.bound === 'lower' ? '下' : '上'}限`;
    case 'reactant':
      return src.observed
        ? `${left[src.index]} 投料区间与剩余量观测共同给出的${src.bound === 'lower' ? '下' : '上'}界`
        : `${left[src.index]} 投料上限（完全反应）给出的上界`;
    default:
      return '观测约束';
  }
}

app.post('/api/balance', (req, res) => {
  const { errors, parsed } = parseSides(req.body ?? {});
  if (errors.length > 0) return res.json({ ok: false, errors });

  const result = balanceEquation(parsed.left, parsed.right);
  res.json({ ok: true, result });
});

// 投料区间分析：仅在唯一正系数解（balanced）时有意义。
app.post('/api/feed-analysis', (req, res) => {
  const body = req.body ?? {};
  const { errors, parsed } = parseSides(body);
  if (errors.length > 0) return res.json({ ok: false, errors });

  const result = balanceEquation(parsed.left, parsed.right);
  if (result.status !== 'balanced') {
    return res.json({
      ok: false,
      errors: [
        {
          side: 'left',
          index: -1,
          position: null,
          message:
            result.status === 'not-unique'
              ? '该反应配平系数不唯一，投料区间分析仅对唯一正系数解开放'
              : '该反应无全部为正的配平系数，无法进行投料区间分析',
        },
      ],
    });
  }

  // 区间按物质定位：每侧/每个物质独立校验
  const { errors: rangeErrors, ranges } = parseRanges(body, parsed.left.length);
  if (rangeErrors.length > 0) return res.json({ ok: false, errors: rangeErrors });

  const analysis = analyzeFeed(result.coefficients.left, result.coefficients.right, ranges);

  res.json({
    ok: true,
    result: {
      status: 'balanced',
      coefficients: result.coefficients,
      analysis,
    },
  });
});

// 实验观测核验：沿用配平结果与投料区间，联合判定生成物生成量、反应物剩余量
// 观测闭区间是否能由同一组投料与反应进度实现（至少一种反应物耗尽）。
app.post('/api/observation-check', (req, res) => {
  const body = req.body ?? {};
  const { errors, parsed } = parseSides(body);
  if (errors.length > 0) return res.json({ ok: false, errors });

  const result = balanceEquation(parsed.left, parsed.right);
  if (result.status !== 'balanced') {
    return res.json({
      ok: false,
      errors: [
        {
          side: 'left',
          index: -1,
          section: null,
          field: null,
          message:
            result.status === 'not-unique'
              ? '该反应配平系数不唯一，观测核验仅对唯一正系数解开放'
              : '该反应无全部为正的配平系数，无法进行观测核验',
        },
      ],
    });
  }

  const { errors: rangeErrors, ranges } = parseRanges(body, parsed.left.length);
  if (rangeErrors.length > 0) return res.json({ ok: false, errors: rangeErrors });

  const leftNames = (body.left ?? []).map((f) => String(f).trim());
  const rightNames = (body.right ?? []).map((f) => String(f).trim());
  const remaining = parseObservations(
    body.remaining,
    parsed.left.length,
    'left',
    'remaining',
    '剩余量'
  );
  if (remaining.errors.length > 0) return res.json({ ok: false, errors: remaining.errors });
  const produced = parseObservations(
    body.produced,
    parsed.right.length,
    'right',
    'produced',
    '生成量'
  );
  if (produced.errors.length > 0) return res.json({ ok: false, errors: produced.errors });

  const check = checkObservation(
    result.coefficients.left,
    result.coefficients.right,
    ranges,
    remaining.obs,
    produced.obs
  );

  if (check.status === 'no-observation') {
    return res.json({
      ok: true,
      result: {
        status: 'balanced',
        coefficients: result.coefficients,
        check: {
          status: 'no-observation',
          message: '尚未填写任何观测区间：请至少为一种生成物或一种反应物补填实际量区间（上下限同时填写，留空表示未观测）。',
        },
      },
    });
  }

  if (check.status === 'infeasible') {
    return res.json({
      ok: true,
      result: {
        status: 'balanced',
        coefficients: result.coefficients,
        check: {
          status: 'infeasible',
          stage: check.stage,
          message:
            check.stage === 'joint'
              ? '观测冲突：各项观测对反应进度的共同要求互相矛盾，不存在满足全部观测的投料组合。'
              : '观测冲突：每种反应物若要完全耗尽都与观测相矛盾，即不存在至少一种反应物恰好耗尽的投料组合。',
          reasons: check.reasons.map((r) => ({
            ...r,
            text: reasonText(r, leftNames, rightNames),
          })),
        },
      },
    });
  }

  res.json({
    ok: true,
    result: {
      status: 'balanced',
      coefficients: result.coefficients,
      check: {
        status: 'feasible',
        limitingIndex: check.limitingIndex,
        message: `观测可行：存在同一组投料与反应进度满足全部观测，且 ${leftNames[check.limitingIndex]} 完全耗尽。下面给出一组见证（单位 mol）。`,
        witness: check.witness,
      },
    },
  });
});

// 生产模式：托管前端构建产物
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`化学反应式配平服务已启动: http://localhost:${PORT}`);
});
