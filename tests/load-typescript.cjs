const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

module.exports = function loadTypeScript(file) {
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: api,
    require: name => name.startsWith(".")
      ? module.exports(path.resolve(path.dirname(file), `${name}.ts`))
      : require(name),
  });
  return api;
};
