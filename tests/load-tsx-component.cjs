const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
module.exports=function loadComponent(file) {
 const api={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,
  target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:api,Date,Intl,console,
  require:name=>name.startsWith('.') ? module.exports(path.resolve(path.dirname(file),name+'.tsx')) : require(name)});
 return api;
};
