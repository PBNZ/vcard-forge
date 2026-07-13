/**
 * @file vcard-core.test.js
 * @description Tests for the vCard core library (registry, parser, serializer,
 *              validator) against the compliance rules in
 *              docs/reference/vcard-compliance.md (versit 2.1, RFC 2426/2425,
 *              RFC 6350, RFC 6868).
 *
 * Copyright (c) PBNZ 2026
 * Licensed under the GNU General Public License v3.
 */

'use strict';

const CRLF = '\r\n';

/**
 * Build a vCard text block from logical lines with CRLF endings.
 * @param {...string} lines - Content lines between BEGIN and END.
 * @returns {string} Complete vCard text.
 */
function card(version, ...lines) {
    return ['BEGIN:VCARD', `VERSION:${version}`, ...lines, 'END:VCARD', ''].join(CRLF);
}

module.exports = function ({ test, assertEq, assertTrue, assertThrows, api }) {
    const {
        VCARD_PROPERTIES, vcardPropertyDef, vcardPropertyAvailable,
        parseVCard, parseVCardStream, serializeVCard, convertVCardVersion, validateVCard
    } = api;

    /** Find first property by name in a parsed card. */
    const prop = (model, name) => model.properties.find(p => p.name === name);
    /** All properties by name. */
    const props = (model, name) => model.properties.filter(p => p.name === name);
    /** First param of a property by name. */
    const param = (p, name) => (p.params || []).find(x => x.name === name);
    /** Serialized text lines (unfolded not applied). */
    const lines = (text) => text.split(CRLF).filter(l => l.length > 0);

    /* ================= Registry ================= */

    test('registry: NICKNAME exists in 3.0/4.0 but not 2.1', () => {
        assertTrue(!vcardPropertyAvailable('NICKNAME', '2.1'), 'not in 2.1');
        assertTrue(vcardPropertyAvailable('NICKNAME', '3.0'), 'in 3.0');
        assertTrue(vcardPropertyAvailable('NICKNAME', '4.0'), 'in 4.0');
    });

    test('registry: LABEL/MAILER/AGENT dropped in 4.0; KIND/GENDER/ANNIVERSARY are 4.0-only', () => {
        for (const name of ['LABEL', 'MAILER', 'AGENT']) {
            assertTrue(vcardPropertyAvailable(name, '3.0'), `${name} in 3.0`);
            assertTrue(!vcardPropertyAvailable(name, '4.0'), `${name} not in 4.0`);
        }
        for (const name of ['KIND', 'GENDER', 'ANNIVERSARY', 'IMPP']) {
            assertTrue(vcardPropertyAvailable(name, '4.0'), `${name} in 4.0`);
            assertTrue(!vcardPropertyAvailable(name, '2.1'), `${name} not in 2.1`);
        }
    });

    test('registry: TEL TYPE values differ per version (pcs is 3.0; textphone is 4.0; pref not a 4.0 type)', () => {
        const def = vcardPropertyDef('TEL');
        assertTrue(def.typeValues['3.0'].includes('pcs'), '3.0 has pcs');
        assertTrue(def.typeValues['4.0'].includes('textphone'), '4.0 has textphone');
        assertTrue(!def.typeValues['4.0'].includes('pref'), '4.0 has no pref type');
        assertTrue(def.typeValues['2.1'].includes('cell'), '2.1 has cell');
    });

    test('registry: 4.0 cardinality table', () => {
        assertEq(vcardPropertyDef('FN').card40, '1*', 'FN 1*');
        assertEq(vcardPropertyDef('N').card40, '*1', 'N *1');
        assertEq(vcardPropertyDef('BDAY').card40, '*1', 'BDAY *1');
        assertEq(vcardPropertyDef('TEL').card40, '*', 'TEL *');
    });

    /* ================= Parser: basics ================= */

    test('parser: basic 4.0 card', () => {
        const m = parseVCard(card('4.0', 'FN:John Doe', 'N:Doe;John;;;'));
        assertEq(m.version, '4.0');
        assertEq(prop(m, 'FN').value, 'John Doe');
        assertEq(prop(m, 'N').value, [['Doe'], ['John'], [''], [''], ['']]);
    });

    test('parser: throws on non-vCard input', () => {
        assertThrows(() => parseVCard('hello world'), 'BEGIN:VCARD');
    });

    test('parser: accepts lowercase begin/end and LF-only line endings', () => {
        const m = parseVCard('begin:vcard\nversion:3.0\nfn:Jane\nn:Doe;Jane;;;\nend:vcard\n');
        assertEq(m.version, '3.0');
        assertEq(prop(m, 'FN').value, 'Jane');
    });

    test('parser: missing END:VCARD yields warning but still parses', () => {
        const m = parseVCard('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:X\r\n');
        assertEq(prop(m, 'FN').value, 'X');
        assertTrue(m.warnings.some(w => /END:VCARD/i.test(w)), 'warning mentions END:VCARD');
    });

    test('parser: value may contain colons and semicolons after the first colon', () => {
        const m = parseVCard(card('4.0', 'FN:X',
            'TEL;VALUE=uri;PREF=1;TYPE="voice,home":tel:+1-555-555-5555;ext=5555'));
        assertEq(prop(m, 'TEL').value, 'tel:+1-555-555-5555;ext=5555');
        assertEq(param(prop(m, 'TEL'), 'PREF').values, ['1']);
        assertEq(param(prop(m, 'TEL'), 'TYPE').values, ['voice', 'home']);
    });

    test('parser: group prefix is preserved', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'item1.EMAIL:a@b.cd'));
        assertEq(prop(m, 'EMAIL').group, 'item1');
    });

    test('parser: unfolds CRLF+space and CRLF+tab (RFC 6350 §3.2 example)', () => {
        const m = parseVCard(card('4.0', 'FN:X',
            'NOTE:This is a long descrip' + CRLF + ' tion that exists o' + CRLF + '\tn a long line.'));
        assertEq(prop(m, 'NOTE').value, 'This is a long description that exists on a long line.');
    });

    test('parser: multiple cards in one stream', () => {
        const cards = parseVCardStream(card('4.0', 'FN:A') + card('3.0', 'FN:B', 'N:B;;;;'));
        assertEq(cards.length, 2);
        assertEq(cards[0].version, '4.0');
        assertEq(cards[1].version, '3.0');
    });

    /* ================= Parser: params ================= */

    test('parser: 2.1 bare params normalize to TYPE and merge', () => {
        const m = parseVCard(card('2.1', 'N:Doe;J;;;', 'TEL;WORK;VOICE:+1 555'));
        assertEq(param(prop(m, 'TEL'), 'TYPE').values, ['WORK', 'VOICE']);
    });

    test('parser: TYPE=a,b and TYPE=a;TYPE=b merge identically', () => {
        const a = parseVCard(card('3.0', 'FN:X', 'N:X;;;;', 'TEL;TYPE=work,voice:1'));
        const b = parseVCard(card('3.0', 'FN:X', 'N:X;;;;', 'TEL;TYPE=work;TYPE=voice:1'));
        assertEq(param(prop(a, 'TEL'), 'TYPE').values, ['work', 'voice']);
        assertEq(param(prop(b, 'TEL'), 'TYPE').values, ['work', 'voice']);
    });

    test('parser: quoted param values may contain : ; ,', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'ADR;LABEL="a:b;c,d";TYPE=home:;;s;l;r;c;y'));
        assertEq(param(prop(m, 'ADR'), 'LABEL').values, ['a:b;c,d']);
    });

    test('parser: RFC 6868 caret decoding in 4.0 param values', () => {
        const m = parseVCard(card('4.0', 'FN:X', "ADR;LABEL=Mr. John^'s^nhouse^^:;;s;l;r;c;y"));
        assertEq(param(prop(m, 'ADR'), 'LABEL').values, ['Mr. John"s\nhouse^']);
    });

    /* ================= Parser: escaping & encodings ================= */

    test('parser: 4.0 unescapes backslash sequences in text values', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'NOTE:a\\,b\\;c\\\\d\\ne;raw'));
        assertEq(prop(m, 'NOTE').value, 'a,b;c\\d\ne;raw');
    });

    test('parser: 2.1 unescapes only backslash-semicolon (literal backslash-n survives)', () => {
        const m = parseVCard(card('2.1', 'N:Doe;J;;;', 'NOTE:path C:\\names and a \\; semi'));
        assertEq(prop(m, 'NOTE').value, 'path C:\\names and a ; semi');
    });

    test('parser: structured component escaping — escaped semicolon is not a separator', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'N:Foo\\;Bar;A\\,B;;;'));
        assertEq(prop(m, 'N').value, [['Foo;Bar'], ['A,B'], [''], [''], ['']]);
    });

    test('parser: text-list property splits on unescaped commas', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'NICKNAME:Jim,Jimmie,O\\,K'));
        assertEq(prop(m, 'NICKNAME').value, ['Jim', 'Jimmie', 'O,K']);
    });

    test('parser: QUOTED-PRINTABLE decode with UTF-8 charset', () => {
        const m = parseVCard(card('2.1', 'N:X;;;;', 'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Gr=C3=B6=C3=9Fe'));
        assertEq(prop(m, 'NOTE').value, 'Größe');
        assertTrue(!param(prop(m, 'NOTE'), 'ENCODING'), 'ENCODING param consumed');
        assertTrue(!param(prop(m, 'NOTE'), 'CHARSET'), 'CHARSET param consumed');
    });

    test('parser: QUOTED-PRINTABLE decode with ISO-8859-1 charset (Outlook pattern)', () => {
        const m = parseVCard(card('2.1', 'N;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:M=FCller;J=FCrgen;;;'));
        assertEq(prop(m, 'N').value, [['Müller'], ['Jürgen'], [''], [''], ['']]);
    });

    test('parser: QP soft line breaks joined, =0D=0A becomes newline', () => {
        const text = 'BEGIN:VCARD' + CRLF + 'VERSION:2.1' + CRLF + 'N:X;;;;' + CRLF +
            'NOTE;ENCODING=QUOTED-PRINTABLE:line one=0D=0A=' + CRLF + 'line two' + CRLF +
            'END:VCARD' + CRLF;
        const m = parseVCard(text);
        assertEq(prop(m, 'NOTE').value, 'line one\nline two');
    });

    test('parser: 2.1 nested AGENT vCard captured as raw value', () => {
        const text = 'BEGIN:VCARD' + CRLF + 'VERSION:2.1' + CRLF + 'N:Boss;Big;;;' + CRLF +
            'AGENT:' + CRLF +
            'BEGIN:VCARD' + CRLF + 'VERSION:2.1' + CRLF + 'N:Aide;The;;;' + CRLF + 'END:VCARD' + CRLF +
            'END:VCARD' + CRLF;
        const m = parseVCard(text);
        assertTrue(prop(m, 'AGENT').value.includes('N:Aide;The;;;'), 'nested card kept');
        assertEq(prop(m, 'N').value, [['Boss'], ['Big'], [''], [''], ['']]);
    });

    /* ================= Serializer: structure ================= */

    test('serializer: VERSION immediately after BEGIN, CRLF endings, trailing CRLF', () => {
        const m = parseVCard(card('4.0', 'FN:John'));
        const { text } = serializeVCard(m, '4.0');
        const ls = text.split(CRLF);
        assertEq(ls[0], 'BEGIN:VCARD');
        assertEq(ls[1], 'VERSION:4.0');
        assertTrue(text.endsWith('END:VCARD' + CRLF), 'trailing CRLF after END');
        assertTrue(!/[^\r]\n/.test(text), 'no bare LF');
        assertTrue(!/\r(?!\n)/.test(text), 'no bare CR');
    });

    test('serializer: property names upper-cased on output', () => {
        const m = parseVCard('begin:vcard\nversion:4.0\nfn:Jane\nend:vcard\n');
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('FN:Jane'), 'FN upper-cased');
    });

    /* ================= Serializer: escaping per version ================= */

    test('serializer: 4.0 text — escape backslash, comma, newline; raw semicolon allowed', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'NOTE', params: [], value: 'a,b;c\\d\ne' }
        ] };
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('NOTE:a\\,b;c\\\\d\\ne'), `got: ${text}`);
    });

    test('serializer: 3.0 text — semicolon also escaped (RFC 2426 §5)', () => {
        const m = { version: '3.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'NOTE', params: [], value: 'a,b;c' }
        ] };
        const { text } = serializeVCard(m, '3.0');
        assertTrue(text.includes('NOTE:a\\,b\\;c'), `got: ${text}`);
    });

    test('serializer: 2.1 — commas and backslashes stay raw, ASCII text unfolded', () => {
        const m = { version: '2.1', properties: [
            { group: null, name: 'N', params: [], value: [['Doe'], ['J'], [''], [''], ['']] },
            { group: null, name: 'NOTE', params: [], value: 'a,b and C:\\names' }
        ] };
        const { text } = serializeVCard(m, '2.1');
        assertTrue(text.includes('NOTE:a,b and C:\\names'), `got: ${text}`);
    });

    test('serializer: structured components escape their semicolons in every version', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'N', params: [], value: [['Foo;Bar'], ['A,B'], [''], [''], ['']] }
        ] };
        const v4 = serializeVCard(m, '4.0').text;
        assertTrue(v4.includes('N:Foo\\;Bar;A\\,B;;;'), `4.0 got: ${v4}`);
        const v21 = serializeVCard(m, '2.1').text;
        assertTrue(v21.includes('N:Foo\\;Bar;A,B;;;'), `2.1 keeps raw comma, got: ${v21}`);
    });

    test('serializer: multi-valued structured components join with comma (RFC 6350 N example)', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'N', params: [],
              value: [['Stevenson'], ['John'], ['Philip', 'Paul'], ['Dr.'], ['Jr.', 'M.D.']] }
        ] };
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('N:Stevenson;John;Philip,Paul;Dr.;Jr.,M.D.'), `got: ${text}`);
    });

    test('serializer: ADR keeps all seven component slots', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'ADR', params: [],
              value: [[''], [''], ['123 Main St'], ['Any Town'], ['CA'], ['91921'], ['U.S.A.']] }
        ] };
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('ADR:;;123 Main St;Any Town;CA;91921;U.S.A.'), `got: ${text}`);
    });

    /* ================= Serializer: params per version ================= */

    test('serializer: TYPE emission — 4.0 TYPE=, 3.0 TYPE=, 2.1 bare', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'TEL', params: [{ name: 'TYPE', values: ['work', 'voice'] }], value: '+15551234' }
        ] };
        assertTrue(serializeVCard(m, '4.0').text.includes('TEL;TYPE=work,voice:+15551234'), '4.0');
        assertTrue(serializeVCard(m, '3.0').text.includes('TEL;TYPE=work,voice:+15551234'), '3.0');
        assertTrue(serializeVCard(m, '2.1').text.includes('TEL;WORK;VOICE:+15551234'), '2.1 bare');
    });

    test('serializer: 4.0 param values caret-encoded and quoted when they contain : ; ,', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'ADR', params: [{ name: 'LABEL', values: ['Line 1\nLine "2", ok'] }],
              value: [[''], [''], ['s'], ['l'], ['r'], ['c'], ['y']] }
        ] };
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('LABEL="Line 1^nLine ^\'2^\', ok"'), `got: ${text}`);
    });

    test('serializer: PREF param survives 4.0, becomes TYPE=PREF downlevel', () => {
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'EMAIL', params: [{ name: 'PREF', values: ['1'] }], value: 'a@b.cd' }
        ] };
        assertTrue(serializeVCard(m, '4.0').text.includes('EMAIL;PREF=1:a@b.cd'), '4.0 keeps PREF');
        assertTrue(serializeVCard(m, '3.0').text.includes('EMAIL;TYPE=pref:a@b.cd'), '3.0 TYPE=pref');
        assertTrue(serializeVCard(m, '2.1').text.includes('EMAIL;PREF:a@b.cd'), '2.1 bare PREF');
    });

    test('serializer: TYPE=pref uplevels to PREF=1 in 4.0', () => {
        const m = parseVCard(card('3.0', 'FN:X', 'N:X;;;;', 'EMAIL;TYPE=internet,pref:a@b.cd'));
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('PREF=1'), `got: ${text}`);
        assertTrue(!/TYPE=[^;:]*pref/i.test(text), 'pref removed from TYPE');
    });

    /* ================= Serializer: folding ================= */

    test('serializer: 4.0 folds at 75 octets and round-trips', () => {
        const long = 'The quick brown fox jumps over the lazy dog. '.repeat(6);
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'NOTE', params: [], value: long }
        ] };
        const { text } = serializeVCard(m, '4.0');
        for (const l of lines(text)) {
            assertTrue(Buffer.byteLength(l, 'utf8') <= 75, `line too long (${Buffer.byteLength(l, 'utf8')}): ${l}`);
        }
        assertEq(parseVCard(text).properties.find(p => p.name === 'NOTE').value, long, 'round trip');
    });

    test('serializer: 4.0 folding never splits a UTF-8 multi-octet sequence', () => {
        const long = '日本語のテキスト'.repeat(10);
        const m = { version: '4.0', properties: [
            { group: null, name: 'FN', params: [], value: 'X' },
            { group: null, name: 'NOTE', params: [], value: long }
        ] };
        const { text } = serializeVCard(m, '4.0');
        for (const l of lines(text)) {
            assertTrue(Buffer.byteLength(l, 'utf8') <= 75, 'line within 75 octets');
            assertTrue(!Buffer.from(l, 'utf8').toString('utf8').includes('�'), 'no broken sequences');
        }
        assertEq(parseVCard(text).properties.find(p => p.name === 'NOTE').value, long, 'round trip');
    });

    test('serializer: 2.1 plain lines are never folded', () => {
        const long = 'ascii only text '.repeat(10).trim();
        const m = { version: '2.1', properties: [
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'NOTE', params: [], value: long }
        ] };
        const { text } = serializeVCard(m, '2.1');
        assertTrue(text.includes('NOTE:' + long), 'single physical line');
    });

    /* ================= Serializer: 2.1 QP + charset ================= */

    test('serializer: 2.1 non-ASCII value gets CHARSET=UTF-8 + QP and round-trips', () => {
        const m = { version: '2.1', properties: [
            { group: null, name: 'N', params: [], value: [['Müller'], ['Jürgen'], [''], [''], ['']] }
        ] };
        const { text } = serializeVCard(m, '2.1');
        assertTrue(text.includes('N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:'), `got: ${text}`);
        assertTrue(text.includes('M=C3=BCller'), 'QP bytes');
        assertEq(parseVCard(text).properties.find(p => p.name === 'N').value,
            [['Müller'], ['Jürgen'], [''], [''], ['']], 'round trip');
    });

    test('serializer: 2.1 newline in value uses QP =0D=0A without CHARSET for ASCII', () => {
        const m = { version: '2.1', properties: [
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'NOTE', params: [], value: 'line one\nline two' }
        ] };
        const { text } = serializeVCard(m, '2.1');
        assertTrue(text.includes('NOTE;ENCODING=QUOTED-PRINTABLE:line one=0D=0Aline two'), `got: ${text}`);
        assertTrue(!text.includes('NOTE;CHARSET'), 'no CHARSET for pure ASCII');
    });

    test('serializer: 2.1 QP output keeps physical lines under 76 chars with soft breaks', () => {
        const long = 'ä'.repeat(120);
        const m = { version: '2.1', properties: [
            { group: null, name: 'N', params: [], value: [['X'], [''], [''], [''], ['']] },
            { group: null, name: 'NOTE', params: [], value: long }
        ] };
        const { text } = serializeVCard(m, '2.1');
        for (const l of lines(text)) {
            assertTrue(l.length < 76, `QP line too long (${l.length}): ${l.slice(0, 40)}...`);
        }
        assertEq(parseVCard(text).properties.find(p => p.name === 'NOTE').value, long, 'round trip');
    });

    /* ================= Serializer: dates ================= */

    test('serializer: 4.0 normalizes extended dates to ISO 8601 basic', () => {
        const m = parseVCard(card('3.0', 'FN:X', 'N:X;;;;', 'BDAY:1996-04-15'));
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.includes('BDAY:19960415'), `got: ${text}`);
    });

    test('serializer: 4.0 keeps truncated --MMDD dates and VALUE=text dates', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'BDAY:--0415'));
        assertTrue(serializeVCard(m, '4.0').text.includes('BDAY:--0415'), 'truncated kept');
        const t = parseVCard(card('4.0', 'FN:X', 'BDAY;VALUE=text:circa 1800'));
        assertTrue(serializeVCard(t, '4.0').text.includes('BDAY;VALUE=text:circa 1800'), 'text date kept');
    });

    test('serializer: 3.0 keeps extended date format', () => {
        const m = parseVCard(card('3.0', 'FN:X', 'N:X;;;;', 'BDAY:1996-04-15'));
        assertTrue(serializeVCard(m, '3.0').text.includes('BDAY:1996-04-15'), 'extended kept in 3.0');
    });

    /* ================= Serializer: binary bridging ================= */

    test('serializer: 2.1 BASE64 photo becomes data: URI in 4.0', () => {
        const m = parseVCard(card('2.1', 'N:X;;;;', 'PHOTO;ENCODING=BASE64;TYPE=JPEG:AAECAwQ='));
        const { text } = serializeVCard(m, '4.0');
        assertTrue(text.replace(/\r\n[ \t]/g, '').includes('PHOTO:data:image/jpeg;base64,AAECAwQ='), `got: ${text}`);
    });

    test('serializer: 4.0 data: URI photo becomes ENCODING=b in 3.0 and BASE64 in 2.1', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'PHOTO:data:image/jpeg;base64,AAECAwQ='));
        const v3 = serializeVCard(m, '3.0').text.replace(/\r\n[ \t]/g, '');
        assertTrue(v3.includes('PHOTO;ENCODING=b;TYPE=JPEG:AAECAwQ='), `3.0 got: ${v3}`);
        const v21 = serializeVCard(m, '2.1').text.replace(/\r\n[ \t]/g, '');
        assertTrue(v21.includes('PHOTO;ENCODING=BASE64;TYPE=JPEG:AAECAwQ='), `2.1 got: ${v21}`);
    });

    /* ================= Version conversion ================= */

    test('convert: 4.0-only properties are dropped with reasons when targeting 2.1', () => {
        const m = parseVCard(card('4.0', 'FN:Jane Doe', 'N:Doe;Jane;;;',
            'KIND:individual', 'NICKNAME:JD', 'GENDER:F', 'TEL;TYPE=cell:+15551234'));
        const { text, dropped } = serializeVCard(m, '2.1');
        assertTrue(dropped.some(d => d.name === 'KIND'), 'KIND dropped');
        assertTrue(dropped.some(d => d.name === 'NICKNAME'), 'NICKNAME dropped');
        assertTrue(dropped.some(d => d.name === 'GENDER'), 'GENDER dropped');
        assertTrue(text.includes('TEL;CELL:+15551234'), 'TEL survives');
        assertTrue(!text.includes('KIND'), 'no KIND line');
    });

    test('convert: derives FN from N when targeting 3.0/4.0 from an N-only 2.1 card', () => {
        const m = parseVCard(card('2.1', 'N:Smith;Bob;;;'));
        const { text } = serializeVCard(m, '3.0');
        assertTrue(text.includes('FN:Bob Smith'), `got: ${text}`);
    });

    test('convert: derives N from FN when targeting 2.1/3.0 from an FN-only 4.0 card', () => {
        const m = parseVCard(card('4.0', 'FN:Jane Q. Doe'));
        const { text } = serializeVCard(m, '2.1');
        assertTrue(text.includes('N:Doe;Jane;Q.;;'), `got: ${text}`);
    });

    /* ================= Validator ================= */

    test('validator: mandatory properties per version', () => {
        const noFn = { version: '4.0', properties: [] };
        assertTrue(validateVCard(noFn, '4.0').some(d => d.severity === 'error' && d.property === 'FN'), '4.0 needs FN');
        const noN21 = { version: '2.1', properties: [{ group: null, name: 'FN', params: [], value: 'X' }] };
        assertTrue(validateVCard(noN21, '2.1').some(d => d.severity === 'error' && d.property === 'N'), '2.1 needs N');
        const v3 = { version: '3.0', properties: [{ group: null, name: 'FN', params: [], value: 'X' }] };
        assertTrue(validateVCard(v3, '3.0').some(d => d.severity === 'error' && d.property === 'N'), '3.0 needs N too');
    });

    test('validator: 4.0 cardinality — duplicate N is an error, ALTID-tagged duplicates are not', () => {
        const dup = parseVCard(card('4.0', 'FN:X', 'N:A;;;;', 'N:B;;;;'));
        assertTrue(validateVCard(dup, '4.0').some(d => d.severity === 'error' && d.property === 'N'), 'dup N error');
        const alt = parseVCard(card('4.0', 'FN:X', 'N;ALTID=1;LANGUAGE=en:A;;;;', 'N;ALTID=1;LANGUAGE=jp:B;;;;'));
        assertTrue(!validateVCard(alt, '4.0').some(d => d.severity === 'error' && d.property === 'N'), 'ALTID ok');
    });

    test('validator: property availability for target version', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'N:X;;;;', 'KIND:individual'));
        assertTrue(validateVCard(m, '2.1').some(d => d.property === 'KIND'), 'KIND flagged for 2.1');
        assertTrue(!validateVCard(m, '4.0').some(d => d.property === 'KIND'), 'KIND fine in 4.0');
    });

    test('validator: TYPE parameter not allowed on BDAY in 4.0', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'BDAY;TYPE=home:19960415'));
        assertTrue(validateVCard(m, '4.0').some(d => d.severity === 'error' && d.property === 'BDAY'), 'TYPE on BDAY');
    });

    test('validator: unknown TYPE value warns, known value passes (case-insensitive)', () => {
        const bad = parseVCard(card('4.0', 'FN:X', 'TEL;TYPE=banana:1'));
        assertTrue(validateVCard(bad, '4.0').some(d => d.property === 'TEL' && /banana/i.test(d.message)), 'banana flagged');
        const ok = parseVCard(card('4.0', 'FN:X', 'TEL;TYPE=CELL:1'));
        assertTrue(!validateVCard(ok, '4.0').some(d => d.property === 'TEL'), 'CELL fine');
    });

    test('validator: PREF must be 1..100 in 4.0', () => {
        const bad = parseVCard(card('4.0', 'FN:X', 'EMAIL;PREF=150:a@b.cd'));
        assertTrue(validateVCard(bad, '4.0').some(d => d.severity === 'error' && /PREF/.test(d.message)), 'PREF=150');
        const ok = parseVCard(card('4.0', 'FN:X', 'EMAIL;PREF=1:a@b.cd'));
        assertTrue(!validateVCard(ok, '4.0').some(d => /PREF/.test(d.message)), 'PREF=1 ok');
    });

    test('validator: GENDER sex component must be M/F/O/N/U or empty', () => {
        const ok1 = parseVCard(card('4.0', 'FN:X', 'GENDER:M'));
        const ok2 = parseVCard(card('4.0', 'FN:X', 'GENDER:;it\'s complicated'));
        const bad = parseVCard(card('4.0', 'FN:X', 'GENDER:X'));
        assertTrue(!validateVCard(ok1, '4.0').some(d => d.property === 'GENDER'), 'M ok');
        assertTrue(!validateVCard(ok2, '4.0').some(d => d.property === 'GENDER'), 'empty sex ok');
        assertTrue(validateVCard(bad, '4.0').some(d => d.severity === 'error' && d.property === 'GENDER'), 'X bad');
    });

    test('validator: 4.0 BDAY must be ISO 8601 basic or VALUE=text', () => {
        const bad = parseVCard(card('4.0', 'FN:X', 'BDAY:15 April 1996'));
        assertTrue(validateVCard(bad, '4.0').some(d => d.severity === 'error' && d.property === 'BDAY'), 'prose date');
        const ok = parseVCard(card('4.0', 'FN:X', 'BDAY:19960415'));
        assertTrue(!validateVCard(ok, '4.0').some(d => d.property === 'BDAY'), 'basic ok');
    });

    test('validator: unknown property warns, X- extension does not', () => {
        const m = parseVCard(card('4.0', 'FN:X', 'FOO:bar', 'X-CUSTOM:baz'));
        const diags = validateVCard(m, '4.0');
        assertTrue(diags.some(d => d.severity === 'warning' && d.property === 'FOO'), 'FOO warned');
        assertTrue(!diags.some(d => d.property === 'X-CUSTOM'), 'X- silent');
    });

    /* ================= Full round trips ================= */

    test('round trip: rich 4.0 card survives parse → serialize → parse', () => {
        const original = card('4.0',
            'FN:Simon Perreault',
            'N:Perreault;Simon;;;ing. jr\\,M.Sc.',
            'BDAY:--0203',
            'GENDER:M',
            'ADR;TYPE=work:;Suite D2-630;2875 Laurier;Quebec;QC;G1V 2M2;Canada',
            'TEL;VALUE=uri;TYPE="work,voice";PREF=1:tel:+1-418-656-9254;ext=102',
            'EMAIL;TYPE=work:simon.perreault@viagenie.ca',
            'ORG:Viagenie',
            'URL;TYPE=home:http://nomis80.org');
        const m1 = parseVCard(original);
        const { text } = serializeVCard(m1, '4.0');
        const m2 = parseVCard(text);
        assertEq(m2.properties, m1.properties, 'model stable across round trip');
    });

    test('round trip: 4.0 → 2.1 → parse keeps core identity data', () => {
        const m = parseVCard(card('4.0', 'FN:Jane Doe', 'N:Doe;Jane;;;',
            'TEL;TYPE=cell;PREF=1:+15551234', 'EMAIL:jane@example.com', 'NOTE:Größe & Umlaute'));
        const down = serializeVCard(m, '2.1');
        const m2 = parseVCard(down.text);
        assertEq(m2.version, '2.1');
        assertEq(prop(m2, 'N').value, [['Doe'], ['Jane'], [''], [''], ['']]);
        assertEq(prop(m2, 'NOTE').value, 'Größe & Umlaute');
        assertTrue(param(prop(m2, 'TEL'), 'TYPE').values.map(v => v.toUpperCase()).includes('CELL'), 'cell kept');
    });
};
