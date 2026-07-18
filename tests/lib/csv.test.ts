import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";

describe("toCsv (Section 7.13)", () => {
  it("renders a header row and one row per input, comma-separated", () => {
    const csv = toCsv(
      [
        { name: "Alice", amount: 100 },
        { name: "Bob", amount: 200 },
      ],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Amount", value: (r) => r.amount },
      ]
    );
    expect(csv).toBe("Name,Amount\r\nAlice,100\r\nBob,200");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = toCsv(
      [{ note: 'Contains, a comma' }, { note: 'Has "quotes"' }, { note: "Has\na newline" }],
      [{ header: "Note", value: (r) => r.note }]
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"Contains, a comma"');
    expect(lines[2]).toBe('"Has ""quotes"""');
    expect(lines[3]).toBe('"Has\na newline"');
  });

  it("renders null/undefined values as empty strings", () => {
    const csv = toCsv([{ note: null }, { note: undefined }], [{ header: "Note", value: (r) => r.note }]);
    expect(csv).toBe("Note\r\n\r\n");
  });

  it("produces just the header row for an empty dataset", () => {
    const csv = toCsv([] as { name: string }[], [{ header: "Name", value: (r) => r.name }]);
    expect(csv).toBe("Name");
  });
});
