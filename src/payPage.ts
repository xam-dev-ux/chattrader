export function buildPayPage(amountUSDC: number, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay · ChatTrader</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0b0d;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      background: #131720;
      border: 1px solid #1e2736;
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .logo {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 4px;
      background: linear-gradient(90deg, #0052ff, #00c3ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .tagline {
      color: #475569;
      font-size: 13px;
      margin-bottom: 28px;
    }
    .amount-card {
      background: #0d1117;
      border: 1px solid #1e2736;
      border-radius: 14px;
      padding: 24px;
      text-align: center;
      margin-bottom: 24px;
    }
    .amount-value {
      font-size: 44px;
      font-weight: 800;
      line-height: 1.1;
    }
    .amount-unit {
      font-size: 16px;
      color: #0052ff;
      font-weight: 600;
      margin-top: 6px;
    }
    .amount-desc {
      font-size: 13px;
      color: #64748b;
      margin-top: 10px;
    }
    .btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; box-shadow: none !important; }
    .btn-pay {
      background: linear-gradient(135deg, #0052ff, #0070f3);
      color: #fff;
    }
    .btn-pay:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 8px 24px rgba(0,82,255,0.45);
    }
    .status {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.55;
      display: none;
      word-break: break-word;
    }
    .status.loading { background: #0e1f3d; color: #93c5fd; display: block; }
    .status.success { background: #052e16; color: #4ade80; display: block; }
    .status.error   { background: #2d0f0f; color: #f87171; display: block; }
    .tx-link {
      display: block;
      margin-top: 8px;
      color: #4ade80;
      text-decoration: underline;
      font-size: 13px;
      word-break: break-all;
    }
    .powered {
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #1e293b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ChatTrader</div>
    <div class="tagline">Powered by x402 · Base Network</div>

    <div class="amount-card">
      <div class="amount-value">${amountUSDC}</div>
      <div class="amount-unit">USDC on Base</div>
      <div class="amount-desc">${description}</div>
    </div>

    <button class="btn btn-pay" id="pay-btn" onclick="handlePay()">
      Pay with Base Wallet
    </button>

    <div class="status" id="status"></div>
    <div class="powered">x402 · EIP-3009 · Base Mainnet</div>
  </div>

  <script>
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const CHAIN_ID = 8453;
    // Same URL — fetch() sends Accept: */* so server returns 402 JSON, not HTML
    const ENDPOINT = window.location.href;

    function setStatus(html, type) {
      const el = document.getElementById('status');
      el.innerHTML = html;
      el.className = 'status ' + type;
    }

    function randomBytes32() {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      return '0x' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    async function handlePay() {
      const btn = document.getElementById('pay-btn');
      btn.disabled = true;

      try {
        // 1. Connect wallet
        setStatus('Connecting wallet…', 'loading');
        if (!window.ethereum) {
          throw new Error('No wallet detected. Install <a href="https://www.coinbase.com/wallet" target="_blank" style="color:inherit">Coinbase Wallet</a> or MetaMask.');
        }
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        const userAddress = accounts[0];

        // 2. Switch to Base
        setStatus('Switching to Base network…', 'loading');
        try {
          await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
        } catch (err) {
          if (err.code === 4902) {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }],
            });
          } else throw err;
        }

        // 3. Get payment requirements from 402 response
        setStatus('Loading payment details…', 'loading');
        const resp402 = await fetch(ENDPOINT);
        const hdr402 = resp402.headers.get('x-payment-required');
        if (!hdr402) throw new Error('Missing X-PAYMENT-REQUIRED header.');
        const payReq = JSON.parse(atob(hdr402));
        const req = payReq.requirements[0];
        const botAddress = req.payTo;
        const amountMicro = req.amount;  // e.g. "120000"

        // 4. Sign EIP-3009 TransferWithAuthorization
        setStatus('Sign the payment in your wallet…', 'loading');
        const eip3009Nonce = randomBytes32();
        const validBefore = String(Math.floor(Date.now() / 1000) + 300);

        const typedData = JSON.stringify({
          domain: { name: 'USD Coin', version: '2', chainId: CHAIN_ID, verifyingContract: USDC_ADDRESS },
          types: {
            TransferWithAuthorization: [
              { name: 'from',        type: 'address' },
              { name: 'to',          type: 'address' },
              { name: 'value',       type: 'uint256' },
              { name: 'validAfter',  type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce',       type: 'bytes32' },
            ],
          },
          primaryType: 'TransferWithAuthorization',
          message: { from: userAddress, to: botAddress, value: amountMicro, validAfter: '0', validBefore, nonce: eip3009Nonce },
        });

        const signature = await ethereum.request({ method: 'eth_signTypedData_v4', params: [userAddress, typedData] });

        // 5. Submit with X-PAYMENT header
        setStatus('Settling payment on Base…', 'loading');
        const xPayment = btoa(JSON.stringify({
          scheme: 'exact',
          network: 'eip155:8453',
          payload: {
            authorization: { from: userAddress, to: botAddress, value: amountMicro, validAfter: '0', validBefore, nonce: eip3009Nonce },
            signature,
          },
        }));

        const result = await fetch(ENDPOINT, { headers: { 'X-PAYMENT': xPayment } });
        const body = await result.json();
        if (!result.ok) throw new Error(body.error || 'Payment failed.');

        const txHash = body.paymentTxHash || body.txHash;
        btn.textContent = '✓ Paid';
        setStatus(
          '✓ Payment confirmed! Check your XMTP chat for the result.' +
          (txHash ? '<a class="tx-link" href="https://basescan.org/tx/' + txHash + '" target="_blank">View on Basescan →</a>' : ''),
          'success'
        );

      } catch (err) {
        setStatus('Error: ' + (err.message || String(err)), 'error');
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}
