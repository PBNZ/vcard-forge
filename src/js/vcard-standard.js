/**
 * @file vcard-standard.js
 * @description The vCard standards registry: per-property version availability,
 *              vCard 4.0 cardinality, value kinds, TYPE parameter vocabularies,
 *              plus the low-level codecs (escaping, quoted-printable, date
 *              normalization) shared by the parser, serializer, and validator.
 *
 *              Every rule here is traced to a primary specification — see
 *              docs/reference/vcard-compliance.md for the citations
 *              (versit vCard 2.1, RFC 2425/2426, RFC 6350, RFC 6868).
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

/** Supported vCard versions, oldest first. */
const VCARD_VERSIONS = ['2.1', '3.0', '4.0'];

/** TEL TYPE vocabulary per version (versit 2.1 ABNF; RFC 2426 §3.3.1; RFC 6350 §6.4.1). */
const TEL_TYPES = {
    '2.1': ['home', 'work', 'pref', 'voice', 'fax', 'msg', 'cell', 'pager', 'bbs', 'modem', 'car', 'isdn', 'video'],
    '3.0': ['home', 'msg', 'work', 'pref', 'voice', 'fax', 'cell', 'video', 'pager', 'bbs', 'modem', 'car', 'isdn', 'pcs'],
    '4.0': ['text', 'voice', 'fax', 'cell', 'video', 'pager', 'textphone', 'work', 'home']
};

/** EMAIL TYPE vocabulary per version (versit 2.1 ABNF; RFC 2426 §3.3.2; RFC 6350 §5.6). */
const EMAIL_TYPES = {
    '2.1': ['internet', 'x400', 'pref', 'work', 'home', 'aol', 'applelink', 'attmail', 'cis', 'eworld', 'ibmmail', 'mcimail', 'powershare', 'prodigy', 'tlx'],
    '3.0': ['internet', 'x400', 'pref', 'work', 'home'],
    '4.0': ['work', 'home']
};

/** ADR/LABEL TYPE vocabulary per version (versit 2.1 ABNF; RFC 2426 §3.2.1; RFC 6350 §5.6). */
const ADR_TYPES = {
    '2.1': ['dom', 'intl', 'postal', 'parcel', 'home', 'work'],
    '3.0': ['dom', 'intl', 'postal', 'parcel', 'home', 'work', 'pref'],
    '4.0': ['work', 'home']
};

/** RELATED TYPE vocabulary (RFC 6350 §6.6.6). */
const RELATED_TYPES = {
    '4.0': ['contact', 'acquaintance', 'friend', 'met', 'co-worker', 'colleague', 'co-resident',
        'neighbor', 'child', 'parent', 'sibling', 'spouse', 'kin', 'muse', 'crush', 'date',
        'sweetheart', 'me', 'agent', 'emergency', 'work', 'home']
};

/** Generic work/home vocabulary for 4.0 properties without a specialised list (RFC 6350 §5.6). */
const GENERIC_TYPES_40 = { '4.0': ['work', 'home'] };

/**
 * The property registry.
 *
 * Each definition:
 * - `versions`   versions the property exists in.
 * - `card40`     RFC 6350 §6 cardinality ('1', '1*', '*1', '*'); only meaningful for 4.0.
 * - `kind`       value shape: 'text' | 'text-list' | 'structured' | 'uri' |
 *                'date-and-or-time' | 'timestamp' | 'language-tag' | 'raw' | 'vcard'.
 * - `components` for 'structured': number of fixed components to pad to (0 = variable).
 * - `listComponents` for 'structured': whether components hold comma-separated value lists.
 * - `typeAllowed40` whether TYPE may appear on this property in 4.0 (RFC 6350 §5.6 list).
 * - `typeValues` known TYPE values per version, when a vocabulary is defined.
 *
 * @type {Object<string, Object>}
 */
const VCARD_PROPERTIES = {
    'SOURCE':       { versions: ['3.0', '4.0'], card40: '*',  kind: 'uri' },
    'KIND':         { versions: ['4.0'], card40: '*1', kind: 'text' },
    'XML':          { versions: ['4.0'], card40: '*',  kind: 'text' },
    'FN':           { versions: ['2.1', '3.0', '4.0'], card40: '1*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'N':            { versions: ['2.1', '3.0', '4.0'], card40: '*1', kind: 'structured', components: 5, listComponents: true },
    'NICKNAME':     { versions: ['3.0', '4.0'], card40: '*', kind: 'text-list', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'PHOTO':        { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'BDAY':         { versions: ['2.1', '3.0', '4.0'], card40: '*1', kind: 'date-and-or-time' },
    'ANNIVERSARY':  { versions: ['4.0'], card40: '*1', kind: 'date-and-or-time' },
    'GENDER':       { versions: ['4.0'], card40: '*1', kind: 'structured', components: 0, listComponents: false },
    'ADR':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'structured', components: 7, listComponents: true, typeAllowed40: true, typeValues: ADR_TYPES },
    'LABEL':        { versions: ['2.1', '3.0'], kind: 'text', typeValues: ADR_TYPES },
    'TEL':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: TEL_TYPES },
    'EMAIL':        { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: EMAIL_TYPES },
    'IMPP':         { versions: ['3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'LANG':         { versions: ['4.0'], card40: '*', kind: 'language-tag', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'MAILER':       { versions: ['2.1', '3.0'], kind: 'text' },
    'TZ':           { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'GEO':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'TITLE':        { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'ROLE':         { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'LOGO':         { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'AGENT':        { versions: ['2.1', '3.0'], kind: 'vcard' },
    'ORG':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'structured', components: 0, listComponents: false, typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'MEMBER':       { versions: ['4.0'], card40: '*', kind: 'uri' },
    'RELATED':      { versions: ['4.0'], card40: '*', kind: 'uri', typeAllowed40: true, typeValues: RELATED_TYPES },
    'CATEGORIES':   { versions: ['3.0', '4.0'], card40: '*', kind: 'text-list', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'NOTE':         { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'text', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'PRODID':       { versions: ['3.0', '4.0'], card40: '*1', kind: 'text' },
    'REV':          { versions: ['2.1', '3.0', '4.0'], card40: '*1', kind: 'timestamp' },
    'SORT-STRING':  { versions: ['3.0'], kind: 'text' },
    'SOUND':        { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'UID':          { versions: ['2.1', '3.0', '4.0'], card40: '*1', kind: 'text' },
    'CLIENTPIDMAP': { versions: ['4.0'], card40: '*', kind: 'text' },
    'URL':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true, typeValues: GENERIC_TYPES_40 },
    'CLASS':        { versions: ['3.0'], kind: 'text' },
    'KEY':          { versions: ['2.1', '3.0', '4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'FBURL':        { versions: ['4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'CALADRURI':    { versions: ['4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'CALURI':       { versions: ['4.0'], card40: '*', kind: 'uri', typeAllowed40: true },
    'NAME':         { versions: ['3.0'], kind: 'text' },
    'PROFILE':      { versions: ['3.0'], kind: 'text' }
};

/**
 * Look up a property definition by (case-insensitive) name.
 * @param {string} name - Property name, e.g. 'TEL'.
 * @returns {Object|undefined} The registry definition, or undefined for unknown/X- names.
 */
function vcardPropertyDef(name) {
    return VCARD_PROPERTIES[String(name || '').toUpperCase()];
}

/**
 * Whether a property exists in a given vCard version.
 * Unknown and X- properties return false (they are version-agnostic passthrough).
 * @param {string} name - Property name.
 * @param {string} version - '2.1' | '3.0' | '4.0'.
 * @returns {boolean} True when the registry lists the property for that version.
 */
function vcardPropertyAvailable(name, version) {
    const def = vcardPropertyDef(name);
    return !!def && def.versions.includes(version);
}

/* ============================================================================
 * SECTION: Shared codecs
 * ========================================================================= */

/**
 * Escape a text value for output.
 * 4.0: backslash, comma, and newline MUST be escaped; semicolon stays raw in
 * non-compound values (RFC 6350 §3.4 + TEXT-CHAR ABNF).
 * 3.0: comma AND semicolon must be escaped (RFC 2426 §5).
 * 2.1: no escaping in simple values (versit 2.1 §2.1.3 covers compound values only).
 * @param {string} value - Decoded text.
 * @param {string} version - Target version.
 * @param {boolean} [inComponent=false] - True when inside a compound component,
 *        where the semicolon (all versions) and comma (3.0/4.0 lists) are delimiters.
 * @returns {string} Escaped text.
 */
function vcardEscapeText(value, version, inComponent) {
    let out = String(value);
    if (version === '2.1') {
        return inComponent ? out.replace(/;/g, '\\;') : out;
    }
    out = out.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
    if (version === '3.0' || inComponent) {
        out = out.replace(/;/g, '\\;');
    }
    return out;
}

/**
 * Unescape a text value on input.
 * 3.0/4.0 decode \\ \, \; \n|\N; 2.1 decodes only \; (a raw backslash is data there).
 * @param {string} value - Raw value text.
 * @param {string} version - Source version.
 * @returns {string} Decoded text.
 */
function vcardUnescapeText(value, version) {
    if (version === '2.1') {
        return String(value).replace(/\\;/g, ';');
    }
    return String(value).replace(/\\([\\,;nN])/g, (m, c) => (c === 'n' || c === 'N') ? '\n' : c);
}

/**
 * Split a raw string on a delimiter, honouring backslash escapes.
 * @param {string} value - Raw text.
 * @param {string} delimiter - Single-character delimiter (';' or ',').
 * @returns {string[]} Raw (still-escaped) parts.
 */
function vcardSplitEscaped(value, delimiter) {
    const parts = [];
    let current = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length) {
            current += ch + value[i + 1];
            i++;
        } else if (ch === delimiter) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

/**
 * Encode a string as vCard 2.1 QUOTED-PRINTABLE (RFC 1521 rules: '=', controls,
 * and non-ASCII become =XX; newlines become =0D=0A).
 * @param {string} value - Decoded text (may contain '\n').
 * @returns {string} QP-encoded ASCII text without soft line breaks.
 */
function vcardEncodeQP(value) {
    const bytes = new TextEncoder().encode(String(value).replace(/\r\n|\r|\n/g, '\r\n'));
    let out = '';
    for (const b of bytes) {
        if (b === 0x3D || b < 0x20 || b > 0x7E) {
            out += '=' + b.toString(16).toUpperCase().padStart(2, '0');
        } else {
            out += String.fromCharCode(b);
        }
    }
    return out;
}

/**
 * Decode QUOTED-PRINTABLE text to a string using the given charset.
 * Soft line breaks must already have been joined.
 * @param {string} value - QP text.
 * @param {string} [charset='utf-8'] - IANA charset name from the CHARSET param.
 * @returns {string} Decoded text with newlines normalized to '\n'.
 */
function vcardDecodeQP(value, charset) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(value.substr(i + 1, 2))) {
            bytes.push(parseInt(value.substr(i + 1, 2), 16));
            i += 2;
        } else {
            bytes.push(value.charCodeAt(i) & 0xFF);
        }
    }
    let decoded;
    try {
        decoded = new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes));
    } catch (e) {
        decoded = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    }
    return decoded.replace(/\r\n|\r/g, '\n');
}

/**
 * Normalize a date / date-time toward RFC 6350 §4.3 basic format.
 * Converts extended complete dates (1996-04-15) to basic (19960415) and strips
 * colons from time and zone parts. Leaves year-month (1996-04), truncated
 * (--0415), and unparseable values untouched.
 * @param {string} value - Date-ish text.
 * @returns {string} Normalized value.
 */
function vcardNormalizeDate40(value) {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(T.*)?$/);
    let out = String(value);
    if (m) {
        out = m[1] + m[2] + m[3] + (m[4] || '');
    }
    const t = out.match(/^([^T]*)T(.*)$/);
    if (t) {
        out = t[1] + 'T' + t[2].replace(/:/g, '');
    }
    return out;
}

/**
 * Test a value against the RFC 6350 §4.3 date-and-or-time grammar (basic format).
 * @param {string} value - Candidate value (normalize first with vcardNormalizeDate40).
 * @returns {boolean} True when the value is a valid 4.0 date-and-or-time.
 */
function vcardIsValidDate40(value) {
    const DATE = '(?:\\d{4}(?:\\d{2}\\d{2})?|\\d{4}-\\d{2}|--\\d{2}(?:\\d{2})?|---\\d{2})';
    const DATE_NOREDUC = '(?:\\d{8}|--\\d{4}|---\\d{2})';
    const TIME = '(?:\\d{2}(?:\\d{2}(?:\\d{2})?)?|-\\d{2}(?:\\d{2})?|--\\d{2})';
    const ZONE = '(?:Z|[+-]\\d{2}(?:\\d{2})?)?';
    const re = new RegExp(`^(?:${DATE_NOREDUC}T${TIME}${ZONE}|${DATE}|T${TIME}${ZONE})$`);
    return re.test(String(value));
}
