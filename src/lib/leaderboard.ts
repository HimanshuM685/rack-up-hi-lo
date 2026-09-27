import type { Address } from "viem";
import { Outcome } from "@/lib/contracts";

export const BETTING_DURATION_SECONDS = 60n;

export type RosterPlayer = {
  account: Address;
  displayName: string;
  active: boolean;
};

export type RoundSnapshot = {
  roundId: bigint;
  gameId: bigint;
  bettingClosesAt: bigint;
  outcome: Outcome;
};

export type PlacedBet = {
  roundId: bigint;
  player: Address;
  blockTimestamp: bigint;
  logIndex: number;
};

export type Standing = {
  account: Address;
  displayName: string;
  cumulativeSeconds: number | null;
  earliestCompleted: LogMark | null;
  roundSeconds: number | null;
  roundLog: LogMark | null;
};

export type LeaderboardRow = {
  rank: number;
  overallRank: number;
  account: Address;
  displayName: string;
  cumulativeSeconds: number | null;
  roundSeconds: number | null;
};

type LogMark = {
  blockTimestamp: bigint;
  logIndex: number;
};

export function roundOpenedAt(bettingClosesAt: bigint) {
  if (bettingClosesAt <= BETTING_DURATION_SECONDS) return 0n;
  return bettingClosesAt - BETTING_DURATION_SECONDS;
}

export function reactionSeconds(bettingClosesAt: bigint, blockTimestamp: bigint) {
  const delta = blockTimestamp - roundOpenedAt(bettingClosesAt);
  if (delta <= 0n) return 0;
  const asNumber = Number(delta);
  return Number.isSafeInteger(asNumber) ? asNumber : Number.MAX_SAFE_INTEGER;
}

export function mergeStandings(
  roster: RosterPlayer[],
  rounds: RoundSnapshot[],
  bets: PlacedBet[],
  currentRoundId: bigint,
): Standing[] {
  const players = new Map<string, RosterPlayer>();
  for (const player of roster) {
    if (!player.active) continue;
    const key = player.account.toLowerCase();
    if (!players.has(key)) players.set(key, player);
  }

  const roundsById = new Map(rounds.map((round) => [round.roundId, round]));
  const earliestBet = new Map<string, PlacedBet>();
  for (const bet of bets) {
    if (!roundsById.has(bet.roundId) || !players.has(bet.player.toLowerCase())) continue;
    const key = `${bet.player.toLowerCase()}:${bet.roundId}`;
    const current = earliestBet.get(key);
    if (!current || compareLogs(bet, current) < 0) earliestBet.set(key, bet);
  }

  return [...players.values()].map((player) => {
    const key = player.account.toLowerCase();
    let cumulativeSeconds: number | null = null;
    let earliestCompleted: LogMark | null = null;
    let roundSeconds: number | null = null;
    let roundLog: LogMark | null = null;

    for (const [betKey, bet] of earliestBet) {
      if (!betKey.startsWith(`${key}:`)) continue;
      const round = roundsById.get(bet.roundId);
      if (!round) continue;
      const seconds = reactionSeconds(round.bettingClosesAt, bet.blockTimestamp);
      const mark = { blockTimestamp: bet.blockTimestamp, logIndex: bet.logIndex };
      if (bet.roundId === currentRoundId) {
        roundSeconds = seconds;
        roundLog = mark;
      } else {
        cumulativeSeconds = (cumulativeSeconds ?? 0) + seconds;
        if (!earliestCompleted || compareLogs(mark, earliestCompleted) < 0) earliestCompleted = mark;
      }
    }

    return {
      account: player.account,
      displayName: player.displayName,
      cumulativeSeconds,
      earliestCompleted,
      roundSeconds,
      roundLog,
    };
  });
}

export function rankOverall(standings: Standing[]): LeaderboardRow[] {
  return [...standings].sort(compareOverall).map((standing, index) => toRow(standing, index + 1, index + 1));
}

export function rankRound(standings: Standing[], overall: LeaderboardRow[]): LeaderboardRow[] {
  const overallRank = new Map(overall.map((row) => [row.account.toLowerCase(), row.overallRank]));
  return [...standings]
    .sort(compareRound)
    .map((standing, index) => toRow(standing, index + 1, overallRank.get(standing.account.toLowerCase()) ?? index + 1));
}

export function buildLeaderboard(input: {
  roster: RosterPlayer[];
  rounds: RoundSnapshot[];
  bets: PlacedBet[];
  currentRoundId: bigint;
}) {
  const standings = mergeStandings(input.roster, input.rounds, input.bets, input.currentRoundId);
  const overall = rankOverall(standings);
  return { overall, round: rankRound(standings, overall) };
}

function toRow(standing: Standing, rank: number, overallRank: number): LeaderboardRow {
  return {
    rank,
    overallRank,
    account: standing.account,
    displayName: standing.displayName,
    cumulativeSeconds: standing.cumulativeSeconds,
    roundSeconds: standing.roundSeconds,
  };
}

function compareOverall(left: Standing, right: Standing) {
  const leftTimed = left.cumulativeSeconds !== null;
  const rightTimed = right.cumulativeSeconds !== null;
  if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
  if (left.cumulativeSeconds !== null && right.cumulativeSeconds !== null && left.cumulativeSeconds !== right.cumulativeSeconds) {
    return left.cumulativeSeconds - right.cumulativeSeconds;
  }
  const byLog = compareLogs(left.earliestCompleted, right.earliestCompleted);
  if (byLog !== 0) return byLog;
  return compareAddress(left.account, right.account);
}

function compareRound(left: Standing, right: Standing) {
  const leftTimed = left.roundSeconds !== null;
  const rightTimed = right.roundSeconds !== null;
  if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
  if (left.roundSeconds !== null && right.roundSeconds !== null && left.roundSeconds !== right.roundSeconds) {
    return left.roundSeconds - right.roundSeconds;
  }
  const byLog = compareLogs(left.roundLog, right.roundLog);
  if (byLog !== 0) return byLog;
  return compareAddress(left.account, right.account);
}

function compareLogs(left: LogMark | null, right: LogMark | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left.blockTimestamp !== right.blockTimestamp) return left.blockTimestamp < right.blockTimestamp ? -1 : 1;
  return left.logIndex - right.logIndex;
}

function compareAddress(left: Address, right: Address) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
