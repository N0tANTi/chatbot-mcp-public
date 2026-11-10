export function downloadRule(projectId){
  return `# 项目文件下载\n\n用户需要下载生成的文档时，保存到当前项目目录或 outputs/ 子目录。成功写入后，在最终回复中给出完整的单行下载 URL，不要只给服务器路径。\n\n下载链接格式：\nhttps://claude.example.com/download?project=${encodeURIComponent(projectId)}&file=<经过 URL 编码的项目相对路径>\n\n用 Python urllib.parse.quote(relative_path, safe='') 编码文件名和子目录；不要把绝对路径或令牌写入链接。链接必须对应实际存在的文件，使用其准确文件名。Markdown、PDF、Office 文档、文本、CSV、JSON 和常见图片可下载；隐藏文件、配置、记忆目录、符号链接不提供下载。不要为了下载改动权限或移动既有资料。\n\n用户可能在网页或终端中阅读回复。简短告知：网页中直接点击链接即可下载；在终端（如 Windows Terminal）中按住 Ctrl 点击完整链接。浏览器会使用项目中心的网页登录账号检查权限并下载，不需要退出当前会话，也不需要 SSH 隧道。\n`;
}

// Appended to the system prompt for web-client turns only; terminals keep the shared rule's link output.
export const webClientNote='本次对话来自项目中心网页端。网页会把项目里生成的文件显示为对话末尾的文件卡片（图片可直接预览），点击即下载。因此在网页端：引用生成的文件时只用一次 Markdown 链接，链接文字写文件名，例如 [报告.xlsx](下载 URL)，网页会把它显示为文件标签；不要贴出裸露的下载 URL，也不要解释如何点击或下载。这条说明优先于 generated-downloads.md 中关于告知下载方式的要求。';
