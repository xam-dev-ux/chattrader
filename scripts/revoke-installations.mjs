import { Client, IdentifierKind } from "@xmtp/node-sdk";
import { toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PK = process.env.BOT_PRIVATE_KEY;
if (!PK) { console.error("BOT_PRIVATE_KEY not set"); process.exit(1); }

const account = privateKeyToAccount(PK);

const signer = {
  type: "EOA",
  getIdentifier: () => ({
    identifier: account.address,
    identifierKind: IdentifierKind.Ethereum,
  }),
  signMessage: async (message) => {
    const sig = await account.signMessage({ message });
    return toBytes(sig);
  },
};

const INBOX_ID = "23a7620e1240eae42e21ce69102ba1660482a565afe97146a4f54145e3c69f60";

async function main() {
  console.log("Fetching inbox state...");
  const states = await Client.inboxStateFromInboxIds([INBOX_ID], "production");
  const state = states[0];
  const installations = state.installations;
  console.log(`Found ${installations.length} installations:`, installations.map(i => i.id));

  if (installations.length === 0) {
    console.log("No installations to revoke.");
    return;
  }

  const allIds = installations.map(i => i.bytes);
  console.log("Revoking all installations...");
  await Client.revokeInstallations(signer, INBOX_ID, allIds, "production");
  console.log("Done. All installations revoked.");
}

main().catch(e => { console.error(e); process.exit(1); });
