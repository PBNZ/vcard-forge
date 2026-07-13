/**
 * @file run-tests.js
 * @description Zero-dependency test runner. Loads the app's classic scripts into a
 *              Node `vm` context (they are not modules) and runs every `*.test.js`
 *              file in this directory. Exits non-zero on any failure.
 *
 * Usage: node tests/run-tests.js
 *
 * Copyright (c) PBNZ 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Source files loaded into the shared context, in browser load order. */
const SOURCE_FILES = [
    'vcard-standard.js',
    'vcard-parser.js',
    'vcard-serializer.js',
    'vcard-validator.js',
    'nfc-generator.js'
];

/** Globals re-exported from the vm context for tests to call. */
const EXPORTS = [
    'VCARD_VERSIONS', 'VCARD_PROPERTIES',
    'vcardPropertyDef', 'vcardPropertyAvailable',
    'parseVCard', 'parseVCardStream',
    'serializeVCard', 'convertVCardVersion',
    'validateVCard',
    'NfcHelper', 'NTAG_CONFIG', 'buildNdefRecord', 'wrapInTlv', 'buildUriPayload', 'NfcNtag'
];

/**
 * Load all app sources into a fresh vm context and return the exported API.
 * @returns {Object} Map of exported global names to their values.
 */
function loadApi() {
    const context = vm.createContext({
        console, TextEncoder, TextDecoder, URL, JSON, Math, Array, String, Object, RegExp
    });
    for (const file of SOURCE_FILES) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');
        vm.runInContext(source, context, { filename: file });
    }
    return vm.runInContext(`({ ${EXPORTS.join(', ')} })`, context);
}

let passed = 0;
let failed = 0;
const failures = [];
let currentFile = '';

/**
 * Run a single named test, catching assertion errors.
 * @param {string} name - Test description.
 * @param {Function} fn - Test body; throws on failure.
 */
function test(name, fn) {
    try {
        fn();
        passed++;
    } catch (err) {
        failed++;
        failures.push({ file: currentFile, name, message: err.message });
        console.error(`  FAIL  ${name}\n        ${err.message.split('\n').join('\n        ')}`);
    }
}

/**
 * Assert deep equality via JSON comparison (sufficient for plain data).
 * @param {*} actual - Actual value.
 * @param {*} expected - Expected value.
 * @param {string} [label] - Context label for the failure message.
 */
function assertEq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${label || 'assertEq'}\n  expected: ${e}\n  actual:   ${a}`);
    }
}

/**
 * Assert a value is truthy.
 * @param {*} value - Value to check.
 * @param {string} [label] - Context label for the failure message.
 */
function assertTrue(value, label) {
    if (!value) throw new Error(`${label || 'assertTrue'}: got ${JSON.stringify(value)}`);
}

/**
 * Assert that fn throws; optionally check the message contains a substring.
 * @param {Function} fn - Function expected to throw.
 * @param {string} [contains] - Substring the error message must contain.
 * @param {string} [label] - Context label.
 */
function assertThrows(fn, contains, label) {
    try {
        fn();
    } catch (err) {
        if (contains && !String(err.message).includes(contains)) {
            throw new Error(`${label || 'assertThrows'}: message "${err.message}" missing "${contains}"`);
        }
        return;
    }
    throw new Error(`${label || 'assertThrows'}: did not throw`);
}

const api = loadApi();
const harness = { test, assertEq, assertTrue, assertThrows, api };

const testFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const file of testFiles) {
    currentFile = file;
    console.log(`\n== ${file} ==`);
    require(path.join(__dirname, file))(harness);
}

console.log(`\nTests complete. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) console.error(`  - [${f.file}] ${f.name}`);
    process.exit(1);
}
