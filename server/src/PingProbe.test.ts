import { describe, it, expect } from 'vitest';
import { parsePing } from './PingProbe.js';

const macOS = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: icmp_seq=0 ttl=59 time=14.231 ms
64 bytes from 1.1.1.1: icmp_seq=1 ttl=59 time=12.004 ms

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 4 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 12.004/13.118/14.231/0.912 ms`;

const linux = `PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=59 time=18.6 ms

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 3 received, 25% packet loss, time 3004ms
rtt min/avg/max/mdev = 16.200/18.600/21.100/1.700 ms`;

const busybox = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: seq=0 ttl=59 time=15.000 ms

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 4 packets received, 0% packet loss
round-trip min/avg/max = 14.000/15.500/17.000 ms`;

const allLoss = `PING 10.0.0.99 (10.0.0.99): 56 data bytes

--- 10.0.0.99 ping statistics ---
4 packets transmitted, 0 packets received, 100.0% packet loss`;

describe('parsePing', () => {
  it('parses macOS output (min/avg/max/stddev)', () => {
    expect(parsePing(macOS)).toEqual({ latencyMs: 13.118, lossPct: 0 });
  });

  it('parses Linux iputils output (mdev) including partial loss', () => {
    const r = parsePing(linux);
    expect(r.latencyMs).toBe(18.6);
    expect(r.lossPct).toBeCloseTo(0.25, 6);
  });

  it('parses busybox/alpine output (min/avg/max, no mdev)', () => {
    expect(parsePing(busybox)).toEqual({ latencyMs: 15.5, lossPct: 0 });
  });

  it('reports 100% loss with no rtt line', () => {
    const r = parsePing(allLoss);
    expect(r.lossPct).toBe(1);
    expect(r.latencyMs).toBeUndefined();
  });

  it('returns empty for unrecognized output', () => {
    expect(parsePing('garbage')).toEqual({});
  });
});
