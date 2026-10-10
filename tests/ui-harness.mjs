// Offline render harness: real UI components, stubbed Next transports and CSS.
// State fixtures exercise markup only, not browser events or persistence.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";

export function loadSource(path, overrides = {}) {
  const file = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = createRequire(file);
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    module, module.exports,
  );
  return module.exports;
}

export const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) };
export const link = {
  __esModule: true,
  default: ({ href, children, ...props }) => React.createElement("a", { ...props, href }, children),
};
const utils = loadSource("../src/lib/utils.ts");
export const button = loadSource("../src/components/ui/button.tsx", { "@/lib/utils": utils });
export const card = loadSource("../src/components/ui/card.tsx", { "@/lib/utils": utils });

// Read state variable names instead of depending on useState call indexes.
export function withStateFixtures(path, fixtures) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useState") {
      names.push(node.name.elements[0].name.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let index = 0;
  return {
    ...React,
    useState(initial) {
      const name = names[index++];
      return React.useState(Object.hasOwn(fixtures, name) ? fixtures[name] : initial);
    },
  };
}
