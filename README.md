# 化学反应式配平网页

基于 **React + Node.js (Express)** 的化学反应式配平工具。用户在左右两侧分别输入反应物与生成物的化学式，服务端构建元素守恒矩阵，使用**精确有理数（BigInt 分数）消元**求解，仅在零空间为一维且全部系数严格为正时输出最大公约数为 1 的最简整数系数。配平成功后还可进行**投料区间分析**：在各反应物投料量的独立区间上，用精确有理数联合计算完全反应后生成物生成量、反应物剩余量的可达范围，并标出每种物质是否限量。此外支持**实验观测核验**：沿用已配平反应式与投料区间，填写各生成物实际生成量、各反应物实际剩余量的可选观测闭区间，服务端在同一组投料与反应进度上精确判断观测是否相容，可行时给出一组投料与进度见证。

## 一键启动

需要安装 Docker（含 Compose 插件），无需本机安装 Node.js（依赖安装与前端构建均在镜像内自动完成）。在项目根目录执行：

```bash
docker compose up --build
```

该命令一条即可完成：前后端依赖安装（`npm ci`）→ 前端构建（`vite build`）→ 启动服务。启动后用浏览器访问：

> **http://localhost:3000** （页面与 API 同在 **3000** 端口）

- 页面地址：`http://localhost:3000`
- 配平接口：`POST http://localhost:3000/api/balance`
- 投料区间分析接口：`POST http://localhost:3000/api/feed-analysis`
- 实验观测核验接口：`POST http://localhost:3000/api/observe-check`

如需修改端口，编辑 `docker-compose.yml` 中的 `"宿主端口:3000"`（容器内固定监听 `PORT=3000`）。停止服务：`Ctrl+C`；后台运行：`docker compose up --build -d`。

## 功能

- **左右两侧分别输入物质**，可动态增删条目，回车快速添加
- **可编辑示例**：点击示例标签载入，载入后可任意修改再配平
- 化学式语法：
  - 元素符号**区分大小写**（`Na`、`Cl`、`CO` 与 `Co` 均按元素表校验）
  - 下标必须为**正整数**（`H2O`、`Ca3(PO4)2`，不允许 `0` 和前导零）
  - 圆括号**最多三层**嵌套（如 `H(He(Li)2)3`）
  - **不支持**电荷（`Fe^3+`）、水合点号（`CuSO4·5H2O`）和前置系数（`2H2O`）
- **语法错误精确定位**：指出左/右侧第几个物质、第几个字符，并用 `^` 标出出错位置
- **精确求解**：RREF（行最简形）高斯消元，全程 BigInt 分数运算，无浮点误差
  - 零空间一维且系数全为严格正数：输出 gcd = 1 的最简整数系数
  - 零空间大于一维：提示**解不唯一**，不任意挑选
  - 只有零解 / 系数异号 / 出现零系数：提示**无正解**
- 结果页展示**配平式**（数字自动下标、系数 1 省略）和**每种元素在两侧的原子总数**
- **投料区间分析（仅对唯一正系数解开放）**：
  - 为每种反应物填写以 **mol** 为单位的非负十进制下限、上限（下限 ≤ 上限，最多 6 位小数），各区间相互独立
  - 生成物初始量为 0，按**完全反应**计算，反应进度 ξ = min(nᵢ/cᵢ)
  - 服务端复用化学式解析与配平结果，用**精确有理数在所有允许投料组合上联合求界**（极值在区间盒子的角点上取得，而非端点独立相减），给出反应进度区间、各生成物 cⱼξ 的最小/最大生成量、各反应物 nᵢ−cᵢξ 的最小/最大剩余量，全部以**约分分数**展示
  - 逐项标出限量情况：**均限量**（所有组合中都限量）、**部分限量**（仅部分组合限量）、**从不限量**；并列最小者**均算限量**
  - 区间错误定位到具体物质（并区分下限/上限字段）；**修改反应式立即清除投料输入与分析结果**
- **实验观测核验（接在投料区间分析之后，仅对唯一正系数解开放）**：
  - 沿用已配平反应式与上方各反应物的投料闭区间；为每种**生成物实际生成量**、每种**反应物实际剩余量**填写以 **mol** 为单位的可选闭区间（下限 ≤ 上限，最多 6 位小数），**整行上下限都留空表示未观测**（不允许只填一个界）
  - 服务端用精确有理数联合判断：是否存在**同一组初始投料 nᵢ（落在各投料区间）与同一个反应进度 ξ**，使生成量 = cⱼξ、剩余量 = nᵢ − cᵢξ，且**至少一种反应物剩余为 0**（完全反应）；**不会逐项独立比对观测范围**——做法是枚举耗尽反应物，把剩余量观测（同时约束 nᵢ 与 ξ）与投料区间、生成量观测全部化为对 ξ 的线性区间约束取交集
  - 返回**可行 / 不可行**：可行时给出一组投料 nᵢ、反应进度 ξ 及由其算出的剩余量/生成量作为见证（耗尽反应物高亮标出）；不可行时给出冲突的 ξ 上、下界来源（具体到某项投料或观测）；**没有任何观测时提示补填**
  - 修改观测输入或上方投料区间都会清除上一次核验结论；观测错误定位到具体物质与下限/上限字段

## 本地开发（可选）

需要 Node.js 18+。

```bash
# 终端 1：后端（http://localhost:3000）
cd server && npm install && npm start

# 终端 2：前端开发服务器（http://localhost:5173，/api 自动代理到 3000）
cd client && npm install && npm run dev
```

后端单元测试：

```bash
cd server && npm test
```

## 项目结构

```
├── Dockerfile            # 多阶段构建：前端构建 + 后端依赖 + 运行镜像
├── docker-compose.yml    # 单服务，映射 3000 端口
├── server/
│   ├── index.js          # Express 入口：/api/balance、/api/feed-analysis、/api/observe-check、静态托管
│   └── chem/
│       ├── fraction.js   # 精确有理数（BigInt）
│       ├── parse.js      # 化学式递归下降解析器（含错误定位）
│       ├── balance.js    # 元素守恒矩阵 + RREF 消元 + 零空间判定
│       ├── feed.js       # 投料区间分析：联合求界与限量判定（有理数）
│       └── observe.js    # 实验观测核验：枚举耗尽者、对 ξ 联合求交、见证构造
└── client/
    └── src/
        ├── App.jsx             # 输入面板、示例、结果展示
        ├── FeedAnalysis.jsx    # 投料区间输入、分析结果与限量标注
        ├── ObservationCheck.jsx# 实验观测区间输入、可行/冲突/补填结论与见证
        ├── FracText.jsx        # 约分分数竖排渲染（共享）
        ├── FormulaText.jsx     # 化学式数字下标渲染
        └── styles.css
```

## API

### `POST /api/balance`

```json
{
  "left": ["H2", "O2"],
  "right": ["H2O"]
}
```

成功响应：

```json
{
  "ok": true,
  "result": {
    "status": "balanced",
    "coefficients": { "left": [2, 1], "right": [2] },
    "elements": [
      { "symbol": "H", "left": 4, "right": 4 },
      { "symbol": "O", "left": 2, "right": 2 }
    ]
  }
}
```

语法错误时 `ok` 为 `false`，`errors` 中每项含 `side`、`index`、`position`（1 基字符位置）、`message`、`formula`；无解时 `result.status` 为 `no-positive-solution`，解不唯一时为 `not-unique`（并给出 `nullity`）。

### `POST /api/feed-analysis`

请求体在 `balance` 的基础上增加 `ranges`，与反应物（`left`）等长、按 mol 给出非负十进制区间（最多 6 位小数）：

```json
{
  "left": ["H2", "O2"],
  "right": ["H2O"],
  "ranges": [
    { "lower": "2.5", "upper": "3" },
    { "lower": "2", "upper": "2" }
  ]
}
```

成功响应（分数均已约分，单位 mol）：

```json
{
  "ok": true,
  "result": {
    "status": "balanced",
    "coefficients": { "left": [2, 1], "right": [2] },
    "analysis": {
      "xi": { "min": { "num": "5", "den": "4" }, "max": { "num": "3", "den": "2" } },
      "reactants": [
        { "coefficient": "2", "remaining": { "min": { "num": "0", "den": "1" }, "max": { "num": "0", "den": "1" } }, "limiting": "always" },
        { "coefficient": "1", "remaining": { "min": { "num": "1", "den": "2" }, "max": { "num": "3", "den": "4" } }, "limiting": "never" }
      ],
      "products": [
        { "coefficient": "2", "produced": { "min": { "num": "5", "den": "2" }, "max": { "num": "3", "den": "1" } } }
      ]
    }
  }
}
```

`limiting` 取值：`always`（均限量）、`partial`（仅部分组合限量）、`never`（从不限量）。

区间错误时 `ok` 为 `false`，错误定位到物质（与字段）：每项含 `side`（恒为 `left`）、`index`（反应物下标，整体错误为 `-1`）、`field`（`lower` / `upper` / `null`）、`message`。化学式语法错误的字段格式与 `/api/balance` 一致；配平不唯一或无正解时也返回 `ok:false`，说明该分析不开放。

### `POST /api/observe-check`

实验观测核验。请求体在 `balance` 的基础上同时带上投料区间 `ranges`（格式同 `/api/feed-analysis`，是核验的前提）与 `observations`：`reactants` 与反应物等长表示**剩余量**观测、`products` 与生成物等长表示**生成量**观测；每项 `{ lower, upper }` 均为非负十进制字符串（最多 6 位小数），两者同时为 `null`（或缺失/空串）表示**未观测**，不允许只填一个界。

```json
{
  "left": ["H2", "O2"],
  "right": ["H2O"],
  "ranges": [
    { "lower": "2", "upper": "4" },
    { "lower": "2", "upper": "5" }
  ],
  "observations": {
    "reactants": [
      { "lower": null, "upper": null },
      { "lower": "0.5", "upper": "3" }
    ],
    "products": [
      { "lower": "2", "upper": "4" }
    ]
  }
}
```

可行时 `verdict.feasible` 为 `true`，并给出**同一组**投料与反应进度见证（分数均已约分，单位 mol；`exhausted` 标出剩余为 0 的反应物，`exhaustedIndex` 为其中被枚举为耗尽约束的物质）：

```json
{
  "ok": true,
  "result": {
    "status": "balanced",
    "coefficients": { "left": [2, 1], "right": [2] },
    "verdict": {
      "feasible": true,
      "witness": {
        "xi": { "num": "1", "den": "1" },
        "feeds": [{ "num": "2", "den": "1" }, { "num": "2", "den": "1" }],
        "remaining": [{ "num": "0", "den": "1" }, { "num": "1", "den": "1" }],
        "produced": [{ "num": "2", "den": "1" }],
        "exhausted": [true, false],
        "exhaustedIndex": 0
      }
    }
  }
}
```

不可行时 `feasible` 为 `false`，`message` 指出矛盾的反应进度 ξ 上、下界及其来源（某项投料区间或某项观测），例如“ξ 必须 ≥ 5/2（生成物“H2O”生成量观测下限），又必须 ≤ 2（反应物“H2”投料上限（耗尽约束 n = c·ξ）），两者矛盾”。没有任何观测时 `feasible` 为 `"empty"`，`message` 提示先补填观测。

观测区间输入错误时 `ok` 为 `false`：错误项与 `/api/feed-analysis` 同构，并额外携带 `scope`——`"observation"` 表示观测区间错误（`side` 为 `left`/`right` 区分剩余量/生成量），`"feed"` 表示沿用的投料区间有问题（应先修正上方投料区间）。配平不唯一或无正解时同样返回 `ok:false`。
