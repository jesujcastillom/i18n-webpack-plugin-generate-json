#!/usr/bin/env node
const fs = require("fs-extra");
const _ = require("lodash");
const glob = require("glob");
const path = require("path");
const {transformise} = require("./index");

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
		console.warn(
			`No translation file exists for language ${language} at "${dir}"`
		);
	}
	return {};
}

// sort object keys alphabetically
function sortObject(obj) {
	return Object.keys(obj)
		.sort()
		.reduce(
			(result, key) =>
				Object.assign({}, result, {
					[key]: obj[key]
				}),
			{}
		);
}

function getObjectNestedProperties(obj, parent) {
	let props = [];
	Object.keys(obj)
		.sort()
		.forEach(key => {
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

function buildObject(obj, key, value) {
	if (key.includes(".")) {
		let keys = key.split(".");
		obj[keys[0]] = buildObject(
			obj[keys[0]] ? obj[keys[0]] : {},
			keys.splice(1).join("."),
			value
		);
	} else {
		obj[key] = value;
	}
	return obj;
}

function getObjectFromTranslations(tObject, inputObject) {
	let obj = {};
	let keys = getObjectNestedProperties(tObject);
	keys.forEach(k => {
		Object.assign(obj, buildObject(obj, k, findInnerValue(inputObject, k)));
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
	return item && typeof item === "object" && !Array.isArray(item);
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
				if (!target[key]) Object.assign(target, {[key]: {}});
				mergeDeep(target[key], source[key]);
			} else {
				Object.assign(target, {[key]: source[key]});
			}
		}
	}

	return mergeDeep(target, ...sources);
}

function _purgeOutput(outObj, inputObject) {
	let outProps = getObjectNestedProperties(outObj);
	let inProps = getObjectNestedProperties(inputObject);
	_.forEach(_.differenceWith(outProps, inProps, _.isEqual), key => {
		outObj = _.omit(outObj, [key]);
	});
	return outObj;
}

const argv = require("minimist")(process.argv.slice(2));
const dir = argv.s || argv.source;
const input = argv.i || argv.inputFile;
const defaultLanguage = argv.d || argv["default-language"];
const functionName = argv.f || argv.functionName || "__";
const outputDirectory = argv.o || argv.output || "translations";
const languages = argv.l || argv.languages || "en";
const prefix = argv.p || argv.prefix || "!<";
const willTransformise = argv.t || argv.transformise || false;

if (!dir) console.error("no directory supplied. use -d");

function _generateFileContent(inputFile, outputFile, language) {
	let localeText = _purgeOutput(
		getLocaleConfig(outputFile, language),
		JSON.parse(fs.readFileSync(inputFile))
	);

	const text = fs.readFileSync(inputFile, "utf8");
	const fileObject = JSON.parse(text) || {};
	const value = getObjectNestedProperties(fileObject);
	// return result;
	// const value = _.chain() _.compose(
	// 	_.compact,
	// 	_.uniq,
	// 	_.flatten,
	// 	_.map(function (f) {
	// 	})
	// )([inputFile]);
	const foundMap = _.keyBy(value, (str) => {
		return willTransformise ? transformise(str) : str;
	});
	const newTranslations = _.pickBy(foundMap, (v, key) => {
		let found = key.includes(".")
			? findInnerValue(localeText, key)
			: localeText[key];
		let prefixCheck = false;
		if (typeof found === "string") {
			prefixCheck = found.startsWith(
				key.includes(".") ? key.substring(key.lastIndexOf(".")) : key
			);
		} else {
			found = found !== undefined;
		}
		return !found || prefixCheck;
	});
	console.log(`${inputFile} ==> ${outputFile}: new translations found\n`, newTranslations);
	let newObject = mergeDeep(
		{},
		localeText,
		getObjectFromTranslations(
			newTranslations,
			JSON.parse(fs.readFileSync(inputFile, "utf8"))
		)
	);
	return sortObject(newObject);
}

glob(`${dir}/**/!(${input}|rankmi).json`, {}, (err, files) => {
	files.forEach(file => {
		let relativePath = file.substring(dir.length + 1);
		let filePath = `${outputDirectory}/${defaultLanguage}/${relativePath}`;
		let _path = filePath.substring(0, filePath.lastIndexOf(path.sep));
		fs.ensureDir(_path, err => {
			if (err) {
				console.log(err);
			} else {
				let fileContent = _generateFileContent(`${dir}${path.sep}${input}.json`, filePath, defaultLanguage);
				fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), {encoding: "utf8"});
			}
		});
	});
});

languages.split(" ").forEach(language => {
	glob(`${dir}/**/*.json`, {}, (er, files) => {
		files.forEach(file => {
			let relativePath = file.substring(dir.length + 1);
			let filePath = `${outputDirectory}/${language}/${relativePath}`;
			if (!filePath.startsWith(dir) && !filePath.endsWith("rankmi.json")) {
				let _path = filePath.substring(0, filePath.lastIndexOf(path.sep));
				fs.ensureDir(_path, err => {
					if (err) {
						console.log(err);
					} else {
						let fileContent = _generateFileContent(file, filePath, language);
						fs.writeFile(filePath, JSON.stringify(fileContent, null, 2), {encoding: "utf8"}, _err => {
							if (_err) {
								console.error(_err);
							} else {
								console.log(`WROTE ===> ${filePath}`);
							}
						});
					}
				});
			}
		});
	});
});
