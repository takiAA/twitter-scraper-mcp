# X Cookie 获取与导入教程

[项目首页](../README.zh-CN.md) · [English](authentication.md)

账号工具需要**你自己的已登录 x.com 账号**中的 `auth_token` 和 `ct0`。导入一次后复用本地账号库，会话失效时再刷新。公开 `getTweet` 不需要 Cookie；导入不会开启发推。

## 选择导入方式

| 方式                 | 适用情况                             | 命令                                                         |
| -------------------- | ------------------------------------ | ------------------------------------------------------------ |
| 手动隐藏输入         | 希望自己确认复制内容，或自动解密失败 | `npm run auth:import`                                        |
| 浏览器辅助脚本       | 系统允许本机读取所选浏览器的 Cookie  | `npm run auth:browser -- --browser chrome --profile Default` |
| 现有 twscrape 账号库 | 已经管理了账号会话                   | 设置 `TWSCRAPE_ACCOUNTS_DB`                                  |
| 私有 JSON 导出文件   | 已有 Cookie 扩展导出文件             | `auth:browser -- --cookie-file /绝对路径/cookies.json`       |

先运行 `npm ci --ignore-scripts` 和 `npm run setup:twscrape` 安装依赖。全部操作在自己的电脑和终端中进行。Cookie 相当于可复用凭据，不能放入聊天、Issue、PR、截图、命令参数或 MCP 工具参数。

## 手动导入：Chrome / Edge

![开发者工具示意图，所有 Value 均为占位提示](../assets/cookie-guide.svg)

这是示意图，不是真实账号截图；浏览器版本和语言可能导致标签不同。

1. 用目标浏览器 Profile 打开 **https://x.com**，确认已登录你打算使用的账号。先在 X 页面确认账号身份，不要混用访客/无痕窗口和普通窗口的登录态。
2. 打开开发者工具：macOS 按 `⌘ ⌥ I`；Windows/Linux 按 `Ctrl Shift I` 或 `F12`。也可从浏览器菜单 → 更多工具 → 开发者工具进入。
3. 切到 **Application（应用）→ Storage（存储）→ Cookies → https://x.com**。看不到 Application 时，打开顶部溢出菜单 `»` 或面板菜单。该路径可参考 [Chrome 官方说明](https://developer.chrome.com/docs/devtools/application/cookies)。
4. 在过滤框搜索 **`auth_token`**，复制这一行的 **Value（值）**。保留原始值，不开启 URL 解码。只复制 Value，不要包含名称、引号、`Cookie:` 或 `auth_token=`；不要修改或删除浏览器 Cookie。
5. 在项目目录打开终端，运行：

   ```bash
   npm run auth:import
   ```

   按提示输入本地标签，例如 `my-x`。标签是本地账号库的键，不一定等于 X 用户名。出现 `X auth_token (hidden):` 后粘贴刚复制的值，再按 Enter。

6. 回到**同一个账号、同一个 x.com Origin**，搜索 **`ct0`** 并复制 Value。终端出现 `X ct0 (hidden):` 时粘贴并按 Enter。粘贴时看不到字符是正常的隐藏输入行为，不要重复粘贴；获取两个值期间不要切换 X 账号。
7. 看到导入成功后，清空剪贴板或覆盖为普通文本。截图前关闭开发者工具；已经运行的 MCP 服务需要重启。

默认保存到 `.local/accounts.db`，在 POSIX 系统上使用受限文件权限。手动导入会刷新你输入的已有标签，并保留限流锁；保留多个账号时，请分别使用不同标签。

### 验证读取，不发推

```bash
npm run build
npm run test:client -- --search "from:golang"
```

成功表示账号库中的一个可用会话能读取该样本。如果账号库有多个账号，twscrape 可能选择其他可用账号，因此这个命令不证明某个标签的身份。写入时明确将 `TWITTER_WRITE_ACCOUNT` 绑定到目标标签，在具体写操作获得授权前保持 `TWITTER_ENABLE_WRITE=false`。

### Firefox 等浏览器

Firefox 对应 **Storage（存储）→ Cookies → https://x.com**，参考 [Firefox 官方 Cookie 面板说明](https://firefox-source-docs.mozilla.org/devtools-user/storage_inspector/cookies/index.html)，再把相同两个 Value 粘贴到终端隐藏提示。其他有存储检查器的浏览器也可按类似流程操作。无需粘贴控制台 JavaScript；`auth_token` 是 HttpOnly，`document.cookie` 不是可靠的获取办法。

## 自动导入

先登录 X，再指定一个浏览器/Profile：

```bash
npm run auth:browser -- --browser chrome --profile Default --label my-x
npm run auth:browser -- --browser chrome --profile "Profile 2" --label my-x
# 明确刷新已有标签：
npm run auth:browser -- --browser chrome --profile "Profile 2" --label my-x --replace
# 仅检查本地能否读取，不修改账号库：
npm run auth:browser -- --browser chrome --profile "Profile 2" --check
npm run auth:browser -- --help
```

选择符合实际 Profile 的**一条**导入命令即可。Chrome/Edge 支持目录名、显示名称和目录路径，默认 `Default`；Firefox 默认使用 `default-release` 选择器；Safari 没有 Profile 参数。本地标签默认 `browser-session`，支持 `chrome`、`edge`、`firefox` 和 macOS `safari`。

固定版本的 Sweet Cookie 辅助库请求所选 Profile 的 x.com Cookie 对。包装脚本通过本地管道传给 Python，不显示 Cookie、不导出文本、不通过网络传输。上游读取库可能创建浏览器数据库的临时快照。冲突会话会报错，不会自动切换浏览器。`--check` 仅检查本地可读性，不验证远端登录有效性。

macOS 可能弹出钥匙串授权；Windows 新版 Chromium 的 App-Bound Encryption 可能阻止自动读取，见[上游兼容说明](https://github.com/steipete/sweet-cookie/blob/main/docs/usage.md#browser-and-platform-details)。不要为了提取 Cookie 关闭浏览器或系统安全设置，使用手动隐藏输入即可。此工具需要宿主机开发依赖，不包含在 Docker 运行镜像中。

## 导出文件与 Docker

已有私有 JSON 导出文件时：

```bash
npm run auth:browser -- --cookie-file /绝对路径/cookies.json --label my-x
```

支持 Cookie 记录数组或 `{ "cookies": [...] }`，要求包含 x.com 域名。只导入所需的根路径 Cookie 对；过期、分区、冲突及其他域的记录会被排除或拒绝。刷新已有标签加 `--replace`。文件导入不回退到浏览器读取，用完后移除私有导出文件。

Docker 可在容器数据卷里运行交互式导入，或在宿主机导入后挂载账号目录，见 [Docker 指南](docker.md)。没有显式挂载时，宿主和容器账号库是分开的。

## 常见问题

| 情况                                                          | 检查方法                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 找不到一个或两个 Cookie                                       | 是否选对已登录的 x.com Origin/Profile；刷新页面后再查               |
| 粘贴后没有字符                                                | 正常的隐藏输入，只粘贴一次再按 Enter                                |
| Cookie 格式错误                                               | 只复制 Value，不要带名称、引号、前缀或换行                          |
| 自动解密失败                                                  | 检查 Profile/系统权限，改用手动导入                                 |
| 自动导入提示标签已存在                                        | 使用明确的 `--replace`，或不同标签                                  |
| 导入后 `AUTH_FAILED`                                          | 导入只保存值，不验证 X；重新取得目标账号的新 Cookie 对              |
| `ACCOUNT_UNAVAILABLE` / `RATE_LIMITED`                        | 等待上游限流恢复，不要清空锁强制重试                                |
| `SESSION_BOOTSTRAP_FAILED`                                    | 写入前的接口元数据/签名准备失败；保持写入关闭，提交脱敏的兼容性问题 |
| 写入结果 `PUBLISH_OUTCOME_UNKNOWN` / `DELETE_OUTCOME_UNKNOWN` | 先检查账号或推文，再决定是否重试                                    |

如果 Cookie 意外泄露，通过 X 账号的会话管理功能使受影响的会话失效，再取得新值并替换本地标签。不要在公开报告中粘贴泄露值。阅读[安全说明](../SECURITY.md)和[免责声明](../DISCLAIMER.md)。
