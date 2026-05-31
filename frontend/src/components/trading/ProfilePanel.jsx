import { Stat } from "../shared/Stat";
import { clamp, fmt } from "../../lib/format";

export function ProfilePanel({ activity, profile }) {
  return (
    <section className="profile-panel" aria-label="Reputation profile">
      <div className="panel-heading">
        <h2>Reputation</h2>
        <strong>{profile.reputationScore}</strong>
      </div>
      <div className="score-meter">
        <span style={{ width: `${clamp(profile.reputationScore, 0, 180) / 1.8}%` }} />
      </div>
      <div className="profile-grid">
        <Stat label="Trades" value={profile.totalTrades} />
        <Stat label="Wins" value={profile.winningTrades} />
        <Stat label="Losses" value={profile.losingTrades} />
        <Stat label="Liquidations" value={profile.liquidations} />
        <Stat label="Volume" value={fmt(profile.totalVolume, 0)} />
        <Stat label="Avg. lev." value={`${(profile.avgLeverageX100 / 100).toFixed(2)}x`} />
      </div>
      <div className="activity-log">
        {activity.map((entry, index) => (
          <div className="log-entry" key={`${entry}-${index}`}>
            {entry}
          </div>
        ))}
      </div>
    </section>
  );
}
