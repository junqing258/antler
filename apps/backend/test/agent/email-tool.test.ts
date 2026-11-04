import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({ createTransport: mocks.createTransport }));

import { createEmailTool, type SmtpConfig } from "../../src/agent/email-tool.js";

const config: SmtpConfig = {
  host: "smtp.example.com",
  port: 465,
  user: "sender@example.com",
  pass: "smtp-secret",
  from: "Antler <sender@example.com>",
};

describe("createEmailTool", () => {
  beforeEach(() => {
    mocks.sendMail.mockReset().mockResolvedValue({ messageId: "message-1" });
    mocks.createTransport
      .mockReset()
      .mockReturnValue({ sendMail: mocks.sendMail });
  });

  it("sends a plain-text email through the configured SMTP account", async () => {
    const tool = createEmailTool(config);

    const result = await tool.execute("call-1", {
      to: "  recipient@example.com ",
      subject: "Hello",
      text: "Body",
    });

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: { user: "sender@example.com", pass: "smtp-secret" },
      }),
    );
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: "Antler <sender@example.com>",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: "邮件已发送至 recipient@example.com。",
    });
  });

  it("uses STARTTLS on non-465 ports", () => {
    createEmailTool({ ...config, port: 587 });

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("rejects an invalid recipient before sending", async () => {
    const tool = createEmailTool(config);

    await expect(
      tool.execute("call-2", {
        to: "not-an-address",
        subject: "Hello",
        text: "Body",
      }),
    ).rejects.toThrow("无效的收件人邮箱地址。");
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
