# New Thoth UI Shell Rebrand And Final-Form App Surface Plan

Status: Draft for user review
Scope: UI shell, product surface, visual identity, navigation, menu system, app icon and user-visible language
Non-scope: formal task backend, Clarify runtime, Loop runtime, provider intelligence implementation
Last updated: 2026-07-02

## 1. 背景

当前 Thoth 已经具备可打开、可配对、可通过 relay 连接 daemon、可打包桌面测试包的基础壳。但这个壳仍然明显继承了 Paseo 的产品形态、信息架构、菜单语言和视觉气质。

下一步不应立刻深入 formal task、Clarify、Loop 的业务实现，而应先把 Thoth 的最终产品表皮和交互骨架定下来。这样后续后端实现不是在抽象地“做 Thoth”，而是在把真实数据、权限、状态机和 provider session 接入已经稳定的 Thoth 产品槽位。

这轮工作的核心判断是：

1. Thoth 不是 Paseo 换皮。
2. Thoth 不是 harness 工具箱。
3. Thoth 是 One Thoth，是任务控制平面，是面向用户的私人秘书式工作界面。
4. UI 可以先行，但 UI 不得撒谎；未实现能力只能显示为空态、待配置、不可用或预览态，不能假装已经完成。

## 2. 核心目标

### 2.1 摆脱 Paseo 的用户可见形态

重构所有用户可见 UI 壳，让用户打开 Web App、Desktop App 或未来 Mobile App 时，不再感觉这是 Paseo 的改名版本。

验收重点不是代码包名是否完全重命名，而是用户可见的产品体验是否已经属于 Thoth。

### 2.2 形成最终形态的 Thoth App Surface

先确定 Thoth 长期会保留的产品表面：

1. 全局 Home / One Thoth 入口。
2. Workspace 控制页面。
3. Task / Loop 任务视图。
4. Provider 设置与状态。
5. Device / Relay / Pairing 连接管理。
6. Evidence / Review / Archive 证据与历史入口。
7. Settings / Appearance / Advanced / About。

这些入口可以暂时有未实现状态，但结构要接近最终产品，不再跟着 Paseo 的历史栏目漂移。

### 2.3 建立 Thoth 自己的视觉语言

视觉方向锁定为：

1. 游戏感。
2. 轻松。
3. 可爱。
4. 愉快。
5. 有人格感。
6. 不幼稚、不廉价、不像普通 AI SaaS。

主题意象可以使用：

1. Thoth / 书记官 / 智慧神。
2. 朱鹭 / ibis。
3. 羽翼。
4. 月亮。
5. 卷轴、印章、符文、任务契约。
6. 红、金、白、深墨、青绿等明快对比色。

避免把 UI 做成单调的埃及沙漠色、棕金色或暗蓝紫渐变。Thoth 可以有埃及神话意象，但不应变成一整套厚重、陈旧、低对比度的仿古皮肤。

### 2.4 降低用户心智负担和使用门槛

所有 UI 重构必须服务最核心理念：

1. 用户不需要理解 harness、session、adapter、transport、daemon 等内部概念。
2. 用户看到的是 Thoth、workspace、provider、task、clarify、loop、review、evidence。
3. 复杂状态必须用自然、可恢复、可行动的方式表达。
4. “需要重新配对”“Provider 未配置”“选择模型”“Workspace 尚未注册”这类状态必须给用户明确下一步，而不是暴露底层错误。

### 2.5 为后端真实能力预留稳定插槽

UI 先行不是做假 demo。每个主要 UI 模块都必须对应未来真实能力：

1. Composer controls 对应 Mode / Clarify / Loop / Provider / Attachments。
2. Task card 对应 authority store 中的 task record。
3. Contract card 对应 frozen acceptance contract。
4. Clarify card 对应 provider session 内的 decision-tree node。
5. Loop timeline 对应 plan-exec-review event stream。
6. Evidence view 对应 review result、diff、test output、artifact receipt。
7. Device/Relay view 对应 direct daemon、relay pairing、device token、credential state。

如果后端还未实现，UI 必须诚实显示为 unavailable、coming next、needs provider、needs workspace 或 preview-only。

## 3. 非目标

本轮不做：

1. 不实现 formal task backend。
2. 不实现 Clarify decision-tree runtime。
3. 不实现 Loop / Review / Contract freeze 的真实执行链路。
4. 不新增隐藏 LLM API 调用。
5. 不用本地确定性规则假装智能判断用户意图。
6. 不恢复旧 Python plugin runtime。
7. 不恢复 voice、speech、dictation、audio 功能。
8. 不做单独 mock/debug-only UI 作为主要审核入口。
9. 不做纯 landing page 替代真实产品界面。
10. 不为了视觉重构破坏当前 daemon、relay、workspace、web、desktop 的可用入口。

## 4. 产品约束

### 4.1 UI 必须是真实产品入口

Thoth I 的 dev UI 必须和可发布完整版 UI 是同一套体验。可以存在 dev-only diagnostics，但不能把 debug UI 当成人类主要审核入口。

### 4.2 UI 不得撒谎

未实现的能力可以出现，但必须诚实表达状态：

1. 可用。
2. 未配置。
3. 等待 provider。
4. 等待 workspace。
5. 需要重新配对。
6. 尚未接入。
7. 预览态。

禁止显示虚假的成功态、虚假的 task result、虚假的 provider output 或虚假的 loop progress。

### 4.3 视觉人格必须服务效率

游戏画风、可爱、愉快是气质，不是牺牲交互效率的理由。

UI 必须仍然适合长期工作：

1. 信息密度合理。
2. 状态可扫读。
3. 控件稳定。
4. 字体不挤压。
5. 重要操作明确。
6. 错误和恢复路径清楚。

### 4.4 多端一致但不强行等价

Web、Desktop、Mobile 可以布局不同，但核心语言一致：

1. 同一套品牌资产。
2. 同一套设计 token。
3. 同一套主要栏目。
4. 同一套 task / provider / workspace / relay 状态语义。

Desktop 可以拥有更完整的菜单栏和本地 daemon 管理能力。Mobile 可以更偏 remote control 和 review。Web 在当前阶段是主要人工审核入口。

### 4.5 保留当前已验证基础能力

UI 壳重构后必须保留：

1. Web 入口 `8082 -> 8148` 可打开。
2. Thoth daemon 默认 `127.0.0.1:6688`。
3. 本机 Paseo daemon `127.0.0.1:6767` 不被触碰。
4. Relay test endpoint `relay.test.thoth.seeles.ai` 可配对。
5. Workspace 添加流程不白屏。
6. `hi` 这类当前未配置 provider/model 的输入仍能给出诚实错误，而不是崩溃。
7. Desktop 测试包仍可构建。

## 5. 工程约束

### 5.1 以现有源码为脚手架，不做业务大重写

当前 app/desktop 源码可以作为 UI 重构脚手架。允许移动、重命名、重组用户可见组件，但不在本轮深入改 daemon/core/provider task 逻辑。

### 5.2 不扩大 package 边界

Root workspace 仍保持 10 个包。`packages/app/highlight` 仍是 nested package，不新增 root workspace。

### 5.3 设计系统优先

先建立可复用的 Thoth 设计 token 和 UI 基础组件，再改具体页面。

本轮不应在每个页面散落一次性颜色、阴影、间距和图标样式。

### 5.4 图标和图片策略

1. App icon、logo、角色图、启动页图可以使用 AI 生成 bitmap asset。
2. AI 生成资产必须保存 source note：用途、生成提示词摘要、生成日期、人工筛选说明。
3. 常规 UI 控件图标优先使用已有 icon library，例如 lucide，除非品牌角色或特殊游戏化控件需要 custom asset。
4. App icon 必须有简化版本，不能直接使用完整横版 logo。
5. 小尺寸图标必须在 16px、32px、64px、128px、1024px 下保持可识别。

### 5.5 不引入新的视觉债

1. 不使用单一色相撑完整 UI。
2. 不用大面积低对比棕金、沙色、暗蓝紫渐变。
3. 不用装饰性 orb、bokeh blob 或无意义渐变背景。
4. 不让 UI card 套 card。
5. 卡片圆角默认不超过 8px，除非已有设计系统明确需要。
6. 按钮、badge、输入框必须在中英文和移动宽度下不溢出。

## 6. 信息架构目标

### 6.1 全局 Home

Home 是 One Thoth 的入口，不是 marketing landing page。

应呈现：

1. 当前可用 workspace。
2. 最近 task / conversation。
3. Provider readiness。
4. Device / relay connection state。
5. 快速开始一个 Thoth conversation。

### 6.2 Workspace 页面

Workspace 页面是当前最重要的工作面。

应包含：

1. Workspace identity。
2. Provider selector / status。
3. Composer。
4. Mode / Clarify / Loop controls。
5. Active task area。
6. Timeline / evidence preview。
7. Project files / context status 入口。

### 6.3 Composer 控件

Composer 固定保留这些控制：

1. `+`: 添加图片和小文件，MVP 限制小于 10MB。
2. Provider: 模型、权限、思考强度、fast mode、provider runtime 设置入口。
3. Mode: Quick / Loop。
4. Clarify: Auto / Don't Ask / Light / Balanced / Dive Dive Dive。
5. Loop: Auto / Single Pass / Light / Balanced / Try Try Try。

约束：

1. Scope 不做独立按钮，通过 `@workspace` 或后续 `@target` 机制表达。
2. Quick 下 Loop 控件应灰显或显示不适用。
3. Clarify 对 Quick 和 Loop 都生效。
4. 控件名称可以进一步 UI copy 打磨，但语义不能漂移。

### 6.4 Provider 页面

Provider 是能力来源，不是 Thoth 自己的模型设置。

应包含：

1. Provider 列表。
2. Claude / Codex / ACP / OpenCode / mock 等状态。
3. model id。
4. permission mode。
5. thinking strength。
6. fast mode。
7. provider session readiness。
8. 真实 auth 状态的诚实表达。

### 6.5 Tasks / Loop 页面

Tasks 是最终能力入口，但本轮可先做壳。

应包含：

1. formal task 列表。
2. task status。
3. contract card。
4. clarify decisions。
5. loop timeline。
6. review / evidence summary。
7. stop / pause / resume / archive 的最终位置。

未接后端前，必须显示真实空态或未接入态。

### 6.6 Settings

Settings 需要完全 Thoth 化。

建议分组：

1. General。
2. Providers。
3. Connections。
4. Devices。
5. Appearance。
6. Workspaces。
7. Advanced。
8. About Thoth。

Settings 中不得继续出现 Paseo 用户可见概念。

### 6.7 Desktop 菜单栏

macOS / desktop 菜单栏应重构为 Thoth 语义：

1. Thoth。
2. File。
3. Workspace。
4. Task。
5. Provider。
6. View。
7. Window。
8. Help。

菜单项可以先连接现有能力或 disabled，但命名和分组要接近最终形态。

## 7. 视觉系统目标

### 7.1 Brand Assets

需要产出或替换：

1. App icon。
2. Dock icon。
3. favicon。
4. Desktop icon。
5. Android adaptive icon。
6. Web app manifest icon。
7. Full wordmark。
8. Compact mark。
9. Optional mascot / assistant avatar。
10. About 页面品牌图。

### 7.2 Design Tokens

需要定义：

1. Color palette。
2. Background layers。
3. Text colors。
4. Status colors。
5. Border colors。
6. Spacing scale。
7. Radius scale。
8. Shadow / elevation。
9. Motion duration。
10. Game-like accent style。

### 7.3 Component Tone

组件应有轻松、愉快、游戏感，但保持工作效率。

重点组件：

1. Sidebar item。
2. Top bar。
3. Workspace header。
4. Composer。
5. Mode segmented control。
6. Provider popover。
7. Clarify strength picker。
8. Loop strength picker。
9. Task card。
10. Contract card。
11. Evidence card。
12. Relay/device status row。
13. Empty state。
14. Toast。
15. Modal。

## 8. Copy 和人格目标

Thoth 应像一个有性格的私人秘书，而不是系统后台。

Copy 原则：

1. 语气轻松但不油腻。
2. 直接告诉用户下一步。
3. 不暴露内部实现名作为主要文案。
4. 错误信息优先解释人能理解的原因。
5. 不使用“数字员工”作为主术语。
6. 主术语保持 One Thoth、任务控制平面、workspace、provider、task、loop、review、evidence。

示例方向：

1. `Relay timed out` 不如 `需要重新配对`。
2. `Provider unavailable` 不如 `还没选好可执行的 Provider`。
3. `No workspace` 不如 `先把一个 workspace 交给 Thoth`。
4. `Select model` 需要进一步落成 provider 设置入口，而不是死错误。

## 9. 执行阶段

### 9.1 Phase 0: UI Inventory

目标：

1. 扫描当前 app/desktop 用户可见页面。
2. 标出 Paseo 形态残留。
3. 标出 Thoth 已可用能力与未实现能力。
4. 建立页面和组件迁移清单。

验收：

1. 有 UI inventory 表。
2. 有用户可见 Paseo residue 列表。
3. 有不可动底层能力清单。

### 9.2 Phase 1: Brand And Asset System

目标：

1. 产出 app icon 方向。
2. 产出 full wordmark 和 compact mark。
3. 替换 app/desktop/web icon assets。
4. 建立 asset provenance note。

验收：

1. Web favicon 是 Thoth 新图标。
2. Desktop dock icon 是 Thoth 新图标。
3. Android debug icon 是 Thoth 新图标。
4. icon 在小尺寸下可识别。

### 9.3 Phase 2: Design Tokens And Base Components

目标：

1. 建立 Thoth palette。
2. 建立 background/card/button/input/badge/token。
3. 统一基础组件风格。

验收：

1. 主要页面不再像默认 Paseo 主题。
2. UI 没有一整片单调色相。
3. 中英文文案在移动和桌面宽度下不溢出。

### 9.4 Phase 3: App Shell And Navigation

目标：

1. 重构全局 Home。
2. 重构 sidebar / navigation。
3. 重构 workspace 页面壳。
4. 重构 settings 入口和分类。

验收：

1. 用户可见主栏目全部是 Thoth 语义。
2. 无用户可见 Paseo 命名。
3. Web 和 Desktop 打开后第一屏是 Thoth 产品体验，不是工程工具界面。

### 9.5 Phase 4: Composer And Controls

目标：

1. 重构 composer。
2. 接入 `+`、Provider、Mode、Clarify、Loop 的最终控件位置。
3. 明确未实现能力状态。

验收：

1. Quick / Loop 可见。
2. Clarify 五档可见。
3. Loop 五档可见，但 Quick 下 Loop 不可用。
4. Provider 设置入口清晰。
5. `+` 只表达图片和小文件。

### 9.6 Phase 5: Status, Empty, Error States

目标：

1. 重写关键空态。
2. 重写 relay / daemon / provider / workspace / model 错误态。
3. 重写 task 未实现态。

验收：

1. 错误信息给出下一步。
2. 不暴露无意义内部错误作为主要文案。
3. 当前已知状态 `Select model`、`重新配对`、daemon offline 都有清楚恢复路径。

### 9.7 Phase 6: Desktop Shell

目标：

1. 重构 desktop menu。
2. 替换 desktop app metadata。
3. 验证 mac zip、Linux AppImage、web preview。

验收：

1. Desktop 菜单栏是 Thoth 语义。
2. mac zip 可以打开测试。
3. Linux AppImage 不回退。
4. release artifacts 不进 git。

## 10. 验收标准

### 10.1 视觉验收

1. 打开 Web App 第一屏，用户能明确感知这是 Thoth。
2. 打开 Desktop App，dock icon、窗口标题、菜单栏、About 都是 Thoth。
3. 整体风格符合游戏感、轻松、可爱、愉快。
4. UI 不像普通 AI SaaS 蓝紫渐变模板。
5. UI 不像 Paseo 的换色版本。

### 10.2 信息架构验收

1. 主导航栏目是 Thoth 最终形态。
2. Workspace 页面有最终 composer 控件位置。
3. Provider、Task、Device/Relay、Evidence/Review 的位置明确。
4. Settings 分类清楚。
5. Desktop 菜单栏分组清楚。

### 10.3 诚实状态验收

1. 未实现 formal task backend 时，不显示虚假 task 成功。
2. 未实现 Clarify runtime 时，不显示虚假 clarify output。
3. 未实现 Loop runtime 时，不显示虚假 loop progress。
4. Provider 未配置时，给出 provider 设置入口。
5. Relay 凭证失效时，显示重新配对。

### 10.4 功能不回退验收

必须通过：

1. Web build。
2. Web open-project smoke。
3. Workspace route smoke。
4. `hi` 不白屏。
5. Relay fresh pairing smoke。
6. Settings expired relay credential smoke。
7. Desktop dev launch 或 packaged smoke。
8. 至少当前 foundation gate。
9. `git diff --check`。
10. `npm run format:check`。

### 10.5 用户可见 Paseo residue scan

用户可见 app/desktop/web surface 不得出现：

1. Paseo。
2. getpaseo。
3. app.paseo.sh。
4. relay.paseo.sh。
5. Paseo icon。
6. Paseo menu/category names that no longer match Thoth。

允许存在：

1. NOTICE / provenance。
2. `.agent-os/upstreams/` ignored raw cache。
3. 历史设计归档。
4. 源码注释中的必要 provenance。

## 11. 交付物

本计划完成后应交付：

1. Thoth app icon asset set。
2. Thoth visual token implementation。
3. Thoth app shell navigation。
4. Thoth workspace shell。
5. Thoth composer controls。
6. Thoth settings shell。
7. Thoth desktop menu shell。
8. Thoth status/empty/error copy。
9. Web preview URL。
10. Desktop test artifact path。
11. Screenshot evidence for desktop and web。
12. Verification command summary。

## 12. 最小成功定义

最小成功不是“所有按钮都能跑完整业务”，而是：

1. 用户打开 Thoth 后，第一感知已经是独立产品。
2. 用户能理解 workspace、provider、mode、clarify、loop 的位置。
3. 当前真实可用能力仍能用。
4. 未实现能力不撒谎。
5. 后续 agent 可以沿着这个 UI 壳继续接后端，而不是继续被 Paseo 的产品结构牵着走。
