import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("global install instructions", () => {
  it("uses the npm-based global install workaround consistently", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

    const readme = read("../../../README.md");
    const usersGuide = read("../../../docs/users-guide.md");
    const installScript = read("../../../scripts/install.sh");

    expect(readme).toContain("npm install -g .");
    expect(readme).toContain('npm install -g "$(pwd)/css-view-0.1.0.tgz"');
    expect(usersGuide).toContain("npm install -g .");
    expect(usersGuide).toContain('npm install -g "$(pwd)/css-view-0.1.0.tgz"');
    expect(installScript).toContain('npm install -g "$ROOT_DIR"');

    expect(readme).not.toContain("```bash\nbun install -g .\n```");
    expect(readme).not.toContain("```bash\nbun add -g .\n```");
    expect(usersGuide).not.toContain("```bash\nbun install -g .\n```");
    expect(usersGuide).not.toContain("```bash\nbun add -g .\n```");
    expect(installScript).not.toContain('bun install -g "$ROOT_DIR"');
    expect(installScript).not.toContain('bun add -g "$ROOT_DIR"');
  });
});
