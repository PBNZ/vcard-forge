/**
 * @file vcard-parser.js
 * @description Lenient vCard parser: text → model. Accepts vCard 2.1, 3.0, and
 *              4.0 input, sloppy line endings, bare 2.1 parameters,
 *              QUOTED-PRINTABLE + CHARSET, RFC 6868 caret encoding, groups,
 *              and nested 2.1 AGENT cards. Unknown properties pass through.
 *
 *              Model shape (consumed by serializer/validator/UI):
 *              { version, properties: [{group, name, params: [{name, values}], value}],
 *                warnings: [string] }
 *              `value` is a string for simple kinds, string[] for 'text-list',
 *              and string[][] (components × values) for 'structured'.
 *
 * Copyright (c) PBNZ 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';
/* global vcardPropertyDef, vcardUnescapeText, vcardSplitEscaped, vcardDecodeQP */

/**
 * Assemble logical lines: join folded physical lines (CRLF/LF + WSP, the
 * RFC 2425 §5.8.1 / RFC 6350 §3.2 rule) and QUOTED-PRINTABLE soft line breaks
 * ('=' at end of a QP property line, RFC 1521 via versit 2.1 §2.1.5).
 * @param {string} text - Raw vCard text.
 * @returns {string[]} Logical content lines.
 * @private
 */
function _vcardLogicalLines(text) {
    const physical = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    const folded = [];
    for (const line of physical) {
        if ((line.startsWith(' ') || line.startsWith('\t')) && folded.length > 0) {
            folded[folded.length - 1] += line.slice(1);
        } else {
            folded.push(line);
        }
    }
    const logical = [];
    for (let i = 0; i < folded.length; i++) {
        let line = folded[i];
        const head = line.split(':', 1)[0];
        if (/ENCODING=QUOTED-PRINTABLE/i.test(head) || /;QUOTED-PRINTABLE(;|$)/i.test(head)) {
            while (line.endsWith('=') && i + 1 < folded.length) {
                i++;
                line = line.slice(0, -1) + folded[i];
            }
        }
        logical.push(line);
    }
    return logical.filter(l => l.trim().length > 0);
}

/**
 * Split a content line into its pre-colon part and value, honouring
 * double-quoted parameter values that may contain ':' (RFC 6350 §5).
 * @param {string} line - Logical content line.
 * @returns {{head: string, value: string}|null} Parts, or null when no colon exists.
 * @private
 */
function _vcardSplitLine(line) {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuote = !inQuote;
        else if (ch === ':' && !inQuote) {
            return { head: line.slice(0, i), value: line.slice(i + 1) };
        }
    }
    return null;
}

/**
 * Split a string on a delimiter outside double quotes.
 * @param {string} text - Input text.
 * @param {string} delimiter - Single-character delimiter.
 * @returns {string[]} Parts.
 * @private
 */
function _vcardSplitQuoted(text, delimiter) {
    const parts = [];
    let current = '';
    let inQuote = false;
    for (const ch of text) {
        if (ch === '"') { inQuote = !inQuote; current += ch; }
        else if (ch === delimiter && !inQuote) { parts.push(current); current = ''; }
        else current += ch;
    }
    parts.push(current);
    return parts;
}

/**
 * Decode RFC 6868 caret sequences in a 4.0 parameter value.
 * @param {string} value - Raw parameter value.
 * @returns {string} Decoded value.
 * @private
 */
function _vcardCaretDecode(value) {
    return value.replace(/\^(\^|n|')/g, (m, c) => c === '^' ? '^' : (c === 'n' ? '\n' : '"'));
}

/**
 * Parse the parameter tokens of a content line into merged {name, values} params.
 * Bare tokens (versit 2.1 style, e.g. TEL;HOME;VOICE) become TYPE values.
 * @param {string[]} tokens - Raw parameter tokens (after the property name).
 * @param {string} version - Detected vCard version (for caret decoding).
 * @returns {Array<{name: string, values: string[]}>} Merged parameters.
 * @private
 */
function _vcardParseParams(tokens, version) {
    const params = [];
    const byName = {};
    const push = (name, values) => {
        if (byName[name]) {
            byName[name].values.push(...values);
        } else {
            byName[name] = { name, values: [...values] };
            params.push(byName[name]);
        }
    };
    for (const token of tokens) {
        if (!token) continue;
        const eq = token.indexOf('=');
        if (eq === -1) {
            push('TYPE', [token.trim()]);
            continue;
        }
        const name = token.slice(0, eq).trim().toUpperCase();
        const rawValue = token.slice(eq + 1);
        const listSplit = (name === 'TYPE' || name === 'PID');
        let pieces;
        if (rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2) {
            const inner = rawValue.slice(1, -1);
            pieces = listSplit ? inner.split(',') : [inner];
        } else {
            pieces = _vcardSplitQuoted(rawValue, ',').map(p => {
                return (p.startsWith('"') && p.endsWith('"') && p.length >= 2) ? p.slice(1, -1) : p;
            });
        }
        if (version === '4.0') {
            pieces = pieces.map(_vcardCaretDecode);
        }
        push(name, pieces.map(p => p.trim()));
    }
    return params;
}

/**
 * Decode a raw property value into its model shape based on the registry kind.
 * @param {string} name - Upper-case property name.
 * @param {string} raw - Raw (unescaped-as-written) value text.
 * @param {string} version - Source vCard version.
 * @returns {string|string[]|string[][]} Model value.
 * @private
 */
function _vcardDecodeValue(name, raw, version) {
    const def = vcardPropertyDef(name);
    const kind = def ? def.kind : 'text';
    if (kind === 'structured') {
        const rawComponents = vcardSplitEscaped(raw, ';');
        if (def.components > 0) {
            while (rawComponents.length < def.components) rawComponents.push('');
            rawComponents.length = def.components;
        }
        return rawComponents.map(component => {
            if (def.listComponents && version !== '2.1') {
                return vcardSplitEscaped(component, ',').map(v => vcardUnescapeText(v, version));
            }
            return [vcardUnescapeText(component, version)];
        });
    }
    if (kind === 'text-list') {
        return vcardSplitEscaped(raw, ',').map(v => vcardUnescapeText(v, version));
    }
    if (kind === 'uri' || kind === 'raw' || kind === 'vcard') {
        return raw;
    }
    return vcardUnescapeText(raw, version);
}

/**
 * Parse a single content line into a property object.
 * @param {string} line - Logical content line.
 * @param {string} version - Detected vCard version.
 * @param {string[]} warnings - Warning sink.
 * @returns {Object|null} Property {group, name, params, value}, or null when skipped.
 * @private
 */
function _vcardParseProperty(line, version, warnings) {
    const split = _vcardSplitLine(line);
    if (!split) {
        warnings.push(`Skipped line without a colon: "${line.slice(0, 40)}"`);
        return null;
    }
    const headTokens = _vcardSplitQuoted(split.head, ';');
    let nameToken = headTokens[0].trim();
    let group = null;
    const dot = nameToken.indexOf('.');
    if (dot > 0) {
        group = nameToken.slice(0, dot);
        nameToken = nameToken.slice(dot + 1);
    }
    const name = nameToken.toUpperCase();
    const params = _vcardParseParams(headTokens.slice(1), version);

    let raw = split.value;

    // Consume ENCODING=QUOTED-PRINTABLE (+ optional CHARSET); keep BASE64/B as-is.
    const encodingIdx = params.findIndex(p => p.name === 'ENCODING');
    const charsetIdx = params.findIndex(p => p.name === 'CHARSET');
    const encoding = encodingIdx >= 0 ? params[encodingIdx].values[0].toUpperCase() : null;
    if (encoding === 'QUOTED-PRINTABLE' || params.some(p => p.name === 'TYPE' && p.values.some(v => v.toUpperCase() === 'QUOTED-PRINTABLE'))) {
        const charset = charsetIdx >= 0 ? params[charsetIdx].values[0] : 'utf-8';
        raw = vcardDecodeQP(raw, charset);
        if (encodingIdx >= 0) params.splice(encodingIdx, 1);
        const charsetIdx2 = params.findIndex(p => p.name === 'CHARSET');
        if (charsetIdx2 >= 0) params.splice(charsetIdx2, 1);
    } else if (charsetIdx >= 0) {
        params.splice(charsetIdx, 1);
    }

    return { group, name, params, value: _vcardDecodeValue(name, raw, version) };
}

/**
 * Parse a vCard data stream into an array of card models.
 * Lenient: accepts LF-only endings, lowercase BEGIN/END, missing END (with a
 * warning), and nested 2.1 AGENT cards (kept as raw text values).
 * @param {string} text - Raw vCard stream.
 * @returns {Array<{version: string, properties: Object[], warnings: string[]}>} Cards.
 */
function parseVCardStream(text) {
    const lines = _vcardLogicalLines(text);
    const cards = [];
    let current = null;
    let nested = null;

    // First pass: detect the VERSION of each card so per-line decoding rules match.
    const detectVersion = (startIndex) => {
        let depth = 0;
        for (let i = startIndex; i < lines.length; i++) {
            const l = lines[i].trim();
            if (/^BEGIN\s*:\s*VCARD$/i.test(l)) depth++;
            else if (/^END\s*:\s*VCARD$/i.test(l)) { if (--depth === 0) break; }
            else if (depth === 1) {
                const m = l.match(/^VERSION\s*:\s*(\S+)/i);
                if (m) return m[1];
            }
        }
        return null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (/^BEGIN\s*:\s*VCARD$/i.test(trimmed)) {
            if (current === null) {
                const declared = detectVersion(i);
                current = {
                    version: declared && ['2.1', '3.0', '4.0'].includes(declared) ? declared : '4.0',
                    properties: [],
                    warnings: []
                };
                if (!declared) current.warnings.push('Missing VERSION property; assuming 4.0.');
                else if (!['2.1', '3.0', '4.0'].includes(declared)) current.warnings.push(`Unsupported VERSION "${declared}"; treating as 4.0.`);
            } else {
                nested = { depth: 1, lines: [line.trim()] };
                continue;
            }
            continue;
        }
        if (nested) {
            nested.lines.push(trimmed);
            if (/^BEGIN\s*:\s*VCARD$/i.test(trimmed)) nested.depth++;
            else if (/^END\s*:\s*VCARD$/i.test(trimmed)) {
                if (--nested.depth === 0) {
                    const last = current.properties[current.properties.length - 1];
                    if (last && last.name === 'AGENT' && !String(last.value).trim()) {
                        last.value = nested.lines.join('\r\n');
                    } else {
                        current.warnings.push('Ignored nested vCard block not attached to an AGENT property.');
                    }
                    nested = null;
                }
            }
            continue;
        }
        if (/^END\s*:\s*VCARD$/i.test(trimmed)) {
            if (current) { cards.push(current); current = null; }
            continue;
        }
        if (!current) continue;
        if (/^VERSION\s*:/i.test(trimmed)) continue; // consumed in detection pass
        const prop = _vcardParseProperty(line, current.version, current.warnings);
        if (prop) current.properties.push(prop);
    }

    if (current) {
        current.warnings.push('Missing END:VCARD terminator.');
        cards.push(current);
    }
    return cards;
}

/**
 * Parse the first vCard in a stream.
 * @param {string} text - Raw vCard text.
 * @returns {{version: string, properties: Object[], warnings: string[]}} Card model.
 * @throws {Error} When the input contains no BEGIN:VCARD block.
 */
function parseVCard(text) {
    const cards = parseVCardStream(text);
    if (cards.length === 0) {
        throw new Error('Not a vCard: no BEGIN:VCARD ... END:VCARD block found.');
    }
    return cards[0];
}
