(function () {
    'use strict';

    // ========== Constants ==========
    const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const BASE58_FORBIDDEN = ['0', 'O', 'I', 'l'];

    const TYPE_CONFIG = {
        p2pkh: {
            label: 'Legacy (P2PKH)', prefix: '1', charset: BASE58_CHARS, charsetSize: 58,
            charsetName: 'Base58', caseSensitive: true, offsetStart: 1
        },
        p2sh: {
            label: 'P2SH', prefix: '3', charset: BASE58_CHARS, charsetSize: 58,
            charsetName: 'Base58', caseSensitive: true, offsetStart: 1
        },
        p2wpkh: {
            label: 'Native SegWit (P2WPKH)', prefix: 'bc1q', charset: BECH32_CHARS, charsetSize: 32,
            charsetName: 'Bech32', caseSensitive: false, offsetStart: 4
        },
        p2tr: {
            label: 'Taproot (P2TR)', prefix: 'bc1p', charset: BECH32_CHARS, charsetSize: 32,
            charsetName: 'Bech32m', caseSensitive: false, offsetStart: 4
        }
    };

    const DIFFICULTY_LEVELS = [
        { max: 32, label: '매우 쉬움', cls: 'very-easy', time: '수 초' },
        { max: 1024, label: '쉬움', cls: 'easy', time: '수 초~1분' },
        { max: 100000, label: '보통', cls: 'medium', time: '수 분' },
        { max: 10000000, label: '어려움', cls: 'hard', time: '수십 분' },
        { max: 1000000000, label: '매우 어려움', cls: 'very-hard', time: '수 시간~수 일' },
        { max: Infinity, label: '비현실적', cls: 'impossible', time: '사실상 불가능' }
    ];

    // ========== State ==========
    let selectedType = 'p2pkh';
    let matchMode = 'prefix';
    let vanityWorker = null;
    let searchStartTime = null;
    let elapsedTimer = null;
    let isPaused = false;
    let resultData = null;

    // ========== DOM References ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        typeGrid: $('#type-grid'),
        patternInput: $('#pattern-input'),
        prefixLabel: $('#prefix-label'),
        patternLength: $('#pattern-length'),
        inputFeedback: $('#input-feedback'),
        charsetHelp: $('#charset-help'),
        diffBadge: $('#diff-badge'),
        estAttempts: $('#est-attempts'),
        estTime: $('#est-time'),
        btnStart: $('#btn-start'),
        btnPause: $('#btn-pause'),
        btnResume: $('#btn-resume'),
        btnStop: $('#btn-stop'),
        progressSection: $('#progress-section'),
        statusBadge: $('#status-badge'),
        searchProgressBar: $('#search-progress-bar'),
        liveAttempts: $('#live-attempts'),
        liveSpeed: $('#live-speed'),
        liveElapsed: $('#live-elapsed'),
        liveCurrentAddr: $('#live-current-addr'),
        resultSection: $('#result-section'),
        resultAddress: $('#result-address'),
        resultType: $('#result-type'),
        resultAttempts: $('#result-attempts'),
        resultElapsed: $('#result-elapsed'),
        resultSpeed: $('#result-speed'),
        btnShowPrivkey: $('#btn-show-privkey'),
        privkeyDetails: $('#privkey-details'),
        resultWif: $('#result-wif'),
        resultPrivhex: $('#result-privhex'),
        resultPubhex: $('#result-pubhex'),
        btnDownloadTxt: $('#btn-download-txt'),
        btnDownloadJson: $('#btn-download-json'),
        btnClear: $('#btn-clear'),
        modal: $('#privkey-modal'),
        modalConfirm: $('#modal-confirm'),
        modalCancel: $('#modal-cancel')
    };

    // ========== Type Selection ==========
    dom.typeGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.type-card');
        if (!card) return;
        $$('.type-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedType = card.dataset.type;
        updatePrefixLabel();
        validateInput();
        updateDifficulty();
    });

    function updatePrefixLabel() {
        const cfg = TYPE_CONFIG[selectedType];
        dom.prefixLabel.textContent = cfg.prefix;

        if (cfg.charsetName === 'Base58') {
            dom.charsetHelp.textContent = `허용 문자: 1-9, A-H, J-N, P-Z, a-k, m-z (${cfg.charsetName})`;
        } else {
            dom.charsetHelp.textContent = `허용 문자: q, p, z, r, y, 9, x, 8, g, f, 2, t, v, d, w, 0, s, 3, j, n, 5, 4, k, h, c, e, 6, m, u, a, 7, l (${cfg.charsetName})`;
        }

        // For contains mode, hide the prefix label
        if (matchMode === 'contains') {
            dom.prefixLabel.textContent = '🔍';
        }
    }

    // ========== Match Mode ==========
    $$('.match-radio').forEach(radio => {
        radio.addEventListener('click', () => {
            $$('.match-radio').forEach(r => r.classList.remove('selected'));
            radio.classList.add('selected');
            matchMode = radio.dataset.mode;
            const input = radio.querySelector('input');
            if (input) input.checked = true;
            updatePrefixLabel();
            validateInput();
            updateDifficulty();
        });
    });

    // ========== Input Validation ==========
    dom.patternInput.addEventListener('input', () => {
        let val = dom.patternInput.value;
        const cfg = TYPE_CONFIG[selectedType];

        // Bech32: normalize to lowercase
        if (!cfg.caseSensitive) {
            val = val.toLowerCase();
            dom.patternInput.value = val;
        }

        // Remove spaces
        val = val.replace(/\s/g, '');
        dom.patternInput.value = val;

        dom.patternLength.textContent = val.length;
        validateInput();
        updateDifficulty();
    });

    function validateInput() {
        const val = dom.patternInput.value;
        const cfg = TYPE_CONFIG[selectedType];

        if (!val) {
            dom.inputFeedback.textContent = '';
            dom.inputFeedback.className = 'input-feedback';
            return false;
        }

        // Check for forbidden chars
        for (const ch of val) {
            if (!cfg.charset.includes(ch)) {
                if (cfg.charsetName === 'Base58' && BASE58_FORBIDDEN.includes(ch)) {
                    dom.inputFeedback.textContent = `❌ '${ch}' 문자는 Base58에서 사용할 수 없습니다. (0, O, I, l 제외)`;
                } else {
                    dom.inputFeedback.textContent = `❌ '${ch}' 문자는 ${cfg.charsetName} 주소에서 사용할 수 없습니다.`;
                }
                dom.inputFeedback.className = 'input-feedback error';
                return false;
            }
        }

        // Check prefix conflict
        if (matchMode === 'prefix') {
            const fixedPrefix = cfg.prefix;
            // For bech32 types, check if user tries to set conflicting prefix
            if (selectedType === 'p2wpkh' && val.startsWith('bc1p')) {
                dom.inputFeedback.textContent = '❌ Bech32 주소에 Taproot 접두사(bc1p)를 사용할 수 없습니다.';
                dom.inputFeedback.className = 'input-feedback error';
                return false;
            }
            if (selectedType === 'p2tr' && val.startsWith('bc1q')) {
                dom.inputFeedback.textContent = '❌ Taproot 주소에 Bech32 접두사(bc1q)를 사용할 수 없습니다.';
                dom.inputFeedback.className = 'input-feedback error';
                return false;
            }
        }

        // Length warning
        if (val.length > 5) {
            dom.inputFeedback.textContent = '⚠️ 패턴이 깁니다. 탐색 시간이 매우 길어질 수 있습니다.';
            dom.inputFeedback.className = 'input-feedback error';
            return true; // still valid
        }

        dom.inputFeedback.textContent = `✅ 유효한 패턴입니다.`;
        dom.inputFeedback.className = 'input-feedback valid';
        return true;
    }

    // ========== Difficulty Calculation ==========
    function updateDifficulty() {
        const val = dom.patternInput.value;
        if (!val) {
            dom.diffBadge.textContent = '입력 대기';
            dom.diffBadge.className = 'diff-badge';
            dom.estAttempts.textContent = '—';
            dom.estTime.textContent = '—';
            return;
        }

        const cfg = TYPE_CONFIG[selectedType];
        const len = val.length;

        // For contains match: multiply by address length factor (roughly)
        let expectedAttempts;
        if (matchMode === 'prefix') {
            expectedAttempts = Math.pow(cfg.charsetSize, len);
        } else {
            // Contains is easier: approximately charset^len / addressLength
            const addrLen = cfg.charsetName === 'Base58' ? 30 : 38;
            expectedAttempts = Math.pow(cfg.charsetSize, len) / addrLen;
        }

        // Display
        dom.estAttempts.textContent = formatNumber(Math.round(expectedAttempts));

        // Estimate speed: ~100,000 keys/s for browser (conservative)
        const estSpeed = 100000;
        const estSeconds = expectedAttempts / estSpeed;
        dom.estTime.textContent = formatTime(estSeconds);

        // Difficulty level
        const level = DIFFICULTY_LEVELS.find(l => expectedAttempts <= l.max);
        dom.diffBadge.textContent = level.label;
        dom.diffBadge.className = `diff-badge ${level.cls}`;
    }

    function formatNumber(n) {
        if (n >= 1e12) return (n / 1e12).toFixed(1) + '조';
        if (n >= 1e8) return (n / 1e8).toFixed(1) + '억';
        if (n >= 1e4) return (n / 1e4).toFixed(1) + '만';
        return n.toLocaleString();
    }

    function formatTime(seconds) {
        if (seconds < 1) return '< 1초';
        if (seconds < 60) return Math.ceil(seconds) + '초';
        if (seconds < 3600) return Math.round(seconds / 60) + '분';
        if (seconds < 86400) return (seconds / 3600).toFixed(1) + '시간';
        if (seconds < 31536000) return Math.round(seconds / 86400) + '일';
        return '수 년 이상';
    }

    function formatElapsed(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 60) return s + '초';
        const m = Math.floor(s / 60);
        const remainS = s % 60;
        if (m < 60) return m + '분 ' + remainS + '초';
        const h = Math.floor(m / 60);
        const remainM = m % 60;
        return h + '시간 ' + remainM + '분';
    }

    // ========== Worker Control ==========
    dom.btnStart.addEventListener('click', startSearch);
    dom.btnPause.addEventListener('click', pauseSearch);
    dom.btnResume.addEventListener('click', resumeSearch);
    dom.btnStop.addEventListener('click', stopSearch);

    function startSearch() {
        const pattern = dom.patternInput.value.trim();
        if (!pattern) {
            showFeedback('패턴을 입력하세요.', true);
            return;
        }
        if (!validateInput()) return;

        // Reset state
        resultData = null;
        isPaused = false;
        searchStartTime = Date.now();

        // UI
        dom.progressSection.classList.remove('hidden');
        dom.resultSection.classList.add('hidden');
        dom.btnStart.classList.add('hidden');
        dom.btnPause.classList.remove('hidden');
        dom.btnStop.classList.remove('hidden');
        dom.btnResume.classList.add('hidden');
        dom.statusBadge.textContent = '탐색 중';
        dom.statusBadge.className = 'status-badge running';
        dom.liveAttempts.textContent = '0';
        dom.liveSpeed.textContent = '0 keys/s';
        dom.liveElapsed.textContent = '0초';
        dom.liveCurrentAddr.textContent = '시작 중...';
        dom.searchProgressBar.style.width = '0%';

        // Elapsed timer
        if (elapsedTimer) clearInterval(elapsedTimer);
        elapsedTimer = setInterval(() => {
            if (!isPaused && searchStartTime) {
                dom.liveElapsed.textContent = formatElapsed(Date.now() - searchStartTime);
            }
        }, 1000);

        // Start Worker
        if (vanityWorker) vanityWorker.terminate();
        vanityWorker = new Worker('vanity-worker.js');

        vanityWorker.onmessage = function (e) {
            const data = e.data;
            if (data.status === 'progress') {
                dom.liveAttempts.textContent = data.attempts.toLocaleString();
                dom.liveSpeed.textContent = data.speed.toLocaleString() + ' keys/s';
                dom.liveCurrentAddr.textContent = data.currentAddr;
                // Animate progress bar loosely
                const pct = Math.min(95, Math.log10(data.attempts + 1) * 15);
                dom.searchProgressBar.style.width = pct + '%';
            } else if (data.status === 'success') {
                onSearchSuccess(data);
            } else if (data.status === 'error') {
                console.error('Worker Error:', data.message, data.details);
                dom.liveCurrentAddr.textContent = 'Error: ' + data.message;
                stopSearch();
            }
        };

        vanityWorker.postMessage({
            command: 'start',
            pattern: pattern,
            type: selectedType,
            matchMode: matchMode
        });

        dom.progressSection.scrollIntoView({ behavior: 'smooth' });
    }

    function pauseSearch() {
        if (vanityWorker) {
            vanityWorker.postMessage({ command: 'pause' });
        }
        isPaused = true;
        dom.btnPause.classList.add('hidden');
        dom.btnResume.classList.remove('hidden');
        dom.statusBadge.textContent = '일시정지';
        dom.statusBadge.className = 'status-badge paused';
    }

    function resumeSearch() {
        if (vanityWorker) {
            vanityWorker.postMessage({ command: 'resume' });
        }
        isPaused = false;
        dom.btnResume.classList.add('hidden');
        dom.btnPause.classList.remove('hidden');
        dom.statusBadge.textContent = '탐색 중';
        dom.statusBadge.className = 'status-badge running';
    }

    function stopSearch() {
        if (vanityWorker) {
            vanityWorker.postMessage({ command: 'stop' });
            vanityWorker.terminate();
            vanityWorker = null;
        }
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
        isPaused = false;
        dom.btnStart.classList.remove('hidden');
        dom.btnPause.classList.add('hidden');
        dom.btnResume.classList.add('hidden');
        dom.btnStop.classList.add('hidden');
    }

    function onSearchSuccess(data) {
        stopSearch();
        const elapsedMs = Date.now() - searchStartTime;

        resultData = {
            network: 'bitcoin-mainnet',
            addressType: selectedType,
            address: data.address,
            privateKeyWIF: data.wif,
            privateKeyHex: data.privHex,
            publicKeyHex: data.pubHex,
            attempts: data.attempts,
            elapsedMs: elapsedMs,
            avgSpeed: Math.floor(data.attempts / (elapsedMs / 1000)),
            generatedAt: new Date().toISOString(),
            matchMode: matchMode,
            pattern: dom.patternInput.value
        };

        // Fill result UI
        dom.resultAddress.textContent = resultData.address;
        dom.resultType.textContent = TYPE_CONFIG[selectedType].label;
        dom.resultAttempts.textContent = resultData.attempts.toLocaleString() + '회';
        dom.resultElapsed.textContent = formatElapsed(elapsedMs);
        dom.resultSpeed.textContent = resultData.avgSpeed.toLocaleString() + ' keys/s';
        dom.resultWif.textContent = resultData.privateKeyWIF;
        dom.resultPrivhex.textContent = resultData.privateKeyHex;
        dom.resultPubhex.textContent = resultData.publicKeyHex;

        // Hide private key details initially
        dom.privkeyDetails.classList.add('hidden');
        dom.btnShowPrivkey.classList.remove('hidden');

        // Update progress section
        dom.searchProgressBar.style.width = '100%';
        dom.statusBadge.textContent = '완료';
        dom.statusBadge.className = 'status-badge';
        dom.statusBadge.style.background = 'rgba(0,214,143,0.15)';
        dom.statusBadge.style.color = '#00d68f';

        dom.resultSection.classList.remove('hidden');
        dom.resultSection.scrollIntoView({ behavior: 'smooth' });
    }

    function showFeedback(msg, isError) {
        dom.inputFeedback.textContent = (isError ? '❌ ' : '✅ ') + msg;
        dom.inputFeedback.className = 'input-feedback ' + (isError ? 'error' : 'valid');
    }

    // ========== Private Key Modal ==========
    dom.btnShowPrivkey.addEventListener('click', () => {
        dom.modal.classList.remove('hidden');
    });

    dom.modalConfirm.addEventListener('click', () => {
        dom.modal.classList.add('hidden');
        dom.privkeyDetails.classList.remove('hidden');
        dom.btnShowPrivkey.classList.add('hidden');
    });

    dom.modalCancel.addEventListener('click', () => {
        dom.modal.classList.add('hidden');
    });

    dom.modal.addEventListener('click', (e) => {
        if (e.target === dom.modal) {
            dom.modal.classList.add('hidden');
        }
    });

    // ========== Download ==========
    dom.btnDownloadTxt.addEventListener('click', () => {
        if (!resultData) return;
        const txt = [
            'Bitcoin Vanity Address Generator - 결과',
            '=' .repeat(50),
            `생성 시각: ${resultData.generatedAt}`,
            `주소 유형: ${TYPE_CONFIG[resultData.addressType].label}`,
            `패턴: ${resultData.pattern} (${resultData.matchMode})`,
            '',
            `주소: ${resultData.address}`,
            `개인키 (WIF): ${resultData.privateKeyWIF}`,
            `개인키 (Hex): ${resultData.privateKeyHex}`,
            `공개키 (Hex): ${resultData.publicKeyHex}`,
            '',
            `총 시도: ${resultData.attempts.toLocaleString()}`,
            `소요 시간: ${formatElapsed(resultData.elapsedMs)}`,
            `평균 속도: ${resultData.avgSpeed.toLocaleString()} keys/s`,
            '',
            '⚠️ 이 개인키를 절대 타인과 공유하지 마세요.',
            '⚠️ 이 키를 가진 사람은 해당 주소의 자산을 통제할 수 있습니다.'
        ].join('\n');

        downloadFile(txt, `vanity-${resultData.address.substring(0, 10)}.txt`, 'text/plain');
    });

    dom.btnDownloadJson.addEventListener('click', () => {
        if (!resultData) return;
        const json = JSON.stringify(resultData, null, 2);
        downloadFile(json, `vanity-${resultData.address.substring(0, 10)}.json`, 'application/json');
    });

    function downloadFile(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ========== Memory Clear ==========
    dom.btnClear.addEventListener('click', () => {
        resultData = null;
        dom.resultSection.classList.add('hidden');
        dom.progressSection.classList.add('hidden');
        dom.resultAddress.textContent = '';
        dom.resultWif.textContent = '';
        dom.resultPrivhex.textContent = '';
        dom.resultPubhex.textContent = '';
        dom.privkeyDetails.classList.add('hidden');
        dom.btnShowPrivkey.classList.remove('hidden');
        dom.patternInput.value = '';
        dom.patternLength.textContent = '0';
        dom.inputFeedback.textContent = '';
        dom.inputFeedback.className = 'input-feedback';
        updateDifficulty();
        stopSearch();
    });

    // ========== Copy Handlers ==========
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-btn');
        if (!btn) return;
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId);
        if (!el) return;
        const txt = el.textContent;
        if (txt) {
            navigator.clipboard.writeText(txt).then(() => {
                const old = btn.textContent;
                btn.textContent = '✓ 복사됨';
                btn.style.color = '#00d68f';
                setTimeout(() => {
                    btn.textContent = old;
                    btn.style.color = '';
                }, 1500);
            });
        }
    });

    // ========== Init ==========
    updatePrefixLabel();
    updateDifficulty();

})();
