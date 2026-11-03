// Execute the published Recorder's render decision with query/JSX doubles.
// This is a component-branch reproduction, not a browser or React lifecycle test.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "src/routes/flight-recorder.tsx"), "utf8");
const code = ts.transpileModule(source + "\nexport { Recorder as AuditRecorder };\n", {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function render(queryResults) {
  let index = 0;
  const runtime = {
    jsx: (type, props) => ({ type: typeof type === "function" ? type.name : type, props }),
  };
  runtime.jsxs = runtime.jsx;
  const modules = {
    react: {},
    "react/jsx-runtime": runtime,
    "@tanstack/react-query": {
      useQuery: () => queryResults[index++],
      useQueryClient: () => ({}),
    },
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@xyflow/react": {},
    "@xyflow/react/dist/style.css": {},
    "@/lib/api": {},
    "@/lib/practice": {
      sessionQuery: () => ({}),
      treeQuery: () => ({}),
      scenarioQuery: () => ({}),
    },
  };
  const module = { exports: {} };
  const execute = vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {});
  execute((name) => modules[name] ?? {}, module, module.exports);
  return module.exports.AuditRecorder({ sessionId: 1 });
}

const loaded = { data: { scenario_id: 1 } };
const scenarioFailure = render([
  loaded,
  { data: {} },
  { error: new Error("scenario unavailable") },
]);
const sessionFailure = render([{ error: new Error("session unavailable") }, { data: {} }, {}]);
console.log(
  JSON.stringify(
    {
      source: "939af9f (Recorder unchanged at e5792f2)",
      mode: "actual transpiled component decision, query/JSX doubles",
      scenarioFailure: {
        component: scenarioFailure.type,
        title: scenarioFailure.props.title,
        detail: scenarioFailure.props.detail,
      },
      sessionFailure: { component: sessionFailure.type, title: sessionFailure.props.title },
    },
    null,
    2,
  ),
);
