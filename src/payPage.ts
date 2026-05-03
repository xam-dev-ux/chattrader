export function buildPayPage(amountUSDC: number, description: string, botAddress: string): string {
  const amountMicro = String(Math.round(amountUSDC * 1e6));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay · ChatTrader</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0b0d; color: #f1f5f9; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    .card { background: #131720; border: 1px solid #1e2736; border-radius: 20px;
      padding: 36px 32px; max-width: 420px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    .logo { font-size: 22px; font-weight: 800; margin-bottom: 4px;
      background: linear-gradient(90deg,#0052ff,#00c3ff); -webkit-background-clip: text;
      -webkit-text-fill-color: transparent; background-clip: text; }
    .tagline { color: #475569; font-size: 13px; margin-bottom: 28px; }
    .amount-card { background: #0d1117; border: 1px solid #1e2736; border-radius: 14px;
      padding: 24px; text-align: center; margin-bottom: 24px; }
    .amount-value { font-size: 44px; font-weight: 800; line-height: 1.1; }
    .amount-unit { font-size: 16px; color: #0052ff; font-weight: 600; margin-top: 6px; }
    .amount-desc { font-size: 13px; color: #64748b; margin-top: 10px; }
    .btn { width: 100%; padding: 16px; border: none; border-radius: 12px;
      font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-pay { background: linear-gradient(135deg,#0052ff,#0070f3); color: #fff; }
    .btn-pay:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,82,255,0.45); }
    .status { margin-top: 16px; padding: 14px 16px; border-radius: 10px; font-size: 14px;
      line-height: 1.55; display: none; word-break: break-word; }
    .status.loading { background: #0e1f3d; color: #93c5fd; display: block; }
    .status.success { background: #052e16; color: #4ade80; display: block; }
    .status.error   { background: #2d0f0f; color: #f87171; display: block; }
    .tx-link { display: block; margin-top: 8px; color: #4ade80; text-decoration: underline; font-size: 13px; }
    .powered { text-align: center; margin-top: 20px; font-size: 12px; color: #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">ChatTrader</div>
    <div class="tagline">Pay with USDC · Base Network</div>
    <div class="amount-card">
      <div class="amount-value">${amountUSDC}</div>
      <div class="amount-unit">USDC on Base</div>
      <div class="amount-desc">${description}</div>
    </div>
    <button class="btn btn-pay" id="pay-btn">Pay with Base Wallet</button>
    <div class="status" id="status"></div>
    <div class="powered">ERC-20 Transfer · Base Mainnet</div>
  </div>

  <script type="module">
    import { createWalletClient, custom, encodeFunctionData } from 'https://esm.sh/viem@2.21.0';
    import { base } from 'https://esm.sh/viem@2.21.0/chains';

    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const BOT_ADDRESS  = '${botAddress}';
    const AMOUNT_MICRO = ${amountMicro}n;  // BigInt
    const NONCE        = new URLSearchParams(location.search).get('nonce') ?? '';

    const TRANSFER_ABI = [{
      name: 'transfer', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [{ name: '', type: 'bool' }],
    }];

    function setStatus(html, type) {
      const el = document.getElementById('status');
      el.innerHTML = html;
      el.className = 'status ' + type;
    }

    document.getElementById('pay-btn').addEventListener('click', async () => {
      const btn = document.getElementById('pay-btn');
      btn.disabled = true;

      try {
        // 1. Connect wallet
        setStatus('Connecting wallet…', 'loading');
        if (!window.ethereum) throw new Error('No wallet detected. Install Coinbase Wallet or MetaMask.');

        const walletClient = createWalletClient({ chain: base, transport: custom(window.ethereum) });
        const [userAddress] = await walletClient.requestAddresses();

        // 2. Switch to Base
        setStatus('Switching to Base network…', 'loading');
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
        } catch (err) {
          if (err.code === 4902) {
            await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
              chainId: '0x2105', chainName: 'Base',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'],
            }]});
          } else throw err;
        }

        // 3. Send USDC transfer directly (works with all wallets, no typed-data signing needed)
        setStatus('Approve the USDC transfer in your wallet…', 'loading');
        const data = encodeFunctionData({
          abi: TRANSFER_ABI,
          functionName: 'transfer',
          args: [BOT_ADDRESS, AMOUNT_MICRO],
        });

        const txHash = await walletClient.sendTransaction({
          account: userAddress,
          to: USDC_ADDRESS,
          data,
        });

        console.log('[pay] tx sent:', txHash);
        setStatus('Transaction submitted! Waiting for confirmation…', 'loading');

        // 4. Tell server to watch for the tx and execute the action
        const resp = await fetch('/api/confirm-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash, nonce: NONCE, userAddress }),
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Server error');

        btn.textContent = '✓ Paid';
        setStatus(
          '✓ Payment sent! Your result will arrive in the XMTP chat shortly.' +
          '<a class="tx-link" href="https://basescan.org/tx/' + txHash + '" target="_blank">View transaction on Basescan →</a>',
          'success'
        );

      } catch (err) {
        console.error('[pay] error:', err);
        setStatus('Error: ' + (err.shortMessage || err.message || String(err)), 'error');
        document.getElementById('pay-btn').disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
