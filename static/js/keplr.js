/**
 * Keplr Wallet Integration for TIA Gather
 *
 * Handles wallet connection, balance fetching, and transaction signing
 * for Celestia Mocha Testnet.
 */

// Celestia Mocha Testnet configuration
const CELESTIA_TESTNET = {
    chainId: 'mocha-4',
    chainName: 'Celestia Mocha Testnet',
    rpc: 'https://rpc-mocha.pops.one',
    rest: 'https://api-mocha.pops.one',
    bip44: {
        coinType: 118,
    },
    bech32Config: {
        bech32PrefixAccAddr: 'celestia',
        bech32PrefixAccPub: 'celestiapub',
        bech32PrefixValAddr: 'celestiavaloper',
        bech32PrefixValPub: 'celestiavaloperpub',
        bech32PrefixConsAddr: 'celestiavalcons',
        bech32PrefixConsPub: 'celestiavalconspub',
    },
    currencies: [
        {
            coinDenom: 'TIA',
            coinMinimalDenom: 'utia',
            coinDecimals: 6,
            coinGeckoId: 'celestia',
        },
    ],
    feeCurrencies: [
        {
            coinDenom: 'TIA',
            coinMinimalDenom: 'utia',
            coinDecimals: 6,
            coinGeckoId: 'celestia',
            gasPriceStep: {
                low: 0.01,
                average: 0.02,
                high: 0.1,
            },
        },
    ],
    stakeCurrency: {
        coinDenom: 'TIA',
        coinMinimalDenom: 'utia',
        coinDecimals: 6,
        coinGeckoId: 'celestia',
    },
};

// Global wallet object
window.wallet = {
    address: null,
    balance: null,
    balanceUtia: 0,
    isConnected: false,
    chainConfig: CELESTIA_TESTNET,

    formatAddress(addr, len = 8) {
        if (!addr) return '';
        if (addr.length <= len * 2) return addr;
        return `${addr.slice(0, len)}...${addr.slice(-len)}`;
    },

    formatTIA(utia) {
        const tia = utia / 1_000_000;
        return tia.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    },
};

/**
 * Check if Keplr is installed
 */
function isKeplrInstalled() {
    return typeof window.keplr !== 'undefined';
}

/**
 * Connect to Keplr wallet
 */
async function connectWallet() {
    if (!isKeplrInstalled()) {
        showNotification('Please install Keplr wallet extension', 'error');
        window.open('https://www.keplr.app/download', '_blank');
        return false;
    }

    try {
        // Suggest chain to Keplr (adds Mocha testnet if not present)
        await window.keplr.experimentalSuggestChain(CELESTIA_TESTNET);

        // Enable the chain
        await window.keplr.enable(CELESTIA_TESTNET.chainId);

        // Get the offline signer (amino for signing)
        const offlineSigner = window.keplr.getOfflineSignerOnlyAmino(CELESTIA_TESTNET.chainId);
        const accounts = await offlineSigner.getAccounts();

        if (accounts.length === 0) {
            throw new Error('No accounts found in Keplr');
        }

        // Store wallet info
        window.wallet.address = accounts[0].address;
        window.wallet.isConnected = true;

        // Update UI
        updateWalletUI();

        // Fetch balance
        await fetchBalance();

        console.log('[Keplr] Connected:', window.wallet.address);
        showNotification('Wallet connected successfully!', 'success');

        return true;

    } catch (error) {
        console.error('[Keplr] Connection error:', error);
        showNotification(`Failed to connect: ${error.message}`, 'error');
        return false;
    }
}

/**
 * Fetch wallet balance from Celestia REST API via backend proxy
 */
async function fetchBalance() {
    if (!window.wallet.address) return;

    try {
        const response = await fetch(`/api/celestia/balance/${window.wallet.address}`);
        const data = await response.json();

        if (data.success && data.balances) {
            const utiaBalance = data.balances.find(b => b.denom === 'utia');
            window.wallet.balanceUtia = utiaBalance ? parseInt(utiaBalance.amount) : 0;
            window.wallet.balance = window.wallet.formatTIA(window.wallet.balanceUtia);
            updateWalletUI();
        }

    } catch (error) {
        console.error('[Keplr] Balance fetch error:', error);
    }
}

/**
 * Update wallet UI elements
 */
function updateWalletUI() {
    const connectBtn = document.getElementById('connect-wallet-btn');
    const walletInfo = document.getElementById('wallet-info');
    const walletAddress = document.getElementById('wallet-address');
    const walletBalance = document.getElementById('wallet-balance');
    const walletAvatar = document.getElementById('wallet-avatar');

    if (window.wallet.isConnected) {
        connectBtn.classList.add('hidden');
        walletInfo.classList.remove('hidden');
        walletInfo.classList.add('flex');

        walletAddress.textContent = window.wallet.formatAddress(window.wallet.address);
        walletBalance.textContent = `${window.wallet.balance || '0'} TIA`;

        // Generate avatar from address
        const avatarChar = window.wallet.address.charAt(9).toUpperCase();
        walletAvatar.textContent = avatarChar;

    } else {
        connectBtn.classList.remove('hidden');
        walletInfo.classList.add('hidden');
        walletInfo.classList.remove('flex');
    }
}

/**
 * Sign and broadcast a transaction
 *
 * @param {string} recipientAddress - Address to send TIA to
 * @param {number} amountUtia - Amount in utia (micro TIA)
 * @param {string} memo - Transaction memo
 * @returns {Object} Transaction result with txhash
 */
async function signAndBroadcast(recipientAddress, amountUtia, memo = '') {
    if (!window.wallet.isConnected) {
        throw new Error('Wallet not connected');
    }

    console.log('[Keplr] Signing transaction:', { recipientAddress, amountUtia, memo });

    // 1. Get account info from backend (avoids CORS)
    const accountResponse = await fetch(`/api/celestia/account/${window.wallet.address}`);
    const accountData = await accountResponse.json();

    if (!accountData.success || !accountData.account) {
        throw new Error('Failed to fetch account info');
    }

    const account = accountData.account;
    const accountNumber = account.account_number || '0';
    const sequence = account.sequence || '0';

    console.log('[Keplr] Account info:', { accountNumber, sequence });

    // 2. Create amino sign doc
    const signDoc = {
        chain_id: CELESTIA_TESTNET.chainId,
        account_number: String(accountNumber),
        sequence: String(sequence),
        fee: {
            amount: [{ denom: 'utia', amount: '50000' }],
            gas: '200000',
        },
        msgs: [
            {
                type: 'cosmos-sdk/MsgSend',
                value: {
                    from_address: window.wallet.address,
                    to_address: recipientAddress,
                    amount: [{ denom: 'utia', amount: String(amountUtia) }],
                },
            },
        ],
        memo: memo,
    };

    console.log('[Keplr] Sign doc:', signDoc);

    // 3. Sign with Keplr (user approves in wallet)
    const aminoSigner = window.keplr.getOfflineSignerOnlyAmino(CELESTIA_TESTNET.chainId);
    const signResult = await aminoSigner.signAmino(window.wallet.address, signDoc);

    console.log('[Keplr] Sign result:', signResult);

    // 4. Convert amino to protobuf in browser
    const txBytes = aminoToProtobuf(signResult);
    const txBytesBase64 = uint8ArrayToBase64(txBytes);

    console.log('[Keplr] TX bytes (base64):', txBytesBase64.substring(0, 50) + '...');

    // 5. Broadcast via backend proxy
    const broadcastResponse = await fetch('/api/celestia/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tx_bytes: txBytesBase64,
            mode: 'BROADCAST_MODE_SYNC',
        }),
    });

    const broadcastResult = await broadcastResponse.json();

    console.log('[Keplr] Broadcast result:', broadcastResult);

    if (!broadcastResult.success) {
        throw new Error(broadcastResult.error || 'Broadcast failed');
    }

    const txResponse = broadcastResult.tx_response;

    if (txResponse.code && txResponse.code !== 0) {
        throw new Error(txResponse.raw_log || `Transaction failed with code ${txResponse.code}`);
    }

    // Refresh balance after successful transaction
    setTimeout(() => fetchBalance(), 3000);

    return {
        txhash: txResponse.txhash,
        code: txResponse.code || 0,
        raw_log: txResponse.raw_log,
    };
}

/**
 * Convert amino signed transaction to protobuf bytes
 * This is a simplified version that works for MsgSend transactions
 */
function aminoToProtobuf(signResult) {
    const { signed, signature } = signResult;

    // Import necessary protobuf encoders
    // We'll use a simplified manual encoding approach

    // Encode MsgSend
    const msgSend = encodeMsgSend(
        signed.msgs[0].value.from_address,
        signed.msgs[0].value.to_address,
        signed.msgs[0].value.amount
    );

    // Encode TxBody
    const txBody = encodeTxBody([msgSend], signed.memo);

    // Encode AuthInfo
    const authInfo = encodeAuthInfo(signature.pub_key, signed.fee, signed.sequence);

    // Encode TxRaw
    const txRaw = encodeTxRaw(txBody, authInfo, signature.signature);

    return txRaw;
}

// ===== Protobuf Encoding Helpers =====

function encodeMsgSend(fromAddress, toAddress, amounts) {
    const parts = [];

    // Field 1: from_address (string)
    parts.push(encodeString(1, fromAddress));

    // Field 2: to_address (string)
    parts.push(encodeString(2, toAddress));

    // Field 3: amount (repeated Coin)
    for (const coin of amounts) {
        parts.push(encodeMessage(3, encodeCoin(coin)));
    }

    return concatBytes(parts);
}

function encodeCoin(coin) {
    const parts = [];
    parts.push(encodeString(1, coin.denom));
    parts.push(encodeString(2, coin.amount));
    return concatBytes(parts);
}

function encodeTxBody(messages, memo) {
    const parts = [];

    // Field 1: messages (repeated Any)
    for (const msg of messages) {
        const anyMsg = encodeAny('/cosmos.bank.v1beta1.MsgSend', msg);
        parts.push(encodeMessage(1, anyMsg));
    }

    // Field 2: memo (string)
    if (memo) {
        parts.push(encodeString(2, memo));
    }

    return concatBytes(parts);
}

function encodeAny(typeUrl, value) {
    const parts = [];
    parts.push(encodeString(1, typeUrl));
    parts.push(encodeBytes(2, value));
    return concatBytes(parts);
}

function encodeAuthInfo(pubKey, fee, sequence) {
    const parts = [];

    // Field 1: signer_infos (repeated SignerInfo)
    const signerInfo = encodeSignerInfo(pubKey, sequence);
    parts.push(encodeMessage(1, signerInfo));

    // Field 2: fee
    const feeBytes = encodeFee(fee);
    parts.push(encodeMessage(2, feeBytes));

    return concatBytes(parts);
}

function encodeSignerInfo(pubKey, sequence) {
    const parts = [];

    // Field 1: public_key (Any)
    const pubKeyAny = encodeAny(
        '/cosmos.crypto.secp256k1.PubKey',
        encodeBytes(1, base64ToUint8Array(pubKey.value))
    );
    parts.push(encodeMessage(1, pubKeyAny));

    // Field 2: mode_info
    const modeInfo = encodeModeInfo();
    parts.push(encodeMessage(2, modeInfo));

    // Field 3: sequence
    parts.push(encodeUInt64(3, parseInt(sequence)));

    return concatBytes(parts);
}

function encodeModeInfo() {
    // Single mode with SIGN_MODE_LEGACY_AMINO_JSON (127)
    const single = encodeUInt64(1, 127);
    return encodeMessage(1, single);
}

function encodeFee(fee) {
    const parts = [];

    // Field 1: amount (repeated Coin)
    for (const coin of fee.amount) {
        parts.push(encodeMessage(1, encodeCoin(coin)));
    }

    // Field 2: gas_limit
    parts.push(encodeUInt64(2, parseInt(fee.gas)));

    return concatBytes(parts);
}

function encodeTxRaw(bodyBytes, authInfoBytes, signatureBase64) {
    const parts = [];

    // Field 1: body_bytes
    parts.push(encodeBytes(1, bodyBytes));

    // Field 2: auth_info_bytes
    parts.push(encodeBytes(2, authInfoBytes));

    // Field 3: signatures (repeated bytes)
    parts.push(encodeBytes(3, base64ToUint8Array(signatureBase64)));

    return concatBytes(parts);
}

// ===== Low-level Protobuf Encoding =====

function encodeVarint(value) {
    const bytes = [];
    while (value > 127) {
        bytes.push((value & 0x7f) | 0x80);
        value = Math.floor(value / 128);
    }
    bytes.push(value);
    return new Uint8Array(bytes);
}

function encodeString(fieldNumber, value) {
    const encoded = new TextEncoder().encode(value);
    return encodeBytes(fieldNumber, encoded);
}

function encodeBytes(fieldNumber, value) {
    const tag = encodeVarint((fieldNumber << 3) | 2);
    const length = encodeVarint(value.length);
    return concatBytes([tag, length, value]);
}

function encodeMessage(fieldNumber, value) {
    return encodeBytes(fieldNumber, value);
}

function encodeUInt64(fieldNumber, value) {
    const tag = encodeVarint((fieldNumber << 3) | 0);
    const encoded = encodeVarint(value);
    return concatBytes([tag, encoded]);
}

function concatBytes(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function uint8ArrayToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ===== Utility Functions =====

function showNotification(message, type = 'info') {
    // Simple notification - can be enhanced
    console.log(`[${type.toUpperCase()}] ${message}`);

    // You can add a toast notification system here
}

// Export functions for use in app.js
window.connectWallet = connectWallet;
window.signAndBroadcast = signAndBroadcast;
window.fetchBalance = fetchBalance;
window.isKeplrInstalled = isKeplrInstalled;
