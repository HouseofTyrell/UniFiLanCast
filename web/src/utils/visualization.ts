import {
  Device,
  Link,
  WeatherSignals,
  VisualizationNode,
  Filter,
  DeviceType,
} from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export class NetworkVisualization {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: Map<string, VisualizationNode> = new Map();
  private centerX = 0;
  private centerY = 0;
  private hoveredNode: VisualizationNode | null = null;
  private particles: Particle[] = [];
  private animationFrame = 0;
  private deviceIcons: Map<string, HTMLImageElement> = new Map();
  private iconsLoaded = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.loadDeviceIcons();
  }

  private loadDeviceIcons() {
    const iconPaths = {
      gateway: '/icons/device-gateway.svg',
      switch: '/icons/device-switch.svg',
      ap: '/icons/device-ap.svg',
      client: '/icons/device-laptop.svg',
      server: '/icons/device-server.svg',
      router: '/icons/device-router.svg',
      cloud: '/icons/device-cloud.svg',
    };

    let loadedCount = 0;
    const totalIcons = Object.keys(iconPaths).length;

    for (const [type, path] of Object.entries(iconPaths)) {
      const img = new Image();
      img.onload = () => {
        loadedCount++;
        if (loadedCount === totalIcons) {
          this.iconsLoaded = true;
        }
      };
      img.onerror = () => {
        console.warn(`Failed to load icon: ${path}`);
        loadedCount++;
        if (loadedCount === totalIcons) {
          this.iconsLoaded = true;
        }
      };
      img.src = path;
      this.deviceIcons.set(type, img);
    }
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.centerX = this.canvas.width / 2;
    this.centerY = this.canvas.height / 2;
  }

  updateLayout(devices: Device[], links: Link[]) {
    // Create nodes for devices
    for (const device of devices) {
      let node = this.nodes.get(device.id);

      if (!node) {
        // Initialize new node
        node = {
          device,
          x: this.centerX + (Math.random() - 0.5) * 100,
          y: this.centerY + (Math.random() - 0.5) * 100,
          vx: 0,
          vy: 0,
          radius: this.getNodeRadius(device),
        };
        this.nodes.set(device.id, node);
      } else {
        // Update device data
        node.device = device;
        node.radius = this.getNodeRadius(device);
      }
    }

    // Remove nodes for devices that no longer exist
    const deviceIds = new Set(devices.map(d => d.id));
    for (const [id] of this.nodes) {
      if (!deviceIds.has(id)) {
        this.nodes.delete(id);
      }
    }

    // Apply force-directed layout
    this.applyForces(links);
  }

  private applyForces(_links: Link[]) {
    const nodes = Array.from(this.nodes.values());

    // Reset forces
    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    // Apply forces based on device hierarchy
    for (const node of nodes) {
      const { device } = node;

      // Gateway at center
      if (device.type === 'gateway') {
        const dx = this.centerX - node.x;
        const dy = this.centerY - node.y;
        node.vx += dx * 0.1;
        node.vy += dy * 0.1;
      }
      // Infrastructure devices orbit around gateway
      else if (device.type === 'switch' || device.type === 'ap') {
        const parent = device.parentDeviceId
          ? this.nodes.get(device.parentDeviceId)
          : null;

        if (parent) {
          const desiredDistance = 150;
          const dx = node.x - parent.x;
          const dy = node.y - parent.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 0) {
            const force = (distance - desiredDistance) * 0.05;
            node.vx -= (dx / distance) * force;
            node.vy -= (dy / distance) * force;
          }
        }
      }
      // Clients cluster around their parent
      else if (device.type === 'client') {
        const parent = device.parentDeviceId
          ? this.nodes.get(device.parentDeviceId)
          : null;

        if (parent) {
          const desiredDistance = 80;
          const dx = node.x - parent.x;
          const dy = node.y - parent.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 0) {
            const force = (distance - desiredDistance) * 0.08;
            node.vx -= (dx / distance) * force;
            node.vy -= (dy / distance) * force;
          }
        }
      }

      // Repel from other nodes
      for (const other of nodes) {
        if (other === node) continue;

        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 100 && distance > 0) {
          const force = 50 / (distance * distance);
          node.vx += (dx / distance) * force;
          node.vy += (dy / distance) * force;
        }
      }
    }

    // Apply velocities with damping
    for (const node of nodes) {
      node.x += node.vx * 0.5;
      node.y += node.vy * 0.5;
    }
  }

  render(
    devices: Device[],
    links: Link[],
    weather: WeatherSignals,
    filter: Filter
  ) {
    this.animationFrame++;

    // Clear canvas with dark background
    this.ctx.fillStyle = '#0a0e1a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Filter devices
    const filteredDevices = this.applyFilter(devices, filter);
    const filteredDeviceIds = new Set(filteredDevices.map(d => d.id));

    // Filter links
    const filteredLinks = links.filter(
      link =>
        filteredDeviceIds.has(link.fromId) && filteredDeviceIds.has(link.toId)
    );

    // Update layout
    this.updateLayout(filteredDevices, filteredLinks);

    // Render links with weather effects
    for (const link of filteredLinks) {
      this.renderLink(link, weather);
    }

    // Update and render particles
    this.updateParticles();
    this.renderParticles();

    // Generate lightning particles
    this.generateLightningParticles(weather);

    // Render nodes
    for (const device of filteredDevices) {
      const node = this.nodes.get(device.id);
      if (node) {
        this.renderNode(node, weather);
      }
    }

    // Render hover tooltip
    if (this.hoveredNode) {
      this.renderTooltip(this.hoveredNode);
    }
  }

  private renderLink(link: Link, weather: WeatherSignals) {
    const fromNode = this.nodes.get(link.fromId);
    const toNode = this.nodes.get(link.toId);

    if (!fromNode || !toNode) return;

    const linkId = `${link.fromId}-${link.toId}`;
    const intensity = weather.stormIntensity[linkId] || 0;

    // Base color based on health
    const health = link.healthScore;
    let color: string;

    if (health < 0.3) {
      color = '#ff4444';
    } else if (health < 0.7) {
      color = '#ffaa44';
    } else {
      color = '#4488ff';
    }

    // Line thickness based on utilization
    const baseWidth = 1;
    const maxWidth = 5;
    const width = baseWidth + intensity * (maxWidth - baseWidth);

    // Animate wind effect
    const pulse = Math.sin(this.animationFrame * 0.05 + intensity * 10) * 0.3 + 0.7;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width * pulse;
    this.ctx.globalAlpha = 0.3 + intensity * 0.5;

    // Draw curved line
    const midX = (fromNode.x + toNode.x) / 2;
    const midY = (fromNode.y + toNode.y) / 2;
    const offset = 20;

    this.ctx.beginPath();
    this.ctx.moveTo(fromNode.x, fromNode.y);
    this.ctx.quadraticCurveTo(
      midX + offset,
      midY + offset,
      toNode.x,
      toNode.y
    );
    this.ctx.stroke();

    // Draw flow particles for high utilization
    if (intensity > 0.3 && this.animationFrame % 5 === 0) {
      const t = Math.random();
      const x = fromNode.x * (1 - t) + toNode.x * t;
      const y = fromNode.y * (1 - t) + toNode.y * t;

      this.particles.push({
        x,
        y,
        vx: (toNode.x - fromNode.x) * 0.02,
        vy: (toNode.y - fromNode.y) * 0.02,
        life: 30,
        color,
      });
    }

    this.ctx.restore();
  }

  private renderNode(node: VisualizationNode, weather: WeatherSignals) {
    const { device } = node;
    const fog = weather.fogLevel[device.id] || 0;
    const heat = weather.heat[device.id] || 0;

    this.ctx.save();

    // Draw fog halo
    if (fog > 0.1) {
      const gradient = this.ctx.createRadialGradient(
        node.x,
        node.y,
        node.radius,
        node.x,
        node.y,
        node.radius + 20
      );
      gradient.addColorStop(0, `rgba(150, 150, 150, ${fog * 0.3})`);
      gradient.addColorStop(1, 'rgba(150, 150, 150, 0)');

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius + 20, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw heat glow
    if (heat > 0.1) {
      const gradient = this.ctx.createRadialGradient(
        node.x,
        node.y,
        node.radius,
        node.x,
        node.y,
        node.radius + 15
      );
      gradient.addColorStop(0, `rgba(255, 100, 0, ${heat * 0.4})`);
      gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius + 15, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw node
    const color = this.getNodeColor(device);
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = device.online ? '#ffffff' : '#666666';
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    // Draw icon - use SVG if loaded, otherwise fallback to text
    const icon = this.deviceIcons.get(device.type);
    if (this.iconsLoaded && icon && icon.complete) {
      const iconSize = node.radius * 1.8;
      this.ctx.drawImage(
        icon,
        node.x - iconSize / 2,
        node.y - iconSize / 2,
        iconSize,
        iconSize
      );
    } else {
      // Fallback to text icons
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = `${node.radius}px Arial`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(this.getNodeIcon(device.type), node.x, node.y);
    }

    // Draw WiFi signal indicator
    if (device.wiredOrWifi === 'wifi' && device.rssi) {
      const signalStrength = Math.max(0, (device.rssi + 90) / 60);
      this.ctx.fillStyle = signalStrength > 0.6 ? '#4ade80' : signalStrength > 0.3 ? '#fbbf24' : '#ef4444';
      this.ctx.beginPath();
      this.ctx.arc(node.x + node.radius - 5, node.y - node.radius + 5, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Highlight if hovered
    if (this.hoveredNode === node) {
      this.ctx.strokeStyle = '#ffff00';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private renderTooltip(node: VisualizationNode) {
    const { device } = node;
    const padding = 10;
    const lineHeight = 18;

    const lines = [
      device.name,
      `Type: ${device.type}`,
      `IP: ${device.ip || 'N/A'}`,
      `Status: ${device.online ? 'Online' : 'Offline'}`,
    ];

    if (device.latencyMs) {
      lines.push(`Latency: ${device.latencyMs.toFixed(0)}ms`);
    }

    if (device.wiredOrWifi === 'wifi' && device.ssid) {
      lines.push(`SSID: ${device.ssid}`);
      if (device.rssi) {
        lines.push(`Signal: ${device.rssi}dBm`);
      }
    }

    // Calculate dimensions
    this.ctx.font = '14px monospace';
    const maxWidth = Math.max(
      ...lines.map(line => this.ctx.measureText(line).width)
    );
    const width = maxWidth + padding * 2;
    const height = lines.length * lineHeight + padding * 2;

    // Position tooltip
    let x = node.x + node.radius + 10;
    let y = node.y - height / 2;

    // Keep tooltip on screen
    if (x + width > this.canvas.width) {
      x = node.x - node.radius - width - 10;
    }
    if (y < 0) y = 0;
    if (y + height > this.canvas.height) y = this.canvas.height - height;

    // Draw background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    this.ctx.fillRect(x, y, width, height);

    this.ctx.strokeStyle = '#4488ff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);

    // Draw text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i], x + padding, y + padding + i * lineHeight);
    }
  }

  private updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private renderParticles() {
    for (const p of this.particles) {
      const alpha = p.life / 30;
      this.ctx.fillStyle = p.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private generateLightningParticles(weather: WeatherSignals) {
    const recentLightning = weather.lightningEvents.filter(
      e => Date.now() - e.ts < 1000
    );

    for (const lightning of recentLightning) {
      const node = this.nodes.get(lightning.deviceId);
      if (!node) continue;

      // Generate lightning effect
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: node.x,
          y: node.y,
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.5) * 5,
          life: 15,
          color: '#ffff00',
        });
      }
    }
  }

  private applyFilter(devices: Device[], filter: Filter): Device[] {
    return devices.filter(device => {
      if (filter.wiredOnly && device.wiredOrWifi !== 'wired') return false;
      if (filter.wifiOnly && device.wiredOrWifi !== 'wifi') return false;
      if (filter.issuesOnly && device.online) return false;

      if (filter.search) {
        const search = filter.search.toLowerCase();
        return (
          device.name.toLowerCase().includes(search) ||
          device.ip?.toLowerCase().includes(search) ||
          device.mac?.toLowerCase().includes(search)
        );
      }

      return true;
    });
  }

  private getNodeRadius(device: Device): number {
    switch (device.type) {
      case 'gateway':
        return 30;
      case 'switch':
      case 'ap':
        return 20;
      case 'client':
        return 12;
      default:
        return 15;
    }
  }

  private getNodeColor(device: Device): string {
    if (!device.online) return '#333333';

    switch (device.type) {
      case 'gateway':
        return '#ff9500';
      case 'switch':
        return '#007aff';
      case 'ap':
        return '#34c759';
      case 'client':
        return '#5856d6';
      default:
        return '#8e8e93';
    }
  }

  private getNodeIcon(type: DeviceType): string {
    switch (type) {
      case 'gateway':
        return '⊙';
      case 'switch':
        return '⧉';
      case 'ap':
        return '📡';
      case 'client':
        return '●';
      default:
        return '?';
    }
  }

  handleMouseMove(x: number, y: number) {
    this.hoveredNode = null;

    for (const node of this.nodes.values()) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= node.radius) {
        this.hoveredNode = node;
        break;
      }
    }
  }

  getHoveredNode(): VisualizationNode | null {
    return this.hoveredNode;
  }
}
