/** FIFO readers/writer lock. Multi-key acquisitions always use sorted database IDs. */
class ReadWriteLock {
  private readers = 0;
  private writer = false;
  private queue: { write: boolean; resolve: (release: () => void) => void }[] =
    [];
  acquire(write: boolean): Promise<() => void> {
    return new Promise((resolve) => {
      this.queue.push({ write, resolve });
      this.drain();
    });
  }
  private drain() {
    if (this.writer) return;
    while (this.queue.length) {
      const next = this.queue[0]!;
      if (next.write && this.readers) return;
      this.queue.shift();
      if (next.write) this.writer = true;
      else this.readers++;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        if (next.write) this.writer = false;
        else this.readers--;
        this.drain();
      });
      if (next.write) return;
    }
  }
}
export class SkillLocks {
  private locks = new Map<string, ReadWriteLock>();
  async acquire(ids: string[], write = false) {
    const releases: (() => void)[] = [];
    for (const id of [...new Set(ids)].sort()) {
      let lock = this.locks.get(id);
      if (!lock) this.locks.set(id, (lock = new ReadWriteLock()));
      releases.push(await lock.acquire(write));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releases.reverse()) release();
    };
  }
}
