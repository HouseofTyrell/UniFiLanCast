import { NetworkEvent, EventSeverity, EventType } from './models/types.js';
import { logger } from './utils/logger.js';

export type WebhookFormat = 'auto' | 'discord' | 'slack' | 'json';

export interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  format?: WebhookFormat;
  /** Suppress repeats of the same alert within this window (default 300s). */
  throttleSeconds?: number;
  /** Lowest severity that triggers an alert (default 'warning'). */
  minSeverity?: EventSeverity;
  rules?: {
    newDevice?: boolean;
    deviceOffline?: boolean;
    latencySpike?: boolean;
    packetLoss?: boolean;
    wanIssue?: boolean;
  };
}

const SEVERITY_RANK: Record<EventSeverity, number> = { info: 0, warning: 1, error: 2 };

// Which alert rule gates each event type. Types absent here are never alerted.
const EVENT_RULE: Partial<Record<EventType, keyof NonNullable<AlertConfig['rules']>>> = {
  new_device: 'newDevice',
  offline: 'deviceOffline',
  device_reconnect: 'deviceOffline',
  latency_spike: 'latencySpike',
  packet_loss: 'packetLoss',
  wan_issue: 'wanIssue',
};

const DEFAULT_RULES = {
  newDevice: true,
  deviceOffline: true,
  latencySpike: true,
  packetLoss: true,
  wanIssue: true,
};

/**
 * Evaluates network events against alert rules and pushes notifications to a
 * webhook (Discord, Slack, or generic JSON). De-duplicates and throttles so a
 * flapping device can't spam the channel.
 */
export class AlertManager {
  private enabled: boolean;
  private webhookUrl?: string;
  private format: WebhookFormat;
  private throttleMs: number;
  private minSeverity: EventSeverity;
  private rules: Required<NonNullable<AlertConfig['rules']>>;
  private lastSent = new Map<string, number>();

  constructor(config: AlertConfig) {
    this.enabled = config.enabled && !!config.webhookUrl;
    this.webhookUrl = config.webhookUrl;
    this.format = config.format ?? 'auto';
    this.throttleMs = (config.throttleSeconds ?? 300) * 1000;
    this.minSeverity = config.minSeverity ?? 'warning';
    this.rules = { ...DEFAULT_RULES, ...(config.rules ?? {}) };

    if (this.enabled) {
      logger.info(
        { format: this.resolveFormat(), throttleSeconds: this.throttleMs / 1000 },
        'Alerting enabled'
      );
    }
  }

  /** Process a batch of events from a snapshot; dispatch any that qualify. */
  async process(events: NetworkEvent[]): Promise<void> {
    if (!this.enabled || events.length === 0) return;

    const now = Date.now();
    for (const event of events) {
      if (!this.shouldAlert(event, now)) continue;
      // Only start the throttle window once delivery actually succeeds —
      // otherwise a webhook outage silently suppresses every retry.
      const ok = await this.dispatch(event);
      if (ok) this.lastSent.set(this.dedupeKey(event), now);
    }
  }

  private shouldAlert(event: NetworkEvent, now: number): boolean {
    const rule = EVENT_RULE[event.type];
    if (!rule || !this.rules[rule]) return false;
    if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[this.minSeverity]) return false;

    const last = this.lastSent.get(this.dedupeKey(event));
    if (last !== undefined && now - last < this.throttleMs) return false;
    return true;
  }

  private dedupeKey(event: NetworkEvent): string {
    return `${event.type}:${(event.relatedIds ?? []).join(',')}`;
  }

  private resolveFormat(): Exclude<WebhookFormat, 'auto'> {
    if (this.format !== 'auto') return this.format;
    const url = this.webhookUrl ?? '';
    if (url.includes('discord.com') || url.includes('discordapp.com')) return 'discord';
    if (url.includes('hooks.slack.com')) return 'slack';
    return 'json';
  }

  /** Dispatch one alert. Returns true only on confirmed successful delivery. */
  private async dispatch(event: NetworkEvent): Promise<boolean> {
    if (!this.webhookUrl) return false;
    const text = `${this.icon(event.severity)} ${event.message}`;

    let body: unknown;
    switch (this.resolveFormat()) {
      case 'discord':
        body = { content: text };
        break;
      case 'slack':
        body = { text };
        break;
      default:
        body = { severity: event.severity, type: event.type, message: event.message, ts: event.ts };
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Alert webhook returned non-OK');
        return false;
      }
      logger.info({ type: event.type }, 'Alert dispatched');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to dispatch alert');
      return false;
    }
  }

  private icon(severity: EventSeverity): string {
    return severity === 'error' ? '🔴' : severity === 'warning' ? '🟠' : '🔵';
  }
}
