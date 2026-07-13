/**
 * @file vcard-serializer.js
 * @description Strict vCard serializer: model → 100% spec-compliant text for a
 *              target version (2.1, 3.0, or 4.0), including version conversion.
 *
 *              Emission rules (see docs/reference/vcard-compliance.md):
 *              - 4.0: UTF-8, escape \\ \, \n (and \; in components), RFC 6868
 *                caret-encoded parameters, folding at 75 octets keeping UTF-8
 *                sequences contiguous, VERSION immediately after BEGIN.
 *              - 3.0: additionally escapes ';' in text values; TYPE= params;
 *                no QP/CHARSET.
 *              - 2.1: only \; escaping; bare TYPE params; non-ASCII/multiline
 *                values become CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE with
 *                soft line breaks; plain lines are never folded (ADR 0002).
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
/* global vcardPropertyDef, vcardEscapeText, vcardEncodeQP, vcardNormalizeDate40 */

const VCARD_CRLF = '\r\n';

/** Media-type base per binary-capable property (for ENCODING ↔ data: URI bridging). */
const VCARD_MEDIA_BASE = { PHOTO: 'image', LOGO: 'image', SOUND: 'audio', KEY: 'application' };

/** Parameters versit 2.1 knows (§2.9 ABNF); others are dropped on a 2.1 target. */
const VCARD_PARAMS_21 = ['TYPE', 'VALUE', 'ENCODING', 'CHARSET', 'LANGUAGE'];
/** Parameters RFC 2426 knows (§4 ABNF); others are dropped on a 3.0 target. */
const VCARD_PARAMS_30 = ['TYPE', 'VALUE', 'ENCODING', 'LANGUAGE', 'CONTEXT'];

/**
 * Deep-clone a card model (plain data only).
 * @param {Object} model - Card model.
 * @returns {Object} Independent copy.
 * @private
 */
function _vcardClone(model) {
    return JSON.parse(JSON.stringify(model));
}

/**
 * First value of a named parameter, or null.
 * @param {Object} prop - Property object.
 * @param {string} name - Parameter name.
 * @returns {string|null} First value.
 * @private
 */
function _vcardParamValue(prop, name) {
    const p = (prop.params || []).find(x => x.name === name);
    return p && p.values.length ? p.values[0] : null;
}

/**
 * Remove a parameter by name.
 * @param {Object} prop - Property object.
 * @param {string} name - Parameter name.
 * @private
 */
function _vcardRemoveParam(prop, name) {
    prop.params = (prop.params || []).filter(p => p.name !== name);
}

/**
 * Flatten a model value to a display string (first values of components).
 * @param {string|string[]|string[][]} value - Model value.
 * @returns {string} Flat text.
 * @private
 */
function _vcardFlatValue(value) {
    if (Array.isArray(value)) {
        return value.map(v => Array.isArray(v) ? v.join(',') : v).join(';');
    }
    return String(value == null ? '' : value);
}

/**
 * Derive FN text from an N structured value ("Given Additional Family").
 * @param {string[][]} n - N components.
 * @returns {string} Formatted name.
 * @private
 */
function _vcardDeriveFn(n) {
    const at = (i) => (n[i] && n[i][0]) ? n[i][0].trim() : '';
    return [at(1), at(2), at(0)].filter(Boolean).join(' ');
}

/**
 * Derive an N structured value from an FN string (last token = family).
 * @param {string} fn - Formatted name.
 * @returns {string[][]} N components (family, given, additional, prefixes, suffixes).
 * @private
 */
function _vcardDeriveN(fn) {
    const tokens = String(fn).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [[''], [''], [''], [''], ['']];
    if (tokens.length === 1) return [[tokens[0]], [''], [''], [''], ['']];
    const family = tokens.pop();
    const given = tokens.shift();
    return [[family], [given], [tokens.join(' ')], [''], ['']];
}

/**
 * Convert a card model for a target version: drop unavailable properties,
 * translate PREF ↔ TYPE=pref, bridge inline binary ↔ data: URIs, derive
 * mandatory FN/N, and drop parameters the target grammar does not know.
 * @param {Object} model - Source card model.
 * @param {string} target - '2.1' | '3.0' | '4.0'.
 * @returns {{model: Object, dropped: Array<{name: string, reason: string}>}} Result.
 */
function convertVCardVersion(model, target) {
    const out = _vcardClone(model);
    out.version = target;
    const dropped = [];

    out.properties = out.properties.filter(prop => {
        const def = vcardPropertyDef(prop.name);
        if (def && !def.versions.includes(target)) {
            dropped.push({ name: prop.name, reason: `Property not defined in vCard ${target}` });
            return false;
        }
        return true;
    });

    for (const prop of out.properties) {
        const typeParam = (prop.params || []).find(p => p.name === 'TYPE');

        if (target === '4.0') {
            // TYPE=pref (2.1/3.0) → PREF=1 (RFC 6350 §5.3).
            if (typeParam && typeParam.values.some(v => v.toLowerCase() === 'pref')) {
                typeParam.values = typeParam.values.filter(v => v.toLowerCase() !== 'pref');
                if (typeParam.values.length === 0) _vcardRemoveParam(prop, 'TYPE');
                if (!_vcardParamValue(prop, 'PREF')) {
                    prop.params.push({ name: 'PREF', values: ['1'] });
                }
            }
            // Inline binary → data: URI (RFC 6350 §6.2.4 pattern).
            const encoding = (_vcardParamValue(prop, 'ENCODING') || '').toUpperCase();
            if (encoding === 'B' || encoding === 'BASE64') {
                const base = VCARD_MEDIA_BASE[prop.name] || 'application';
                const fmtParam = (prop.params || []).find(p => p.name === 'TYPE');
                const subtype = fmtParam && fmtParam.values.length ? fmtParam.values[0].toLowerCase() : 'octet-stream';
                _vcardRemoveParam(prop, 'ENCODING');
                _vcardRemoveParam(prop, 'TYPE');
                prop.value = `data:${base}/${subtype};base64,${String(prop.value).replace(/\s+/g, '')}`;
            }
        } else {
            // PREF param → TYPE value (bare PREF in 2.1, TYPE=pref in 3.0).
            if (_vcardParamValue(prop, 'PREF') !== null) {
                _vcardRemoveParam(prop, 'PREF');
                const t = (prop.params || []).find(p => p.name === 'TYPE');
                if (t) {
                    if (!t.values.some(v => v.toLowerCase() === 'pref')) t.values.push('pref');
                } else {
                    prop.params.push({ name: 'TYPE', values: ['pref'] });
                }
            }
            // data: URI → inline binary.
            const def = vcardPropertyDef(prop.name);
            if (def && def.kind === 'uri' && typeof prop.value === 'string') {
                const m = prop.value.match(/^data:([a-z0-9.+-]+)\/([a-z0-9.+-]+);base64,(.+)$/i);
                if (m) {
                    prop.params = (prop.params || []).filter(p => p.name !== 'ENCODING' && p.name !== 'TYPE');
                    prop.params.push({ name: 'ENCODING', values: [target === '2.1' ? 'BASE64' : 'b'] });
                    prop.params.push({ name: 'TYPE', values: [m[2].toUpperCase()] });
                    prop.value = m[3];
                }
            }
            // Drop parameters the target grammar does not define (PID/ALTID/PREF/…).
            const known = target === '2.1' ? VCARD_PARAMS_21 : VCARD_PARAMS_30;
            prop.params = (prop.params || []).filter(p => known.includes(p.name) || p.name.startsWith('X-'));
        }
    }

    // Mandatory property derivation (see compliance reference: mandatory table).
    const has = (name) => out.properties.some(p => p.name === name && _vcardFlatValue(p.value).trim());
    const first = (name) => out.properties.find(p => p.name === name);
    if ((target === '3.0' || target === '4.0') && !has('FN') && has('N')) {
        const fn = _vcardDeriveFn(first('N').value);
        if (fn) out.properties.unshift({ group: null, name: 'FN', params: [], value: fn });
    }
    if ((target === '2.1' || target === '3.0') && !has('N') && has('FN')) {
        out.properties.unshift({ group: null, name: 'N', params: [], value: _vcardDeriveN(first('FN').value) });
    }

    return { model: out, dropped };
}

/**
 * Encode one parameter for output.
 * @param {Object} param - {name, values}.
 * @param {string} version - Target version.
 * @returns {string} Text like ';TYPE=work,voice' or ';WORK;VOICE' (2.1 TYPE).
 * @private
 */
function _vcardEmitParam(param, version, propertyName) {
    if (version === '2.1' && param.name === 'TYPE') {
        // Bare tokens for the property's versit vocabulary (TEL;WORK;VOICE:),
        // explicit TYPE= for media/format values (PHOTO;...;TYPE=GIF: per versit examples).
        const def = vcardPropertyDef(propertyName);
        const vocabulary = (def && def.typeValues && def.typeValues['2.1']) || [];
        return param.values.map(v => {
            return vocabulary.includes(v.toLowerCase()) ? ';' + v.toUpperCase() : `;TYPE=${v}`;
        }).join('');
    }
    const values = param.values.map(v => {
        let value = String(v);
        if (version === '4.0') {
            value = value.replace(/\^/g, '^^').replace(/\r\n|\r|\n/g, '^n').replace(/"/g, "^'");
        } else {
            value = value.replace(/"/g, "'").replace(/\r\n|\r|\n/g, ' ');
        }
        return /[:;,]/.test(value) ? `"${value}"` : value;
    });
    return `;${param.name}=${values.join(',')}`;
}

/**
 * Encode a model value as raw line text for the target version.
 * @param {Object} prop - Property object.
 * @param {string} version - Target version.
 * @returns {string} Escaped value text (before QP/folding).
 * @private
 */
function _vcardEmitValue(prop, version) {
    const def = vcardPropertyDef(prop.name);
    const kind = def ? def.kind : 'text';
    const value = prop.value;

    if (kind === 'structured' && Array.isArray(value)) {
        return value.map(component => {
            const items = Array.isArray(component) ? component : [component];
            return items.map(item => vcardEscapeText(item, version, true)).join(',');
        }).join(';');
    }
    if (kind === 'text-list' && Array.isArray(value)) {
        return value.map(item => vcardEscapeText(item, version, true)).join(',');
    }
    if (kind === 'uri' || kind === 'raw' || kind === 'vcard') {
        return _vcardFlatValue(value);
    }
    let text = _vcardFlatValue(value);
    if ((kind === 'date-and-or-time' || kind === 'timestamp') &&
        version === '4.0' && _vcardParamValue(prop, 'VALUE') !== 'text') {
        text = vcardNormalizeDate40(text);
    }
    return vcardEscapeText(text, version, false);
}

/**
 * Fold a content line at 75 octets (RFC 6350 §3.2 / RFC 2425 §5.8.1), keeping
 * UTF-8 sequences contiguous. Continuation lines begin with a single space.
 * @param {string} line - Logical line.
 * @returns {string[]} Physical lines.
 * @private
 */
function _vcardFold(line) {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return [line];
    const out = [];
    let current = '';
    let budget = 75;
    for (const ch of line) {
        const chBytes = encoder.encode(ch).length;
        if (encoder.encode(current).length + chBytes > budget) {
            out.push(current);
            current = ' ';
            budget = 75;
        }
        current += ch;
    }
    if (current.length > 1 || (out.length === 0 && current.length)) out.push(current);
    return out;
}

/**
 * Fold a QP-encoded 2.1 line with '=' soft breaks, keeping every physical line
 * under 76 characters (versit 2.1 §2.1.5) and never splitting an =XX token.
 * @param {string} line - 'NAME;PARAMS:qp-value' logical line.
 * @returns {string[]} Physical lines.
 * @private
 */
function _vcardFoldQP(line) {
    if (line.length <= 75) return [line];
    const colon = line.indexOf(':');
    const prefix = line.slice(0, colon + 1);
    const tokens = line.slice(colon + 1).match(/=[0-9A-F]{2}|[\s\S]/g) || [];
    const out = [];
    let current = prefix;
    for (const token of tokens) {
        if (current.length + token.length > 74) { // reserve 1 char for the trailing '='
            out.push(current + '=');
            current = '';
        }
        current += token;
    }
    out.push(current);
    return out;
}

/**
 * Serialize a card model to spec-compliant vCard text for a target version.
 * The input model is not mutated; conversion (drops, derivations, bridging)
 * happens on a copy and is reported via `dropped`.
 * @param {Object} model - Card model from the parser or the editor.
 * @param {string} targetVersion - '2.1' | '3.0' | '4.0'.
 * @returns {{text: string, dropped: Array<{name: string, reason: string}>}} Result.
 */
function serializeVCard(model, targetVersion) {
    const { model: card, dropped } = convertVCardVersion(model, targetVersion);
    const lines = ['BEGIN:VCARD', `VERSION:${targetVersion}`];

    for (const prop of card.properties) {
        if (prop.name === 'VERSION' || prop.name === 'BEGIN' || prop.name === 'END') continue;
        const def = vcardPropertyDef(prop.name);
        const kind = def ? def.kind : 'text';
        const group = prop.group ? `${prop.group.toUpperCase()}.` : '';
        const encoding = (_vcardParamValue(prop, 'ENCODING') || '').toUpperCase();
        const isBinary = encoding === 'B' || encoding === 'BASE64';

        if (kind === 'vcard' && /BEGIN:VCARD/i.test(_vcardFlatValue(prop.value))) {
            lines.push(`${group}${prop.name}:`);
            lines.push(..._vcardFlatValue(prop.value).split(/\r\n|\r|\n/));
            continue;
        }

        let value = _vcardEmitValue(prop, targetVersion);
        let paramText = (prop.params || []).map(p => _vcardEmitParam(p, targetVersion, prop.name)).join('');

        if (targetVersion === '2.1' && !isBinary && kind !== 'uri' && kind !== 'raw' && kind !== 'vcard' &&
            (/[^\x00-\x7F]/.test(value) || /\n/.test(value))) {
            const charsetParam = /[^\x00-\x7F]/.test(value) ? ';CHARSET=UTF-8' : '';
            paramText += `${charsetParam};ENCODING=QUOTED-PRINTABLE`;
            value = vcardEncodeQP(value);
            lines.push(..._vcardFoldQP(`${group}${prop.name}${paramText}:${value}`));
            continue;
        }

        const logical = `${group}${prop.name}${paramText}:${value}`;
        if (targetVersion === '2.1') {
            if (isBinary) {
                lines.push(..._vcardFold(logical), ''); // versit 2.1: binary block ends with a blank line
            } else {
                lines.push(logical); // 2.1 plain lines are never folded (ADR 0002)
            }
        } else {
            lines.push(..._vcardFold(logical));
        }
    }

    lines.push('END:VCARD');
    return { text: lines.join(VCARD_CRLF) + VCARD_CRLF, dropped };
}
