/**
 * @file app.js
 * @description UI orchestration for vCard Forge: renders the property editor from
 *              the standards registry, keeps the card model in sync with the
 *              inputs, live-serializes and validates on every change, and
 *              drives .vcf / .nfc export and Flipper WebSerial transfer.
 *
 * Original work Copyright (c) jaylikesbunda
 * Modifications Copyright (c) PBNZ 2026
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
/* global vcardPropertyDef, vcardPropertyAvailable, parseVCard, serializeVCard,
   validateVCard, NfcNtag, NTAG_CONFIG, FlipperSerial */

document.addEventListener('DOMContentLoaded', () => {

    /* ========================================================================
     * SECTION: State
     * ===================================================================== */

    /** Central application state; `model` is the single source of truth. */
    const state = {
        version: '4.0',
        model: { version: '4.0', properties: [], warnings: [] },
        ntag: 'NTAG216',
        compat: 'dual',
        lastSerialized: '',
        parseWarnings: []
    };

    let flipperSerial = null;

    /* ========================================================================
     * SECTION: DOM references
     * ===================================================================== */

    const $ = (id) => document.getElementById(id);
    const editorSections = $('editorSections');
    const sourcePreview = $('sourcePreview');
    const validationPanel = $('validationPanel');
    const byteCounter = $('byteCounter');
    const capacityBar = $('capacityBar');
    const capacityText = $('capacityText');
    const capacityWarning = $('capacityWarning');
    const hostedUrlGroup = $('hostedUrlGroup');
    const hostedUrlInput = $('hostedUrlInput');
    const downloadVcfBtn = $('downloadVcfBtn');
    const copyVcfBtn = $('copyVcfBtn');
    const downloadNfcBtn = $('downloadNfcBtn');
    const sendFlipperBtn = $('sendFlipperBtn');
    const flipperStatus = $('flipperStatus');

    /* ========================================================================
     * SECTION: Model helpers
     * ===================================================================== */

    /**
     * Flatten a model value to a plain string.
     * @param {string|string[]|string[][]} value - Model value.
     * @returns {string} Flat text.
     */
    function flat(value) {
        if (Array.isArray(value)) {
            return value.map(v => Array.isArray(v) ? v.join(',') : v).join(';');
        }
        return String(value == null ? '' : value);
    }

    /**
     * Whether a property holds no user content (structural separators ignored).
     * @param {Object} prop - Property object.
     * @returns {boolean} True when effectively empty.
     */
    function isEmptyProp(prop) {
        return flat(prop.value).replace(/[;,\s]/g, '') === '';
    }

    /** All model properties with the given name. */
    const propsOf = (name) => state.model.properties.filter(p => p.name === name);

    /**
     * Get the first property with the given name, creating it when missing.
     * @param {string} name - Property name.
     * @param {*} initialValue - Value used when creating.
     * @returns {Object} The property object (live reference into the model).
     */
    function getOrCreate(name, initialValue) {
        let prop = state.model.properties.find(p => p.name === name);
        if (!prop) {
            prop = { group: null, name, params: [], value: initialValue };
            state.model.properties.push(prop);
        }
        return prop;
    }

    /** Remove a property object from the model. */
    function removeProp(prop) {
        const i = state.model.properties.indexOf(prop);
        if (i > -1) state.model.properties.splice(i, 1);
    }

    /**
     * Model copy with empty properties pruned, ready for serialize/validate.
     * @returns {Object} Export model (shares property references; not mutated downstream).
     */
    function exportModel() {
        return {
            version: state.model.version,
            properties: state.model.properties.filter(p => !isEmptyProp(p))
        };
    }

    /** Names the structured editor owns; everything else renders as passthrough. */
    const EDITOR_OWNED = new Set(['FN', 'N', 'NICKNAME', 'ORG', 'TITLE', 'ROLE', 'TEL', 'EMAIL',
        'IMPP', 'URL', 'ADR', 'BDAY', 'ANNIVERSARY', 'GENDER', 'KIND', 'LANG', 'NOTE',
        'CATEGORIES', 'UID']);

    /* ========================================================================
     * SECTION: Editor rendering
     * ===================================================================== */

    /** Build an element with attributes and children. */
    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k === 'class') node.className = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (k === 'text') node.textContent = v;
            else node.setAttribute(k, v);
        }
        for (const child of children) if (child) node.appendChild(child);
        return node;
    }

    /** Labelled input group bound to a getter/setter pair. */
    function boundField(label, opts) {
        const input = el(opts.textarea ? 'textarea' : 'input', {
            class: opts.mono ? 'mono' : '',
            placeholder: opts.placeholder || ''
        });
        if (!opts.textarea) input.type = opts.type || 'text';
        if (opts.textarea) input.rows = opts.rows || 3;
        input.value = opts.get() || '';
        input.addEventListener('input', () => { opts.set(input.value); refreshOutput(); });
        const group = el('div', { class: 'input-group' + (opts.span2 ? ' span-2' : '') },
            el('label', { text: label }), input);
        if (opts.hint) group.appendChild(el('p', { class: 'field-hint', text: opts.hint }));
        return group;
    }

    /** Section card with availability-aware content. */
    function sectionCard(title, hiddenCount, ...children) {
        const header = el('div', { class: 'section-header' }, el('h2', { text: title }));
        if (hiddenCount > 0) {
            header.appendChild(el('span', {
                class: 'section-hint',
                text: `${hiddenCount} field${hiddenCount > 1 ? 's' : ''} not in ${state.version}`
            }));
        }
        return el('div', { class: 'card section-card' }, header, ...children);
    }

    /** Read component i of a structured value as an editable string. */
    const comp = (prop, i) => (prop.value[i] || []).join(',');
    /** Write component i of a structured value from an editable string. */
    function setComp(prop, i, text, split) {
        while (prop.value.length <= i) prop.value.push(['']);
        prop.value[i] = split ? text.split(',').map(s => s.trim()) : [text];
    }

    /** TYPE chip set bound to a property's TYPE parameter. */
    function chipSet(prop) {
        const def = vcardPropertyDef(prop.name);
        const vocabulary = (def && def.typeValues && def.typeValues[state.version]) || [];
        const wrap = el('div', { class: 'chip-set' });
        const typeParam = () => (prop.params || []).find(p => p.name === 'TYPE');
        for (const value of vocabulary) {
            if (value === 'pref') continue; // handled by the ★ toggle
            const isOn = () => {
                const t = typeParam();
                return !!t && t.values.some(v => v.toLowerCase() === value);
            };
            const chip = el('span', {
                class: 'chip' + (isOn() ? ' chip-on' : ''),
                text: value,
                onclick: () => {
                    let t = typeParam();
                    if (!t) { t = { name: 'TYPE', values: [] }; prop.params.push(t); }
                    if (isOn()) {
                        t.values = t.values.filter(v => v.toLowerCase() !== value);
                        if (t.values.length === 0) prop.params = prop.params.filter(p => p !== t);
                    } else {
                        t.values.push(value);
                    }
                    chip.classList.toggle('chip-on');
                    refreshOutput();
                }
            });
            wrap.appendChild(chip);
        }
        return wrap;
    }

    /** ★ preferred toggle bound to the PREF parameter (converted per version on export). */
    function prefToggle(prop) {
        const hasPref = () => (prop.params || []).some(p => p.name === 'PREF' ||
            (p.name === 'TYPE' && p.values.some(v => v.toLowerCase() === 'pref')));
        const btn = el('button', {
            class: 'pref-toggle' + (hasPref() ? ' pref-on' : ''),
            title: 'Mark as preferred',
            text: '★',
            onclick: () => {
                if (hasPref()) {
                    prop.params = prop.params.filter(p => p.name !== 'PREF');
                    const t = prop.params.find(p => p.name === 'TYPE');
                    if (t) {
                        t.values = t.values.filter(v => v.toLowerCase() !== 'pref');
                        if (t.values.length === 0) prop.params = prop.params.filter(p => p !== t);
                    }
                } else {
                    prop.params.push({ name: 'PREF', values: ['1'] });
                }
                btn.classList.toggle('pref-on');
                refreshOutput();
            }
        });
        btn.type = 'button';
        return btn;
    }

    /** One row for a multi-instance simple property (TEL/EMAIL/IMPP/URL). */
    function multiRow(prop, opts, container) {
        const input = el('input', { placeholder: opts.placeholder || '' });
        input.type = opts.type || 'text';
        input.value = flat(prop.value);
        input.addEventListener('input', () => { prop.value = input.value; refreshOutput(); });
        const row = el('div', { class: 'prop-row' },
            chipSet(prop),
            el('div', { class: 'input-group' }, input),
            el('div', { class: 'prop-row-side' },
                prefToggle(prop),
                el('button', {
                    class: 'btn-icon', title: 'Remove', text: '✕', type: 'button',
                    onclick: () => { removeProp(prop); row.remove(); refreshOutput(); }
                })));
        container.appendChild(row);
    }

    /** Multi-instance property section body (rows + add button). */
    function multiSection(name, opts) {
        const box = el('div', {});
        const rows = el('div', {});
        for (const prop of propsOf(name)) multiRow(prop, opts, rows);
        box.appendChild(rows);
        box.appendChild(el('button', {
            class: 'btn-add-row', text: `+ Add ${opts.label}`, type: 'button',
            onclick: () => {
                const prop = { group: null, name, params: [], value: '' };
                state.model.properties.push(prop);
                multiRow(prop, opts, rows);
                rows.lastChild.querySelector('input').focus();
            }
        }));
        return box;
    }

    /** Address block editor for one ADR property. */
    function adrBlock(prop, container) {
        const fields = [
            { label: 'Street', i: 2, span2: true }, { label: 'Apt / suite', i: 1 },
            { label: 'PO box', i: 0 }, { label: 'City', i: 3 },
            { label: 'Region / state', i: 4 }, { label: 'Postal code', i: 5 },
            { label: 'Country', i: 6 }
        ];
        const grid = el('div', { class: 'field-grid' });
        for (const f of fields) {
            grid.appendChild(boundField(f.label, {
                span2: f.span2,
                get: () => comp(prop, f.i),
                set: (v) => setComp(prop, f.i, v, false)
            }));
        }
        const block = el('div', { class: 'adr-block' },
            el('div', { class: 'adr-block-header' },
                chipSet(prop),
                el('div', { class: 'prop-row-side' },
                    prefToggle(prop),
                    el('button', {
                        class: 'btn-icon', title: 'Remove address', text: '✕', type: 'button',
                        onclick: () => { removeProp(prop); block.remove(); refreshOutput(); }
                    }))),
            grid);
        container.appendChild(block);
    }

    /**
     * Render the full editor from the current model and target version.
     * Called on load, import, version change, and Clear — not on keystrokes.
     */
    function renderEditor() {
        editorSections.innerHTML = '';
        const v = state.version;
        const available = (name) => vcardPropertyAvailable(name, v);
        const hiddenIn = (names) => names.filter(n => !available(n)).length;

        /* --- Identity --- */
        {
            const n = getOrCreate('N', [[''], [''], [''], [''], ['']]);
            const nameGrid = el('div', { class: 'field-grid' },
                boundField('Prefix', { get: () => comp(n, 3), set: (x) => setComp(n, 3, x, true), placeholder: 'Dr.' }),
                boundField('Given name', { get: () => comp(n, 1), set: (x) => setComp(n, 1, x, true), placeholder: 'Jane' }),
                boundField('Additional names', { get: () => comp(n, 2), set: (x) => setComp(n, 2, x, true), placeholder: 'Q.' }),
                boundField('Family name', { get: () => comp(n, 0), set: (x) => setComp(n, 0, x, true), placeholder: 'Doe' }),
                boundField('Suffix', { get: () => comp(n, 4), set: (x) => setComp(n, 4, x, true), placeholder: 'PhD' }));
            const children = [
                boundField('Displayed name (FN)', {
                    get: () => flat(getOrCreate('FN', '').value),
                    set: (x) => { getOrCreate('FN', '').value = x; },
                    placeholder: 'Dr. Jane Q. Doe, PhD',
                    hint: v === '2.1' ? 'Optional in 2.1 — N below is the required name.' :
                        'Required — how the name is displayed.'
                }),
                nameGrid
            ];
            if (available('NICKNAME')) {
                children.push(boundField('Nicknames (comma-separated)', {
                    get: () => Array.isArray(getOrCreate('NICKNAME', []).value) ? getOrCreate('NICKNAME', []).value.join(', ') : '',
                    set: (x) => { getOrCreate('NICKNAME', []).value = x.split(',').map(s => s.trim()).filter(Boolean); },
                    placeholder: 'JD, Janie'
                }));
            }
            editorSections.appendChild(sectionCard('Identity', hiddenIn(['NICKNAME']), ...children));
        }

        /* --- Organization --- */
        {
            const org = getOrCreate('ORG', [['']]);
            editorSections.appendChild(sectionCard('Organization', 0,
                el('div', { class: 'field-grid' },
                    boundField('Organization', { get: () => comp(org, 0), set: (x) => setComp(org, 0, x, false), placeholder: 'ACME Corp.' }),
                    boundField('Unit / department', { get: () => comp(org, 1), set: (x) => setComp(org, 1, x, false), placeholder: 'R&D' }),
                    boundField('Job title (TITLE)', {
                        get: () => flat(getOrCreate('TITLE', '').value),
                        set: (x) => { getOrCreate('TITLE', '').value = x; }, placeholder: 'Chief Engineer'
                    }),
                    boundField('Role (ROLE)', {
                        get: () => flat(getOrCreate('ROLE', '').value),
                        set: (x) => { getOrCreate('ROLE', '').value = x; }, placeholder: 'Programmer'
                    }))));
        }

        /* --- Phones --- */
        editorSections.appendChild(sectionCard('Phone numbers', 0,
            multiSection('TEL', { label: 'phone', type: 'tel', placeholder: '+64 21 123 4567' })));

        /* --- Online --- */
        {
            const children = [
                el('div', { class: 'input-group' }, el('label', { text: 'Email addresses' })),
                multiSection('EMAIL', { label: 'email', type: 'email', placeholder: 'jane@example.com' })
            ];
            if (available('IMPP')) {
                children.push(el('div', { class: 'input-group' }, el('label', { text: 'Instant messaging (IMPP)' })));
                children.push(multiSection('IMPP', { label: 'IM address', placeholder: 'xmpp:jane@example.com' }));
            }
            children.push(el('div', { class: 'input-group' }, el('label', { text: 'Websites' })));
            children.push(multiSection('URL', { label: 'website', type: 'url', placeholder: 'https://example.com' }));
            editorSections.appendChild(sectionCard('Email, IM & web', hiddenIn(['IMPP']), ...children));
        }

        /* --- Addresses --- */
        {
            const blocks = el('div', {});
            for (const prop of propsOf('ADR')) adrBlock(prop, blocks);
            editorSections.appendChild(sectionCard('Addresses', 0, blocks,
                el('button', {
                    class: 'btn-add-row', text: '+ Add address', type: 'button',
                    onclick: (e) => {
                        const prop = { group: null, name: 'ADR', params: [], value: [[''], [''], [''], [''], [''], [''], ['']] };
                        state.model.properties.push(prop);
                        adrBlock(prop, blocks);
                        refreshOutput();
                    }
                })));
        }

        /* --- Dates & personal --- */
        {
            const dateHint = v === '4.0' ? 'e.g. 19850412 or --0412 (RFC 6350 basic format; dashes are normalized)' : 'e.g. 1985-04-12';
            const children = [el('div', { class: 'field-grid' },
                boundField('Birthday (BDAY)', {
                    get: () => flat(getOrCreate('BDAY', '').value),
                    set: (x) => { getOrCreate('BDAY', '').value = x; },
                    placeholder: v === '4.0' ? '19850412' : '1985-04-12', hint: dateHint
                }),
                available('ANNIVERSARY') ? boundField('Anniversary', {
                    get: () => flat(getOrCreate('ANNIVERSARY', '').value),
                    set: (x) => { getOrCreate('ANNIVERSARY', '').value = x; },
                    placeholder: '20100815'
                }) : null)];
            if (available('GENDER')) {
                const g = getOrCreate('GENDER', [[''], ['']]);
                const sexSelect = el('select', {});
                for (const [value, label] of [['', '—'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other'], ['N', 'None / n.a.'], ['U', 'Unknown']]) {
                    const opt = el('option', { value, text: label });
                    if ((comp(g, 0) || '') === value) opt.selected = true;
                    sexSelect.appendChild(opt);
                }
                sexSelect.addEventListener('change', () => { setComp(g, 0, sexSelect.value, false); refreshOutput(); });
                children.push(el('div', { class: 'field-grid' },
                    el('div', { class: 'input-group' }, el('label', { text: 'Gender (GENDER)' }), sexSelect),
                    boundField('Gender identity (free text)', {
                        get: () => comp(g, 1), set: (x) => setComp(g, 1, x, false), placeholder: 'optional'
                    })));
            }
            if (available('KIND')) {
                const kind = getOrCreate('KIND', '');
                const kindSelect = el('select', {});
                for (const [value, label] of [['', 'individual (default)'], ['individual', 'individual'], ['group', 'group'], ['org', 'organization'], ['location', 'location']]) {
                    const opt = el('option', { value, text: label });
                    if (String(kind.value) === value) opt.selected = true;
                    kindSelect.appendChild(opt);
                }
                kindSelect.addEventListener('change', () => { kind.value = kindSelect.value; refreshOutput(); });
                children.push(el('div', { class: 'field-grid' },
                    el('div', { class: 'input-group' }, el('label', { text: 'Kind (KIND)' }), kindSelect),
                    boundField('Languages (LANG, comma-separated)', {
                        get: () => propsOf('LANG').map(p => flat(p.value)).join(', '),
                        set: (x) => {
                            state.model.properties = state.model.properties.filter(p => p.name !== 'LANG');
                            for (const tag of x.split(',').map(s => s.trim()).filter(Boolean)) {
                                state.model.properties.push({ group: null, name: 'LANG', params: [], value: tag });
                            }
                        },
                        placeholder: 'en, mi'
                    })));
            }
            editorSections.appendChild(sectionCard('Dates & personal',
                hiddenIn(['ANNIVERSARY', 'GENDER', 'KIND', 'LANG']), ...children));
        }

        /* --- Notes & metadata --- */
        {
            const children = [
                boundField('Notes (NOTE)', {
                    textarea: true, rows: 3,
                    get: () => flat(getOrCreate('NOTE', '').value),
                    set: (x) => { getOrCreate('NOTE', '').value = x; },
                    placeholder: 'Free-form notes — line breaks are encoded per version.'
                })
            ];
            if (available('CATEGORIES')) {
                children.push(boundField('Categories / tags (comma-separated)', {
                    get: () => Array.isArray(getOrCreate('CATEGORIES', []).value) ? getOrCreate('CATEGORIES', []).value.join(', ') : '',
                    set: (x) => { getOrCreate('CATEGORIES', []).value = x.split(',').map(s => s.trim()).filter(Boolean); },
                    placeholder: 'work, conference'
                }));
            }
            children.push(boundField('Unique ID (UID)', {
                get: () => flat(getOrCreate('UID', '').value),
                set: (x) => { getOrCreate('UID', '').value = x; },
                placeholder: 'urn:uuid:…  (optional)'
            }));
            editorSections.appendChild(sectionCard('Notes & metadata', hiddenIn(['CATEGORIES']), ...children));
        }

        /* --- Other imported properties (passthrough) --- */
        {
            const others = state.model.properties.filter(p => !EDITOR_OWNED.has(p.name));
            if (others.length > 0) {
                const rows = el('div', {});
                for (const prop of others) {
                    const paramText = (prop.params || [])
                        .map(p => `${p.name}=${p.values.join(',')}`).join(';');
                    const display = el('textarea', { class: 'readonly-value' });
                    display.value = flat(prop.value);
                    display.readOnly = true;
                    display.rows = 1;
                    const row = el('div', { class: 'prop-row prop-readonly' },
                        el('span', { class: 'prop-key-label', text: prop.name + (paramText ? `;${paramText}` : '') }),
                        el('div', { class: 'input-group' }, display),
                        el('button', {
                            class: 'btn-icon', title: 'Remove', text: '✕', type: 'button',
                            onclick: () => { removeProp(prop); row.remove(); refreshOutput(); }
                        }));
                    rows.appendChild(row);
                }
                editorSections.appendChild(sectionCard('Other imported properties', 0,
                    el('p', { class: 'field-hint', text: 'Preserved verbatim on export; not editable here.' }),
                    rows));
            }
        }
    }

    /* ========================================================================
     * SECTION: Live output
     * ===================================================================== */

    /** Render the serialized source with lightweight, safe syntax highlighting. */
    function renderPreview(text) {
        sourcePreview.innerHTML = '';
        for (const line of text.split('\r\n')) {
            const lineEl = document.createElement('div');
            const colon = line.indexOf(':');
            if (colon > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
                const head = line.slice(0, colon);
                const semi = head.indexOf(';');
                const name = semi === -1 ? head : head.slice(0, semi);
                const params = semi === -1 ? '' : head.slice(semi);
                lineEl.appendChild(el('span', { class: 'tok-name', text: name }));
                if (params) lineEl.appendChild(el('span', { class: 'tok-param', text: params }));
                lineEl.appendChild(el('span', { class: 'tok-delim', text: ':' }));
                lineEl.appendChild(document.createTextNode(line.slice(colon + 1)));
            } else {
                lineEl.textContent = line || ' ';
            }
            sourcePreview.appendChild(lineEl);
        }
    }

    /** Render diagnostics (+ conversion drops and parse warnings) into the panel. */
    function renderDiagnostics(diags, dropped) {
        validationPanel.innerHTML = '';
        const entries = [
            ...diags.map(d => ({ cls: `diag-${d.severity}`, icon: d.severity === 'error' ? '✕' : '⚠', prop: d.property, msg: d.message })),
            ...dropped.map(d => ({ cls: 'diag-info', icon: 'ℹ', prop: d.name, msg: `${d.reason} — dropped on export.` })),
            ...state.parseWarnings.map(w => ({ cls: 'diag-info', icon: 'ℹ', prop: 'import', msg: w }))
        ];
        if (entries.length === 0) {
            validationPanel.appendChild(el('div', { class: 'diag-ok', text: `✓ Valid vCard ${state.version}` }));
            return;
        }
        for (const e of entries) {
            validationPanel.appendChild(el('div', { class: `diag ${e.cls}` },
                el('span', { text: e.icon }),
                el('span', { class: 'diag-prop', text: e.prop }),
                el('span', { text: e.msg })));
        }
    }

    /**
     * Serialize + validate the current model and refresh every output surface:
     * preview, diagnostics, byte counter, NFC capacity, and button states.
     */
    function refreshOutput() {
        const model = exportModel();
        const { text, dropped } = serializeVCard(model, state.version);
        const diags = validateVCard(model, state.version);
        const errors = diags.filter(d => d.severity === 'error');

        state.lastSerialized = text;
        renderPreview(text);
        renderDiagnostics(diags, dropped);

        const bytes = new TextEncoder().encode(text).length;
        byteCounter.textContent = `${bytes} bytes`;
        downloadVcfBtn.disabled = errors.length > 0;
        downloadVcfBtn.title = errors.length > 0 ? 'Fix the validation errors first' : '';

        /* --- NFC capacity --- */
        const config = NTAG_CONFIG[state.ntag];
        const url = hostedUrlInput.value.trim();
        const dual = state.compat === 'dual';
        hostedUrlGroup.style.display = dual ? '' : 'none';
        const nfcBytes = dual && url
            ? NfcNtag.calculateDualRecordSize(text, url)
            : NfcNtag.calculateSingleRecordSize(text);
        const fits = nfcBytes <= config.ndefCapacity;
        capacityBar.style.width = `${Math.min((nfcBytes / config.ndefCapacity) * 100, 100)}%`;
        capacityBar.classList.toggle('over-capacity', !fits);
        capacityText.textContent = `${nfcBytes} / ${config.ndefCapacity} bytes`;

        let warning = '';
        if (!fits) {
            warning = 'Too large for this tag.';
            if (state.ntag === 'NTAG213' && nfcBytes <= NTAG_CONFIG.NTAG215.ndefCapacity) warning += ' NTAG215 would fit.';
            else if (state.ntag !== 'NTAG216' && nfcBytes <= NTAG_CONFIG.NTAG216.ndefCapacity) warning += ' NTAG216 would fit.';
        } else if (dual && !url) {
            warning = 'Enter the hosted .vcf URL for iOS compatibility (or switch to Android only).';
        }
        capacityWarning.textContent = warning;

        const nfcReady = errors.length === 0 && fits && (!dual || !!url);
        downloadNfcBtn.disabled = !nfcReady;
        sendFlipperBtn.disabled = !nfcReady;
    }

    /* ========================================================================
     * SECTION: Import / export
     * ===================================================================== */

    /** Replace the model with a parsed card and re-render everything. */
    function loadModel(model) {
        state.model = model;
        state.parseWarnings = model.warnings || [];
        const radio = document.querySelector(`input[name="vcardVersion"][value="${model.version}"]`);
        if (radio) { radio.checked = true; state.version = model.version; }
        renderEditor();
        refreshOutput();
    }

    /** Sanitized download filename derived from the display name. */
    function exportFilename() {
        const fn = flat((state.model.properties.find(p => p.name === 'FN') || { value: '' }).value) ||
            flat((state.model.properties.find(p => p.name === 'N') || { value: '' }).value);
        const base = fn.replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_').toLowerCase();
        return base || 'contact';
    }

    /** Trigger a browser download. */
    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /** Build the Flipper .nfc file text for the current card and settings. */
    function buildNfcFile() {
        const tag = new NfcNtag(state.ntag);
        const url = hostedUrlInput.value.trim();
        if (state.compat === 'dual' && url) {
            tag.generateDualRecordBusinessCard(state.lastSerialized, url);
        } else {
            tag.generateVcardTag(state.lastSerialized);
        }
        return tag.exportData();
    }

    downloadVcfBtn.addEventListener('click', () => {
        downloadFile(`${exportFilename()}.vcf`, state.lastSerialized, 'text/vcard');
    });

    copyVcfBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(state.lastSerialized);
            copyVcfBtn.textContent = 'Copied!';
        } catch (e) {
            copyVcfBtn.textContent = 'Copy failed';
        }
        setTimeout(() => { copyVcfBtn.textContent = 'Copy'; }, 1500);
    });

    downloadNfcBtn.addEventListener('click', () => {
        try {
            downloadFile(`${exportFilename()}.nfc`, buildNfcFile(), 'application/octet-stream');
        } catch (err) {
            capacityWarning.textContent = err.message;
        }
    });

    sendFlipperBtn.addEventListener('click', async () => {
        if (!navigator.serial || /Mobi|Android/i.test(navigator.userAgent)) {
            $('webSerialModal').classList.add('active');
            return;
        }
        try {
            sendFlipperBtn.disabled = true;
            flipperStatus.className = 'send-status';
            const nfcData = buildNfcFile();
            if (!flipperSerial) flipperSerial = new FlipperSerial();
            if (!flipperSerial.isConnected) {
                flipperStatus.textContent = 'Connecting to Flipper…';
                await flipperSerial.connect();
            }
            flipperStatus.textContent = 'Sending…';
            await flipperSerial.writeCommand('storage mkdir /ext/nfc');
            await flipperSerial.writeFile(`/ext/nfc/${exportFilename()}.nfc`, nfcData);
            flipperStatus.textContent = `Saved to Flipper as /ext/nfc/${exportFilename()}.nfc`;
            flipperStatus.classList.add('success');
        } catch (err) {
            console.error('Flipper transfer failed:', err);
            flipperStatus.textContent = `Error: ${err.message}`;
            flipperStatus.classList.add('error');
            flipperSerial = null;
        } finally {
            sendFlipperBtn.disabled = false;
        }
    });

    /* --- Import panels --- */

    const pastePanel = $('pastePanel');
    const urlPanel = $('urlPanel');

    $('importPasteBtn').addEventListener('click', () => {
        pastePanel.classList.toggle('hidden');
        urlPanel.classList.add('hidden');
    });
    $('importUrlBtn').addEventListener('click', () => {
        urlPanel.classList.toggle('hidden');
        pastePanel.classList.add('hidden');
    });
    document.querySelectorAll('.panel-close').forEach(btn =>
        btn.addEventListener('click', () => btn.closest('.import-panel').classList.add('hidden')));

    $('pasteLoadBtn').addEventListener('click', () => {
        const text = $('pasteTextarea').value.trim();
        if (!text) return;
        try {
            loadModel(parseVCard(text));
            pastePanel.classList.add('hidden');
        } catch (err) {
            alert(err.message);
        }
    });

    $('importFileBtn').addEventListener('click', () => $('importFileInput').click());
    $('importFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                loadModel(parseVCard(String(reader.result)));
            } catch (err) {
                alert(err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    $('urlFetchBtn').addEventListener('click', async () => {
        const url = $('urlFetchInput').value.trim();
        if (!url) return;
        const btn = $('urlFetchBtn');
        btn.textContent = '…';
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            loadModel(parseVCard(await res.text()));
            urlPanel.classList.add('hidden');
        } catch (err) {
            alert('Fetch failed (likely CORS). The file will open in a new tab — copy its contents and use Paste.');
            window.open(url, '_blank');
            urlPanel.classList.add('hidden');
            pastePanel.classList.remove('hidden');
        } finally {
            btn.textContent = 'Fetch';
        }
    });

    $('clearBtn').addEventListener('click', () => {
        state.model = { version: state.version, properties: [], warnings: [] };
        state.parseWarnings = [];
        renderEditor();
        refreshOutput();
    });

    /* ========================================================================
     * SECTION: Toolbar radio groups & theme
     * ===================================================================== */

    document.querySelectorAll('input[name="vcardVersion"]').forEach(radio =>
        radio.addEventListener('change', () => {
            state.version = radio.value;
            renderEditor();
            refreshOutput();
        }));
    document.querySelectorAll('input[name="ntagType"]').forEach(radio =>
        radio.addEventListener('change', () => { state.ntag = radio.value; refreshOutput(); }));
    document.querySelectorAll('input[name="compatMode"]').forEach(radio =>
        radio.addEventListener('change', () => { state.compat = radio.value; refreshOutput(); }));
    hostedUrlInput.addEventListener('input', refreshOutput);

    document.querySelectorAll('.modal-close').forEach(btn =>
        btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('active')));

    const themeToggle = $('themeToggle');

    /** Sync the theme toggle glyph with the active theme. */
    function updateThemeToggle() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        themeToggle.textContent = current === 'dark' ? '☀️' : '🌙';
    }

    /** Apply saved theme > system preference > dark default. */
    function initTheme() {
        const saved = localStorage.getItem('theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        updateThemeToggle();
    }

    themeToggle.addEventListener('click', () => {
        const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeToggle();
    });

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                updateThemeToggle();
            }
        });
    }

    /* ========================================================================
     * SECTION: Init
     * ===================================================================== */

    initTheme();
    renderEditor();
    refreshOutput();
});
