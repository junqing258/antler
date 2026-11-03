// markdown-it-footnote 未随包发布类型声明。
// @ts-expect-error 模块仅有 JS 实现，见 https://github.com/antler 依赖清单
import footnote from "markdown-it-footnote";

// markdown-it 15 自带类型中插件签名为 (md: MarkdownIt) => void(旧版 @types 的 PluginSimple 已移除)。
export default footnote as (md: import("markdown-it").MarkdownIt) => void;
