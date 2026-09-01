import { buildZip } from "@/lib/account/export";

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

describe("buildZip", () => {
  it("produces a well-formed empty archive", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readU32(zip, 0)).toBe(0x06054b50); // EOCD signature
  });

  it("stores entries with local header signatures and correct sizes", () => {
    const data = new TextEncoder().encode('{"a":1}');
    const zip = buildZip([{ name: "profile.json", data }]);
    expect(readU32(zip, 0)).toBe(0x04034b50); // local file header
    // name follows the 30-byte header
    const name = new TextDecoder().decode(zip.slice(30, 30 + "profile.json".length));
    expect(name).toBe("profile.json");
    // data follows the name
    const payload = zip.slice(30 + name.length, 30 + name.length + data.length);
    expect(new TextDecoder().decode(payload)).toBe('{"a":1}');
  });

  it("counts entries in the end-of-central-directory record", () => {
    const entries = [
      { name: "a.json", data: new Uint8Array([1, 2, 3]) },
      { name: "b.json", data: new Uint8Array([4]) },
    ];
    const zip = buildZip(entries);
    const eocdOffset = zip.length - 22;
    expect(readU32(zip, eocdOffset)).toBe(0x06054b50);
    const view = new DataView(zip.buffer, zip.byteOffset + eocdOffset);
    expect(view.getUint16(8, true)).toBe(2); // entry count
  });
});
