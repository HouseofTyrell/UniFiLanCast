import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Device, NetworkEvent, HistorySample } from './models/types.js';
import { logger } from './utils/logger.js';

export interface DeviceRecord {
  id: string;
  mac?: string;
  name: string;
  type: string;
  firstSeen: number;
  lastSeen: number;
  known: boolean;
}

/**
 * SQLite-backed persistence: history snapshots, a durable device inventory
 * (with first-seen tracking), and an event log. Survives restarts so the map
 * has a "yesterday" and new-device detection isn't fooled by a reboot.
 */
export class Store {
  private db: Database.Database;

  private insertSnapshot: Database.Statement;
  private selectSnapshots: Database.Statement;
  private pruneSnapshots: Database.Statement;
  private getDeviceStmt: Database.Statement;
  private insertDeviceStmt: Database.Statement;
  private touchDeviceStmt: Database.Statement;
  private insertEventStmt: Database.Statement;
  private recentEventsStmt: Database.Statement;
  private pruneEventsStmt: Database.Statement;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        timestamp INTEGER PRIMARY KEY,
        data      TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id         TEXT PRIMARY KEY,
        mac        TEXT,
        name       TEXT,
        type       TEXT,
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        known      INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        severity    TEXT,
        type        TEXT,
        message     TEXT,
        related_ids TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    `);

    this.insertSnapshot = this.db.prepare(
      'INSERT OR REPLACE INTO snapshots (timestamp, data) VALUES (?, ?)'
    );
    this.selectSnapshots = this.db.prepare(
      'SELECT data FROM snapshots WHERE timestamp >= ? ORDER BY timestamp ASC'
    );
    this.pruneSnapshots = this.db.prepare('DELETE FROM snapshots WHERE timestamp < ?');
    this.getDeviceStmt = this.db.prepare('SELECT * FROM devices WHERE id = ?');
    this.insertDeviceStmt = this.db.prepare(
      `INSERT INTO devices (id, mac, name, type, first_seen, last_seen, known)
       VALUES (@id, @mac, @name, @type, @firstSeen, @lastSeen, 0)`
    );
    this.touchDeviceStmt = this.db.prepare(
      'UPDATE devices SET name = @name, type = @type, mac = @mac, last_seen = @lastSeen WHERE id = @id'
    );
    this.insertEventStmt = this.db.prepare(
      `INSERT INTO events (ts, severity, type, message, related_ids)
       VALUES (@ts, @severity, @type, @message, @relatedIds)`
    );
    this.recentEventsStmt = this.db.prepare(
      'SELECT ts, severity, type, message, related_ids FROM events ORDER BY ts DESC LIMIT ?'
    );
    this.pruneEventsStmt = this.db.prepare('DELETE FROM events WHERE ts < ?');

    logger.info(`Persistence store ready at ${dbPath}`);
  }

  saveSnapshot(sample: HistorySample): void {
    this.insertSnapshot.run(sample.timestamp, JSON.stringify(sample));
  }

  getHistory(minutes: number): HistorySample[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const rows = this.selectSnapshots.all(cutoff) as Array<{ data: string }>;
    return rows.map(r => JSON.parse(r.data) as HistorySample);
  }

  /**
   * Record the devices seen in this snapshot. Returns the ids of devices never
   * seen before (genuinely new — survives restarts, unlike an in-memory cache).
   */
  upsertDevices(devices: Device[], now: number): string[] {
    const newIds: string[] = [];
    const tx = this.db.transaction((items: Device[]) => {
      for (const d of items) {
        const existing = this.getDeviceStmt.get(d.id);
        const row = {
          id: d.id,
          mac: d.mac ?? null,
          name: d.name,
          type: d.type,
          lastSeen: now,
        };
        if (existing) {
          this.touchDeviceStmt.run(row);
        } else {
          this.insertDeviceStmt.run({ ...row, firstSeen: now });
          newIds.push(d.id);
        }
      }
    });
    tx(devices);
    return newIds;
  }

  getDevice(id: string): DeviceRecord | undefined {
    const row = this.getDeviceStmt.get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      mac: row.mac ?? undefined,
      name: row.name,
      type: row.type,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      known: !!row.known,
    };
  }

  markKnown(id: string, known: boolean): void {
    this.db.prepare('UPDATE devices SET known = ? WHERE id = ?').run(known ? 1 : 0, id);
  }

  appendEvents(events: NetworkEvent[]): void {
    if (events.length === 0) return;
    const tx = this.db.transaction((items: NetworkEvent[]) => {
      for (const e of items) {
        this.insertEventStmt.run({
          ts: e.ts,
          severity: e.severity,
          type: e.type,
          message: e.message,
          relatedIds: JSON.stringify(e.relatedIds ?? []),
        });
      }
    });
    tx(events);
  }

  getRecentEvents(limit = 200): NetworkEvent[] {
    const rows = this.recentEventsStmt.all(limit) as Array<any>;
    return rows.map(r => ({
      ts: r.ts,
      severity: r.severity,
      type: r.type,
      message: r.message,
      relatedIds: JSON.parse(r.related_ids || '[]'),
    }));
  }

  /** Whether the inventory is empty — used to seed silently on first run. */
  isInventoryEmpty(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
    return row.n === 0;
  }

  prune(retentionMinutes: number): void {
    const cutoff = Date.now() - retentionMinutes * 60 * 1000;
    this.pruneSnapshots.run(cutoff);
    // Keep events a bit longer than snapshots for forensics (min 7 days).
    const eventCutoff = Date.now() - Math.max(retentionMinutes, 7 * 24 * 60) * 60 * 1000;
    this.pruneEventsStmt.run(eventCutoff);
  }

  close(): void {
    this.db.close();
  }
}
