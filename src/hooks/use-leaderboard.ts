"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import {
  gameAddress,
  hiLoGameAbi,
  type PlayerView,
  type Round,
} from "@/lib/contracts";
import {
  buildLeaderboard,
  type LeaderboardRow,
  type PlacedBet,
  type RoundSnapshot,
} from "@/lib/leaderboard";

const LOG_WINDOW = 9_000n;
const MAX_LOG_WINDOWS = 80;
const PAGE_SIZE = 100n;
const TIMING_HINT = "Bet times could not be read. Ranks show players still in the game.";
const ROSTER_HINT = "The leaderboard could not be loaded.";

type LogCache = {
  nextBlock: bigint;
  discoveryComplete: boolean;
  timingUnavailable: boolean;
  bets: PlacedBet[];
  timestamps: Map<string, bigint>;
  seen: Set<string>;
};

type Board = {
  overall: LeaderboardRow[];
  round: LeaderboardRow[];
  loading: boolean;
  hint: string | null;
  timingKnown: boolean;
};

type ContractLog = {
  blockNumber: bigint | null;
  logIndex: number | null;
  args: { roundId?: bigint; player?: Address; gameId?: bigint };
};

const logCaches = new Map<string, LogCache>();
let syncQueue: Promise<unknown> = Promise.resolve();

export function useLeaderboard(input: {
  gameId: bigint;
  roundId: bigint;
  configured: boolean;
  round?: Round;
}) {
  const client = usePublicClient();
  const refreshRef = useRef<() => void>(() => {});
  const lastGoodRef = useRef<Board | null>(null);
  const [board, setBoard] = useState<Board>({
    overall: [],
    round: [],
    loading: input.configured,
    hint: null,
    timingKnown: true,
  });
  const closesAt = input.round?.bettingClosesAt;
  const snapshotGameId = input.round?.gameId;
  const snapshotOutcome = input.round?.outcome;
  const gameKey = input.gameId.toString();
  const gameKeyRef = useRef(gameKey);
  const [seenGame, setSeenGame] = useState(gameKey);
  if (seenGame !== gameKey) {
    setSeenGame(gameKey);
    setBoard({ overall: [], round: [], loading: input.configured, hint: null, timingKnown: true });
  }

  useEffect(() => {
    if (gameKeyRef.current !== gameKey) {
      gameKeyRef.current = gameKey;
      lastGoodRef.current = null;
    }
    if (!input.configured || !client || !gameAddress) {
      refreshRef.current = () => {};
      return;
    }

    const activeClient = client;
    const contract = gameAddress;
    const snapshot = closesAt !== undefined && snapshotGameId !== undefined && snapshotOutcome !== undefined
      ? { gameId: snapshotGameId, bettingClosesAt: closesAt, outcome: snapshotOutcome }
      : undefined;
    let cancelled = false;
    let request = 0;

    const run = async () => {
      const current = ++request;
      const apply = (next: Board, remember: boolean) => {
        if (cancelled || current !== request) return;
        if (remember) lastGoodRef.current = next;
        setBoard(next);
      };

      try {
        const roster = await fetchRoster(activeClient, contract, input.gameId);
        const walked = await fetchRounds(activeClient, contract, input.gameId, input.roundId);
        const rounds = includeSnapshotRound(walked, input.gameId, input.roundId, snapshot);
        let hint: string | null = null;
        let bets: PlacedBet[] = [];
        let timingKnown = true;
        try {
          const synced = await enqueueSync(() => syncBets(activeClient, contract, input.gameId, rounds));
          bets = synced.timingKnown ? synced.bets : [];
          timingKnown = synced.timingKnown;
          hint = synced.hint;
        } catch {
          timingKnown = false;
          hint = TIMING_HINT;
        }
        const ranked = buildLeaderboard({
          roster,
          rounds,
          bets,
          currentRoundId: input.roundId,
        });
        apply({ ...ranked, loading: false, hint, timingKnown }, true);
      } catch {
        const previous = lastGoodRef.current;
        apply(previous
          ? { ...previous, loading: false, hint: ROSTER_HINT }
          : { overall: [], round: [], loading: false, hint: ROSTER_HINT, timingKnown: false }, false);
      }
    };

    refreshRef.current = () => { void run(); };
    void run();
    const timer = setInterval(() => void run(), 4_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, closesAt, gameKey, input.configured, input.gameId, input.roundId, snapshotGameId, snapshotOutcome]);

  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current(),
  });

  if (!input.configured) {
    return { overall: [], round: [], loading: false, hint: null, timingKnown: true };
  }
  return board;
}

function enqueueSync<T>(task: () => Promise<T>) {
  const run = syncQueue.then(task, task);
  syncQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function fetchRoster(client: NonNullable<ReturnType<typeof usePublicClient>>, contract: `0x${string}`, gameId: bigint) {
  const counts = await client.readContract({
    address: contract,
    abi: hiLoGameAbi,
    functionName: "getPlayerCount",
    args: [gameId],
  });
  const total = counts[0];
  const players: PlayerView[] = [];
  for (let batchStart = 0n; batchStart < total; batchStart += PAGE_SIZE * 4n) {
    const offsets: bigint[] = [];
    for (let offset = batchStart; offset < total && offset < batchStart + PAGE_SIZE * 4n; offset += PAGE_SIZE) {
      offsets.push(offset);
    }
    const pages = await Promise.all(offsets.map((offset) => client.readContract({
      address: contract,
      abi: hiLoGameAbi,
      functionName: "getPlayerPage",
      args: [gameId, offset, PAGE_SIZE],
    })));
    for (const page of pages) players.push(...page);
  }
  return players;
}

async function fetchRounds(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  contract: `0x${string}`,
  gameId: bigint,
  currentRoundId: bigint,
) {
  const rounds: RoundSnapshot[] = [];
  let cursor = currentRoundId;
  while (cursor > 0n && rounds.length < 200) {
    const batch: bigint[] = [];
    for (let index = 0n; index < 10n && cursor - index > 0n; index++) batch.push(cursor - index);
    const results = await Promise.all(batch.map((roundId) => client.readContract({
      address: contract,
      abi: hiLoGameAbi,
      functionName: "getRound",
      args: [roundId],
    })));
    let stop = false;
    results.forEach((round, index) => {
      if (stop) return;
      if (round.gameId !== gameId) {
        stop = true;
        return;
      }
      rounds.push({
        roundId: batch[index],
        gameId: round.gameId,
        bettingClosesAt: round.bettingClosesAt,
        outcome: Number(round.outcome),
      });
    });
    if (stop) break;
    cursor -= BigInt(batch.length);
  }
  return rounds.reverse();
}

function includeSnapshotRound(
  rounds: RoundSnapshot[],
  gameId: bigint,
  roundId: bigint,
  round?: Pick<Round, "gameId" | "bettingClosesAt" | "outcome">,
) {
  if (!round || roundId === 0n || round.gameId !== gameId || rounds.some((item) => item.roundId === roundId)) return rounds;
  return [...rounds, {
    roundId,
    gameId: round.gameId,
    bettingClosesAt: round.bettingClosesAt,
    outcome: round.outcome,
  }].sort((left, right) => (left.roundId < right.roundId ? -1 : left.roundId > right.roundId ? 1 : 0));
}

async function syncBets(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  contract: `0x${string}`,
  gameId: bigint,
  rounds: RoundSnapshot[],
) {
  const key = gameId.toString();
  const cache = logCaches.get(key) ?? {
    nextBlock: 0n,
    discoveryComplete: false,
    timingUnavailable: false,
    bets: [],
    timestamps: new Map<string, bigint>(),
    seen: new Set<string>(),
  };
  logCaches.set(key, cache);

  const head = await client.getBlockNumber();
  const oldest = rounds[0]?.roundId;
  if (!cache.discoveryComplete) {
    const configured = configuredFromBlock();
    if (!oldest) {
      cache.discoveryComplete = true;
      cache.nextBlock = head + 1n;
    } else if (configured !== null) {
      cache.discoveryComplete = true;
      cache.nextBlock = configured;
    } else {
      try {
        const start = await findStartBlock(client, contract, gameId, oldest, head);
        cache.discoveryComplete = true;
        cache.timingUnavailable = start === null;
        cache.nextBlock = start ?? head + 1n;
      } catch {
        cache.discoveryComplete = true;
        cache.timingUnavailable = true;
        cache.nextBlock = head + 1n;
      }
    }
  }

  if (cache.discoveryComplete && !cache.timingUnavailable && cache.nextBlock <= head) {
    let from = cache.nextBlock;
    try {
      while (from <= head) {
        const to = from + LOG_WINDOW - 1n > head ? head : from + LOG_WINDOW - 1n;
        await ingestBets(client, contract, cache, from, to);
        from = to + 1n;
        cache.nextBlock = from;
      }
    } catch {
      cache.timingUnavailable = cache.bets.length === 0;
      if (cache.bets.length > 0) {
        return { bets: cache.bets, timingKnown: true, hint: "Bet times may be out of date." };
      }
    }
  }

  return {
    bets: cache.bets,
    timingKnown: !cache.timingUnavailable,
    hint: cache.timingUnavailable ? TIMING_HINT : null,
  };
}

async function findStartBlock(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  contract: `0x${string}`,
  gameId: bigint,
  oldestRoundId: bigint,
  head: bigint,
) {
  let cursor = head;
  for (let scanned = 0; scanned < MAX_LOG_WINDOWS && cursor >= 0n; scanned++) {
    const from = cursor >= LOG_WINDOW ? cursor - LOG_WINDOW + 1n : 0n;
    const logs = await client.getContractEvents({
      address: contract,
      abi: hiLoGameAbi,
      eventName: "RoundOpened",
      args: { gameId },
      fromBlock: from,
      toBlock: cursor,
    }) as ContractLog[];
    const match = logs.find((log) => log.args.roundId === oldestRoundId && log.blockNumber != null);
    if (match?.blockNumber != null) return match.blockNumber;
    if (from === 0n) return null;
    cursor = from - 1n;
  }
  return null;
}

async function ingestBets(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  contract: `0x${string}`,
  cache: LogCache,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const logs = await client.getContractEvents({
    address: contract,
    abi: hiLoGameAbi,
    eventName: "BetPlaced",
    fromBlock,
    toBlock,
  }) as ContractLog[];
  const missing: bigint[] = [];
  for (const log of logs) {
    if (log.blockNumber == null || cache.timestamps.has(log.blockNumber.toString())) continue;
    if (!missing.some((blockNumber) => blockNumber === log.blockNumber)) missing.push(log.blockNumber);
  }
  await Promise.all(missing.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber });
    cache.timestamps.set(blockNumber.toString(), block.timestamp);
  }));

  for (const log of logs) {
    const { roundId, player } = log.args;
    if (roundId == null || player == null || log.blockNumber == null) continue;
    const id = `${log.blockNumber}:${log.logIndex ?? 0}`;
    const blockTimestamp = cache.timestamps.get(log.blockNumber.toString());
    if (cache.seen.has(id) || blockTimestamp === undefined) continue;
    cache.seen.add(id);
    cache.bets.push({ roundId, player, blockTimestamp, logIndex: log.logIndex ?? 0 });
  }
}

function configuredFromBlock() {
  const raw = process.env.NEXT_PUBLIC_GAME_FROM_BLOCK;
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}
