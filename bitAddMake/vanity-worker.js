// =============================================
// Bitcoin Vanity Address Worker
// Supports: P2PKH, P2SH, P2WPKH, P2TR
// Matching: prefix, contains
// Control: start, pause, resume, stop
// =============================================

// ===== Error Handler =====
self.onerror = function (msg, url, lineNo, columnNo, error) {
    self.postMessage({
        status: 'error',
        message: `Worker Error: ${msg} at ${lineNo}:${columnNo}`,
        details: error ? error.stack : null
    });
    return false;
};

// ===== Library Loading =====
let bitcoin = null;
let secp = null;
let b32 = null;
let Buffer = null;

async function loadScript(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const code = await resp.text();
        (0, eval)(code);
        return true;
    } catch (e) {
        self.postMessage({ status: 'error', message: `Script load failed (${url}): ${e.message}` });
        return false;
    }
}

async function initLibs() {
    try {
        const base = self.location.href.substring(0, self.location.href.lastIndexOf('/') + 1);

        // Load buffer shim first (this sets self.Buffer or window.Buffer)
        if (!await loadScript(base + 'buffer.js')) return false;
        
        // Load bitcoinjs-lib
        if (!await loadScript(base + 'bitcoinjs-lib.min.js')) return false;
        bitcoin = self.bitcoinjs || self.bitcoin;
        if (!bitcoin) throw new Error('bitcoinjs not found');

        // Grab the Buffer that bitcoinjs sets up, or fallback
        Buffer = self.Buffer || (bitcoin && bitcoin.Buffer) || null;
        if (!Buffer) {
            // Minimal shim if nothing available
            throw new Error('Buffer not found');
        }

        // Load CryptoJS for tagged hash (taproot)
        if (!await loadScript(base + 'crypto-js.min.js')) return false;

        // Load secp256k1 for Taproot
        if (!await loadScript(base + 'secp256k1.js')) return false;
        secp = self.nobleSecp256k1;

        // Load bech32 for Taproot
        if (!await loadScript(base + 'bech32.js')) return false;
        b32 = self.bech32;

        return true;
    } catch (e) {
        self.postMessage({ status: 'error', message: 'initLibs: ' + e.message, details: e.stack });
        return false;
    }
}

// ===== State =====
let isRunning = false;
let isPaused = false;

// ===== Message Handler =====
self.onmessage = async function (e) {
    const { command, pattern, type, matchMode } = e.data;

    if (command === 'start') {
        if (!bitcoin) {
            const ok = await initLibs();
            if (!ok) return;
        }
        isRunning = true;
        isPaused = false;
        startVanitySearch(pattern, type, matchMode || 'prefix');
    } else if (command === 'pause') {
        isPaused = true;
    } else if (command === 'resume') {
        isPaused = false;
    } else if (command === 'stop') {
        isRunning = false;
        isPaused = false;
    }
};

// ===== Address Generation =====
function generateAddress(keyPair, pubkey, type, network) {
    try {
        if (type === 'p2pkh') {
            return bitcoin.payments.p2pkh({ pubkey, network }).address;
        }
        if (type === 'p2sh') {
            return bitcoin.payments.p2sh({
                redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
                network
            }).address;
        }
        if (type === 'p2wpkh') {
            return bitcoin.payments.p2wpkh({ pubkey, network }).address;
        }
        if (type === 'p2tr') {
            return generateTaprootAddress(pubkey, network);
        }
    } catch (err) {
        // Skip on error
    }
    return null;
}

function generateTaprootAddress(pubkey, network) {
    // Try native p2tr first
    try {
        if (bitcoin && bitcoin.payments && bitcoin.payments.p2tr) {
            const internalPubkey = pubkey.slice(1, 33);
            const p2tr = bitcoin.payments.p2tr({ internalPubkey, network });
            return p2tr.address;
        }
    } catch (e) {
        // Fall through to manual
    }

    // Manual Taproot (BIP 341)
    if (!secp || !secp.Point || !b32 || !b32.bech32m || !self.CryptoJS) return null;

    try {
        const P = pubkey.slice(1, 33); // x-only pubkey (32 bytes)
        const P_hex = bufToHex(P);

        // Tagged Hash (TapTweak)
        const tag = 'TapTweak';
        const tagHash = CryptoJS.SHA256(tag).toString();
        const tagBuf = hexToUint8(tagHash);
        
        // Combine: tagHash || tagHash || P
        const combined = new Uint8Array(tagBuf.length + tagBuf.length + 32);
        combined.set(tagBuf, 0);
        combined.set(tagBuf, tagBuf.length);
        const pBytes = (P instanceof Uint8Array) ? P : new Uint8Array(P);
        combined.set(pBytes, tagBuf.length * 2);
        
        const tweakHashHex = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(uint8ToHex(combined))).toString();

        // Q = P + tweak * G
        const P_point = secp.Point.fromHex(P_hex);
        const Q_point = P_point.add(secp.Point.BASE.multiply(BigInt('0x' + tweakHashHex)));
        const Q_compressed = Q_point.toRawBytes(true); // 33 bytes, 02/03 prefix
        const Q_xonly = Q_compressed.slice(1, 33); // 32 bytes x-only

        // Bech32m encode
        const words = b32.bech32m.toWords(Q_xonly);
        return b32.bech32m.encode('bc', [1, ...words]);
    } catch (err) {
        return null;
    }
}

// ===== Utility =====
function bufToHex(buf) {
    const bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return arr;
}

function uint8ToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== Pattern Matching =====
function matchesPattern(address, pattern, type, matchMode) {
    if (type === 'p2pkh' || type === 'p2sh') {
        // Base58: case-sensitive
        if (matchMode === 'prefix') {
            // Address starts with "1" or "3", pattern matches after that
            const offset = 1;
            return address.substring(offset, offset + pattern.length) === pattern;
        } else {
            return address.includes(pattern);
        }
    } else {
        // Bech32/Bech32m: case-insensitive (lowercase)
        const patternLower = pattern.toLowerCase();
        const addrLower = address.toLowerCase();
        if (matchMode === 'prefix') {
            // After "bc1q" or "bc1p" (4 chars)
            return addrLower.substring(4, 4 + patternLower.length) === patternLower;
        } else {
            return addrLower.includes(patternLower);
        }
    }
}

// ===== Main Search Loop =====
function startVanitySearch(pattern, type, matchMode) {
    const network = bitcoin.networks.bitcoin;
    let attempts = 0;
    const startTime = Date.now();

    function searchChunk() {
        if (!isRunning) return;
        if (isPaused) {
            setTimeout(searchChunk, 200);
            return;
        }

        try {
            const chunkStart = Date.now();
            let lastAddr = '';

            while (Date.now() - chunkStart < 100) {
                attempts++;

                // Generate random 32 bytes
                const privKeyBytes = new Uint8Array(32);
                if (self.crypto && self.crypto.getRandomValues) {
                    self.crypto.getRandomValues(privKeyBytes);
                } else {
                    for (let j = 0; j < 32; j += 4) {
                        const r = Math.floor(Math.random() * 0x100000000);
                        privKeyBytes[j] = r & 0xff;
                        privKeyBytes[j + 1] = (r >> 8) & 0xff;
                        privKeyBytes[j + 2] = (r >> 16) & 0xff;
                        privKeyBytes[j + 3] = (r >> 24) & 0xff;
                    }
                }

                // Convert to Buffer that bitcoinjs-lib expects
                const privateKey = Buffer.from(privKeyBytes);

                try {
                    const keyPair = bitcoin.ECPair.fromPrivateKey(privateKey);
                    const pubkey = keyPair.publicKey;
                    const address = generateAddress(keyPair, pubkey, type, network);

                    if (!address) continue;
                    lastAddr = address;

                    if (matchesPattern(address, pattern, type, matchMode)) {
                        isRunning = false;

                        const privHex = uint8ToHex(privKeyBytes);
                        let pubHex;
                        try {
                            pubHex = pubkey.toString('hex');
                        } catch (e) {
                            pubHex = bufToHex(pubkey);
                        }

                        self.postMessage({
                            status: 'success',
                            attempts: attempts,
                            wif: keyPair.toWIF(),
                            address: address,
                            privHex: privHex,
                            pubHex: pubHex,
                            elapsedMs: Date.now() - startTime
                        });
                        return;
                    }
                } catch (err) {
                    // Skip invalid keys silently
                }
            }

            // Progress update
            if (attempts > 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                self.postMessage({
                    status: 'progress',
                    attempts: attempts,
                    speed: elapsed > 0 ? Math.floor(attempts / elapsed) : 0,
                    currentAddr: lastAddr || '생성 중...'
                });
            }

            if (isRunning) {
                setTimeout(searchChunk, 0);
            }
        } catch (globalErr) {
            self.postMessage({
                status: 'error',
                message: 'Search crashed: ' + globalErr.message,
                details: globalErr.stack
            });
            isRunning = false;
        }
    }

    searchChunk();
}
