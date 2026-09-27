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
const MAX_LOG_WINDOWS = 6;
const PAGE_SIZE = 100n;
const BLOCK_READS = 4;
const SAFETY_POLL_MS = 15_000;
const TIMING_HINT = "Bet times could not be read. Ranks show players still in the game.";
const ROSTER_HINT = "The leaderboard could not be loaded.";

type RefreshMode = "all" | "roster" | "logs";

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

type ChainClient = NonNullable<ReturnType<typeof usePublicClient>>;
type SnapshotRound = Pick<Round, "gameId" | "bettingClosesAt" | "outcome">;

const logCaches = new Map<string, LogCache>();
const rosterCaches = new Map<string, PlayerView[]>();
const roundCaches = new Map<string, RoundSnapshot[]>();
let syncQueue: Promise<unknown> = Promise.resolve();

export function useLeaderboard(input: {
  gameId: bigint;
  roundId: bigint;
  configured: boolean;
  round?: Round;
}) {
  const client = usePublicClient();
  const gameKey = input.gameId.toString();
  const refreshRef = useRef<(mode: RefreshMode) => void>(() => {});
  const roundIdRef = useRef(input.roundId);
  const roundGameRef = useRef(gameKey);
  const loadedGameRef = useRef<string | null>(null);
  const snapshotRef = useRef<SnapshotRound | undefined>(undefined);
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
  const [seenGame, setSeenGame] = useState(gameKey);
  if (seenGame !== gameKey) {
    setSeenGame(gameKey);
    setBoard({ overall: [], round: [], loading: input.configured, hint: null, timingKnown: true });
  }

  useEffect(() => {
    if (roundGameRef.current !== gameKey) {
      roundGameRef.current = gameKey;
      roundIdRef.current = input.roundId;
    } else if (input.roundId > roundIdRef.current) {
      roundIdRef.current = input.roundId;
    }
    snapshotRef.current = closesAt !== undefined && snapshotGameId !== undefined && snapshotOutcome !== undefined
      ? { gameId: snapshotGameId, bettingClosesAt: closesAt, outcome: snapshotOutcome }
      : undefined;
  }, [closesAt, gameKey, input.roundId, snapshotGameId, snapshotOutcome]);

  useEffect(() => {
    if (loadedGameRef.current !== gameKey) {
      loadedGameRef.current = gameKey;
      lastGoodRef.current = null;
    }
    if (!input.configured || !client || !gameAddress) {
      refreshRef.current = () => {};
      return;
    }

    const activeClient = client;
    const contract = gameAddress;
    let cancelled = false;
    let inflight = false;
    let pending: RefreshMode | null = null;

    const apply = (next: Board, remember: boolean) => {
      if (cancelled) return;
      if (remember) lastGoodRef.current = next;
      setBoard(next);
    };

    const run = (mode: RefreshMode, queue: boolean) => {
      if (cancelled) return;
      if (inflight) {
        if (queue) pending = preferMode(pending, mode);
        return;
      }
      inflight = true;
      void (async () => {
        let modeToRun: RefreshMode | null = mode;
        while (modeToRun && !cancelled) {
          const current = modeToRun;
          pending = null;
          await loadBoard(current);
          modeToRun = pending;
        }
        inflight = false;
      })();
    };

    async function loadBoard(mode: RefreshMode) {
      const roundId = roundIdRef.current;
      const snapshot = snapshotRef.current;
      try {
        const roster = mode === "logs"
          ? rosterCaches.get(gameKey) ?? await fetchRoster(activeClient, contract, input.gameId)
          : await fetchRoster(activeClient, contract, input.gameId);
        rosterCaches.set(gameKey, roster);
        const rounds = await ensureRounds(activeClient, contract, input.gameId, gameKey, roundId, snapshot);
        const cache = logCaches.get(gameKey);
        const primed = Boolean(cache?.discoveryComplete && !cache.timingUnavailable);
        if (!(mode === "logs" && primed)) {
          apply(toBoard(roster, rounds, primed ? cache?.bets ?? [] : [], roundId, primed, null), true);
        }

        const synced = await enqueueSync(() => syncBets(activeClient, contract, input.gameId, rounds));
        if (cancelled) return;
        apply(toBoard(
          roster,
          rounds,
          synced.timingKnown ? synced.bets : [],
          roundIdRef.current,
          synced.timingKnown,
          synced.hint,
        ), true);
      } catch {
        const previous = lastGoodRef.current;
        apply(previous
          ? { ...previous, loading: false, hint: ROSTER_HINT }
          : { overall: [], round: [], loading: false, hint: ROSTER_HINT, timingKnown: false }, false);
      }
    }

    refreshRef.current = (mode) => run(mode, true);
    run("all", true);
    const timer = setInterval(() => run("logs", false), SAFETY_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run("all", true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, gameKey, input.configured, input.gameId]);

  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "BetPlaced",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current("logs"),
  });
  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "RoundOpened",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: (logs) => {
      for (const log of logs) {
        const roundId = log.args.roundId;
        if (roundId !== undefined && roundId > roundIdRef.current) roundIdRef.current = roundId;
      }
      refreshRef.current("logs");
    },
  });
  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "LobbyJoined",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current("roster"),
  });
  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "RoundSettled",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current("roster"),
  });
  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "RoundRefunded",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current("roster"),
  });
  useWatchContractEvent({
    address: gameAddress,
    abi: hiLoGameAbi,
    eventName: "GameEnded",
    enabled: input.configured && Boolean(gameAddress),
    onLogs: () => refreshRef.current("roster"),
  });

  if (!input.configured) {
    return { overall: [], round: [], loading: false, hint: null, timingKnown: true };
  }
  return board;
}

function preferMode(current: RefreshMode | null, next: RefreshMode) {
  const rank: Record<RefreshMode, number> = { logs: 0, roster: 1, all: 2 };
  if (!current || rank[next] > rank[current]) return next;
  return current;
}

function toBoard(
  roster: PlayerView[],
  rounds: RoundSnapshot[],
  bets: PlacedBet[],
  currentRoundId: bigint,
  timingKnown: boolean,
  hint: string | null,
): Board {
  return {
    ...buildLeaderboard({ roster, rounds, bets, currentRoundId }),
    loading: false,
    hint,
    timingKnown,
  };
}

function enqueueSync<T>(task: () => Promise<T>) {
  const run = syncQueue.then(task, task);
  syncQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function fetchRoster(client: ChainClient, contract: `0x${string}`, gameId: bigint) {
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

async function ensureRounds(
  client: ChainClient,
  contract: `0x${string}`,
  gameId: bigint,
  gameKey: string,
  roundId: bigint,
  snapshot: SnapshotRound | undefined,
) {
  const cached = roundCaches.get(gameKey) ?? [];
  const tip = cached.reduce((max, round) => round.roundId > max ? round.roundId : max, 0n);
  let rounds = cached;
  if (roundId > tip) {
    const extra = await fetchRounds(client, contract, gameId, roundId, tip);
    rounds = mergeRounds(cached, extra);
  }
  rounds = includeSnapshotRound(rounds, gameId, roundId, snapshot);
  roundCaches.set(gameKey, rounds);
  return rounds;
}

async function fetchRounds(
  client: ChainClient,
  contract: `0x${string}`,
  gameId: bigint,
  currentRoundId: bigint,
  floor = 0n,
) {
  const rounds: RoundSnapshot[] = [];
  let cursor = currentRoundId;
  while (cursor > floor && rounds.length < 200) {
    const batch: bigint[] = [];
    for (let index = 0n; index < 10n && cursor - index > floor; index++) batch.push(cursor - index);
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map((id) => client.readContract({
      address: contract,
      abi: hiLoGameAbi,
      functionName: "getRound",
      args: [id],
    })));
    let stop = false;
    results.forEach((round, index) => {
      if (stop) return;
      const roundId = batch[index];
      if (roundId === undefined || round.gameId !== gameId) {
        stop = true;
        return;
      }
      rounds.push({
        roundId,
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

function mergeRounds(cached: RoundSnapshot[], extra: RoundSnapshot[]) {
  const byId = new Map<string, RoundSnapshot>();
  for (const round of [...cached, ...extra]) byId.set(round.roundId.toString(), round);
  return [...byId.values()].sort((left, right) => left.roundId < right.roundId ? -1 : left.roundId > right.roundId ? 1 : 0);
}

function includeSnapshotRound(rounds: RoundSnapshot[], gameId: bigint, roundId: bigint, round?: SnapshotRound) {
  if (!round || roundId === 0n || round.gameId !== gameId || rounds.some((item) => item.roundId === roundId)) return rounds;
  return mergeRounds(rounds, [{
    roundId,
    gameId: round.gameId,
    bettingClosesAt: round.bettingClosesAt,
    outcome: round.outcome,
  }]);
}

async function syncBets(client: ChainClient, contract: `0x${string}`, gameId: bigint, rounds: RoundSnapshot[]) {
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
  if (!cache.discoveryComplete) {
    const configured = configuredFromBlock();
    if (rounds.length === 0) {
      cache.discoveryComplete = true;
      cache.nextBlock = head + 1n;
    } else if (configured !== null) {
      cache.discoveryComplete = true;
      cache.nextBlock = configured;
    } else {
      try {
        const start = await findStartBlock(client, contract, gameId, head);
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

async function findStartBlock(client: ChainClient, contract: `0x${string}`, gameId: bigint, head: bigint) {
  let cursor = head;
  let oldestFound: bigint | null = null;
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
    const blocks = logs.flatMap((log) => log.blockNumber == null ? [] : [log.blockNumber]);
    if (blocks.length === 0) return oldestFound;
    const oldestInWindow = blocks.reduce((min, block) => block < min ? block : min);
    oldestFound = oldestFound === null || oldestInWindow < oldestFound ? oldestInWindow : oldestFound;
    if (from === 0n) return oldestFound;
    cursor = from - 1n;
  }
  return null;
}

async function ingestBets(client: ChainClient, contract: `0x${string}`, cache: LogCache, fromBlock: bigint, toBlock: bigint) {
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
  let cursor = 0;
  async function readNext() {
    while (cursor < missing.length) {
      const blockNumber = missing[cursor];
      cursor += 1;
      if (blockNumber === undefined) continue;
      const block = await client.getBlock({ blockNumber });
      cache.timestamps.set(blockNumber.toString(), block.timestamp);
    }
  }
  const workers = Math.min(BLOCK_READS, missing.length);
  await Promise.all(Array.from({ length: workers }, () => readNext()));

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
