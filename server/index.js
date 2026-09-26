import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFormula, ParseError } from './chem/parse.js';
import { balanceEquation } from './chem/balance.js';
import { parseBound, analyzeFeed } from './chem/feed.js';

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
  const rangeErrors = [];
  const rawRanges = body.ranges;
  if (!Array.isArray(rawRanges) || rawRanges.length !== parsed.left.length) {
    rangeErrors.push({
      side: 'left',
      index: -1,
      field: null,
      message: '投料区间数量必须与反应物数量一致',
    });
  } else {
    rawRanges.forEach((rg, i) => {
      const push = (field, message) =>
        rangeErrors.push({ side: 'left', index: i, field, message });

      if (rg === null || typeof rg !== 'object') {
        push(null, '投料区间格式不正确');
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
    });
  }
  if (rangeErrors.length > 0) return res.json({ ok: false, errors: rangeErrors });

  const ranges = rawRanges.map((rg) => ({
    lower: parseBound(rg.lower),
    upper: parseBound(rg.upper),
  }));
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
