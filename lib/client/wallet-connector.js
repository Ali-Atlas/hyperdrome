/**
 * NEAR Connect for the wallet page (SPEC.md 11): one lazily loaded connector, testnet only and
 * filtered to wallets that can sign a message, and the wallet-signed transactions that need no
 * server (`unlink_wallet`, `withdraw`).
 */

/** Gas for the wallet-signed `withdraw`: the SPEC.md 13 budget, the same the ops path attaches. */
const WITHDRAW_GAS = '150000000000000';
const UNLINK_GAS = '30000000000000';
const ONE_YOCTO = '1';

/** @type {Promise<import('@hot-labs/near-connect').NearConnector> | null} */
let connector = null;

/**
 * The nonce of the document's Content-Security-Policy, or null when the document was not loaded
 * under it (a client-side navigation to the page).
 * @returns {string | null}
 */
function documentNonce() {
  const script = /** @type {HTMLScriptElement | null} */ (document.querySelector('script[nonce]'));
  return script?.nonce || null;
}

/**
 * The page's connector. Third-party wallet code runs only under the page's policy.
 * @returns {Promise<import('@hot-labs/near-connect').NearConnector>}
 */
export function getConnector() {
  const cspNonce = documentNonce();
  if (!cspNonce) return Promise.reject(new Error('Reload this page to connect your wallet.'));
  connector ??= import('@hot-labs/near-connect').then(
    ({ NearConnector }) =>
      new NearConnector({
        network: 'testnet',
        features: { signMessage: true, testnet: true },
        cspNonce,
        autoConnect: false,
      })
  );
  return connector;
}

/**
 * Open the NEAR Connect modal and sign the challenge in one wallet step. The connector filters to
 * wallets that support `signInAndSignMessage`.
 * @param {{ nonce: string, message: string, recipient: string }} challenge the hex nonce from the server
 * @returns {Promise<{ accountId: string, publicKey: string, signature: string }>}
 */
export async function signLinkChallenge({ nonce, message, recipient }) {
  const near = await getConnector();
  const signed = new Promise((resolve) => {
    near.once('wallet:signInAndSignMessage', (event) => resolve(event.accounts[0]));
  });
  await near.connect({
    signMessageParams: { message, recipient, nonce: hexToBytes(nonce) },
  });
  const account = /** @type {import('@hot-labs/near-connect').AccountWithSignedMessage} */ (
    await signed
  );
  return {
    accountId: account.accountId,
    publicKey: account.signedMessage.publicKey,
    signature: account.signedMessage.signature,
  };
}

/**
 * The connected wallet, opening the modal when none is connected; refuses any account other than
 * the linked wallet.
 * @param {string} linkedWallet
 * @returns {Promise<import('@hot-labs/near-connect').NearWalletBase>}
 */
async function connectedLinkedWallet(linkedWallet) {
  const near = await getConnector();
  let accounts;
  try {
    ({ accounts } = await near.getConnectedWallet());
  } catch {
    await near.connect();
    ({ accounts } = await near.getConnectedWallet());
  }
  const wallet = (await near.getConnectedWallet()).wallet;
  if (accounts[0]?.accountId !== linkedWallet) {
    throw new Error(`Connect the linked wallet ${linkedWallet} and try again.`);
  }
  return wallet;
}

/**
 * Send a contract call from the linked wallet with 1 yocto.
 * @param {{ gameId: string, linkedWallet: string, method: string, args: Record<string, unknown>, gas: string }} input
 */
async function sendFromWallet({ gameId, linkedWallet, method, args, gas }) {
  const wallet = await connectedLinkedWallet(linkedWallet);
  const outcome = await wallet.signAndSendTransaction({
    signerId: linkedWallet,
    receiverId: gameId,
    actions: [
      { type: 'FunctionCall', params: { methodName: method, args, gas, deposit: ONE_YOCTO } },
    ],
  });
  const status = /** @type {{ status?: unknown }} */ (outcome)?.status;
  if (status && typeof status === 'object' && 'Failure' in status) {
    throw new Error('The transaction failed on chain.');
  }
  return outcome;
}

/**
 * `withdraw` signed by the wallet itself, with no server involved.
 * @param {{ gameId: string, wallet: string, player: string, tokens: string[], volts: number }} input
 */
export function withdrawFromWallet({ gameId, wallet, player, tokens, volts }) {
  return sendFromWallet({
    gameId,
    linkedWallet: wallet,
    method: 'withdraw',
    args: { player, tokens, volts: String(volts) },
    gas: WITHDRAW_GAS,
  });
}

/**
 * `unlink_wallet` signed by the wallet itself.
 * @param {{ gameId: string, wallet: string, player: string }} input
 */
export function unlinkFromWallet({ gameId, wallet, player }) {
  return sendFromWallet({
    gameId,
    linkedWallet: wallet,
    method: 'unlink_wallet',
    args: { player },
    gas: UNLINK_GAS,
  });
}

/**
 * @param {string} hex
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
}
