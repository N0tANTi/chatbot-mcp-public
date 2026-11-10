# Chatbot MCP — public source

Claude Code 网页客户端与 CloudCLI 后端桥接的脱敏源码版。

包含项目与会话管理、消息与工具活动、文件下载和图片预览、项目记忆编辑、上下文整理及订阅额度展示。记忆功能的代码在此仓库中，个人记忆和聊天内容不在其中。

- `web/`：React/Vite 网页端及离线单元测试。
- `integrations/cloudcli/`：固定版本 CloudCLI 的认证、会话和 Claude Code 集成。
- `tools/`：必要的构建、代理及官方账号辅助工具。

## 开发验证

需要 Node.js 22、npm 与 Python 3.12+。完整后端和文件权限测试面向 Linux；Windows 可构建前端。

```sh
cd web
npm ci
npm run build
node --test tests/*.test.mjs
```

完整后端需要另行安装和配置 Claude Code、CloudCLI、代理及服务账户。源码中的 `appuser`、`claude.example.com` 与全零磁盘 UUID 是示例占位值，须根据自己的环境调整；该仓库不是可直接套用的生产部署包。网页中的所有登录共享主机执行权限，配置分开不代表主机文件系统安全隔离。

## 隐私与同步

这是独立提交历史的公开快照，由私有源单向筛选发布。个人项目记录、运维历史、私人记忆、聊天导出、数据库、上传文件、账号配置和旧 Git 历史不会复制过来。新源文件和变更的二进制资源需要先经过发布清单审核，已有文件的更新也必须通过隐私和密钥扫描。

公开仓库的修改不会自动回写私有源；自动发布会更新生成的快照。详情见 [公开同步说明](docs/PUBLIC_MIRROR.md)。

## 许可证与来源

本仓库集成及前端依原有声明以 AGPL-3.0 发布，见 [LICENSE](LICENSE) 和 [来源声明](integrations/cloudcli/NOTICE.md)。CloudCLI 来自 [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)。界面参考项目的 MIT 声明与字体 OFL 声明随源码保留。

原工作区附带的 [cc-connect](https://github.com/chenhg5/cc-connect) 仅为未部署的上游参考，不随此公开快照复制。

获取此公开版本：`git clone https://github.com/N0tANTi/chatbot-mcp-public.git`。构建目录、依赖缓存及个人运行数据不会随同步发布。
