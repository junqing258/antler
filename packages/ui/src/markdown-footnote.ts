// markdown-it-footnote 未随包发布类型声明。
// @ts-expect-error 模块仅有 JS 实现，见 https://github.com/antler 依赖清单
import footnote from "markdown-it-footnote";

export default footnote as import("markdown-it").PluginSimple;
