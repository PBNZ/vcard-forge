/**
 * @file nfc-generator.js
 * @description NFC/NDEF byte-level generation for Flipper Zero .nfc files.
 *              Builds vCard contact tags for NTAG213/215/216: a single
 *              text/vcard MIME record, or a dual-record message (vCard +
 *              hosted .vcf URL) for iOS + Android compatibility.
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

/* ============================================================================
 * SECTION: Utility Helpers
 * ========================================================================= */

/**
 * Helper class providing byte/hex conversion utilities for NFC data generation.
 */
class NfcHelper {
    /**
     * Convert a string to uppercase and trim whitespace.
     * @param {string} val - The string to convert.
     * @returns {string} The uppercased, trimmed string.
     * @throws {Error} If input is not a string.
     */
    upper(val) {
        if (val && typeof val === 'string') {
            return val.toUpperCase().trim();
        }
        throw new Error(`Invalid input: Expected string, got ${typeof val}`);
    }

    /**
     * Generate a random hex string of the given byte size.
     * @param {number} size - Number of hex characters to generate.
     * @returns {string} Random hex string.
     */
    randomHex(size) {
        return [...Array(size)]
            .map(() => Math.floor(Math.random() * 16).toString(16))
            .join('');
    }

    /**
     * Convert a hex string to a byte array.
     * @param {string} hex - The hex string (e.g. "0A1B2C").
     * @returns {number[]} Array of byte values.
     * @throws {Error} If input is not a valid hex string.
     */
    hexStrToByteArray(hex) {
        if (!hex || typeof hex !== 'string') {
            throw new Error('Invalid hex string');
        }
        return hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16));
    }

    /**
     * Convert a byte array to a space-separated uppercase hex string.
     * @param {number[]} buffer - Array of byte values.
     * @returns {string} Space-separated hex string (e.g. "0A 1B 2C").
     */
    byteArrayToHexStrSplit(buffer) {
        return buffer
            .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
            .join(' ');
    }

    /**
     * Convert a UTF-8 string to an array of byte values.
     * @param {string} str - The string to encode.
     * @returns {number[]} Array of byte values.
     */
    stringToBytes(str) {
        const encoder = new TextEncoder();
        return Array.from(encoder.encode(str));
    }
}

/* ============================================================================
 * SECTION: NTAG Configuration Constants
 * ========================================================================= */

/**
 * Configuration data for each supported NTAG type.
 * @type {Object<string, {pages: number, userDataStart: number, userDataEnd: number, cc: number[], mifareVersion: string, endPages: Object<number, number[]>}>}
 */
const NTAG_CONFIG = {
    'NTAG213': {
        pages: 45,
        userDataStart: 4,
        userDataEnd: 39,
        ndefCapacity: 144,  // (39 - 4 + 1) * 4 = 144 bytes, ~137 usable after TLV
        cc: [0xE1, 0x10, 0x12, 0x00],
        mifareVersion: '00 04 04 02 01 00 0F 03',
        endPages: {
            41: [0x00, 0x00, 0x00, 0xBD],
            42: [0x04, 0x00, 0x00, 0xFF],
            43: [0x00, 0x05, 0x00, 0x00],
            44: [0xFF, 0xFF, 0xFF, 0xFF]
        }
    },
    'NTAG215': {
        pages: 135,
        userDataStart: 4,
        userDataEnd: 129,
        ndefCapacity: 504,  // (129 - 4 + 1) * 4 = 504 bytes
        cc: [0xE1, 0x10, 0x3E, 0x00],
        mifareVersion: '00 04 04 02 01 00 11 03',
        endPages: {
            130: [0x00, 0x00, 0x00, 0xBD],
            131: [0x04, 0x00, 0x00, 0xFF],
            132: [0x00, 0x05, 0x00, 0x00],
            133: [0xFF, 0xFF, 0xFF, 0xFF],
            134: [0x00, 0x00, 0x00, 0x00]
        }
    },
    'NTAG216': {
        pages: 231,
        userDataStart: 4,
        userDataEnd: 225,
        ndefCapacity: 888,  // (225 - 4 + 1) * 4 = 888 bytes
        cc: [0xE1, 0x10, 0x6D, 0x00],
        mifareVersion: '00 04 04 02 01 00 13 03',
        endPages: {
            227: [0x00, 0x00, 0x00, 0xBD],
            228: [0x04, 0x00, 0x00, 0xFF],
            229: [0x00, 0x05, 0x00, 0x00],
            230: [0xFF, 0xFF, 0xFF, 0xFF]
        }
    }
};

/**
 * NDEF URI prefix codes as defined by the NFC Forum URI Record Type Definition.
 * @type {Object<string, number>}
 */
const URI_PREFIXES = {
    'http://www.': 0x01,
    'https://www.': 0x02,
    'http://': 0x03,
    'https://': 0x04,
    'tel:': 0x05,
    'mailto:': 0x06,
    'ftp://': 0x0D,
    'ftps://': 0x0E,
    'geo:': 0x1F
};

/* ============================================================================
 * SECTION: NDEF Record Builders
 * ========================================================================= */

/**
 * Build a single NDEF record byte array.
 *
 * @param {Object} options - Record options.
 * @param {number} options.tnf - Type Name Format (3-bit value, 0x01-0x06).
 * @param {number[]} options.type - Type field bytes.
 * @param {number[]} options.payload - Payload bytes.
 * @param {boolean} [options.mb=true] - Message Begin flag.
 * @param {boolean} [options.me=true] - Message End flag.
 * @returns {number[]} The complete NDEF record as a byte array.
 */
function buildNdefRecord({ tnf, type, payload, mb = true, me = true }) {
    const typeLength = type.length;
    const payloadLength = payload.length;
    const isShortRecord = payloadLength < 256;

    // Build the flag byte: MB | ME | CF=0 | SR | IL=0 | TNF
    let flags = (tnf & 0x07);
    if (mb) flags |= 0x80;
    if (me) flags |= 0x40;
    if (isShortRecord) flags |= 0x10;

    const record = [flags, typeLength];

    if (isShortRecord) {
        record.push(payloadLength & 0xFF);
    } else {
        record.push(
            (payloadLength >>> 24) & 0xFF,
            (payloadLength >>> 16) & 0xFF,
            (payloadLength >>> 8) & 0xFF,
            payloadLength & 0xFF
        );
    }

    record.push(...type, ...payload);
    return record;
}

/**
 * Wrap NDEF record(s) in a TLV envelope for writing to an NTAG.
 * Produces: [0x03, length, ...records, 0xFE]
 *
 * @param {number[]} ndefMessageBytes - The raw NDEF message bytes (all records concatenated).
 * @returns {number[]} TLV-wrapped bytes ready to write starting at page 4.
 */
function wrapInTlv(ndefMessageBytes) {
    const totalLength = ndefMessageBytes.length;
    const tlv = [0x03]; // NDEF Message TLV type

    if (totalLength < 0xFF) {
        tlv.push(totalLength);
    } else {
        tlv.push(0xFF, (totalLength >> 8) & 0xFF, totalLength & 0xFF);
    }

    tlv.push(...ndefMessageBytes);
    tlv.push(0xFE); // Terminator TLV
    return tlv;
}

/**
 * Build a URI NDEF record payload with efficient prefix compression.
 *
 * @param {string} uri - The full URI string (e.g. "https://example.com").
 * @returns {{payload: number[], prefixCode: number}} The payload bytes and matched prefix code.
 */
function buildUriPayload(uri) {
    const helper = new NfcHelper();
    let prefixCode = 0x00;
    let remaining = uri;

    for (const [prefix, code] of Object.entries(URI_PREFIXES)) {
        if (uri.toLowerCase().startsWith(prefix)) {
            prefixCode = code;
            remaining = uri.slice(prefix.length);
            break;
        }
    }

    return {
        payload: [prefixCode, ...helper.stringToBytes(remaining)],
        prefixCode
    };
}

/* ============================================================================
 * SECTION: NfcNtag Class — Tag Generation
 * ========================================================================= */

/**
 * Generates a complete Flipper Zero .nfc file for NTAG213/215/216 tags.
 * Handles UID generation, page layout, NDEF message writing, and file export.
 */
class NfcNtag {
    /**
     * Create a new NFC tag generator.
     * @param {string} [deviceType='NTAG215'] - The NTAG type: 'NTAG213', 'NTAG215', or 'NTAG216'.
     * @throws {Error} If deviceType is not a valid NTAG type.
     */
    constructor(deviceType = 'NTAG215') {
        this.helper = new NfcHelper();
        this.deviceType = this._validateDeviceType(deviceType);
        this.config = NTAG_CONFIG[this.deviceType];
        this.pages = Array.from(
            { length: this.config.pages },
            () => Array(4).fill(0)
        );
        this.uid = this._generateUid();
    }

    /**
     * Get the maximum NDEF data capacity in bytes for this tag type.
     * This is the raw user data area size (pages 4 through userDataEnd × 4 bytes).
     * Actual usable capacity is slightly less due to TLV overhead (2-4 bytes header + 1 byte terminator).
     * @returns {number} Maximum NDEF capacity in bytes.
     */
    getMaxNdefCapacity() {
        return this.config.ndefCapacity;
    }

    /* ------------------------------------------------------------------
     * Private: Validation & UID
     * ---------------------------------------------------------------- */

    /**
     * Validate and normalise the device type string.
     * @param {string} type - Device type to validate.
     * @returns {string} Normalised device type.
     * @throws {Error} If type is not supported.
     * @private
     */
    _validateDeviceType(type) {
        const normalised = this.helper.upper(type);
        if (!(normalised in NTAG_CONFIG)) {
            throw new Error(`Invalid device type: ${type}. Must be one of: ${Object.keys(NTAG_CONFIG).join(', ')}`);
        }
        return normalised;
    }

    /**
     * Generate a random 7-byte UID with NXP manufacturer prefix (0x04).
     * @returns {number[]} 7-byte UID array.
     * @private
     */
    _generateUid() {
        const uid0 = 0x04; // NXP manufacturer code
        const rest = this.helper.hexStrToByteArray(this.helper.randomHex(12));
        return [uid0, ...rest];
    }

    /* ------------------------------------------------------------------
     * Private: Page Setup
     * ---------------------------------------------------------------- */

    /**
     * Write UID, BCC, internal bytes, and capability container to pages 0-3.
     * BCC0 = 0x88 XOR UID0 XOR UID1 XOR UID2
     * BCC1 = UID3 XOR UID4 XOR UID5 XOR UID6
     * @private
     */
    _writeHeaderPages() {
        const uid = this.uid;

        // Page 0: UID0, UID1, UID2, BCC0
        this.pages[0][0] = uid[0];
        this.pages[0][1] = uid[1];
        this.pages[0][2] = uid[2];
        this.pages[0][3] = 0x88 ^ uid[0] ^ uid[1] ^ uid[2]; // BCC0 (fixed: was missing 0x88)

        // Page 1: UID3, UID4, UID5, UID6
        this.pages[1][0] = uid[3];
        this.pages[1][1] = uid[4];
        this.pages[1][2] = uid[5];
        this.pages[1][3] = uid[6];

        // Page 2: BCC1, Internal, Lock0, Lock1
        this.pages[2][0] = uid[3] ^ uid[4] ^ uid[5] ^ uid[6]; // BCC1
        this.pages[2][1] = 0x48; // Internal byte
        this.pages[2][2] = 0x00; // Lock0
        this.pages[2][3] = 0x00; // Lock1

        // Page 3: Capability Container (per tag type)
        this.pages[3] = [...this.config.cc];
    }

    /**
     * Write end/tail pages with configuration and lock bytes per tag type.
     * @private
     */
    _writeEndPages() {
        const endPages = this.config.endPages;
        for (const [page, data] of Object.entries(endPages)) {
            this.pages[parseInt(page, 10)] = [...data];
        }
    }

    /**
     * Write an NDEF TLV-wrapped message to the tag data pages starting at page 4.
     * @param {number[]} tlvData - Complete TLV-wrapped NDEF data.
     * @throws {Error} If the data exceeds the tag's capacity.
     * @private
     */
    _writeNdefData(tlvData) {
        let pageIndex = 4;
        let byteIndex = 0;

        for (let i = 0; i < tlvData.length; i++) {
            if (pageIndex >= this.config.userDataEnd + 1) {
                throw new Error(
                    `NDEF message too large for ${this.deviceType}. ` +
                    `Data: ${tlvData.length} bytes, Capacity: ${this.config.ndefCapacity} bytes.`
                );
            }
            this.pages[pageIndex][byteIndex] = tlvData[i];
            byteIndex++;
            if (byteIndex === 4) {
                byteIndex = 0;
                pageIndex++;
            }
        }
        // Fill remainder of last partial page with zeros
        while (byteIndex > 0 && byteIndex < 4) {
            this.pages[pageIndex][byteIndex] = 0x00;
            byteIndex++;
        }
    }

    /* ------------------------------------------------------------------
     * Public: Tag Generation Methods
     * ---------------------------------------------------------------- */

    /**
     * Generate a vCard NFC tag (single MIME record).
     * @param {string} vcardData - The full vCard text (BEGIN:VCARD ... END:VCARD).
     */
    generateVcardTag(vcardData) {
        this.uid = this._generateUid();
        this._writeHeaderPages();

        const helper = new NfcHelper();
        const record = buildNdefRecord({
            tnf: 0x02,  // Media type
            type: helper.stringToBytes('text/vcard'),
            payload: helper.stringToBytes(vcardData),
            mb: true,
            me: true
        });
        this._writeNdefData(wrapInTlv(record));
        this._writeEndPages();
    }

    /**
     * Generate a dual-record NFC tag for iOS-compatible business cards.
     * Record 1: text/vcard MIME record (for Android direct reading).
     * Record 2: URI record pointing to hosted VCF file (for iOS compatibility).
     *
     * @param {string} vcardData - The full vCard text.
     * @param {string} vcfUrl - The URL to the hosted .vcf file.
     */
    generateDualRecordBusinessCard(vcardData, vcfUrl) {
        this.uid = this._generateUid();
        this._writeHeaderPages();

        const helper = new NfcHelper();

        // Record 1: vCard MIME (MB=1, ME=0)
        const vcardRecord = buildNdefRecord({
            tnf: 0x02,
            type: helper.stringToBytes('text/vcard'),
            payload: helper.stringToBytes(vcardData),
            mb: true,
            me: false
        });

        // Record 2: URL (MB=0, ME=1)
        const { payload: uriPayload } = buildUriPayload(vcfUrl);
        const urlRecord = buildNdefRecord({
            tnf: 0x01,
            type: [0x55],
            payload: uriPayload,
            mb: false,
            me: true
        });

        const fullMessage = [...vcardRecord, ...urlRecord];
        this._writeNdefData(wrapInTlv(fullMessage));
        this._writeEndPages();
    }

    /**
     * Calculate bytes needed for a dual-record business card NDEF message.
     * Useful for checking capacity before generation.
     *
     * @param {string} vcardData - The vCard text content.
     * @param {string} vcfUrl - The URL to the hosted VCF file.
     * @returns {number} Total bytes including TLV wrapper.
     */
    static calculateDualRecordSize(vcardData, vcfUrl) {
        const helper = new NfcHelper();
        const vcardPayload = helper.stringToBytes(vcardData);
        const vcardType = helper.stringToBytes('text/vcard');
        const { payload: uriPayload } = buildUriPayload(vcfUrl);

        // Record 1
        const vcardRecordLen = 1 + 1 + (vcardPayload.length < 256 ? 1 : 4) + vcardType.length + vcardPayload.length;
        // Record 2
        const urlRecordLen = 1 + 1 + (uriPayload.length < 256 ? 1 : 4) + 1 + uriPayload.length;

        const messageLen = vcardRecordLen + urlRecordLen;
        // TLV: 1 byte type + (1 or 3 bytes length) + message + 1 byte terminator
        const tlvOverhead = 1 + (messageLen < 0xFF ? 1 : 3) + 1;

        return messageLen + tlvOverhead;
    }

    /**
     * Calculate bytes needed for a single-record MIME NDEF message.
     * Useful for checking capacity before generation.
     *
     * @param {string} payloadData - The payload data string.
     * @param {string} mimeType - The MIME type string (e.g. 'text/vcard').
     * @returns {number} Total bytes including TLV wrapper.
     */
    static calculateSingleRecordSize(payloadData, mimeType = 'text/vcard') {
        const helper = new NfcHelper();
        const payloadBytes = helper.stringToBytes(payloadData);
        const typeBytes = helper.stringToBytes(mimeType);

        // Record length: 1 (flags) + 1 (type len) + (1 or 4) (payload len) + type len + payload len
        const recordLen = 1 + 1 + (payloadBytes.length < 256 ? 1 : 4) + typeBytes.length + payloadBytes.length;

        // TLV overhead: 1 (NDEF type) + (1 or 3) (length) + 1 (TerminatorFE)
        const tlvOverhead = 1 + (recordLen < 0xFF ? 1 : 3) + 1;

        return recordLen + tlvOverhead;
    }

    /* ------------------------------------------------------------------
     * Public: Export
     * ---------------------------------------------------------------- */

    /**
     * Generate the Flipper Zero .nfc file content as a string.
     * @returns {string} Complete .nfc file content.
     */
    exportData() {
        const header = this._generateFileHeader();
        const pages = this.pages
            .map((page, index) =>
                `Page ${index}: ${page.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`
            )
            .join('\n');
        return header + '\n' + pages + '\nFailed authentication attempts: 0\n';
    }

    /**
     * Generate the Flipper .nfc file header string.
     * @returns {string} The header portion of the .nfc file.
     * @private
     */
    _generateFileHeader() {
        return `Filetype: Flipper NFC device
Version: 4
# Device type can be ISO14443-3A, ISO14443-3B, ISO14443-4A, ISO14443-4B, ISO15693-3, FeliCa, NTAG/Ultralight, Mifare Classic, Mifare Plus, Mifare DESFire, SLIX, ST25TB, EMV
Device type: NTAG/Ultralight
# UID is common for all formats
UID: ${this.helper.byteArrayToHexStrSplit(this.uid)}
# ISO14443-3A specific data
ATQA: 00 44
SAK: 00
# NTAG/Ultralight specific data
Data format version: 2
NTAG/Ultralight type: ${this.deviceType}
Signature: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
Mifare version: ${this.config.mifareVersion}
Counter 0: 0
Tearing 0: 00
Counter 1: 0
Tearing 1: 00
Counter 2: 0
Tearing 2: 00
Pages total: ${this.config.pages}
Pages read: ${this.config.pages}`;
    }
}
