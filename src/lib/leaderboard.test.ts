import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { Outcome } from "@/lib/contracts";
import {
  buildLeaderboard,
  reactionSeconds,
  roundOpenedAt,
  type PlacedBet,
  type RosterPlayer,
  type RoundSnapshot,
} from "./leaderboard";

const ALICE = "0x1111111111111111111111111111111111111111" as Address;
const BOB = "0x2222222222222222222222222222222222222222" as Address;
const CARA = "0x3333333333333333333333333333333333333333" as Address;
const DAN = "0x4444444444444444444444444444444444444444" as Address;

function player(account: Address, displayName: string, active = true): RosterPlayer {
  return { account, displayName, active };
}

function round(roundId: bigint, bettingClosesAt: bigint, outcome: Outcome): RoundSnapshot {
  return { roundId, gameId: 1n, bettingClosesAt, outcome };
}

function bet(roundId: bigint, bettor: Address, blockTimestamp: bigint, logIndex: number): PlacedBet {
  return { roundId, player: bettor, blockTimestamp, logIndex };
}

describe("leaderboard ranking", () => {
  it("opens a round 60 seconds before betting closes", () => {
    expect(roundOpenedAt(1_060n)).toBe(1_000n);
    expect(roundOpenedAt(10n)).toBe(0n);
    expect(reactionSeconds(1_060n, 1_004n)).toBe(4);
    expect(reactionSeconds(1_060n, 900n)).toBe(0);
  });

  it("drops a player who lost a decisive round", () => {
    const board = buildLeaderboard({
      currentRoundId: 1n,
      roster: [player(ALICE, "Alice"), player(BOB, "Bob", false)],
      rounds: [round(1n, 1_060n, Outcome.Hi)],
      bets: [bet(1n, ALICE, 1_012n, 2), bet(1n, BOB, 1_004n, 1)],
    });

    expect(board.overall.map((row) => row.displayName)).toEqual(["Alice"]);
    expect(board.round.map((row) => row.displayName)).toEqual(["Alice"]);
  });

  it("drops a player who skipped a decisive round", () => {
    const board = buildLeaderboard({
      currentRoundId: 1n,
      roster: [player(ALICE, "Alice"), player(CARA, "Cara", false)],
      rounds: [round(1n, 1_060n, Outcome.Lo)],
      bets: [bet(1n, ALICE, 1_008n, 1)],
    });

    expect(board.overall.map((row) => row.displayName)).toEqual(["Alice"]);
    expect(board.round.map((row) => row.displayName)).toEqual(["Alice"]);
  });

  it("keeps the field after a refund and leaves the live round out of the overall total", () => {
    const roster = [
      player(ALICE, "Alice"),
      player(BOB, "Bob"),
      player(CARA, "Cara"),
      player(DAN, "Dan", false),
    ];
    const rounds = [round(1n, 1_060n, Outcome.Hi), round(2n, 2_060n, Outcome.Refund)];
    const bets = [
      bet(1n, ALICE, 1_010n, 1),
      bet(1n, DAN, 1_004n, 0),
      bet(2n, ALICE, 2_006n, 1),
      bet(2n, BOB, 2_003n, 0),
    ];

    const live = buildLeaderboard({ roster, rounds, bets, currentRoundId: 2n });
    expect(live.overall.map((row) => row.displayName)).toEqual(["Alice", "Bob", "Cara"]);
    expect(live.overall[0]?.cumulativeSeconds).toBe(10);
    expect(live.overall[1]?.cumulativeSeconds).toBeNull();
    expect(live.round.map((row) => [row.displayName, row.roundSeconds, row.overallRank])).toEqual([
      ["Bob", 3, 2],
      ["Alice", 6, 1],
      ["Cara", null, 3],
    ]);

    const next = buildLeaderboard({ roster, rounds, bets, currentRoundId: 3n });
    expect(next.overall.map((row) => [row.displayName, row.cumulativeSeconds])).toEqual([
      ["Bob", 3],
      ["Alice", 16],
      ["Cara", null],
    ]);
    expect(next.round.every((row) => row.roundSeconds === null)).toBe(true);
  });

  it("breaks equal times by earlier log, then address", () => {
    const board = buildLeaderboard({
      currentRoundId: 2n,
      roster: [player(BOB, "Bob"), player(ALICE, "Alice"), player(CARA, "Cara")],
      rounds: [round(1n, 1_060n, Outcome.Hi)],
      bets: [bet(1n, BOB, 1_010n, 2), bet(1n, ALICE, 1_010n, 1)],
    });

    expect(board.overall.map((row) => row.displayName)).toEqual(["Alice", "Bob", "Cara"]);
    expect(board.overall.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});
