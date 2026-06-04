// Model-free "signature skeleton" extraction. For distant context (files that
// are several hops from the change), the agent rarely needs full function
// bodies — the public surface (imports, declarations, signatures) is enough to
// understand the shape. Stripping bodies is how AST tools claim big per-file
// savings; we approximate it deterministically, no parser/model, by keeping
// structural lines and collapsing bodies.
//
// Conservative by design: if the skeleton isn't meaningfully smaller (or would
// be empty), callers fall back to the full snippet, so we never lose context to
// an over-aggressive strip.

const BRACE_LANGUAGES = new Set([
  ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java", ".js", ".jsx",
  ".kt", ".kts", ".mjs", ".cjs", ".php", ".rs", ".scala", ".swift", ".ts", ".tsx"
]);
const INDENT_LANGUAGES = new Set([".py", ".rb"]);

// Declaration/keep patterns shared across languages. Import/use/package lines
// and declaration headers are always kept; everything else inside a body is
// collapsed.
// Lines that are structural enough to keep even inside a body: imports, comments,
// decorators, and declaration headers. Deliberately excludes const/let/var and
// other statements — those are only wanted at the top level, which the
// brace-depth-0 rule already keeps; inside a body they are just noise.
const KEEP_RE =
  /^\s*(?:@|\/\/|#|\*|\/\*|import\b|export\b|from\b|use\b|package\b|namespace\b|require|include|mod\b|pub\b|public\b|private\b|protected\b|static\b|final\b|abstract\b|async\b|default\b|function\b|func\b|fn\b|class\b|interface\b|trait\b|struct\b|enum\b|type\b|module\b|record\b|def\b)/;

export function extractSignatures(content, filePath = "") {
  const extension = extname(filePath);
  if (!content || typeof content !== "string") return null;
  let skeleton = null;
  if (BRACE_LANGUAGES.has(extension)) skeleton = braceSkeleton(content, "  // ...");
  else if (INDENT_LANGUAGES.has(extension)) skeleton = keywordSkeleton(content, "    # ...");
  else return null;

  // Only worth it if we actually shrank it; otherwise let the caller keep the
  // full snippet.
  if (!skeleton || skeleton.length === 0) return null;
  if (skeleton.length > content.length * 0.7) return null;
  return skeleton;
}

// Brace languages: a line at brace-depth 0 (imports, declaration signatures
// — which sit before their opening `{` — and top-level statements) is kept;
// lines inside a body are dropped and collapsed, except nested declaration
// headers (e.g. methods written with a keyword).
function braceSkeleton(content, dropped) {
  const out = [];
  let depth = 0;
  let droppedRun = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const keep = depth === 0 || KEEP_RE.test(trimmed);
    if (keep) {
      out.push(line);
      droppedRun = false;
    } else if (!droppedRun && trimmed.length > 0) {
      out.push(dropped);
      droppedRun = true;
    }
    for (const char of line) {
      if (char === "{") depth += 1;
      else if (char === "}") depth = Math.max(0, depth - 1);
    }
  }
  return collapseBlanks(out.join("\n"));
}

// Indentation languages (Python, Ruby): keep imports and declaration headers
// (def/class/module, decorators) plus module-level lines with no indentation;
// drop indented bodies.
function keywordSkeleton(content, dropped) {
  const out = [];
  let droppedRun = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const topLevel = line.length === trimmed.length; // no leading whitespace
    const keep = trimmed === "" || topLevel || KEEP_RE.test(trimmed);
    if (keep) {
      out.push(line);
      droppedRun = false;
    } else if (!droppedRun && trimmed.length > 0) {
      out.push(dropped);
      droppedRun = true;
    }
  }
  return collapseBlanks(out.join("\n"));
}

function collapseBlanks(text) {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function extname(filePath) {
  const base = String(filePath);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}
