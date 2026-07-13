/**
 * @file vcard-validator.js
 * @description vCard validation: model + target version → diagnostics.
 *              Errors block .vcf export in the UI; warnings do not.
 *              Rules and citations: docs/reference/vcard-compliance.md.
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
/* global vcardPropertyDef, vcardNormalizeDate40, vcardIsValidDate40 */

/**
 * Validate a card model against a target vCard version.
 * @param {Object} model - Card model ({version, properties}).
 * @param {string} targetVersion - '2.1' | '3.0' | '4.0'.
 * @returns {Array<{severity: 'error'|'warning', property: string, message: string}>}
 *          Diagnostics, empty when fully clean.
 */
function validateVCard(model, targetVersion) {
    const diags = [];
    const error = (property, message) => diags.push({ severity: 'error', property, message });
    const warning = (property, message) => diags.push({ severity: 'warning', property, message });

    const flat = (value) => Array.isArray(value)
        ? value.map(v => Array.isArray(v) ? v.join(',') : v).join(';')
        : String(value == null ? '' : value);
    const has = (name) => model.properties.some(p => p.name === name && flat(p.value).trim());
    const paramOf = (prop, name) => (prop.params || []).find(x => x.name === name);

    /* --- Mandatory properties (versit 2.1 §2.2.2/§2.6.6; RFC 2426 §5; RFC 6350 §6.2.1) --- */
    if ((targetVersion === '3.0' || targetVersion === '4.0') && !has('FN')) {
        error('FN', `FN (formatted name) is required in vCard ${targetVersion}.`);
    }
    if ((targetVersion === '2.1' || targetVersion === '3.0') && !has('N')) {
        error('N', `N (structured name) is required in vCard ${targetVersion}.`);
    }

    /* --- 4.0 cardinality (RFC 6350 §6; ALTID groups count once, §5.4) --- */
    if (targetVersion === '4.0') {
        const counts = {};
        for (const prop of model.properties) {
            const def = vcardPropertyDef(prop.name);
            if (!def || (def.card40 !== '*1' && def.card40 !== '1')) continue;
            const altid = paramOf(prop, 'ALTID');
            const key = altid ? `altid:${altid.values[0]}` : `instance:${Math.random()}`;
            counts[prop.name] = counts[prop.name] || new Set();
            counts[prop.name].add(key);
        }
        for (const [name, keys] of Object.entries(counts)) {
            if (keys.size > 1) {
                error(name, `${name} may appear at most once in vCard 4.0 (use ALTID for alternative representations).`);
            }
        }
    }

    for (const prop of model.properties) {
        const def = vcardPropertyDef(prop.name);

        /* --- Unknown / unavailable properties --- */
        if (!def) {
            if (!prop.name.startsWith('X-')) {
                warning(prop.name, `Unknown property "${prop.name}" (kept as-is on export).`);
            }
            continue;
        }
        if (!def.versions.includes(targetVersion)) {
            warning(prop.name, `${prop.name} does not exist in vCard ${targetVersion} and will be dropped on export.`);
            continue;
        }

        /* --- TYPE parameter legality and vocabulary --- */
        const typeParam = paramOf(prop, 'TYPE');
        if (typeParam) {
            if (targetVersion === '4.0' && !def.typeAllowed40) {
                error(prop.name, `The TYPE parameter is not allowed on ${prop.name} in vCard 4.0 (RFC 6350 §5.6).`);
            } else if (def.typeValues && def.typeValues[targetVersion]) {
                const known = def.typeValues[targetVersion];
                for (const v of typeParam.values) {
                    const lv = v.toLowerCase();
                    if (lv === 'pref' && targetVersion === '4.0') {
                        warning(prop.name, `TYPE=pref is not a vCard 4.0 type; use PREF=1 instead (converted automatically on export).`);
                    } else if (!known.includes(lv) && !lv.startsWith('x-')) {
                        warning(prop.name, `TYPE value "${v}" is not a registered ${prop.name} type in vCard ${targetVersion}.`);
                    }
                }
            }
        }

        /* --- PREF parameter range (RFC 6350 §5.3) --- */
        const pref = paramOf(prop, 'PREF');
        if (pref && targetVersion === '4.0') {
            const n = Number(pref.values[0]);
            if (!Number.isInteger(n) || n < 1 || n > 100) {
                error(prop.name, `PREF must be an integer between 1 and 100 (got "${pref.values[0]}").`);
            }
        }

        /* --- Parameters that only exist in specific versions --- */
        if (paramOf(prop, 'CHARSET') && targetVersion !== '2.1') {
            error(prop.name, `The CHARSET parameter was eliminated after vCard 2.1 (RFC 2426 §5).`);
        }
        const enc = paramOf(prop, 'ENCODING');
        if (enc) {
            const v = String(enc.values[0] || '').toUpperCase();
            if (targetVersion === '4.0') {
                warning(prop.name, `The ENCODING parameter does not exist in vCard 4.0; inline binary is converted to a data: URI on export.`);
            } else if (targetVersion === '3.0' && v !== 'B') {
                error(prop.name, `vCard 3.0 only allows ENCODING=b (RFC 2426 §5); got "${enc.values[0]}".`);
            }
        }

        /* --- GENDER shape (RFC 6350 §6.2.7) --- */
        if (prop.name === 'GENDER') {
            const sex = Array.isArray(prop.value) ? ((prop.value[0] || [''])[0] || '') : String(prop.value).split(';')[0];
            if (!/^[MFONU]?$/i.test(sex.trim())) {
                error('GENDER', `GENDER sex component must be one of M, F, O, N, U, or empty (got "${sex}").`);
            }
        }

        /* --- Date formats (RFC 6350 §4.3) --- */
        if (def.kind === 'date-and-or-time' && targetVersion === '4.0') {
            const valueParam = paramOf(prop, 'VALUE');
            const isText = valueParam && valueParam.values[0] && valueParam.values[0].toLowerCase() === 'text';
            const text = flat(prop.value).trim();
            if (text && !isText && !vcardIsValidDate40(vcardNormalizeDate40(text))) {
                error(prop.name, `"${text}" is not a valid vCard 4.0 date (use e.g. 19960415, --0415, or VALUE=text).`);
            }
        }

        /* --- Light value sanity (warnings only) --- */
        if (prop.name === 'EMAIL') {
            const v = flat(prop.value).trim();
            if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !/^mailto:/i.test(v)) {
                warning('EMAIL', `"${v}" does not look like an email address.`);
            }
        }
        if (def.kind === 'uri' && prop.name === 'URL') {
            const v = flat(prop.value).trim();
            if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v)) {
                warning('URL', `"${v}" has no URI scheme (e.g. https://).`);
            }
        }
    }

    return diags;
}
