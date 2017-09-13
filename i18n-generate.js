#!/usr/bin/env node
const fs = require('fs');
const _ = require('lodash/fp');
const glob = require('glob');
const path = require('path');
const { transformise } = require('./index');

// ** README **
// Searches through a directory to find all strings wrapped in __('') (or whatever function name you choose)
// it then compares these to the existing keys in [language].json file and adds only new keys
// with the english words to translate.
// English words are prefixed with !! (or whatever you choose) so we can see visually in our running application
// what has been mapped whilst awaiting translations.
// Prefixing also makes it easier to regex those mapped translations in case you need to for whatever reason.
// TODO - add option to remove mapped, un-translated text before regenerating them

function getLocaleConfig(dir, language) {
  try {
    const content = fs.readFileSync(dir);
    return JSON.parse(content);
  } catch (error) {
    console.warn(`No translation file exists for language ${language} at "${dir}"`);
  }
  return {};
}

// sort object keys alphabetically
function sortObject(obj) {
  return Object.keys(obj).sort().reduce((result, key) => (
    Object.assign({}, result, {
      [key]: obj[key],
    })
  ), {});
}

function getObjectNestedProperties(obj, parent) {
  let props = [];
  Object.keys(obj).forEach(key => {
    if (typeof obj[key] === "object") {
      let innerKeys = getObjectNestedProperties(obj[key], key);
      innerKeys.forEach((innerKey, index, arr) => {
        arr[index] = `${key}.${innerKey}`;
      });
      props = props.concat(innerKeys);
    } else {
      props.push(key);
    }
  });
  return props;
}

function buildObject(obj, key) {
  let value;
  if (key.includes(".")) {
    let keys = key.split(".");
    obj[keys[0]] = buildObject(obj[keys[0]] ? obj[keys[0]] : {}, keys.splice(1).join("."));
  } else {
    obj[key] = `${prefix}${key}`;
  }
  return obj;
}

function getObjectFromTranslations(tObject) {
  let obj = {};
  let keys = getObjectNestedProperties(tObject);
  keys.forEach((k) => {
    Object.assign(obj, buildObject(obj, k));
  });
  return obj;
}

function findInnerValue(obj, key) {
  let value;
  if (key.includes(".")) {
    let keys = key.split(".");
    if (obj[keys[0]]) {
      return findInnerValue(obj[keys[0]], keys.splice(1).join("."));
    }
    return undefined;
  }
  return obj[key];
}

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Deep merge two objects.
 * @param target
 * @param ...sources
 */
function mergeDeep(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return mergeDeep(target, ...sources);
}

function _clearEmptyKeys(obj) {
  Object.keys(obj).forEach(function (key) {
    if (isObject(obj[key])) {
      _clearEmptyKeys(obj[key]);
      if (!Object.keys(obj[key]).length) {
        delete obj[key]
      }
    }else if(!obj[key]){
      delete obj[key]
    }
  });
  return obj;
}

function _purgeOutput(outObj, inputFile) {
  let outProps = getObjectNestedProperties(outObj);
  outProps.forEach(function (prop) {
    if (findInnerValue(JSON.parse(fs.readFileSync(inputFile)), prop) === undefined) {
      eval(`outObj.${prop}=undefined`);
    }
  });
  outObj = _clearEmptyKeys(outObj);
  return outObj;
}

const argv = require('minimist')(process.argv.slice(2));
const dir = argv.s || argv.source;
const functionName = argv.f || argv.functionName || '__';
const outputDirectory = argv.o || argv.output || 'translations';
const languages = argv.l || argv.languages || 'en';
const prefix = argv.p || argv.prefix || '!<';
const willTransformise = argv.t || argv.transformise || false;

if (!dir) console.error('no directory supplied. use -d');

function _generateFileContent(inputFile, outputFile, language) {
  let localeText = _purgeOutput(getLocaleConfig(outputFile, language), inputFile);
  const value = _.compose(
    _.compact,
    _.uniq,
    _.flatten,
    _.map(function (f) {
      const text = fs.readFileSync(f, "utf8");
      const fileObject = JSON.parse(text) || {};
      const result = getObjectNestedProperties(fileObject);
      return result;
    })
  )([inputFile]);
  const foundMap = _.keyBy(function (str) {
    return willTransformise ? transformise(str) : str;
  })(value);
  const newTranslations = _.pickBy(function (v, key) {
    const found = key.includes(".")
      ? findInnerValue(localeText, key)
      : localeText[key];
    return !found || found.startsWith(prefix);
  })(foundMap);
  console.log(`\n\n${language}: new translations found\n`, newTranslations);
  let newObject = mergeDeep(
    {},
    localeText,
    getObjectFromTranslations(newTranslations)
  );
  return sortObject(newObject);
}

function _writeObjectToJson(obj, filePath) {
  fs.writeFileSync(filePath,
    JSON.stringify(obj, null, 2),
    "utf8");
}

languages.split(" ").forEach(language => {
  glob(`${dir}/**/*.json`, {}, (er, files) => {
    files.forEach(file => {
      let relativePath = file.substring(dir.length + 1);
      let filePath = `${outputDirectory}/${language}/${relativePath}`;
      if (!filePath.startsWith(dir)) {
        let fileContent = _generateFileContent(file, filePath, language);
        let _path = filePath.substring(0, filePath.lastIndexOf("/"));
        if (!fs.existsSync(_path)) {
          fs.mkdirSync(_path);
        }
        _writeObjectToJson(fileContent, filePath);
      }
    });
  });
});