import { useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import footnote from "./markdown-footnote";
import cjkFriendly from "markdown-it-cjk-friendly";
import remend from "remend";
import { createLowlight, common } from "lowlight";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

type Node = { token: Token; children: Node[] };
const parser = new MarkdownIt({ html: false, linkify: true })
  .use(footnote)
  .use(cjkFriendly);
const lowlight = createLowlight(common);

const HLJS_COLORS: Record<string, string> = {
  "hljs-keyword": "#7c4dff",
  "hljs-built_in": "#7c4dff",
  "hljs-type": "#7c4dff",
  "hljs-string": "#2e7d32",
  "hljs-regexp": "#2e7d32",
  "hljs-comment": "#9e9e9e",
  "hljs-quote": "#9e9e9e",
  "hljs-number": "#c2410c",
  "hljs-literal": "#c2410c",
  "hljs-title": "#1565c0",
  "hljs-title.function_": "#1565c0",
  "hljs-function": "#1565c0",
  "hljs-attr": "#b42318",
  "hljs-attribute": "#b42318",
  "hljs-variable": "#b42318",
  "hljs-meta": "#00838f",
  "hljs-tag": "#00838f",
  "hljs-name": "#00838f",
  "hljs-symbol": "#6d4c41",
  "hljs-bullet": "#6d4c41",
};

type Segment = { text: string; color?: string };

type HastNode = {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: string[] };
};

/** 语法高亮只负责展示；未注册语言或解析失败时按纯文本显示。 */
function highlightSegments(code: string, lang: string): Segment[] {
  try {
    const tree = lowlight.highlight(lang, code);
    const segments: Segment[] = [];
    const walk = (node: HastNode, color?: string) => {
      if (node.type === "text") {
        if (node.value) segments.push({ text: node.value, color });
        return;
      }
      const className = node.properties?.className?.find((name) =>
        name.startsWith("hljs-"),
      );
      const next = (className && HLJS_COLORS[className]) || color;
      node.children?.forEach((child) => walk(child, next));
    };
    walk(tree as unknown as HastNode);
    return segments.length ? segments : [{ text: code }];
  } catch {
    return [{ text: code }];
  }
}

function tree(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack = [root];
  for (const token of tokens) {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else {
      const node = {
        token,
        children: token.children ? tree(token.children) : [],
      };
      stack[stack.length - 1].push(node);
      if (token.nesting === 1) stack.push(node.children);
    }
  }
  return root;
}

function inline(nodes: Node[]): React.ReactNode {
  return nodes.map(({ token, children }, index) => {
    const content = children.length ? inline(children) : token.content;
    switch (token.type) {
      case "text":
        return token.content;
      case "softbreak":
      case "hardbreak":
        return "\n";
      case "code_inline":
        return (
          <Text key={index} style={styles.inlineCode}>
            {content}
          </Text>
        );
      case "strong_open":
        return (
          <Text key={index} style={styles.strong}>
            {content}
          </Text>
        );
      case "em_open":
        return (
          <Text key={index} style={styles.emphasis}>
            {content}
          </Text>
        );
      case "s_open":
        return (
          <Text key={index} style={styles.strike}>
            {content}
          </Text>
        );
      case "link_open": {
        const href = String(token.attrGet("href") ?? "");
        const safe = /^(https?:|mailto:)/i.test(href);
        return (
          <Text
            key={index}
            accessibilityRole={safe ? "link" : undefined}
            style={styles.link}
            onPress={
              safe
                ? () => {
                    void Linking.openURL(href).catch(() => {});
                  }
                : undefined
            }
          >
            {content}
          </Text>
        );
      }
      case "image":
        return <Text key={index}>{token.content || "[图片]"}</Text>;
      case "footnote_ref":
        return (
          <Text key={index} style={styles.footnoteRef}>
            {`[${Number(token.meta?.id ?? 0) + 1}]`}
          </Text>
        );
      default:
        return <Text key={index}>{content}</Text>;
    }
  });
}

function blocks(nodes: Node[]): React.ReactNode {
  return nodes.map(({ token, children }, index) => {
    switch (token.type) {
      case "inline":
        return (
          <Text selectable key={index}>
            {inline(children)}
          </Text>
        );
      case "paragraph_open":
        return (
          <Text selectable key={index} style={styles.paragraph}>
            {children.map((child) => inline(child.children))}
          </Text>
        );
      case "heading_open":
        return (
          <Text
            selectable
            key={index}
            style={[styles.heading, token.tag === "h1" && styles.h1]}
          >
            {children.map((child) => inline(child.children))}
          </Text>
        );
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0] ?? "";
        const segments = language
          ? highlightSegments(token.content.replace(/\n$/, ""), language)
          : [{ text: token.content.replace(/\n$/, "") }];
        return (
          <ScrollView horizontal key={index} style={styles.code}>
            <Text selectable style={styles.codeText}>
              {segments.map((segment, segIndex) => (
                <Text
                  key={segIndex}
                  style={segment.color ? { color: segment.color } : undefined}
                >
                  {segment.text}
                </Text>
              ))}
            </Text>
          </ScrollView>
        );
      }
      case "hr":
        return <View key={index} style={styles.rule} />;
      case "footnote_block_open":
        return (
          <View key={index} style={styles.footnotes}>
            {blocks(children)}
          </View>
        );
      case "footnote_open":
        return (
          <View key={index} style={styles.footnoteItem}>
            {blocks(children)}
          </View>
        );
      case "footnote_anchor":
        return (
          <Text key={index} style={styles.footnoteRef}>
            ↩
          </Text>
        );
      case "blockquote_open":
        return (
          <View key={index} style={styles.quote}>
            {blocks(children)}
          </View>
        );
      case "bullet_list_open":
      case "ordered_list_open":
        return (
          <View key={index} style={styles.list}>
            {children.map((child, i) => (
              <View key={i} style={styles.listItem}>
                <Text>
                  {token.type === "ordered_list_open"
                    ? `${Number(token.attrGet("start") || 1) + i}. `
                    : "• "}
                </Text>
                <View style={styles.listBody}>{blocks(child.children)}</View>
              </View>
            ))}
          </View>
        );
      case "table_open":
        return <MarkdownTable key={`${index}:${tableContent(children)}`} sections={children} />;
      default:
        return (
          <View key={index}>
            {children.length ? (
              blocks(children)
            ) : (
              <Text selectable>{token.content}</Text>
            )}
          </View>
        );
    }
  });
}

function tableContent(nodes: Node[]): string {
  return nodes.map(({ token, children }) => `${token.type}:${token.content}:${tableContent(children)}`).join("|");
}

function MarkdownTable({ sections }: { sections: Node[] }) {
  const [widths, setWidths] = useState<number[]>([]);
  const rows = sections.flatMap((section) => section.children);
  return (
    <ScrollView horizontal>
      <View style={styles.table}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.children.map(({ token, children }, columnIndex) => {
              const alignment = String(token.attrGet("style") ?? "")
                .match(/text-align:\s*(left|center|right)/)?.[1] as "left" | "center" | "right" | undefined;
              return (
                <View
                  key={columnIndex}
                  style={[styles.cell, widths[columnIndex] != null && { minWidth: widths[columnIndex] }]}
                  onLayout={(event) => {
                    const width = event.nativeEvent.layout.width;
                    setWidths((current) => {
                      if (width <= (current[columnIndex] ?? 0)) return current;
                      const next = [...current];
                      next[columnIndex] = width;
                      return next;
                    });
                  }}
                >
                  <Text selectable style={[token.type === "th_open" && styles.strong, { textAlign: alignment ?? "left" }]}>
                    {children.map((child) => inline(child.children))}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function MessageMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  // 流式补全只作用于展示输入，不改写领域消息。
  const nodes = useMemo(
    () => tree(parser.parse(streaming ? remend(text) : text, {})),
    [text, streaming],
  );
  return <View>{blocks(nodes)}</View>;
}

const styles = StyleSheet.create({
  paragraph: { marginVertical: 3, fontSize: 15, lineHeight: 24, color: "#333" },
  heading: { fontSize: 18, fontWeight: "700", marginVertical: 5 },
  h1: { fontSize: 22 },
  strong: { fontWeight: "700" },
  emphasis: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  link: { color: "#126b9a", textDecorationLine: "underline" },
  inlineCode: { fontFamily: "monospace", backgroundColor: "#e4e9e7" },
  code: {
    backgroundColor: "#e4e9e7",
    padding: 8,
    marginVertical: 5,
    borderRadius: 5,
  },
  codeText: { fontFamily: "monospace" },
  quote: { borderLeftWidth: 3, borderLeftColor: "#aab9b2", paddingLeft: 8 },
  list: { paddingLeft: 8 },
  listItem: { flexDirection: "row" },
  listBody: { flex: 1 },
  // 各单元格测量内容宽度，整列共享最大值。
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#bcc9c3", marginVertical: 5 },
  row: { flexDirection: "row" },
  cell: {
    flexShrink: 0,
    padding: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#bcc9c3",
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: "#bcc9c3",
    marginVertical: 6,
  },
  footnoteRef: { fontSize: 11, color: "#126b9a" },
  footnotes: {
    borderTopWidth: 1,
    borderTopColor: "#bcc9c3",
    marginTop: 8,
    paddingTop: 6,
    gap: 4,
  },
  footnoteItem: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
});
