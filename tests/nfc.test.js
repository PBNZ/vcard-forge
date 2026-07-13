/**
 * @file nfc.test.js
 * @description Tests for the vCard-focused NFC layer: NTAG page layout
 *              invariants, NDEF/TLV construction, size calculators, Flipper
 *              .nfc export format, and removal of non-vCard generators.
 *
 * Copyright (c) PBNZ 2026
 * Licensed under the GNU General Public License v3.
 */

'use strict';

module.exports = function ({ test, assertEq, assertTrue, assertThrows, api }) {
    const { NfcNtag, NTAG_CONFIG, buildNdefRecord, wrapInTlv, buildUriPayload } = api;

    const VCARD = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Tester\r\nEND:VCARD\r\n';

    /** Parse "Page N: AA BB CC DD" lines from an exported .nfc file. */
    function pages(exported) {
        const map = {};
        for (const line of exported.split('\n')) {
            const m = line.match(/^Page (\d+): ((?:[0-9A-F]{2} ?)+)$/);
            if (m) map[Number(m[1])] = m[2].trim().split(' ').map(h => parseInt(h, 16));
        }
        return map;
    }

    test('ntag: BCC0 and BCC1 checksums follow the NFC Forum formula', () => {
        const tag = new NfcNtag('NTAG216');
        tag.generateVcardTag(VCARD);
        const p = pages(tag.exportData());
        const uid = [...p[0].slice(0, 3), ...p[1]];
        assertEq(p[0][3], 0x88 ^ uid[0] ^ uid[1] ^ uid[2], 'BCC0');
        assertEq(p[2][0], uid[3] ^ uid[4] ^ uid[5] ^ uid[6], 'BCC1');
        assertEq(uid[0], 0x04, 'NXP manufacturer byte');
    });

    test('ntag: capability container bytes per tag type', () => {
        const expected = { NTAG213: 0x12, NTAG215: 0x3E, NTAG216: 0x6D };
        for (const [type, size] of Object.entries(expected)) {
            const tag = new NfcNtag(type);
            tag.generateVcardTag(VCARD);
            const p = pages(tag.exportData());
            assertEq(p[3], [0xE1, 0x10, size, 0x00], `CC for ${type}`);
        }
    });

    test('ndef: TLV wrapper uses short length below 0xFF and 3-byte form above', () => {
        const short = wrapInTlv(new Array(10).fill(0xAA));
        assertEq(short.slice(0, 2), [0x03, 10], 'short TLV header');
        assertEq(short[short.length - 1], 0xFE, 'terminator');
        const long = wrapInTlv(new Array(300).fill(0xAA));
        assertEq(long.slice(0, 4), [0x03, 0xFF, 0x01, 0x2C], 'long TLV header (300 = 0x012C)');
    });

    test('ndef: record header switches to 4-byte payload length above 255 bytes', () => {
        const small = buildNdefRecord({ tnf: 0x02, type: [0x61], payload: new Array(10).fill(1) });
        assertTrue((small[0] & 0x10) !== 0, 'SR flag set for short record');
        const big = buildNdefRecord({ tnf: 0x02, type: [0x61], payload: new Array(300).fill(1) });
        assertTrue((big[0] & 0x10) === 0, 'SR flag clear for long record');
        assertEq(big.slice(2, 6), [0, 0, 0x01, 0x2C], '4-byte length');
    });

    test('ndef: URI payload compresses known prefixes', () => {
        assertEq(buildUriPayload('https://www.example.com').payload[0], 0x02, 'https://www. code');
        assertEq(buildUriPayload('https://example.com').payload[0], 0x04, 'https:// code');
        assertEq(buildUriPayload('unknown://x').payload[0], 0x00, 'no prefix');
    });

    test('nfc: vCard tag data starts with a text/vcard MIME record at page 4', () => {
        const tag = new NfcNtag('NTAG216');
        tag.generateVcardTag(VCARD);
        const p = pages(tag.exportData());
        assertEq(p[4][0], 0x03, 'NDEF TLV type');
        // record header: flags, typeLen=10 ('text/vcard')
        assertEq(p[4][3], 10, 'type length');
    });

    test('nfc: dual-record message chains MB/ME flags correctly', () => {
        const tag = new NfcNtag('NTAG216');
        tag.generateDualRecordBusinessCard(VCARD, 'https://example.com/x.vcf');
        const p = pages(tag.exportData());
        const flags1 = p[4][2];
        assertTrue((flags1 & 0x80) !== 0, 'record 1 has MB');
        assertTrue((flags1 & 0x40) === 0, 'record 1 lacks ME');
    });

    test('nfc: size calculators match actual generation limits', () => {
        const single = NfcNtag.calculateSingleRecordSize(VCARD);
        assertTrue(single > VCARD.length, 'single includes overhead');
        const dual = NfcNtag.calculateDualRecordSize(VCARD, 'https://example.com/x.vcf');
        assertTrue(dual > single, 'dual is bigger');
    });

    test('nfc: oversized payload throws a capacity error', () => {
        const tag = new NfcNtag('NTAG213');
        assertThrows(() => tag.generateVcardTag(VCARD + 'X'.repeat(500)), 'too large');
    });

    test('nfc: export carries the Flipper header and per-type Mifare version', () => {
        const tag = new NfcNtag('NTAG215');
        tag.generateVcardTag(VCARD);
        const out = tag.exportData();
        assertTrue(out.includes('Filetype: Flipper NFC device'), 'filetype');
        assertTrue(out.includes('NTAG/Ultralight type: NTAG215'), 'tag type');
        assertTrue(out.includes('Mifare version: 00 04 04 02 01 00 11 03'), '215 version bytes');
        assertTrue(out.includes(`Pages total: ${NTAG_CONFIG.NTAG215.pages}`), 'page count');
    });

    test('nfc: non-vCard generators are removed', () => {
        for (const gone of ['generateUrlTag', 'generateWifiTag', 'generateAarTag', 'generateCustomMimeTag']) {
            assertEq(typeof NfcNtag.prototype[gone], 'undefined', `${gone} removed`);
        }
        assertEq(typeof NfcNtag.prototype.generateVcardTag, 'function', 'vCard generator kept');
        assertEq(typeof NfcNtag.prototype.generateDualRecordBusinessCard, 'function', 'dual generator kept');
    });
};
