export type SseFrame = { id?: string; event?: string; data: string };

/** Incrementally frame decoded SSE text; the caller owns UTF-8 decoding and cursor policy. */
export class SseParser {
  private buffer = "";
  push(text: string): SseFrame[] {
    this.buffer += text;
    const frames: SseFrame[] = [];
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      let id: string | undefined;
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "id" && !value.includes("\0")) id = value;
        else if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) frames.push({ id, event, data: data.join("\n") });
    }
    return frames;
  }
}
