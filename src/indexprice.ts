import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { Liquidity } from "@raydium-io/raydium-sdk";
import { OpenOrders } from "@project-serum/serum";
import { LIQUIDITY_STATE_LAYOUT_V4 } from "@raydium-io/raydium-sdk";

//dotenv.config();

const RAYDIUM_LIQUIDITY_POOL_V4_ADDRESS = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
// CANNOT USE MAINNET RPC DUE TO RESOURCE USE, USE QUICK NODE OR HELIUS
//const RPC = process.env.RPC;
const RPC = "<yourRPC>";

/**
 * Retrieves the pool ID based on the provided token address.
 *
 * @param baseString - The token address used to retrieve the pool ID.
 * @returns The pool ID as a string if found, otherwise null.
 */
async function getPoolID(baseString: string): Promise<string | null> {
  let base = new PublicKey(baseString);
  const quote = new PublicKey(WSOL_ADDRESS);
  const commitment: Commitment = "confirmed";

  try {
    const connection = new Connection(RPC);

    // First try with base
    const baseAccounts = await connection.getProgramAccounts(new PublicKey(RAYDIUM_LIQUIDITY_POOL_V4_ADDRESS), {
      commitment,
      filters: [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
            bytes: base.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
            bytes: quote.toBase58(),
          },
        },
      ],
    });

    if (baseAccounts.length > 0) {
      const { pubkey } = baseAccounts[0];
      return pubkey.toString();
    }

    // If base fails, try with quote
    const quoteAccounts = await connection.getProgramAccounts(new PublicKey(RAYDIUM_LIQUIDITY_POOL_V4_ADDRESS), {
      commitment,
      filters: [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
            bytes: quote.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
            bytes: base.toBase58(),
          },
        },
      ],
    });

    if (quoteAccounts.length > 0) {
      const { pubkey } = quoteAccounts[0];
      return pubkey.toString();
    }

    return null;
  } catch (error) {
    console.error("Error fetching Market accounts:", error);
    return null;
  }
}

/**
 * Retrieves the token price for a given pool ID.
 *
 * @param poolId - The ID of the pool to fetch the token price from.
 * @return The token price in SOL. Returns undefined if an error occurs.
 */
async function getTokenPrice(poolId: string): Promise<number> {
  try {
    //fetching pool data
    const version: 4 | 5 = 4;

    const connection = new Connection(RPC);

    const account = await connection.getAccountInfo(new PublicKey(poolId));
    const { state: LiquidityStateLayout } = Liquidity.getLayouts(version);

    //@ts-ignore
    const poolState = LiquidityStateLayout.decode(account?.data);

    const baseDecimal = 10 ** poolState.baseDecimal.toNumber();
    const quoteDecimal = 10 ** poolState.quoteDecimal.toNumber();

    const baseTokenAmount = await connection.getTokenAccountBalance(poolState.baseVault);
    const quoteTokenAmount = await connection.getTokenAccountBalance(poolState.quoteVault);

    const basePnl = poolState.baseNeedTakePnl.toNumber() / baseDecimal;
    const quotePnl = poolState.quoteNeedTakePnl.toNumber() / quoteDecimal;

    const OPENBOOK_PROGRAM_ID = poolState.marketProgramId;

    const openOrders = await OpenOrders.load(connection, poolState.openOrders, OPENBOOK_PROGRAM_ID);

    const openOrdersBaseTokenTotal = openOrders.baseTokenTotal.toNumber() / baseDecimal;
    const openOrdersQuoteTokenTotal = openOrders.quoteTokenTotal.toNumber() / quoteDecimal;

    const base = (baseTokenAmount.value?.uiAmount || 0) + openOrdersBaseTokenTotal - basePnl;
    const quote = (quoteTokenAmount.value?.uiAmount || 0) + openOrdersQuoteTokenTotal - quotePnl;

    let priceInSol = "";

    if (poolState.baseMint.equals(NATIVE_MINT)) {
      priceInSol = (base / quote).toString();
    } else if (poolState.quoteMint.equals(NATIVE_MINT)) {
      priceInSol = (quote / base).toString();
    }

    return parseFloat(priceInSol);
  } catch (e) {
    console.error(e);
    return;
  }
}

/**
 * fetch the pool ID for a given token address,
 * retrieves the token price using the pool ID,
 * and logs the token price in SOL.
 */
async function main() {
  try {
    const tokenAddress = "DVuaDuQdPZ6H49inC2Xoyx7BpLAAJTPPChSfHuGpy8X4"; // CA you want to fetch price

    const poolId = await getPoolID(tokenAddress);

    if (!poolId) {
      console.log("No Pool ID Found");
      return;
    }

    const priceInSol = await getTokenPrice(poolId);

    if (!priceInSol) {
      console.log("Unable to fetch token price.");
      return;
    }

    console.log("Token Price:", priceInSol, "SOL");
  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main();
