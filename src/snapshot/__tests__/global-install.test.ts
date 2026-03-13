import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("global install instructions", () => {
  it("uses the Bun link workflow consistently for local installs", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

    const readme = read("../../../README.md");
    const usersGuide = read("../../../docs/users-guide.md");
    const installScript = read("../../../scripts/install.sh");

    expect(readme).toContain("bun link");
    expect(readme).toContain("bash scripts/install.sh");
    expect(usersGuide).toContain("bun link");
    expect(installScript).toContain("bun link");

    expect(readme).not.toContain("```bash\nbun install -g .\n```");
    expect(readme).not.toContain("```bash\nbun add -g .\n```");
    expect(usersGuide).not.toContain("```bash\nbun install -g .\n```");
    expect(usersGuide).not.toContain("```bash\nbun add -g .\n```");
    expect(installScript).not.toContain('npm install -g "$ROOT_DIR"');
  });
});
