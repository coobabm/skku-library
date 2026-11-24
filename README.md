# SKKU Library

让本机 agent 使用 Ego Lite 里的成均馆大学图书馆登录会话，搜索论文、馆藏和期刊，并将出版社提供的论文 PDF 保存到本地。命令行工具 `skku-lib` 返回 JSON，可从 Codex 或其他本机 agent 调用。

## 安装

需要 Python 3.9 或更高版本、可从终端运行的 `ego-browser`，以及在 Ego Lite 中可用的图书馆账号。以下命令将仓库克隆到 Codex 技能目录，并在用户的命令目录创建符号链接。若已安装此技能，可直接使用现有命令。

```sh
mkdir -p "$HOME/.codex/skills" "$HOME/.local/bin"
gh repo clone coobabm/skku-library "$HOME/.codex/skills/skku-library"
ln -s "$HOME/.codex/skills/skku-library/scripts/skku-lib" "$HOME/.local/bin/skku-lib"
export PATH="$HOME/.local/bin:$PATH"
skku-lib --help
```

## 使用

在 Codex 中可以说“用成均馆图书馆搜 근자감，把可下载的论文保存到下载目录”。从其他 agent 或终端调用时，先检索，再把结果里的论文 ID 交给下载命令。

```sh
skku-lib search '근자감'
skku-lib download '근자감' --id 'edspia:edspia.NODE11826460' --out ./paper.pdf
skku-lib search '근자감' --kind books
skku-lib search 'Nature' --kind journals
```

默认检索论文，每页 5 条。若检索时指定了 `--page` 或 `--limit`，下载时沿用相同的关键词和分页参数。成功下载后会返回保存路径和字节数。遇到 `login_required` 时，在 Ego Lite 的学校页面完成登录，然后在原命令末尾加上 `--space <返回的空间编号>` 重试。

已在 macOS 上用 Ego Lite 验证过论文、馆藏和刊名检索，以及通过 DBpia 机构认证下载原版 PDF。其他出版社的下载支持取决于其页面和机构访问权限。
