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

function getLocaleConfig(dir, id) {
  try {
    const content = fs.readFileSync(`${dir}/${id}.json`);
    return JSON.parse(content);
  } catch (error) {
    console.warn(`No translation file exists for language "${id}"`);
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

function getObjectNestedProperties(obj,parent){
  let props = [];
  Object.keys(obj).forEach(key => {
    if (typeof obj[key] === "object") {
      let innerKeys = getObjectNestedProperties(obj[key], key);
      innerKeys.forEach((innerKey,index,arr)=>{
        arr[index] = `${key}.${innerKey}`;
      });
      props = props.concat(innerKeys);
    } else {
      props.push(key);
    }
  });
  return props;
}

function buildObject(obj,key){
  let value;
  if (key.includes(".")) {
    let keys = key.split(".");
    obj[keys[0]] = buildObject(obj[keys[0]] ? obj[keys[0]] : {},keys.splice(1).join("."));
  }else{
    obj[key] = `${prefix}${key}`;
  }
  return obj;
}

function getObjectFromTranslations(tObject){
  let obj = {};
  let keys = getObjectNestedProperties(tObject);
  keys.forEach((k)=>{
    Object.assign(obj,buildObject(obj,k));
  });
  return obj;
}

function findInnerValue(obj,key){
  let value;
  if(key.includes(".")){
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

const argv = require('minimist')(process.argv.slice(2));
const dir = argv.s || argv.source;
const functionName = argv.f || argv.functionName || '__';
const outputDirectory = argv.o || argv.output || 'translations';
const languages = argv.l || argv.languages || 'en';
const prefix = argv.p || argv.prefix || '!<';
const willTransformise = argv.t || argv.transformise || false;

if (!dir) console.error('no directory supplied. use -d');

// TODO - test if the outputDirectory exists

glob(`${dir}/**/*.json`, {}, function(er, files) {
  const value = _.compose(
    _.compact,
    _.uniq,
    _.flatten,
    _.map(function(file) {
      const text = fs.readFileSync(file, "utf8");
      const fileObject = JSON.parse(text);
      const result = getObjectNestedProperties(fileObject);
      return result;
    })
  )(files);
  const languagesArray = languages.split(" ");
  languagesArray.forEach(function(language) {
    const localeText = getLocaleConfig(outputDirectory, language);
    const foundMap = _.keyBy(function(str) {
      return willTransformise ? transformise(str) : str;
    })(value);
    const newTranslations = _.pickBy(function(v, key) {
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
    newObject = sortObject(newObject);
    fs.writeFileSync(
      `${outputDirectory}/${language}.json`,
      JSON.stringify(newObject, null, 2),
      "utf8"
    );
  });
});
