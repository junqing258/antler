import { crc32 } from "node:zlib";
/** Small stored ZIP writer for adversarial archive fixtures (no external zip executable). */
export function archive(
  files: Record<string, string | Buffer>,
  options: { symlink?: string; encrypted?: string } = {},
) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = Buffer.from(path),
      data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(path === options.encrypted ? 1 : 0, 6);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(path === options.encrypted ? 1 : 0, 8);
    record.writeUInt32LE(crc32(data), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(
      ((path === options.symlink ? 0o120777 : 0o100600) * 65536) >>> 0,
      38,
    );
    record.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]).toString("base64");
}
export const instruction = (description = "Example skill", disabled = false) =>
  `---\nname: sample-skill\ndescription: ${description}\ndisable-model-invocation: ${disabled}\n---\nUse resources carefully.\n`;
export const uploadBody = (
  description = "Example skill",
  disabled = false,
) => ({
  name: "sample-skill",
  archive: archive({
    "SKILL.md": instruction(description, disabled),
    "data.txt": "original resource",
  }),
});
