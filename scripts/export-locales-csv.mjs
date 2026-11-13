import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(projectRoot, "src");
const outputFile = path.join(projectRoot, "locales.csv");
const languages = ["en", "es", "it", "fr"];

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function objectEntries(object, sourceFile, declarationName, localeMaps) {
  if (object && ts.isCallExpression(object) && ts.isIdentifier(object.expression) && object.expression.text === "locale") {
    const entries = new Map(localeMaps.get("en") ?? []);
    const supplied = object.arguments[0] ? objectEntries(object.arguments[0], sourceFile, declarationName, localeMaps) : new Map();
    for (const [key, value] of supplied) entries.set(key, value);
    return entries;
  }
  while (object && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object) || ts.isParenthesizedExpression(object))) {
    object = object.expression;
  }
  if (!ts.isObjectLiteralExpression(object)) return new Map();
  const entries = new Map();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) {
      const inherited = localeMaps.get(property.expression.text);
      if (inherited) for (const [key, value] of inherited) entries.set(key, value);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : undefined;
    if (!key) continue;
    if (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
      throw new Error(`${sourceFile}: ${declarationName}.${key} is not a plain translated string.`);
    }
    entries.set(key, property.initializer.text);
  }
  return entries;
}

const sourceFiles = fs.readdirSync(sourceDirectory)
  .filter((name) => /^i18n.*\.ts$/.test(name))
  .sort();
const rows = [];

for (const fileName of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const localeMaps = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const variableName = declaration.name.text;
      if (languages.includes(variableName)) {
        localeMaps.set(variableName, objectEntries(declaration.initializer, fileName, variableName, localeMaps));
        continue;
      }

      let initializer = declaration.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (!ts.isObjectLiteralExpression(initializer)) continue;
      const localized = new Map();
      for (const property of initializer.properties) {
        if (ts.isShorthandPropertyAssignment(property) && languages.includes(property.name.text)) {
          const inherited = localeMaps.get(property.name.text);
          if (inherited) localized.set(property.name.text, inherited);
          continue;
        }
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !languages.includes(property.name.text)) continue;
        const value = property.initializer;
        if (ts.isIdentifier(value)) {
          const inherited = localeMaps.get(value.text);
          if (inherited) localized.set(property.name.text, inherited);
        } else {
          localized.set(property.name.text, objectEntries(value, fileName, `${variableName}.${property.name.text}`, localeMaps));
        }
      }
      if (languages.every((language) => localized.has(language))) {
        for (const language of languages) localeMaps.set(language, localized.get(language));
      }
    }
  }

  if (localeMaps.size === 0) continue;
  const keySet = new Set([...localeMaps.values()].flatMap((entries) => [...entries.keys()]));
  const sortedKeys = [...keySet].sort((left, right) => left.localeCompare(right));
  for (const key of sortedKeys) {
    const values = languages.map((language) => localeMaps.get(language)?.get(key));
    if (values.some((value) => value === undefined)) {
      throw new Error(`${fileName}:${key} is missing from one or more locale maps (${languages.join(", ")}).`);
    }
    rows.push([`${fileName.replace(/\.ts$/, "")}.${key}`, ...values]);
  }
}

if (rows.length === 0) throw new Error("No translated strings were found.");
const csv = [["key", ...languages], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
fs.writeFileSync(outputFile, `\uFEFF${csv}`, "utf8");
console.log(`Exported ${rows.length} strings in ${languages.length} languages to ${path.relative(projectRoot, outputFile)}.`);
