# UniFiLanCast Graphics Assets

> **Note (current state):** the device nodes in the live constellation are now drawn **programmatically** as monoline glyphs by `drawGlyph()` in `web/src/utils/visualization.ts` (router / switch / AP / client), not loaded from the device SVGs below. The branding assets (logo, app icon) are still used. The device-*.svg files remain as reference/source art.

This document describes the graphics assets implemented for the UniFiLanCast project.

## Overview

The graphics implementation includes:
- **Branding**: Logo and app icon
- **Device Icons**: SVG icons for different network device types
- **Visual Elements**: Flow lines, lightning bolts, and indicators
- **Background**: Topographic pattern for visual depth

## Asset Structure

```
web/public/
├── icons/
│   ├── logo-icon.svg           # Circular logo icon
│   ├── logo-horizontal.svg     # Horizontal logo with text
│   ├── app-icon.svg            # App icon (rounded square)
│   ├── device-router.svg       # Router icon
│   ├── device-switch.svg       # Switch icon
│   ├── device-gateway.svg      # Gateway icon
│   ├── device-ap.svg           # Access Point icon
│   ├── device-server.svg       # Server icon
│   ├── device-laptop.svg       # Laptop/client icon
│   ├── device-cloud.svg        # Cloud icon
│   ├── flow-lines.svg          # Data flow lines
│   ├── lightning-bolt.svg      # Lightning bolt icon
│   └── indicator-ring.svg      # Circular indicator
└── assets/
    └── topographic-pattern.svg # Background pattern
```

## Logo Usage

### Circular Icon
```jsx
<img src="/icons/logo-icon.svg" alt="UniFiLanCast" />
```
Use for: Favicon, app icon, small displays

### Horizontal Logo
```jsx
<img src="/icons/logo-horizontal.svg" alt="UniFiLanCast" />
```
Use for: Headers, marketing materials, wide displays

### App Icon
```jsx
<img src="/icons/app-icon.svg" alt="UniFiLanCast" />
```
Use for: PWA icon, mobile home screen, app launchers

## Device Icons

Device icons are automatically loaded by the `NetworkVisualization` class and rendered on the canvas. The visualization system will:

1. **Load icons on initialization**
2. **Render SVG icons** when loaded
3. **Fallback to Unicode** characters if icons fail to load

### Supported Device Types
- `gateway` → device-gateway.svg
- `switch` → device-switch.svg
- `ap` → device-ap.svg
- `client` → device-laptop.svg
- `server` → device-server.svg
- `router` → device-router.svg
- `cloud` → device-cloud.svg

### Manual Usage
```jsx
<img src="/icons/device-router.svg" alt="Router" />
```

## Visual Elements

### Flow Lines
```jsx
<img src="/icons/flow-lines.svg" alt="Data flow" />
```
Represents data flow and network traffic patterns.

### Lightning Bolt
```jsx
<img src="/icons/lightning-bolt.svg" alt="Alert" />
```
Indicates latency spikes, alerts, or high-priority events.

### Indicator Ring
```jsx
<img src="/icons/indicator-ring.svg" alt="Status" />
```
General-purpose status indicator or loading state.

## Topographic Background

The topographic background pattern can be applied using CSS classes:

### Import the CSS
```jsx
import './components/TopographicBackground.css';
```

### Available Classes

#### Full Background
```jsx
<div className="topographic-background">
  {/* Content */}
</div>
```

#### Tiled Pattern
```jsx
<div className="topographic-background-tiled">
  {/* Content */}
</div>
```

#### Animated Background
```jsx
<div className="topographic-background-animated">
  {/* Content */}
</div>
```

#### Overlay (on top of existing backgrounds)
```jsx
<div style={{position: 'relative'}}>
  <div className="topographic-overlay"></div>
  {/* Content */}
</div>
```

#### Canvas with Background
```jsx
<div className="canvas-with-topo">
  <canvas ref={canvasRef} />
</div>
```

## Color Palette

The graphics use a consistent color palette:

- **Primary Blue**: `#007AFF` (links, UI elements)
- **Network Blues**: `#5B8FB9`, `#4A9ECC`, `#6BB6E0` (logo, flows)
- **Dark Navy**: `#0B2447` (backgrounds)
- **Dark Gray**: `#1A2332` (secondary backgrounds)
- **Status Colors**:
  - Green: `#34C759` (healthy, online)
  - Orange: `#FF9500` (warning, gateway)
  - Red: `#FF3B30` (error, offline)
  - Yellow: `#FFD700` (lightning, alerts)

## Design Guidelines

### Logo
- Minimum size: 32x32px (icon), 120x40px (horizontal)
- Clear space: 8px around logo
- Use on dark backgrounds for best visibility

### Device Icons
- Designed for 64x64px display
- Scale proportionally (maintain aspect ratio)
- Work well at 32x32px minimum

### Background Pattern
- Opacity: 0.3-0.6 recommended for overlays
- Works best with dark base color (#0a0e1a)
- Subtle movement animation available

## Browser Compatibility

All graphics are SVG-based and support:
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Progressive enhancement (fallback to Unicode icons)
- Retina/HiDPI displays (vector graphics scale perfectly)

## Performance Notes

- SVG icons are loaded asynchronously
- Canvas rendering uses hardware acceleration
- Background patterns use CSS for efficiency
- Lazy loading recommended for non-critical assets

## Customization

To customize graphics:

1. **Edit SVG files** directly in `/web/public/icons/`
2. **Adjust colors** using CSS variables or inline SVG styles
3. **Modify pattern** in `/web/public/assets/topographic-pattern.svg`
4. **Update visualization** in `/web/src/utils/visualization.ts`

## Future Enhancements

Potential improvements:
- [ ] Animated device icons (pulsing, spinning)
- [ ] Dark/light theme variations
- [ ] Additional device types (firewall, NAS, IoT)
- [ ] Custom icon sets
- [ ] Interactive SVG elements
- [ ] WebGL-based rendering for advanced effects
