import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createTransport } from "nodemailer";
import { Type } from "typebox";

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

const parameters = Type.Object({
  to: Type.String({
    minLength: 3,
    description: "Recipient email address.",
  }),
  subject: Type.String({
    minLength: 1,
    maxLength: 200,
    description: "Email subject.",
  }),
  text: Type.String({
    minLength: 1,
    description: "Plain-text email body.",
  }),
});

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function createEmailTool(config: SmtpConfig): AgentTool<
  typeof parameters
> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return {
    name: "send_email",
    label: "Send email",
    description:
      "Send a plain-text email to one recipient using the configured SMTP account. Confirm the recipient and content with the user before sending.",
    parameters,
    async execute(_toolCallId, { to, subject, text }) {
      const recipient = to.trim();
      if (!ADDRESS.test(recipient))
        throw new Error("无效的收件人邮箱地址。");
      const info = await transport.sendMail({
        from: config.from,
        to: recipient,
        subject,
        text,
      });
      return {
        content: [{ type: "text" as const, text: `邮件已发送至 ${recipient}。` }],
        details: { messageId: info.messageId },
      };
    },
  };
}
