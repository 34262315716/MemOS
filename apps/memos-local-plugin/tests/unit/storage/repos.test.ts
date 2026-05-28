import { describe, expect, it } from "vitest";

import { makeTmpDb } from "../../helpers/tmp-db.js";

function vec(arr: number[]): Float32Array {
  return new Float32Array(arr);
}

describe("storage/repos — happy paths", () => {
  it("sessions: upsert / touch / list", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.sessions.upsert({
        id: "s1",
        agent: "openclaw",
        startedAt: 1,
        lastSeenAt: 1,
        meta: {},
      });
      repos.sessions.touch("s1", 42, { hostPid: 123 });
      const got = repos.sessions.getById("s1")!;
      expect(got.lastSeenAt).toBe(42);
      expect(got.meta).toEqual({ hostPid: 123 });

      const recent = repos.sessions.listRecent(10);
      expect(recent.map((s) => s.id)).toEqual(["s1"]);
    } finally {
      cleanup();
    }
  });

  it("episodes: open → append trace → close", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.sessions.upsert({
        id: "s",
        agent: "openclaw",
        startedAt: 0,
        lastSeenAt: 0,
        meta: {},
      });
      repos.episodes.insert({
        id: "e1",
        sessionId: "s",
        startedAt: 1,
        endedAt: null,
        traceIds: [],
        rTask: null,
        status: "open",
      });

      expect(repos.episodes.getOpenForSession("s")!.id).toBe("e1");

      repos.episodes.appendTrace("e1", ["t1", "t2"]);
      expect(repos.episodes.getById("e1")!.traceIds).toEqual(["t1", "t2"]);

      repos.episodes.close("e1", 99, 0.8);
      const closed = repos.episodes.getById("e1")!;
      expect(closed.status).toBe("closed");
      expect(closed.endedAt).toBe(99);
      expect(closed.rTask).toBeCloseTo(0.8);
      expect(repos.episodes.getOpenForSession("s")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("traces: insert, list with filter, bulk fetch, updateScore", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.sessions.upsert({
        id: "s",
        agent: "openclaw",
        startedAt: 0,
        lastSeenAt: 0,
        meta: {},
      });
      repos.episodes.insert({
        id: "e",
        sessionId: "s",
        startedAt: 0,
        endedAt: null,
        traceIds: [],
        rTask: null,
        status: "open",
      });

      for (let i = 0; i < 3; i++) {
        repos.traces.insert({
          id: `t${i}`,
          episodeId: "e",
          sessionId: "s",
          ts: 10 * (i + 1),
          userText: `u${i}`,
          agentText: `a${i}`,
          toolCalls: [],
          reflection: null,
          value: i === 0 ? -0.9 : 0.5,
          alpha: 0.3,
          rHuman: null,
          priority: 0.1 * i,
          tags: [],
          vecSummary: vec([i, 0]),
          vecAction: null,
          turnId: 0 as never,
          schemaVersion: 1,
        });
      }

      const all = repos.traces.list({ sessionId: "s" });
      expect(all.length).toBe(3);
      expect(all[0]!.ts).toBeGreaterThan(all[1]!.ts); // newest first by default

      const highAbs = repos.traces.list({ minAbsValue: 0.8 });
      expect(highAbs.map((t) => t.id)).toEqual(["t0"]);

      const bulk = repos.traces.getManyByIds(["t0", "t2", "missing"]);
      expect(bulk.map((t) => t.id).sort()).toEqual(["t0", "t2"]);

      repos.traces.updateScore("t0", { value: -0.5, alpha: 0.6, priority: 1.5 });
      expect(repos.traces.getById("t0")!.value).toBe(-0.5);
      expect(repos.traces.getById("t0")!.priority).toBe(1.5);
    } finally {
      cleanup();
    }
  });

  // Regression for https://github.com/MemTensor/MemOS/issues/1593 — the
  // metrics dashboard used to walk `traces.list({ limit: 10_000 })`,
  // which `clampLimit` silently capped at 500 rows, so the Web UI's
  // Memory count plateaued at 500 once the database grew beyond that.
  // The new SQL aggregates must report the real row count.
  it("traces: aggregateMetrics + listTimestampsSince ignore the 500-row page cap", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      // Seed sessions referenced by trace FKs: one primary plus a small
      // pool of "extras" so we can vary the session_id column and still
      // satisfy the foreign key.
      const sessionIds = ["s-bulk", ...Array.from({ length: 7 }, (_, i) => `s-extra-${i}`)];
      for (const id of sessionIds) {
        repos.sessions.upsert({
          id,
          agent: "openclaw",
          startedAt: 0,
          lastSeenAt: 0,
          meta: {},
        });
      }
      repos.episodes.insert({
        id: "e-bulk",
        sessionId: "s-bulk",
        startedAt: 0,
        endedAt: null,
        traceIds: [],
        rTask: null,
        status: "open",
      });

      // Seed enough rows that the legacy `list({ limit: 10_000 })` path
      // would have clamped at 500. Inserting 612 rows is enough to make
      // sure the aggregate beats the cap by a comfortable margin.
      const TOTAL = 612;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTodayMs = startOfToday.getTime();
      let todayWrites = 0;
      let withEmbeddings = 0;
      for (let i = 0; i < TOTAL; i++) {
        // Stagger ts so half land before "today" and half after, plus
        // toggle vectors on every other row to exercise the embeddings
        // CASE branch and the session-distinctness counter.
        const ts = i < 300 ? startOfTodayMs - (300 - i) * 1_000 : startOfTodayMs + (i - 300) * 1_000;
        if (ts >= startOfTodayMs) todayWrites += 1;
        const hasVec = i % 2 === 0;
        if (hasVec) withEmbeddings += 1;
        repos.traces.insert({
          id: `tr-${i}`,
          episodeId: "e-bulk",
          sessionId: i % 3 === 0 ? "s-bulk" : `s-extra-${i % 7}`,
          ts,
          userText: "",
          agentText: "",
          toolCalls: [],
          reflection: null,
          value: 0,
          alpha: 0,
          rHuman: null,
          priority: 0,
          tags: [],
          vecSummary: hasVec ? vec([i, 0]) : null,
          vecAction: null,
          // Use a distinct turnId per row so `countTurns` matches `TOTAL`.
          turnId: i as never,
          schemaVersion: 1,
        });
      }

      // `list()` is still page-limited — proves the cap is real and the
      // legacy implementation would have missed everything past row 500.
      expect(repos.traces.list({ limit: 10_000 }).length).toBeLessThanOrEqual(500);

      // The new SQL aggregates must see every row.
      const stats = repos.traces.aggregateMetrics({ startOfTodayMs });
      expect(stats.writesToday).toBe(todayWrites);
      expect(stats.embeddings).toBe(withEmbeddings);
      // Distinct sessions = "s-bulk" + 7 "s-extra-*" buckets.
      expect(stats.sessions).toBe(8);

      // countTurns is the source for the "Memories" KPI — confirm it
      // also reports every row, not just the first page.
      expect(repos.traces.countTurns({})).toBe(TOTAL);

      // The viewer needs ts past row 500 to draw its daily-writes chart.
      const tsList = repos.traces.listTimestampsSince({
        sinceMs: 0,
      });
      expect(tsList.length).toBe(TOTAL);
    } finally {
      cleanup();
    }
  });

  it("policies: upsert + stats + vector filter by status", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.policies.upsert({
        id: "p_cand",
        title: "cand",
        trigger: "",
        procedure: "",
        verification: "",
        boundary: "",
        support: 1,
        gain: 0,
        status: "candidate",
        sourceEpisodeIds: [],
        inducedBy: "proto",
        decisionGuidance: { preference: [], antiPattern: [] },
        vec: vec([1, 0]),
        createdAt: 1,
        updatedAt: 1,
      });
      repos.policies.upsert({
        id: "p_active",
        title: "active",
        trigger: "",
        procedure: "",
        verification: "",
        boundary: "",
        support: 5,
        gain: 0.4,
        status: "active",
        sourceEpisodeIds: [],
        inducedBy: "proto",
        decisionGuidance: { preference: [], antiPattern: [] },
        vec: vec([1, 0]),
        createdAt: 1,
        updatedAt: 1,
      });

      repos.policies.updateStats("p_cand", {
        support: 3,
        gain: 0.2,
        status: "candidate",
        updatedAt: 2,
      });
      expect(repos.policies.getById("p_cand")!.support).toBe(3);

      const active = repos.policies.list({ status: "active" });
      expect(active.map((p) => p.id)).toEqual(["p_active"]);

      const hits = repos.policies.searchByVector(vec([1, 0]), 5, {
        statusIn: ["active"],
      });
      expect(hits.map((h) => h.id)).toEqual(["p_active"]);

      const textHits = repos.policies.searchByText('"active"', 5, {
        statusIn: ["active"],
      });
      expect(textHits.map((h) => h.id)).toEqual(["p_active"]);

      const patternHits = repos.policies.searchByPattern(["act"], 5, {
        statusIn: ["active"],
      });
      expect(patternHits.map((h) => h.id)).toEqual(["p_active"]);
    } finally {
      cleanup();
    }
  });

  it("skills: insert + bumpTrial + unique name constraint", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.skills.insert({
        id: "sk1",
        name: "retry-shell-with-sudo",
        status: "candidate",
        invocationGuide: "…",
        procedureJson: null,
        eta: 0,
        support: 1,
        gain: 0.1,
        trialsAttempted: 0,
        trialsPassed: 0,
        sourcePolicyIds: [],
        sourceWorldModelIds: [],
        evidenceAnchors: [],
        vec: vec([1, 0]),
        createdAt: 1,
        updatedAt: 1,
        version: 1,
      });

      expect(() =>
        repos.skills.insert({
          id: "sk2",
          name: "retry-shell-with-sudo", // same name
          status: "candidate",
          invocationGuide: "",
          procedureJson: null,
          eta: 0,
          support: 0,
          gain: 0,
          trialsAttempted: 0,
          trialsPassed: 0,
          sourcePolicyIds: [],
          sourceWorldModelIds: [],
          evidenceAnchors: [],
          vec: null,
          createdAt: 1,
          updatedAt: 1,
          version: 1,
        }),
      ).toThrow(/UNIQUE/i);

      const after = repos.skills.bumpTrial("sk1", true, 2);
      expect(after).toEqual({ trialsAttempted: 1, trialsPassed: 1, eta: 0.5 });
      const after2 = repos.skills.bumpTrial("sk1", false, 3);
      expect(after2.eta).toBeCloseTo(1 / 3, 5);
    } finally {
      cleanup();
    }
  });

  it("feedback: insert, scoped list, polarity filter", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.sessions.upsert({
        id: "s",
        agent: "openclaw",
        startedAt: 0,
        lastSeenAt: 0,
        meta: {},
      });
      repos.episodes.insert({
        id: "e",
        sessionId: "s",
        startedAt: 0,
        endedAt: null,
        traceIds: [],
        rTask: null,
        status: "open",
      });

      repos.feedback.insert({
        id: "f1",
        ts: 10,
        episodeId: "e",
        traceId: null,
        channel: "explicit",
        polarity: "positive",
        magnitude: 0.9,
        rationale: "great",
        raw: null,
      });
      repos.feedback.insert({
        id: "f2",
        ts: 20,
        episodeId: "e",
        traceId: null,
        channel: "implicit",
        polarity: "negative",
        magnitude: 0.5,
        rationale: null,
        raw: { tool: "shell" },
      });

      const forEpisode = repos.feedback.getForEpisode("e");
      expect(forEpisode.map((f) => f.id)).toEqual(["f2", "f1"]);

      const neg = repos.feedback.list({ polarity: "negative" });
      expect(neg.map((f) => f.id)).toEqual(["f2"]);
      expect(neg[0]!.raw).toEqual({ tool: "shell" });
    } finally {
      cleanup();
    }
  });

  it("candidate_pool: upsert, list by signature, prune, promote", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.policies.upsert({
        id: "p1",
        title: "t",
        trigger: "",
        procedure: "",
        verification: "",
        boundary: "",
        support: 0,
        gain: 0,
        status: "candidate",
        sourceEpisodeIds: [],
        inducedBy: "",
        decisionGuidance: { preference: [], antiPattern: [] },
        vec: null,
        createdAt: 0,
        updatedAt: 0,
      });
      repos.candidatePool.upsert({
        id: "c1",
        policyId: null,
        evidenceTraceIds: ["t1"],
        signature: "sig-a",
        similarity: 0.7,
        expiresAt: 1000,
      });
      repos.candidatePool.upsert({
        id: "c1",
        policyId: null,
        evidenceTraceIds: ["t1", "t2"],
        signature: "sig-a",
        similarity: 0.8,
        expiresAt: 1000,
      });
      const a = repos.candidatePool.listBySignature("sig-a");
      expect(a.length).toBe(1);
      expect(a[0]!.similarity).toBeCloseTo(0.8);
      expect(a[0]!.evidenceTraceIds).toEqual(["t1", "t2"]);

      repos.candidatePool.promote("c1", "p1");
      expect(repos.candidatePool.getById("c1")!.policyId).toBe("p1");

      const pruned = repos.candidatePool.prune(2000);
      expect(pruned).toBe(1);
      expect(repos.candidatePool.list().length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("decision_repairs: insert, markValidated, recentForContext", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.decisionRepairs.insert({
        id: "r1",
        ts: 10,
        contextHash: "h1",
        preference: "p",
        antiPattern: "a",
        highValueTraceIds: ["t1"],
        lowValueTraceIds: ["t2"],
        validated: false,
      });
      repos.decisionRepairs.insert({
        id: "r2",
        ts: 20,
        contextHash: "h1",
        preference: "p2",
        antiPattern: "a2",
        highValueTraceIds: [],
        lowValueTraceIds: [],
        validated: false,
      });
      const recent = repos.decisionRepairs.recentForContext("h1");
      expect(recent.map((r) => r.id)).toEqual(["r2", "r1"]);
      repos.decisionRepairs.markValidated("r1");
      expect(repos.decisionRepairs.getById("r1")!.validated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("audit: append + list + listKind", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      const id1 = repos.audit.append({
        ts: 1,
        actor: "system",
        kind: "config.update",
        target: "viewer.port",
        detail: { from: 18910, to: 18920 },
      });
      repos.audit.append({
        ts: 2,
        actor: "user",
        kind: "skill.retire",
        target: "sk-id",
        detail: {},
      });
      repos.audit.append({
        ts: 3,
        actor: "system",
        kind: "config.update",
        target: "hub.enabled",
        detail: { value: true },
      });

      expect(repos.audit.getById(id1)!.detail).toEqual({ from: 18910, to: 18920 });
      expect(repos.audit.listKind("config.update", 10).map((a) => a.target)).toEqual([
        "hub.enabled",
        "viewer.port",
      ]);
      expect(repos.audit.list({ limit: 5 }).length).toBe(3);
    } finally {
      cleanup();
    }
  });

  it("kv: set/get/delete + metadata", () => {
    const { repos, cleanup } = makeTmpDb();
    try {
      repos.kv.set("system.installed_version", "2.0.0-alpha.1");
      expect(repos.kv.get("system.installed_version", "")).toBe("2.0.0-alpha.1");

      const meta = repos.kv.getWithMeta("system.installed_version", "");
      expect(meta.updatedAt).toBeGreaterThan(0);

      repos.kv.set("flags", { debug: true });
      expect(repos.kv.get<{ debug: boolean }>("flags", { debug: false }).debug).toBe(true);

      repos.kv.del("flags");
      expect(repos.kv.get("flags", null)).toBeNull();
    } finally {
      cleanup();
    }
  });
});
