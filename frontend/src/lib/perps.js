import { markets } from "../config/markets";
import { clamp } from "./format";

export const BASIS_POINTS = 10000;
export const MAINTENANCE_MARGIN_BPS = 625;

export function seedHistory(sourceMarkets = markets) {
  return sourceMarkets.map((market) =>
    Array.from({ length: 72 }, (_, index) => {
      const wave = Math.sin(index / 7) * market.price * 0.012;
      const drift = (index - 36) * market.price * 0.0005;
      return market.price + wave + drift;
    })
  );
}

export function reputationLeverageCap(score, marketMax) {
  if (score < 80) return Math.min(2, marketMax);
  if (score < 120) return Math.min(3, marketMax);
  if (score < 180) return Math.min(4, marketMax);
  return Math.min(5, marketMax);
}

export function calculateReputation(profile) {
  const winBonus = profile.winningTrades * 8;
  const experienceBonus = profile.totalTrades * 3;
  const volumeBonus = Math.floor(profile.totalVolume / 1000);
  const pnlBonus = profile.realizedPnl > 0 ? Math.floor(profile.realizedPnl / 1000) : 0;
  const liquidationPenalty = profile.liquidations * 30;
  const leveragePenalty = Math.floor(Math.max(profile.avgLeverageX100 - 200, 0) / 20);

  return Math.max(
    0,
    100 + winBonus + experienceBonus + volumeBonus + pnlBonus - liquidationPenalty - leveragePenalty
  );
}

export function liquidationPrice(collateral, leverage, isLong, entryPrice) {
  const size = collateral * leverage;
  const maintenance = (size * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;
  const lossToMaintenance = collateral - maintenance;
  const priceMove = size > 0 ? (lossToMaintenance * entryPrice) / size : 0;
  return isLong ? Math.max(entryPrice - priceMove, 0) : entryPrice + priceMove;
}

export function positionHealth(position, equity, maintenance) {
  return clamp((equity / maintenance) * 100, 0, 999);
}
