---
name: skku-library
description: 用 Ego Lite 已登录的成均馆大学学术信息馆（SKKU Library）按关键词检索论文、馆藏和期刊，下载机构可访问的论文原版 PDF。用户提到成均馆图书馆查资料、SKKU 查论文或下载全文时使用。
---

运行本机命令 `~/.local/bin/skku-lib`，读取 stdout 的 JSON。使用书目字段区分同一论文的多数据库记录。

```sh
skku-lib search '근자감'
skku-lib search '근자감' --kind books
skku-lib search 'Nature' --kind journals
skku-lib download '근자감' --id 'edspia:edspia.NODE11826460' --out "$HOME/Downloads/근자감.pdf"
```

默认每页 5 条，支持 `--page` 和 `--limit`。下载时沿用检索的关键词、页码和条数，传搜索返回的论文 ID。馆藏与刊名检索只返回书目信息。下载依赖出版社开放的全文或机构权限和下载按钮。以命令成功返回的绝对路径和字节数为准；已有文件会返回 `file_exists`。

每次独立调用默认使用 Ego Lite 当前配置中的登录态，成功后收起临时空间。收到 `login_required` 时请用户在已交接的 Ego Lite 页面完成登录；用户确认后，带 `--space <返回的数字>` 重跑同一命令。显式传入的任务空间由调用方在该任务结束时用 Ego Lite 的 `finish` 收起。收到 `no_full_text` 或 `no_download` 时如实说明该记录的情况。

跨库找论文优先用 `skku-lib search '关键词' --source all --limit 3`，一次获取 SKKU、Crossref、PubMed、arXiv 四路结果。按库查看 `results`，当 `complete=false` 时保留成功项并说明失败来源。可用 `publishers 'Wiley'` 查出版机构 ID，再用 `search '关键词' --source crossref --member 311` 限定出版机构。下载 `arxiv:`、`pubmed:`、`doi:` 开头的 ID 时可省略关键词。公开 API 检索与 arXiv PDF 下载使用系统 curl，不需要浏览器登录。

用户指定具体站点时，先用 `skku-lib sources '站名'` 取对应校区的 `site`。需要站内原始结果时运行 `site-search <site> '关键词' --limit 5`，用其结果 ID 调用 `site-download <site> '关键词' --limit 5 --id <id> --out <路径>`。只需打开馆方入口时用 `open-source <site>`，保留返回的 Ego Lite 空间号和页签继续操作。目录中的 `direct_api` 和 `crossref_member` 是节约时间的元数据检索途径。目录条目可能是馆内终端、视频或统计库，无法识别搜索结果或全文时保留工具返回的明确状态。
