import { describe, expect, it } from "vitest";
import { formatSize, promptOf } from "./generator";

const FENCE = "```";

describe("promptOf", () => {
  it("reads a text block as the page shows it, each paragraph unwrapped (the real PROMPT.md is checked end to end)", () => {
    const md = `# Generating a lesson set\r\n\r\n## The prompt\r\n\r\n${FENCE}text\r\nYou write a touch-typing course for my\r\n`
      + `keyboard. Attached: layout-export.json.\r\n\r\nFollow GENERATE.md step by step.\r\n${FENCE}\r\n`;
    expect(promptOf(md)).toBe(
      "You write a touch-typing course for my keyboard. Attached: layout-export.json.\n\nFollow GENERATE.md step by step.",
    );
  });

  it("takes the first text block only, with CRLF or LF line ends, and drops empty paragraphs", () => {
    const md = `# Title\r\n\r\n${FENCE}text\r\n\r\nfirst line\r\nsecond line\r\n\r\n\r\n\r\nthird\r\n${FENCE}\r\n\r\n${FENCE}text\r\nanother\r\n${FENCE}\r\n`;
    expect(promptOf(md)).toBe("first line second line\n\nthird");
    expect(promptOf(md.replace(/\r\n/g, "\n"))).toBe("first line second line\n\nthird");
  });

  it("is null without a text block", () => {
    expect(promptOf(`# Nothing here\n\n${FENCE}json\n{}\n${FENCE}\n`)).toBeNull();
    expect(promptOf("")).toBeNull();
  });
});

describe("formatSize", () => {
  it("shows bytes, kilobytes and megabytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1100)).toBe("1 KB");
    expect(formatSize(4541)).toBe("4 KB");
    expect(formatSize(134487)).toBe("131 KB");
    expect(formatSize(1_300_000)).toBe("1.2 MB");
  });
});
