"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { Phase, phaseLabel, type Round } from "@/lib/contracts";
import { type LeaderboardRow } from "@/lib/leaderboard";
import { shortAddress } from "@/lib/format";

type View = "round" | "overall";

export function Leaderboard(props: {
  gameId: bigint;
  roundId: bigint;
  phase: Phase;
  round?: Round;
  configured: boolean;
  self?: Address;
}) {
  const board = useLeaderboard(props);
  const [view, setView] = useState<View>("round");
  const emptyCopy = props.phase === Phase.Lobby || props.phase === Phase.AwaitingInitialBall
    ? "No players at the table yet."
    : "No players remain.";

  return (
    <section className={`panel leaderboard leaderboard--${view}`} aria-label="Leaderboard">
      <div className="panel__header">
        <h2>Leaderboard</h2>
        <span className="round-label">{props.roundId > 0n ? `Round ${props.roundId.toString()}` : phaseLabel[props.phase]}</span>
      </div>

      {props.configured ? (
        <>
          <div className="leaderboard__switch" role="group" aria-label="Leaderboard view">
            <button className="button button--ghost button--compact" type="button" aria-pressed={view === "round"} onClick={() => setView("round")}>
              This round
            </button>
            <button className="button button--ghost button--compact" type="button" aria-pressed={view === "overall"} onClick={() => setView("overall")}>
              Overall
            </button>
          </div>

          {board.loading && board.overall.length === 0 ? <p className="hint" role="status">Reading the table…</p> : null}
          {!board.loading && board.overall.length === 0 ? <p className="empty-state">{board.hint ?? emptyCopy}</p> : null}
          {board.overall.length > 0 ? (
            <>
              {board.hint ? <p className="hint">{board.hint}</p> : null}
              <LeaderboardPane mode="round" rows={board.round} self={props.self} timingKnown={board.timingKnown} />
              <LeaderboardPane mode="overall" rows={board.overall} self={props.self} timingKnown={board.timingKnown} />
            </>
          ) : null}
        </>
      ) : (
        <p className="empty-state">Leaderboard appears once the game contract is set.</p>
      )}
    </section>
  );
}

function LeaderboardPane(props: {
  mode: View;
  rows: LeaderboardRow[];
  self?: Address;
  timingKnown: boolean;
}) {
  const overall = props.mode === "overall";
  return (
    <div className={`leaderboard__pane leaderboard__pane--${props.mode}`}>
      <h3 className="leaderboard__title">{overall ? "Overall" : "This round"}</h3>
      <div className="leaderboard__columns round-label" aria-hidden="true">
        <span>#</span>
        <span>Player</span>
        <span>{overall ? "Total" : "Time"}</span>
        <span>{overall ? "Round" : "Overall"}</span>
      </div>
      <ol className="leaderboard__list">
        {props.rows.map((row) => {
          const you = isSameAccount(row.account, props.self);
          const tone = row.rank <= 3 ? " leaderboard__row--top" : "";
          return (
            <li className={`leaderboard__row${tone}${you ? " leaderboard__row--you" : ""}`} key={row.account}>
              <span className="leaderboard__pos">{row.rank}</span>
              <span className="leaderboard__name">
                {row.displayName || shortAddress(row.account)}
                {you ? <span className="leaderboard__you">You</span> : null}
              </span>
              <span className="leaderboard__metric">{overall ? formatTotal(row.cumulativeSeconds, props.timingKnown) : formatRoundTime(row, props.timingKnown)}</span>
              <span className="leaderboard__metric">{overall ? formatRoundTime(row, props.timingKnown) : `#${row.overallRank}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatRoundTime(row: LeaderboardRow, timingKnown: boolean) {
  if (!timingKnown) return "—";
  if (row.roundSeconds === null) return "Waiting";
  return `${row.roundSeconds}s`;
}

function formatTotal(seconds: number | null, timingKnown: boolean) {
  if (!timingKnown || seconds === null) return "—";
  return `${seconds}s`;
}

function isSameAccount(left: Address, right?: Address) {
  return Boolean(right && left.toLowerCase() === right.toLowerCase());
}
