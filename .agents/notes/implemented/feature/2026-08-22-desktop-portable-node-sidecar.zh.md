# Agent Note: Desktop portable Node sidecar acquisition

Status: implemented

English | [中文](2026-08-22-desktop-portable-node-sidecar.md)

## Problem

桌面 sidecar 获取器虽然按目标选择压缩包，却信任未经校验的下载，而且内部函数只能通过脚本入口使用。陈旧二进制、传输失败或损坏的压缩包可能因此进入后续 bundle 流程，而这些失败路径也没有聚焦测试。

## Decision

`apps/desktop/scripts/fetch-node-sidecar.mjs` 同时下载所选 Node 压缩包及匹配的 `SHASUMS256.txt`，要求存在精确的压缩包条目，在解压前校验 SHA-256，并在已安装 sidecar 旁记录压缩包名称与摘要。重定向次数有上限，非成功响应会失败；代理参数仍通过 argv 传给 `curl`，直连 HTTPS 保留原有无代理路径。

解压使用新建的临时目录。目标规格提供压缩包成员与目标文件名；成员在解析前经过校验，POSIX 目标会获得可执行权限。安装会在目标文件旁准备替换文件，通过可恢复的重命名同时替换 sidecar 与元数据；替换或最终权限检查失败时恢复两份旧文件。缓存命中要求版本、Rust target、已记录的摘要元数据匹配，并且 `<sidecar> --version` 成功。传输、摘要、解压或可执行文件校验失败时保留旧目标，并始终清理临时文件。

获取器导出下载、解压、摘要校验和编排函数，使测试可以注入本地压缩包及可执行文件适配器，而不需要联网或提交 sidecar。命令行入口仍是桌面 bundle 命令使用的生产路径。

## Testing

`apps/desktop/scripts/fetch-node-sidecar.spec.mjs` 覆盖精确摘要解析与校验、重定向、HTTP 失败、损坏压缩包、缺少压缩包成员、陈旧缓存元数据、临时目录清理、POSIX 可执行权限请求、按目标生成的文件名以及安装失败后的恢复。目标规格测试继续固定全部受支持目标行并验证压缩包路径包含关系。

## Alternatives considered

**只依赖 HTTPS 传输而不读取 `SHASUMS256.txt`。** 不采用，因为传输认证不能替代解压前所需的发布文件摘要校验。

**保持获取器只能作为脚本模块运行。** 不采用，因为注入适配器可以在无网络和无下载制品的情况下确定性覆盖失败路径。

**在下载前删除已有 sidecar。** 不采用，因为准备失败时不得把原本可用的缓存变成残缺目标。

## Consequences

每个版本和目标的首次获取会多请求一个摘要文件，并在被忽略的二进制旁保存摘要元数据。本地测试使用注入适配器；实际执行已获取 sidecar 的宿主 smoke 仍属于运行时烘焙工作包的目标 runner 要求。下载得到的 sidecar 仍是未跟踪的构建输出。
