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

## 跨库联搜和按出版方检索

`--source all` 并行查询 SKKU、Crossref、PubMed 和 arXiv，按来源返回 JSON。每库各取 `--limit` 条；同一论文可能出现在多个来源。检查 `complete` 和各库的 `status`，即可区分零命中、限流和部分成功。只查一个公开 API 时可指定其名称，无需启动 Ego Lite。公开 API 调用需要本机有 `curl`。

```sh
skku-lib search 'social comparison' --source all --limit 3
skku-lib publishers 'Wiley'
skku-lib search 'social comparison' --source crossref --member 311
skku-lib download --id 'arxiv:2201.00978v1' --out ./pyramid-tnt.pdf
```

`arxiv:…` 可直接下载公开 PDF。`pubmed:…` 和 `doi:…` 使用 Ego Lite 打开全文入口并尝试保存。Crossref 的会员筛选按 DOI 注册机构检索。平台收录范围、学校订阅范围和注册机构的出版范围各有差异。

## 从馆方目录进入指定网站

```sh
skku-lib sources
skku-lib sources 'ScienceDirect'
skku-lib site-search 1:2883 'social comparison' --limit 3
skku-lib site-download 1:2883 'social comparison' --limit 3 --id '<上一步返回的 ID>' --out ./paper.pdf
skku-lib open-source 1:2883
```

`sources` 实时读取两个校区的目录。`site` 保留校区编号，`listed_entry` 表示该校区登记了入口。部分条目面向馆内终端，另一些提供视频、数据或书目。返回的 `direct_api` 可作为 `--source` 参数，`crossref_member` 可作为 `--source crossref --member` 的编号。

`site-search` 从学校登记的入口进入出版商，用站内搜索框检索，返回识别到的论文标题和 ID。`count` 是本次返回的条数。`site-download` 会按原关键词和结果 ID 核对目标再下载。遇到 `site_search_unavailable`、`site_results_unrecognized` 或 `no_download` 时，保留状态供 agent 判断；也可用 `open-source` 继续在浏览器操作。新建的 `open-source` 空间会保留并返回空间号和页签。

### 验证范围

2026-11-24 的两校区目录分别列出 158 和 157 项，按名称去重为 159 项。目录数量随学校更新。已验证 DBpia、KISS、ScienceDirect 和 Springer 的站内关键词检索，以及 DBpia、KISS、ScienceDirect、PLOS Medicine 和 arXiv 的 PDF 下载。KISS 的不同记录可能只提供外部原文说明。其他目录条目使用通用站内检索与下载适配，逐站支持情况以实际返回状态为准。

公开元数据接口的字段和检索语法见 [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)、[arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html)和 [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25499/)。馆方数据库清单可在[人文社会科学校区](https://lib.skku.edu/hsc/resources/browse/database)和[自然科学校区](https://lib.skku.edu/nsc/resources/browse/database)查看。
