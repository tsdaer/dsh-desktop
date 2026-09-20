// scripts/verify-translation-pairing.ts
import { existsSync as existsSync2, globSync, readFileSync, statSync as statSync2, writeFileSync } from "node:fs";
import { basename as basename3, join, resolve as resolve2, sep } from "node:path";

// scripts/translation-pairing-git.ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
var SNAPSHOT_REF_PREFIX = "refs/dsh/translation-pairing/snapshots";
var GIT_COMMAND_MAX_BUFFER = 1 << 26;
function gitBlobHash(content) {
  const hash = createHash("sha1");
  hash.update(`blob ${content.byteLength}\0`);
  hash.update(content);
  return hash.digest("hex");
}
function runGit(root2, args, operation, input) {
  const result = spawnSync("git", ["-C", root2, ...args], {
    input,
    maxBuffer: GIT_COMMAND_MAX_BUFFER
  });
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${operation} failed with status ${String(result.status)}: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}
function gitIndexPaths(root2) {
  const paths = /* @__PURE__ */ new Set();
  const entries = runGit(root2, ["ls-files", "--stage", "-z"], "listing Git index paths").toString("utf8").split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^\d+ [0-9a-f]+ ([0-3])\t([\s\S]+)$/.exec(entry);
    if (!match?.[1] || match[2] === void 0) throw new Error("git ls-files --stage returned a malformed entry");
    if (match[1] === "0") paths.add(match[2]);
  }
  return paths;
}
function readGitIndexBlob(root2, path) {
  const output = runGit(
    root2,
    ["ls-files", "--stage", "-z", "--", path],
    `git ls-files --stage for ${path}`
  ).toString("utf8");
  const entries = output.split("\0").filter(Boolean);
  if (entries.length === 0) return void 0;
  if (entries.length !== 1) throw new Error(`${path} does not have exactly one resolved index entry`);
  const match = /^(?:\d+) ([0-9a-f]+) 0\t[\s\S]+$/.exec(entries[0] ?? "");
  if (!match?.[1]) throw new Error(`${path} remains unmerged or has an invalid index entry`);
  return {
    objectId: match[1],
    content: runGit(root2, ["cat-file", "blob", match[1]], `reading staged ${path}`)
  };
}
function storeGitBlob(root2, content) {
  const expected = gitBlobHash(content);
  const stored = runGit(root2, ["hash-object", "-w", "--stdin"], "git hash-object -w --stdin", content).toString("utf8").trim();
  if (stored !== expected) {
    throw new Error(`git hash-object -w --stdin returned unexpected object ID ${JSON.stringify(stored)}; expected ${expected}`);
  }
  runGit(
    root2,
    ["update-ref", `${SNAPSHOT_REF_PREFIX}/${stored}`, stored],
    "git update-ref for translation snapshot"
  );
  return stored;
}

// scripts/translation-pairing-record.ts
import { basename } from "node:path";
var META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/;
function translationPairPaths(source) {
  if (!source.endsWith(".md") || source.endsWith(".zh.md")) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`);
  }
  return {
    source,
    zh: source.replace(/\.md$/, ".zh.md"),
    meta: source.replace(/\.md$/, ".i18n.yaml")
  };
}
function parseTranslationPairingRecord(content, paths) {
  const hashes = /* @__PURE__ */ new Map();
  for (const line of content.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = META_LINE.exec(line);
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return void 0;
    hashes.set(match[1], match[2]);
  }
  const sourceHash = hashes.get(basename(paths.source));
  const zhHash = hashes.get(basename(paths.zh));
  if (hashes.size !== 2 || sourceHash === void 0 || zhHash === void 0) return void 0;
  return { sourceHash, zhHash };
}
function renderTranslationPairingRecord(paths, record) {
  return [
    "# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each",
    "# side as of the last confirmed-consistent state. Both languages carry equal authority;",
    "# after editing either side, bring the other along and re-record with:",
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    ""
  ].join("\n");
}

// scripts/translation-pairing.ts
import { basename as basename2 } from "node:path";
import { fromMarkdown as fromMarkdown2 } from "mdast-util-from-markdown";
import { gfmFromMarkdown as gfmFromMarkdown2 } from "mdast-util-gfm";
import { gfm as gfm2 } from "micromark-extension-gfm";

// scripts/translation-links.ts
import { existsSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";

// scripts/markdown.ts
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
function parseMarkdown(source) {
  return fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}
function visitMarkdown(node, visitor) {
  if (visitor(node) === false) return;
  if ("children" in node) {
    for (const child of node.children) visitMarkdown(child, visitor);
  }
}
function isExternalOrAbsoluteMarkdownUrl(url) {
  return url.startsWith("#") || url.startsWith("//") || url.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}
function splitMarkdownUrlTarget(url) {
  const boundary = url.search(/[?#]/);
  if (boundary === -1) return { path: url, suffix: "" };
  return { path: url.slice(0, boundary), suffix: url.slice(boundary) };
}
function skipWhitespace(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}
function labelEnd(source) {
  const first = source.indexOf("[");
  if (first === -1) return -1;
  let depth = 0;
  for (let index = first; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
function destinationRange(rawNode, type) {
  const endOfLabel = labelEnd(rawNode);
  if (endOfLabel === -1) throw new Error(`markdown: cannot locate label end in ${JSON.stringify(rawNode)}`);
  let start;
  if (type === "definition") {
    const colon = rawNode.indexOf(":", endOfLabel + 1);
    if (colon === -1) throw new Error(`markdown: cannot locate definition separator in ${JSON.stringify(rawNode)}`);
    start = skipWhitespace(rawNode, colon + 1);
  } else {
    if (rawNode[endOfLabel + 1] !== "(") {
      throw new Error(`markdown: cannot locate inline destination in ${JSON.stringify(rawNode)}`);
    }
    start = skipWhitespace(rawNode, endOfLabel + 2);
  }
  if (rawNode[start] === "<") {
    for (let index = start + 1; index < rawNode.length; index += 1) {
      if (rawNode[index] === "\\") index += 1;
      else if (rawNode[index] === ">") return { start: start + 1, end: index };
    }
    throw new Error(`markdown: cannot locate angle-bracket destination end in ${JSON.stringify(rawNode)}`);
  }
  let depth = 0;
  for (let index = start; index < rawNode.length; index += 1) {
    const char = rawNode[index];
    if (char === "\\") index += 1;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) return { start, end: index };
      depth -= 1;
    } else if (/\s/.test(char ?? "") && depth === 0) {
      return { start, end: index };
    }
  }
  return { start, end: rawNode.length };
}
function markdownDestination(source, node) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === void 0 || end === void 0) {
    throw new Error(`markdown: destination ${JSON.stringify(node.url)} has no source offsets`);
  }
  const range = destinationRange(source.slice(start, end), node.type);
  const absolute = { start: start + range.start, end: start + range.end };
  return { ...absolute, url: source.slice(absolute.start, absolute.end) };
}

// scripts/translation-links.ts
function languageSwitcherLinkOffset(tree, markdown, acceptedTargets) {
  if (tree.type !== "root") return void 0;
  const accepted = new Set(typeof acceptedTargets === "string" ? [acceptedTargets] : acceptedTargets);
  const headingIndex = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1);
  if (headingIndex < 0) return void 0;
  for (const node of tree.children.slice(headingIndex + 1)) {
    if (node.type === "heading") return void 0;
    if (node.type !== "paragraph" || node.position === void 0) continue;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === void 0 || end === void 0) continue;
    const authored = markdown.slice(start, end);
    if (!/^(?:English \| \[中文\]\([^\n]+\)|\[English\]\([^\n]+\) \| 中文)$/.test(authored)) continue;
    const links = node.children.filter((child) => child.type === "link");
    if (links.length === 1 && accepted.has(links[0]?.url ?? "")) {
      return links[0]?.position?.start.offset;
    }
  }
  return void 0;
}
function hasLanguageSwitcher(tree, markdown, acceptedTargets) {
  return languageSwitcherLinkOffset(tree, markdown, acceptedTargets) !== void 0;
}
function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
function worktreeFileExists(repoRoot, repoPath) {
  try {
    const path = resolve(repoRoot, repoPath);
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
function repositoryFileExists(context, repoPath) {
  return context.repositoryFileExists?.(repoPath) ?? worktreeFileExists(context.repoRoot, repoPath);
}
function repositoryRelativePath(path) {
  const normalized = posix.normalize(path);
  if (normalized === "" || normalized === "." || normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    return void 0;
  }
  return normalized;
}
function resolveRepositoryTarget(rawPath, context) {
  const decoded = decodePath(rawPath);
  const exact = repositoryRelativePath(posix.join(posix.dirname(context.sourcePath), decoded));
  if (exact === void 0) return void 0;
  return repositoryFileExists(context, exact) ? exact : void 0;
}
function translationPairTarget(targetPath, context) {
  const source = targetPath.endsWith(".zh.md") ? targetPath.replace(/\.zh\.md$/, ".md") : targetPath.endsWith(".md") ? targetPath : void 0;
  if (source === void 0 || !context.isTranslationPairSource(source)) return void 0;
  const zh = source.replace(/\.md$/, ".zh.md");
  return { source, zh };
}
function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function relativeExpectedPath(context, expectedPath, rawPath) {
  const relative = posix.relative(posix.dirname(context.sourcePath), expectedPath);
  const encoded = relative.split("/").map(encodePathSegment).join("/");
  return rawPath.startsWith("./") && !encoded.startsWith(".") ? `./${encoded}` : encoded;
}
function expectedLocalePath(rawPath, locale, context, expectedPath) {
  if (locale === "zh" && rawPath.endsWith(".md") && !rawPath.endsWith(".zh.md")) {
    return rawPath.replace(/\.md$/, ".zh.md");
  }
  if (locale === "en" && rawPath.endsWith(".zh.md")) return rawPath.replace(/\.zh\.md$/, ".md");
  return relativeExpectedPath(context, expectedPath, rawPath);
}
function resolveTranslationLink(url, context, authoredUrl) {
  if (isExternalOrAbsoluteMarkdownUrl(url)) return void 0;
  const { path } = splitMarkdownUrlTarget(url);
  const authored = splitMarkdownUrlTarget(authoredUrl);
  if (path === "") return void 0;
  const targetPath = resolveRepositoryTarget(path, context);
  if (targetPath === void 0) return void 0;
  const pair = translationPairTarget(targetPath, context);
  if (pair === void 0) return void 0;
  const locale = context.sourcePath.endsWith(".zh.md") ? "zh" : "en";
  const expectedPath = locale === "zh" ? pair.zh : pair.source;
  return {
    pair,
    targetPath,
    suffix: authored.suffix,
    expectedPath,
    expectedUrl: `${expectedLocalePath(authored.path, locale, context, expectedPath)}${authored.suffix}`,
    locale
  };
}
function hasExpectedLocale(resolved) {
  return resolved.targetPath === resolved.expectedPath;
}
function replacementFor(destination, value) {
  return { start: destination.start, end: destination.end, value };
}
function authoredExternalTarget(markdown, node) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === void 0 || end === void 0) {
    throw new Error(`translation-links: external link ${JSON.stringify(node.url)} has no source offsets`);
  }
  const raw = markdown.slice(start, end);
  if (node.type === "definition" || raw.startsWith("[")) return markdownDestination(markdown, node).url;
  if (raw.startsWith("<") && raw.endsWith(">")) return raw.slice(1, -1);
  return raw;
}
function applyReplacements(markdown, replacements) {
  let output = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
}
function visitDocumentLinkNodes(markdown, skipTargets, visitor) {
  const tree = parseMarkdown(markdown);
  const switcherOffset = languageSwitcherLinkOffset(tree, markdown, skipTargets);
  const referencedIdentifiers = /* @__PURE__ */ new Set();
  const visitedDefinitions = /* @__PURE__ */ new Set();
  visitMarkdown(tree, (node) => {
    if (node.type === "linkReference") referencedIdentifiers.add(node.identifier);
  });
  visitMarkdown(tree, (node) => {
    if (node.type === "link" && node.position?.start.offset === switcherOffset) return;
    if (node.type === "link") {
      visitor(node);
    } else if (node.type === "definition" && referencedIdentifiers.has(node.identifier) && !visitedDefinitions.has(node.identifier)) {
      visitedDefinitions.add(node.identifier);
      visitor(node);
    }
  });
}
function visitResolvedDocumentLinks(markdown, context, skipTargets, visitor) {
  visitDocumentLinkNodes(markdown, skipTargets, (node) => {
    if (isExternalOrAbsoluteMarkdownUrl(node.url)) return;
    const destination = markdownDestination(markdown, node);
    const resolved = resolveTranslationLink(node.url, context, destination.url);
    if (resolved !== void 0) visitor(node, destination, resolved);
  });
}
function translationLinkLocaleViolations(markdown, context, skipTargets = []) {
  const violations = [];
  visitResolvedDocumentLinks(markdown, context, skipTargets, (node, destination, resolved) => {
    if (hasExpectedLocale(resolved)) return;
    violations.push({
      sourcePath: context.sourcePath,
      line: node.position?.start.line ?? 0,
      url: destination.url,
      expectedUrl: resolved.expectedUrl
    });
  });
  return violations;
}
function normalizeTranslationMarkdownLinks(markdown, context, skipTargets = []) {
  const replacements = [];
  visitResolvedDocumentLinks(markdown, context, skipTargets, (_node, destination, resolved) => {
    replacements.push(replacementFor(
      destination,
      `dsh-translation-target:${resolved.pair.source}${resolved.suffix}`
    ));
  });
  return applyReplacements(markdown, replacements);
}
function semanticTranslationLinkNodeTarget(node, markdown, context) {
  if (isExternalOrAbsoluteMarkdownUrl(node.url)) return authoredExternalTarget(markdown, node);
  const destination = markdownDestination(markdown, node);
  const resolved = resolveTranslationLink(node.url, context, destination.url);
  return resolved === void 0 ? destination.url : `dsh-translation-target:${resolved.pair.source}${resolved.suffix}`;
}

// scripts/translation-pairing.ts
var GENERATED_REGION_BEGIN_LINE = /^<!-- BEGIN GENERATED (\S+)(?: [^>]*)? -->$/;
var GENERATED_REGION_END_LINE = /^<!-- END GENERATED (\S+) -->$/;
var GENERATED_REGION_MARKER_HINT = /^<!-- (?:BEGIN|END) GENERATED /;
function partitionGeneratedRegions(content) {
  const lines = content.split("\n");
  const regions = [];
  const kept = [];
  let open = null;
  for (const line of lines) {
    const begin = GENERATED_REGION_BEGIN_LINE.exec(line);
    if (begin?.[1]) {
      if (open) throw new Error("generated region BEGIN marker nested inside an open region");
      open = { slug: begin[1], lines: [line] };
      continue;
    }
    const end = GENERATED_REGION_END_LINE.exec(line);
    if (end?.[1]) {
      if (!open) throw new Error("generated region END marker without a BEGIN");
      if (end[1] !== open.slug) throw new Error(`generated region END slug '${end[1]}' does not match its BEGIN slug '${open.slug}'`);
      open.lines.push(line);
      regions.push(open.lines.join("\n"));
      open = null;
      continue;
    }
    if (GENERATED_REGION_MARKER_HINT.test(line)) {
      throw new Error(`malformed generated region marker line: ${JSON.stringify(line)}`);
    }
    if (open) open.lines.push(line);
    else kept.push(line);
  }
  if (open) throw new Error("generated region BEGIN marker without an END");
  return { regions, stripped: kept.join("\n") };
}
var README_ARTIFACT = /(?:^|\/)readme(?:\.md|\.zh\.md|\.i18n\.yaml)$/i;
var ROOT_PAIRED_DOCUMENT_ARTIFACT = /^(?:brand_guidelines|contributing|safety)(?:\.md|\.zh\.md|\.i18n\.yaml)$/i;
var NON_SOURCE_DIRECTORIES = /* @__PURE__ */ new Set([
  "node_modules",
  "lib",
  ".pnpm-store",
  ".cache",
  "coverage",
  ".sessions",
  ".storages",
  "tmp",
  "dist-exe",
  "__pycache__",
  ".pytest_cache",
  ".artifacts",
  "vendor"
]);
var TRANSLATION_SCOPE_GLOB_EXCLUDES = [
  ".agents/notes/archived/**",
  "**/node_modules/**",
  "**/lib/**",
  "**/.pnpm-store/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/.doc-typecheck-*/**",
  "**/.node-next-types-*/**",
  "**/.sessions/**",
  "**/.storages/**",
  "**/tmp/**",
  "**/dist-exe/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "apps/web/dist/**",
  ".artifacts/**",
  "python/sdk-runtime/src/deepseek_harness_runtime/runtime/deepseek-harness-sdk-runtime-*/**",
  "python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/**",
  "vendor/**"
];
function isTranslationSourceExcluded(file) {
  const segments = file.split("/");
  return segments.some((segment) => NON_SOURCE_DIRECTORIES.has(segment) || segment.startsWith(".doc-typecheck-") || segment.startsWith(".node-next-types-")) || file.startsWith("apps/web/dist/") || file.startsWith("python/sdk-runtime/src/deepseek_harness_runtime/runtime/deepseek-harness-sdk-runtime-") || file.startsWith("python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/");
}
function isTranslationScopeFile(file) {
  return !file.startsWith(".agents/notes/archived/") && !isTranslationSourceExcluded(file) && (README_ARTIFACT.test(file) || ROOT_PAIRED_DOCUMENT_ARTIFACT.test(file) || file.startsWith(".agents/notes/") || file.startsWith("docs/") || file.startsWith("python/"));
}
function excludedField(record) {
  const value = record.excluded;
  if (!Array.isArray(value)) {
    throw new Error("translation-pairing.manifest.json: excluded must be an array of strings");
  }
  const entries = value;
  if (!entries.every((entry) => typeof entry === "string")) {
    throw new Error("translation-pairing.manifest.json: excluded must be an array of strings");
  }
  return entries;
}
function parseTranslationPairingManifest(content) {
  const value = JSON.parse(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("translation-pairing.manifest.json: expected an object");
  }
  const record = value;
  const unsupported = Object.keys(record).filter((field) => field !== "excluded");
  if (unsupported.length > 0) {
    throw new Error(`translation-pairing.manifest.json: unsupported field(s): ${unsupported.join(", ")}; every in-scope document is required`);
  }
  return { excluded: excludedField(record) };
}
function isTranslationPairingManifestExcluded(file, manifest2) {
  return manifest2.excluded.some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry);
}
function translationPairSourcePredicate(manifest2) {
  return (sourcePath) => isTranslationScopeFile(sourcePath) && !isTranslationPairingManifestExcluded(sourcePath, manifest2);
}
function pairAnchorOfArgument(argument) {
  const normalized = argument.split("\\").join("/").replace(/^\.\//, "");
  if (normalized.endsWith(".zh.md")) return `${normalized.slice(0, -".zh.md".length)}.md`;
  if (normalized.endsWith(".i18n.yaml")) return `${normalized.slice(0, -".i18n.yaml".length)}.md`;
  if (normalized.endsWith(".md")) return normalized;
  return `${normalized}.md`;
}
function parseTranslationPairingCliArgs(argv) {
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const anchors = [...new Set(argv.filter((argument) => !argument.startsWith("--")).map(pairAnchorOfArgument))].sort();
  const unknown = flags.filter((flag) => !["--list", "--write", "--all", "--cached"].includes(flag));
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(", ")}`);
  const listMode2 = flags.includes("--list");
  const writeMode2 = flags.includes("--write");
  const allMode = flags.includes("--all");
  const cachedMode = flags.includes("--cached");
  if (listMode2 && (writeMode2 || allMode || cachedMode || anchors.length > 0)) {
    throw new Error("--list reports the whole corpus and takes no other flags or paths");
  }
  if (allMode && !writeMode2) throw new Error("--all only applies to --write");
  if (cachedMode && writeMode2) throw new Error("--cached is a read-only index check and cannot be combined with --write");
  if (cachedMode && anchors.length === 0) throw new Error("--cached requires the staged pair paths to check");
  if (writeMode2) {
    if (anchors.length > 0 && allMode) throw new Error("--write takes either pair paths or --all, not both");
    if (anchors.length === 0 && !allMode) {
      throw new Error("--write requires the pair(s) you confirmed (any file of a pair), or --all to re-record every complete pair; recording pairs you did not review blesses unconfirmed content");
    }
    return { input: "worktree", mode: "write", scope: allMode ? "corpus" : "pairs", anchors };
  }
  if (listMode2) return { input: "worktree", mode: "list", scope: "corpus", anchors: [] };
  return {
    input: cachedMode ? "index" : "worktree",
    mode: "check",
    scope: anchors.length > 0 ? "pairs" : "corpus",
    anchors
  };
}
function parseTranslationMarkdown(content) {
  return fromMarkdown2(content, { extensions: [gfm2()], mdastExtensions: [gfmFromMarkdown2()] });
}
var PUBLIC_REPOSITORY_BLOB_ROOT = "https://github.com/deepseek-ai/deepseek-harness/blob/master/";
function languageSwitcherTargets(counterpart) {
  return [basename2(counterpart), `${PUBLIC_REPOSITORY_BLOB_ROOT}${counterpart}`];
}
function requiresSourceLanguageSwitcher(source) {
  return ![
    "docs/agent-lifecycle.md",
    "docs/capability-seams.md",
    "docs/config-catalog.md",
    "docs/cordis-api/context.md",
    "docs/cordis-api/events.md",
    "docs/cordis-api/fiber.md",
    // Excluded from pairing, but kept here for generated-category completeness and direct spec coverage.
    "docs/cordis-api/inherited.md",
    "docs/cordis-api/registry.md",
    "docs/cordis-api/service.md",
    "docs/event-producer-consumer.md",
    "docs/graph-atlas.md",
    "docs/module-graph.md",
    "docs/persistence-catalog.md",
    "docs/tool-catalog.md",
    "docs/tool-execution-pipeline.md"
  ].includes(source);
}
function translationStructureSignature(tree, switcherTargets, linkContext) {
  const switcherOffset = languageSwitcherLinkOffset(tree, linkContext.markdown, switcherTargets);
  const sig = { headings: [], code: [], tables: [], lists: [], links: [] };
  const definitions = /* @__PURE__ */ new Map();
  const collectDefinitions = (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if ("children" in node) for (const child of node.children) collectDefinitions(child);
  };
  collectDefinitions(tree);
  const linkTarget = (node) => semanticTranslationLinkNodeTarget(node, linkContext.markdown, linkContext);
  const visit = (node) => {
    switch (node.type) {
      case "heading":
        sig.headings.push(node.depth);
        break;
      case "code":
        sig.code.push(`\`\`\`${node.lang ?? ""}${node.meta ? ` ${node.meta}` : ""}
${node.value}`);
        break;
      case "table":
        sig.tables.push(`${node.children.length}x${node.children[0]?.children.length ?? 0}`);
        break;
      case "list":
        sig.lists.push(node.ordered ? `ordered:start=${node.start ?? 1}:items=${node.children.length}` : `bullet:items=${node.children.length}`);
        break;
      case "link":
        if (node.position?.start.offset !== switcherOffset) {
          sig.links.push(linkTarget(node));
        }
        break;
      case "linkReference": {
        const definition = definitions.get(node.identifier);
        if (definition !== void 0) {
          sig.links.push(linkTarget(definition));
        }
        break;
      }
      default:
        break;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return sig;
}
function show(value) {
  if (value === void 0) return "nothing";
  const text = JSON.stringify(value);
  return text.length > 72 ? `${text.slice(0, 72)}\u2026` : text;
}
function translationStructureDiff(source, zh) {
  const out = [];
  const fields = [
    ["heading (depth)", source.headings, zh.headings],
    ["code block", source.code, zh.code],
    ["table (row x column count)", source.tables, zh.tables],
    ["list (kind, start, item count)", source.lists, zh.lists],
    ["link target", source.links, zh.links]
  ];
  for (const [field, sourceValues, zhValues] of fields) {
    const length = Math.max(sourceValues.length, zhValues.length);
    for (let index = 0; index < length; index++) {
      if (sourceValues[index] !== zhValues[index]) {
        out.push(`${field} #${index + 1} diverges between the pair: ${show(sourceValues[index])} vs ${show(zhValues[index])}`);
        break;
      }
    }
  }
  return out;
}

// scripts/verify-translation-pairing.ts
var root = resolve2(import.meta.dirname, "..");
var request;
try {
  request = parseTranslationPairingCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
var listMode = request.mode === "list";
var writeMode = request.mode === "write";
var indexMode = request.input === "index";
var indexFiles = indexMode ? gitIndexPaths(root) : void 0;
var contentCache = /* @__PURE__ */ new Map();
function readRepositoryFile(file) {
  if (contentCache.has(file)) return contentCache.get(file);
  const content = indexMode ? indexFiles?.has(file) ? readGitIndexBlob(root, file)?.content : void 0 : existsSync2(join(root, file)) && statSync2(join(root, file)).isFile() ? readFileSync(join(root, file)) : void 0;
  contentCache.set(file, content);
  return content;
}
function repositoryFileExists2(file) {
  return indexMode ? indexFiles?.has(file) === true : readRepositoryFile(file) !== void 0;
}
var SCOPE_PATTERNS = [
  "**/*.md",
  "**/*.i18n.yaml",
  ".agents/notes/**/*.md",
  ".agents/notes/**/*.i18n.yaml"
];
var manifestContent = readRepositoryFile("scripts/translation-pairing.manifest.json");
if (manifestContent === void 0) {
  throw new Error("scripts/translation-pairing.manifest.json is missing from the selected content plane");
}
var manifest = parseTranslationPairingManifest(manifestContent.toString("utf8"));
var isTranslationPairSource = translationPairSourcePredicate(manifest);
function isExcluded(file) {
  return isTranslationPairingManifestExcluded(file, manifest);
}
var files = /* @__PURE__ */ new Set();
if (request.scope === "pairs") {
  for (const anchor of request.anchors) {
    const { source, zh, meta } = translationPairPaths(anchor);
    for (const file of [source, zh, meta]) {
      if (repositoryFileExists2(file)) files.add(file);
    }
    if (!indexMode && !repositoryFileExists2(anchor)) files.add(anchor);
  }
} else {
  for (const pattern of SCOPE_PATTERNS) {
    for (const match of globSync(pattern, { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join("/");
      if (isTranslationScopeFile(normalized)) files.add(normalized);
    }
  }
}
var translations = [...files].filter((f) => f.endsWith(".zh.md")).sort();
var metas = [...files].filter((f) => f.endsWith(".i18n.yaml")).sort();
var sources = [...files].filter((f) => f.endsWith(".md") && !f.endsWith(".zh.md")).sort();
if (request.scope === "pairs") {
  const rejected = request.anchors.filter((anchor) => !isTranslationScopeFile(anchor) || isExcluded(anchor));
  const absent = request.anchors.filter((anchor) => {
    const { source, zh, meta } = translationPairPaths(anchor);
    return ![source, zh, meta].some(repositoryFileExists2);
  });
  if (rejected.length > 0 || !indexMode && absent.length > 0) {
    for (const anchor of rejected) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`);
    }
    for (const anchor of absent) {
      console.error(`verify-translation-pairing: ${anchor} names no pair on disk (none of its three files exist)`);
    }
    process.exit(2);
  }
}
if (writeMode) {
  let written = 0;
  for (const source of sources) {
    if (isExcluded(source)) continue;
    const paths = translationPairPaths(source);
    const { zh, meta } = paths;
    if (!repositoryFileExists2(source) || !repositoryFileExists2(zh)) {
      if (request.scope === "pairs") {
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${repositoryFileExists2(source) ? zh : source}`);
        process.exit(2);
      }
      continue;
    }
    const sourceContent = readRepositoryFile(source);
    const zhContent = readRepositoryFile(zh);
    if (sourceContent === void 0 || zhContent === void 0) throw new Error(`${source}: complete pair became unreadable`);
    const record = renderTranslationPairingRecord(paths, {
      sourceHash: storeGitBlob(root, sourceContent),
      zhHash: storeGitBlob(root, zhContent)
    });
    if (existsSync2(join(root, meta)) && readFileSync(join(root, meta), "utf8") === record) continue;
    writeFileSync(join(root, meta), record);
    console.log(`verify-translation-pairing: recorded ${meta}`);
    written++;
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`);
  process.exit(0);
}
var errors = [];
var state = /* @__PURE__ */ new Map();
for (const source of sources) {
  if (isExcluded(source)) continue;
  const { zh } = translationPairPaths(source);
  if (!repositoryFileExists2(zh)) {
    errors.push(`${source}: in-scope documentation must merge bilingual (docs/i18n/README.md); add the counterpart and record the pair`);
    state.set(source, "missing");
  }
}
var pairAnchors = /* @__PURE__ */ new Set();
for (const zh of translations) pairAnchors.add(zh.replace(/\.zh\.md$/, ".md"));
for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, ".md"));
for (const source of [...pairAnchors].sort()) {
  const paths = translationPairPaths(source);
  const { zh, meta } = paths;
  const have = {
    source: repositoryFileExists2(source),
    zh: repositoryFileExists2(zh),
    meta: repositoryFileExists2(meta)
  };
  if (isExcluded(source)) {
    if (have.zh) errors.push(`${zh}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`);
    if (have.meta) errors.push(`${meta}: ${source} is excluded from pairing; this consistency record must not exist`);
    continue;
  }
  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => k === "source" ? source : k === "zh" ? zh : meta);
  if (missing.length > 0) {
    errors.push(`${source}: incomplete pair \u2014 missing ${missing.join(", ")} (pairs merge whole: both languages plus the .i18n.yaml record)`);
    continue;
  }
  const sourceContent = readRepositoryFile(source);
  const zhContent = readRepositoryFile(zh);
  const metaContent = readRepositoryFile(meta);
  if (sourceContent === void 0 || zhContent === void 0 || metaContent === void 0) {
    throw new Error(`${source}: complete pair became unreadable`);
  }
  const record = parseTranslationPairingRecord(metaContent.toString("utf8"), paths);
  if (record === void 0) {
    errors.push(`${meta}: malformed consistency record (expected exactly \`${basename3(source)}: <40-hex>\` and \`${basename3(zh)}: <40-hex>\`)`);
    continue;
  }
  let consistent = true;
  for (const [file, content] of [[source, sourceContent], [zh, zhContent]]) {
    const current = gitBlobHash(content);
    const recorded = file === source ? record.sourceHash : record.zhHash;
    if (recorded !== current) {
      errors.push(`${file}: out of sync \u2014 content no longer matches the pair's last confirmed-consistent state in ${meta} (bring the other side along, then re-record with --write)`);
      consistent = false;
    }
  }
  if (!consistent) {
    state.set(source, "out-of-sync");
    continue;
  }
  const sourceText = sourceContent.toString("utf8");
  const zhText = zhContent.toString("utf8");
  const sourceSwitcherTargets = languageSwitcherTargets(source);
  const zhSwitcherTargets = languageSwitcherTargets(zh);
  for (const violation of [
    ...translationLinkLocaleViolations(sourceText, {
      repoRoot: root,
      sourcePath: source,
      isTranslationPairSource,
      repositoryFileExists: repositoryFileExists2
    }, zhSwitcherTargets),
    ...translationLinkLocaleViolations(zhText, {
      repoRoot: root,
      sourcePath: zh,
      isTranslationPairSource,
      repositoryFileExists: repositoryFileExists2
    }, sourceSwitcherTargets)
  ]) {
    errors.push(`${violation.sourcePath}:${violation.line}: link target ${JSON.stringify(violation.url)} uses the wrong locale; expected ${JSON.stringify(violation.expectedUrl)}`);
    state.set(source, "out-of-sync");
  }
  let sourceRegions;
  let zhRegions;
  try {
    sourceRegions = partitionGeneratedRegions(sourceText);
    zhRegions = partitionGeneratedRegions(zhText);
  } catch (error) {
    errors.push(`${source} \u2194 ${zh}: ${error instanceof Error ? error.message : String(error)}`);
    state.set(source, "out-of-sync");
    continue;
  }
  const normalizedSourceRegions = sourceRegions.regions.map((region) => normalizeTranslationMarkdownLinks(region, {
    repoRoot: root,
    sourcePath: source,
    isTranslationPairSource,
    repositoryFileExists: repositoryFileExists2
  }));
  const normalizedZhRegions = zhRegions.regions.map((region) => normalizeTranslationMarkdownLinks(region, {
    repoRoot: root,
    sourcePath: zh,
    isTranslationPairSource,
    repositoryFileExists: repositoryFileExists2
  }));
  if (normalizedSourceRegions.length !== normalizedZhRegions.length || normalizedSourceRegions.some((region, index) => region !== normalizedZhRegions[index])) {
    errors.push(`${source} \u2194 ${zh}: generated regions differ beyond paired-document locale paths \u2014 regenerate both sides`);
    state.set(source, "out-of-sync");
  }
  const sourceTree = parseTranslationMarkdown(sourceText);
  const zhTree = parseTranslationMarkdown(zhText);
  if (!hasLanguageSwitcher(zhTree, zhText, sourceSwitcherTargets)) {
    errors.push(`${zh}: missing language switcher \u2014 no link to ${basename3(source)}`);
  }
  if (requiresSourceLanguageSwitcher(source) && !hasLanguageSwitcher(sourceTree, sourceText, zhSwitcherTargets)) {
    errors.push(`${source}: missing language switcher \u2014 no link back to ${basename3(zh)}`);
  }
  for (const divergence of translationStructureDiff(
    translationStructureSignature(sourceTree, zhSwitcherTargets, {
      repoRoot: root,
      sourcePath: source,
      isTranslationPairSource,
      repositoryFileExists: repositoryFileExists2,
      markdown: sourceText
    }),
    translationStructureSignature(zhTree, sourceSwitcherTargets, {
      repoRoot: root,
      sourcePath: zh,
      isTranslationPairSource,
      repositoryFileExists: repositoryFileExists2,
      markdown: zhText
    })
  )) {
    errors.push(`${source} \u2194 ${zh}: ${divergence}`);
  }
  if (!state.has(source)) state.set(source, "ok");
}
for (const source of sources) {
  if (!isExcluded(source) && !state.has(source)) state.set(source, "missing");
}
if (listMode) {
  const order = { "out-of-sync": 0, missing: 1, ok: 2 };
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]));
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === "missing" ? "  (required)" : ""}`);
  }
  const counts = { "ok": 0, "out-of-sync": 0, "missing": 0 };
  for (const status of state.values()) counts[status]++;
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts["out-of-sync"]} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`);
  process.exit(0);
}
if (errors.length === 0) {
  console.log(request.scope === "pairs" ? `verify-translation-pairing: ${pairAnchors.size} named ${indexMode ? "staged " : ""}pair(s) consistent; the corpus-wide check still runs in doc-sync.` : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`);
  process.exit(0);
}
console.error("verify-translation-pairing: bilingual pairing rules violated (see docs/i18n/README.md):");
for (const message of errors) console.error(`  ${message}`);
process.exit(1);
