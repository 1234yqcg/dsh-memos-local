# Fork 说明（Bearer token 修复）

本仓库是 [steven-stack-s/dsh-memos-local](https://github.com/steven-stack-s/dsh-memos-local) 的 fork，
在 2.0.20-dsh.3 基础上增加了一处桌面端修复。

## 差异

- `dist/server/routes/auth.js`、`dist/adapters/deepseek-harness/viewer-proxy.js`
  （以及对应 `.d.ts` / 测试）：DSH 桌面端通过 `dsh-app://` 协议转发页面时会丢掉
  `set-cookie`，只靠 cookie 的登录会“登录成功但立刻失效”。现在登录成功后把 token 存进
  `localStorage`，之后所有请求附带 `Authorization: Bearer`。
- 对应提交：`989541f fix(dsh): support Bearer token auth for desktop protocol forwarding`
  （分支 `feat/dsh-bearer-auth`，已合入本仓库 `main`）。

## 安装

```bash
# 在 DSH profile 目录（如 ~/.dsh/profiles/desktop）执行
pnpm add github:1234yqcg/dsh-memos-local
```

然后在 `package.json` 的 `dsh.profile.bundles` 中加入 `@steven-stack-s/dsh-memos-local`，
重启 DSH。

## 说明

- 包名仍是 `@steven-stack-s/dsh-memos-local`，bundle id 不用改。
- 与 npm 上的 `2.0.20-dsh.3` 同名，二选一安装。
