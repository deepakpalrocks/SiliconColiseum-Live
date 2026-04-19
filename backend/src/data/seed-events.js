/**
 * Seed historical crypto events for RAG memory.
 * Called once at startup if the historical_events table is empty.
 */

import { queryOne, execute } from "../db/database.js";

const EVENTS = [
  // === BTC Events ===
  { event_date: "2024-01-10", tokens: '["BTC"]', event_type: "regulatory", headline: "SEC approves spot Bitcoin ETFs", description: "SEC approved 11 spot Bitcoin ETFs including BlackRock's iShares Bitcoin Trust. Marked a historic moment for crypto institutional adoption.", market_impact: "very_bullish", price_change_pct: 7.2, timeframe: "24h", source: "SEC" },
  { event_date: "2024-04-20", tokens: '["BTC"]', event_type: "macro", headline: "Bitcoin 4th halving completes", description: "Block reward reduced from 6.25 to 3.125 BTC. Historically precedes major bull runs within 12-18 months.", market_impact: "bullish", price_change_pct: 2.1, timeframe: "24h", source: "Blockchain" },
  { event_date: "2024-03-14", tokens: '["BTC"]', event_type: "macro", headline: "Bitcoin hits new ATH at $73,750", description: "Driven by ETF inflows and halving anticipation. BlackRock IBIT became largest Bitcoin ETF by AUM.", market_impact: "very_bullish", price_change_pct: 5.8, timeframe: "24h", source: "Markets" },
  { event_date: "2022-11-08", tokens: '["BTC","ETH","SOL"]', event_type: "hack", headline: "FTX exchange collapses", description: "FTX filed for bankruptcy amid $8B shortfall. Triggered massive market selloff and contagion fears.", market_impact: "very_bearish", price_change_pct: -22.5, timeframe: "7d", source: "Reuters" },
  { event_date: "2021-05-19", tokens: '["BTC","ETH"]', event_type: "regulatory", headline: "China bans crypto mining and trading", description: "China's State Council declared crackdown on Bitcoin mining and trading activities.", market_impact: "very_bearish", price_change_pct: -30, timeframe: "7d", source: "Reuters" },
  { event_date: "2021-09-07", tokens: '["BTC"]', event_type: "macro", headline: "El Salvador adopts Bitcoin as legal tender", description: "First nation to adopt Bitcoin as legal tender. Initially crashed 10% on launch day bugs.", market_impact: "bearish", price_change_pct: -10, timeframe: "24h", source: "Bloomberg" },
  { event_date: "2024-12-05", tokens: '["BTC"]', event_type: "macro", headline: "Bitcoin crosses $100,000 milestone", description: "Post-election rally and ETF accumulation pushed BTC past $100K for the first time.", market_impact: "very_bullish", price_change_pct: 4.5, timeframe: "24h", source: "Markets" },

  // === ETH Events ===
  { event_date: "2024-05-23", tokens: '["ETH"]', event_type: "regulatory", headline: "SEC approves spot Ethereum ETFs", description: "SEC approved 19b-4 filings for spot Ethereum ETFs. Surprised markets expecting rejection.", market_impact: "very_bullish", price_change_pct: 15.2, timeframe: "24h", source: "SEC" },
  { event_date: "2022-09-15", tokens: '["ETH"]', event_type: "launch", headline: "Ethereum Merge completes — PoW to PoS", description: "Ethereum successfully transitioned from Proof of Work to Proof of Stake, reducing energy consumption by 99.95%.", market_impact: "neutral", price_change_pct: -2.1, timeframe: "24h", source: "Ethereum Foundation" },
  { event_date: "2024-03-13", tokens: '["ETH"]', event_type: "launch", headline: "Ethereum Dencun upgrade goes live", description: "EIP-4844 proto-danksharding dramatically reduced L2 transaction fees by 10-100x.", market_impact: "bullish", price_change_pct: 3.5, timeframe: "24h", source: "Ethereum Foundation" },
  { event_date: "2023-04-12", tokens: '["ETH"]', event_type: "launch", headline: "Ethereum Shanghai upgrade enables staking withdrawals", description: "ETH stakers could finally withdraw. Contrary to fear, more ETH was staked than withdrawn.", market_impact: "bullish", price_change_pct: 5.8, timeframe: "7d", source: "Ethereum Foundation" },

  // === SOL Events ===
  { event_date: "2023-12-25", tokens: '["SOL"]', event_type: "macro", headline: "Solana rallies from $20 to $120 in Q4 2023", description: "Driven by memecoin season, Jito airdrop, and ecosystem growth after FTX contagion faded.", market_impact: "very_bullish", price_change_pct: 500, timeframe: "7d", source: "Markets" },
  { event_date: "2024-11-25", tokens: '["SOL"]', event_type: "macro", headline: "Solana hits ATH at $263", description: "Memecoin frenzy (Pump.fun), institutional interest, and potential SOL ETF filings.", market_impact: "very_bullish", price_change_pct: 12, timeframe: "7d", source: "Markets" },
  { event_date: "2022-12-29", tokens: '["SOL"]', event_type: "macro", headline: "Solana drops to $8 post-FTX collapse", description: "FTX/Alameda held huge SOL bags. Market feared total ecosystem death. TVL dropped 97%.", market_impact: "very_bearish", price_change_pct: -65, timeframe: "7d", source: "Markets" },

  // === DeFi Events ===
  { event_date: "2022-05-09", tokens: '["ETH","BTC"]', event_type: "hack", headline: "Terra/Luna and UST collapse", description: "UST depegged, LUNA went from $80 to near zero. Contagion hit 3AC, Celsius, Voyager. $60B wiped out.", market_impact: "very_bearish", price_change_pct: -35, timeframe: "7d", source: "Markets" },
  { event_date: "2023-03-11", tokens: '["ETH","BTC"]', event_type: "macro", headline: "USDC depegs after SVB collapse", description: "Circle held $3.3B at Silicon Valley Bank. USDC briefly traded at $0.87. Markets panicked.", market_impact: "very_bearish", price_change_pct: -10, timeframe: "24h", source: "Bloomberg" },
  { event_date: "2024-02-07", tokens: '["ETH"]', event_type: "macro", headline: "Ethereum restaking narrative explodes", description: "EigenLayer TVL surged past $7B. LRT protocols like EtherFi, Puffer grew rapidly.", market_impact: "bullish", price_change_pct: 8, timeframe: "7d", source: "DeFiLlama" },

  // === ARB Events ===
  { event_date: "2023-03-23", tokens: '["ARB"]', event_type: "launch", headline: "Arbitrum ARB token airdrop", description: "Massive airdrop to early users. Initial trading at $1.26, settled around $1.10.", market_impact: "bullish", price_change_pct: -12, timeframe: "24h", source: "Arbitrum Foundation" },
  { event_date: "2024-03-16", tokens: '["ARB"]', event_type: "macro", headline: "Arbitrum STIP grants boost ecosystem", description: "100M ARB incentive program drove TVL growth. GMX, Camelot, Radiant benefited most.", market_impact: "bullish", price_change_pct: 15, timeframe: "7d", source: "Arbitrum DAO" },

  // === LINK Events ===
  { event_date: "2024-01-30", tokens: '["LINK"]', event_type: "partnership", headline: "Chainlink CCIP adoption accelerates", description: "Major banks and Swift integrated CCIP for cross-chain messaging. LINK rallied on institutional use case.", market_impact: "bullish", price_change_pct: 18, timeframe: "7d", source: "Chainlink" },
  { event_date: "2023-12-07", tokens: '["LINK"]', event_type: "launch", headline: "Chainlink Staking v0.2 launches", description: "Expanded staking from 25M to 45M LINK capacity. Community stake filled quickly.", market_impact: "bullish", price_change_pct: 8, timeframe: "24h", source: "Chainlink" },

  // === UNI Events ===
  { event_date: "2024-02-23", tokens: '["UNI"]', event_type: "launch", headline: "Uniswap Foundation proposes fee switch", description: "Proposal to share protocol revenue with UNI stakers. Token surged 50%+ on the announcement.", market_impact: "very_bullish", price_change_pct: 55, timeframe: "24h", source: "Uniswap Governance" },

  // === AAVE Events ===
  { event_date: "2024-07-25", tokens: '["AAVE"]', event_type: "launch", headline: "Aave proposes buyback and fee distribution", description: "ACI proposed using protocol revenue to buy back AAVE. Token rallied on tokenomics upgrade.", market_impact: "very_bullish", price_change_pct: 25, timeframe: "7d", source: "Aave Governance" },

  // === GMX Events ===
  { event_date: "2023-08-04", tokens: '["GMX"]', event_type: "launch", headline: "GMX V2 launches on Arbitrum", description: "Introduced synthetic assets, improved pricing, and new fee structure. TVL grew rapidly.", market_impact: "bullish", price_change_pct: 12, timeframe: "7d", source: "GMX" },

  // === General Market / Regulatory ===
  { event_date: "2023-06-05", tokens: '["BTC","ETH","SOL","ARB","LINK"]', event_type: "regulatory", headline: "SEC sues Binance and Coinbase", description: "SEC filed lawsuits against both major exchanges. Multiple alts classified as securities.", market_impact: "very_bearish", price_change_pct: -8, timeframe: "24h", source: "SEC" },
  { event_date: "2023-10-16", tokens: '["BTC"]', event_type: "macro", headline: "Fake BlackRock ETF approval news", description: "CoinTelegraph published false ETF approval news. BTC spiked to $30K then crashed when debunked.", market_impact: "bearish", price_change_pct: -5, timeframe: "1h", source: "Markets" },
  { event_date: "2023-06-15", tokens: '["BTC"]', event_type: "regulatory", headline: "BlackRock files spot Bitcoin ETF", description: "World's largest asset manager filed for spot BTC ETF. Triggered massive rally as others followed.", market_impact: "very_bullish", price_change_pct: 12, timeframe: "7d", source: "SEC Filing" },
  { event_date: "2024-08-05", tokens: '["BTC","ETH","SOL"]', event_type: "macro", headline: "Japan carry trade unwind crashes global markets", description: "Bank of Japan rate hike triggered yen carry trade unwind. BTC dropped from $65K to $49K intraday.", market_impact: "very_bearish", price_change_pct: -18, timeframe: "24h", source: "Bloomberg" },
  { event_date: "2024-09-18", tokens: '["BTC","ETH"]', event_type: "macro", headline: "Fed cuts rates by 50bps", description: "First Fed rate cut since 2020. Larger than expected 50bps cut signaled easing cycle.", market_impact: "bullish", price_change_pct: 5, timeframe: "24h", source: "Federal Reserve" },
  { event_date: "2024-11-05", tokens: '["BTC","ETH","SOL"]', event_type: "macro", headline: "Pro-crypto candidate wins US election", description: "Markets rallied on expectations of favorable crypto regulation and potential Bitcoin strategic reserve.", market_impact: "very_bullish", price_change_pct: 30, timeframe: "7d", source: "Markets" },

  // === Hack/Exploit Events ===
  { event_date: "2023-09-25", tokens: '["ETH"]', event_type: "hack", headline: "Mixin Network hacked for $200M", description: "Cloud service provider breach led to $200M loss from Mixin's hot wallets.", market_impact: "bearish", price_change_pct: -3, timeframe: "24h", source: "Mixin" },
  { event_date: "2024-02-26", tokens: '["ETH"]', event_type: "hack", headline: "PlayDapp exploited for $290M", description: "Private key compromise led to minting of 1.79B PLA tokens worth $290M.", market_impact: "neutral", price_change_pct: -1, timeframe: "24h", source: "PlayDapp" },
  { event_date: "2023-11-22", tokens: '["ETH"]', event_type: "hack", headline: "KyberSwap exploited for $54M", description: "Sophisticated math exploit drained pools across multiple chains.", market_impact: "neutral", price_change_pct: -1.5, timeframe: "24h", source: "KyberSwap" },
  { event_date: "2022-03-29", tokens: '["ETH"]', event_type: "hack", headline: "Ronin Bridge hacked for $625M", description: "Lazarus Group compromised validator keys. Largest DeFi hack in history at the time.", market_impact: "bearish", price_change_pct: -5, timeframe: "7d", source: "Ronin" },

  // === Stablecoin Events ===
  { event_date: "2023-08-16", tokens: '["BTC","ETH"]', event_type: "macro", headline: "PayPal launches PYUSD stablecoin", description: "PayPal's USD-backed stablecoin on Ethereum. Signaled mainstream stablecoin adoption.", market_impact: "bullish", price_change_pct: 2, timeframe: "24h", source: "PayPal" },

  // === Layer 2 Events ===
  { event_date: "2024-06-11", tokens: '["ETH"]', event_type: "launch", headline: "Base chain TVL surpasses $6B", description: "Coinbase's L2 grew rapidly driven by memecoin activity and Farcaster ecosystem.", market_impact: "bullish", price_change_pct: 3, timeframe: "7d", source: "DeFiLlama" },

  // === Additional Events ===
  { event_date: "2024-03-27", tokens: '["ETH"]', event_type: "launch", headline: "EigenLayer opens deposits", description: "Restaking protocol opened for all depositors. $15B TVL within weeks.", market_impact: "bullish", price_change_pct: 5, timeframe: "7d", source: "EigenLayer" },
  { event_date: "2023-01-14", tokens: '["BTC","ETH","SOL"]', event_type: "macro", headline: "Crypto market rallies in January 2023", description: "Markets bottomed in late 2022. January saw strong recovery with BTC up 40%.", market_impact: "very_bullish", price_change_pct: 40, timeframe: "7d", source: "Markets" },
  { event_date: "2024-01-25", tokens: '["ETH"]', event_type: "regulatory", headline: "Ethereum Foundation receives SEC inquiry", description: "SEC reportedly investigating Ethereum Foundation. ETH briefly dipped on the news.", market_impact: "bearish", price_change_pct: -4, timeframe: "24h", source: "Fortune" },
  { event_date: "2023-12-28", tokens: '["SOL"]', event_type: "launch", headline: "Jupiter DEX announces JUP airdrop", description: "Largest Solana airdrop drove massive activity. SOL ecosystem sentiment extremely positive.", market_impact: "bullish", price_change_pct: 8, timeframe: "7d", source: "Jupiter" },
  { event_date: "2024-04-14", tokens: '["BTC","ETH"]', event_type: "macro", headline: "Iran-Israel tensions spike crypto selloff", description: "Geopolitical escalation caused risk-off move. BTC dropped 8% on missile attack fears.", market_impact: "very_bearish", price_change_pct: -8, timeframe: "24h", source: "Bloomberg" },
  { event_date: "2024-07-05", tokens: '["BTC"]', event_type: "macro", headline: "Mt. Gox repayments begin", description: "~140K BTC from 2014 hack began being distributed. Market feared sell pressure.", market_impact: "bearish", price_change_pct: -7, timeframe: "7d", source: "Mt. Gox Trustee" },
  { event_date: "2024-08-01", tokens: '["BTC","ETH"]', event_type: "macro", headline: "US Government sells seized BTC", description: "DOJ approved sale of $2B in Silk Road BTC. Added to sell-side pressure.", market_impact: "bearish", price_change_pct: -4, timeframe: "24h", source: "DOJ" },
  { event_date: "2024-10-29", tokens: '["SOL"]', event_type: "launch", headline: "Solana processes record TPS from memecoins", description: "Pump.fun memecoin platform drove Solana to 65M daily transactions. Network held up.", market_impact: "bullish", price_change_pct: 10, timeframe: "7d", source: "Solscan" },
  { event_date: "2025-01-20", tokens: '["BTC","ETH","SOL"]', event_type: "regulatory", headline: "New US administration takes pro-crypto stance", description: "Executive orders on crypto policy expected. Market rallied on regulatory clarity hopes.", market_impact: "very_bullish", price_change_pct: 8, timeframe: "24h", source: "Bloomberg" },
  { event_date: "2025-03-07", tokens: '["BTC"]', event_type: "regulatory", headline: "US establishes Strategic Bitcoin Reserve", description: "Executive order created a national Bitcoin reserve from seized assets. Historic government endorsement.", market_impact: "very_bullish", price_change_pct: 5, timeframe: "24h", source: "White House" },
];

/**
 * Seed historical events table if empty.
 */
export function seedHistoricalEvents() {
  const count = queryOne("SELECT COUNT(*) as cnt FROM historical_events");
  if (count && count.cnt > 0) {
    console.log(`[SEED] Historical events table already has ${count.cnt} entries, skipping seed`);
    return;
  }

  console.log(`[SEED] Seeding ${EVENTS.length} historical crypto events...`);
  for (const e of EVENTS) {
    execute(
      `INSERT INTO historical_events (event_date, tokens, event_type, headline, description, market_impact, price_change_pct, timeframe, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.event_date, e.tokens, e.event_type, e.headline, e.description, e.market_impact, e.price_change_pct, e.timeframe, e.source]
    );
  }
  console.log(`[SEED] Seeded ${EVENTS.length} historical events`);
}
