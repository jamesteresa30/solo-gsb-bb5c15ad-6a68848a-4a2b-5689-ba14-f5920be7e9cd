import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFormula, ParseError } from './chem/parse.js';
import { balanceEquation } from './chem/balance.js';
import { parseBound, analyzeFeed } from './chem/feed.js';
import { checkObservations } from './chem/observe.js';

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

/**
 * 校验反应物投料区间（数量必须与反应物一致）。
 * 返回 { errors, ranges }：errors 为空时 ranges 为 [{ lower: Frac, upper: Frac }]。
 */
function parseFeedRanges(rawRanges, count) {
  if (!Array.isArray(rawRanges) || rawRanges.length !== count) {
    return {
      errors: [
        { side: 'left', index: -1, field: null, message: '投料区间数量必须与反应物数量一致' },
      ],
      ranges: null,
    };
  }
  const errors = [];
  const ranges = rawRanges.map((rg, i) => {
    const push = (field, message) =>
      errors.push({ side: 'left', index: i, field, message });

    if (rg === null || typeof rg !== 'object') {
      push(null, '投料区间格式不正确');
      return null;
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
    return lower !== undefined && upper !== undefined ? { lower, upper } : null;
  });
  return { errors: errors.length ? errors : [], ranges: errors.length ? null : ranges };
}

/**
 * 校验实验观测区间。side 为 'left'（剩余量）或 'right'（生成量）；
 * 每项 { lower, upper }：两者留空（null/缺失/空串）表示未观测；
 * 必须成对出现，非空值与投料量同样受 parseBound 约束，且下限 ≤ 上限。
 * 返回的区间未观测时为 { lower: null, upper: null }。
 */
function parseObservationList(rawList, count, side) {
  const errors = [];
  if (!Array.isArray(rawList) || rawList.length !== count) {
    return {
      errors: [
        {
          side,
          index: -1,
          field: null,
          scope: 'observation',
          message: '观测区间数量必须与物质数量一致',
        },
      ],
      list: null,
    };
  }
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

  const list = rawList.map((rg, i) => {
    const push = (field, message) =>
      errors.push({ side, index: i, field, scope: 'observation', message });

    if (rg === null || typeof rg !== 'object') {
      push(null, '观测区间格式不正确');
      return null;
    }
    if (blank(rg.lower) && blank(rg.upper)) {
      return { lower: null, upper: null }; // 未观测
    }
    if (blank(rg.lower) || blank(rg.upper)) {
      push(blank(rg.lower) ? 'lower' : 'upper', '观测区间的下限与上限必须同时填写（都留空表示未观测）');
      return null;
    }
    let lower;
    let upper;
    try {
      lower = parseBound(rg.lower);
    } catch (e) {
      push('lower', `观测下限无效：${e.message}`);
    }
    try {
      upper = parseBound(rg.upper);
    } catch (e) {
      push('upper', `观测上限无效：${e.message}`);
    }
    if (lower !== undefined && upper !== undefined && upper.sub(lower).sign() < 0) {
      push('upper', '观测上限不能小于下限');
    }
    return lower !== undefined && upper !== undefined ? { lower, upper } : null;
  });
  return { errors: errors.length ? errors : [], list: errors.length ? null : list };
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
  const { errors: rangeErrors, ranges } = parseFeedRanges(body.ranges, parsed.left.length);
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

// 实验观测核验：沿用配平结果与投料区间，在“同一组”投料与反应进度下
// 联合判断各生成物生成量、各反应物剩余量的观测闭区间能否同时满足，
// 且至少一种反应物剩余为 0（完全反应）。仅在 balanced 时开放。
app.post('/api/observe-check', (req, res) => {
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
              ? '该反应配平系数不唯一，实验观测核验仅对唯一正系数解开放'
              : '该反应无全部为正的配平系数，无法进行实验观测核验',
        },
      ],
    });
  }

  // 投料区间是核验的前提：必须先给出完整且合法的各反应物投料闭区间。
  const { errors: rangeErrors, ranges } = parseFeedRanges(body.ranges, parsed.left.length);
  if (rangeErrors.length > 0) {
    rangeErrors.unshift({
      side: 'left',
      index: -1,
      field: null,
      scope: 'feed',
      message: '实验观测核验沿用上方各反应物的投料区间，请先补全并修正投料区间',
    });
    return res.json({ ok: false, errors: rangeErrors });
  }

  const { errors: obsErrors, list: reactants } = parseObservationList(
    body.observations?.reactants,
    parsed.left.length,
    'left'
  );
  const { errors: prodErrors, list: products } = parseObservationList(
    body.observations?.products,
    parsed.right.length,
    'right'
  );
  if (obsErrors.length > 0 || prodErrors.length > 0) {
    return res.json({ ok: false, errors: [...obsErrors, ...prodErrors] });
  }

  const verdict = checkObservations(
    result.coefficients.left,
    result.coefficients.right,
    ranges,
    { reactants, products },
    {
      reactants: parsed.left.map((_, i) => body.left[i].trim()),
      products: parsed.right.map((_, i) => body.right[i].trim()),
    }
  );

  res.json({
    ok: true,
    result: {
      status: 'balanced',
      coefficients: result.coefficients,
      verdict,
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
