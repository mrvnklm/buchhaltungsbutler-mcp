#!/usr/bin/env node
// Packages the server as a Claude Desktop Extension (.mcpb) for one-click
// installation: npm run build:mcpb, then drag the resulting file into
// Claude Desktop -> Settings -> Extensions.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const stageDir = join(root, "mcpb-build");
const outFile = join(root, "buchhaltungsbutler-mcp.mcpb");

console.log("Building server...");
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

console.log("Staging extension bundle...");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "server"), { recursive: true });
cpSync(join(root, "dist"), join(stageDir, "server"), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

writeFileSync(
  join(stageDir, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, type: pkg.type, dependencies: pkg.dependencies },
    null,
    2
  )
);

console.log("Installing production dependencies...");
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stageDir,
  stdio: "inherit",
});

console.log("Packing .mcpb bundle...");
if (existsSync(outFile)) rmSync(outFile);
// Resolves the pinned @anthropic-ai/mcpb devDependency from node_modules/.bin
// rather than fetching an unpinned "latest" from the registry.
execFileSync("npx", ["mcpb", "pack", stageDir, outFile], {
  cwd: root,
  stdio: "inherit",
});

rmSync(stageDir, { recursive: true, force: true });
console.log(`Done: ${outFile}`);
