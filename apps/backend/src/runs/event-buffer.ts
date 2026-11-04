import type { RunEvent } from "../agent/events.js";

/** Loss-tolerant persistence; live events never wait for a batch write. */
export class RunEventBuffer {
  private events: RunEvent[] = [];
  private timer?: NodeJS.Timeout;
  private writing?: Promise<void>;

  constructor(private readonly write: (events: RunEvent[]) => Promise<void>) {}

  append(event: RunEvent) {
    this.events.push(event);
    // Bound pending work even if the database stalls. Dropped events remain
    // available in the runtime's live replay, but may be absent after restart.
    if (this.events.length > 1_000) this.events.shift();
    this.schedule();
  }

  private schedule() {
    if (this.timer || this.writing || !this.events.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 2_000);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.writing) {
      await this.writing;
      return this.flush();
    }
    if (!this.events.length) return;
    const events = this.events.splice(0);
    this.writing = Promise.resolve().then(() => this.write(events)).catch(() => {
      // Do not retry an ever-growing backlog or poison subsequent batches.
      console.warn(`[Runs] Event batch persistence failed for ${events[0].runId}; ${events.length} events dropped`);
    });
    await this.writing;
    this.writing = undefined;
    this.schedule();
  }
}
