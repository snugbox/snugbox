# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Iso Room Planner — a hackathon prototype that renders a 2D floor-plan grid alongside a live isometric canvas view. Users can paint/erase floor tiles, place furniture from a catalog, and drag furniture around in the isometric view.

## Commands

```bash
pnpm install       # install deps (requires initialized git submodule)
pnpm dev           # start Next.js dev server (port 3000, Turbopack)
pnpm dev:network   # listen on all interfaces for access from another device
pnpm build         # production build
pnpm lint          # oxlint
pnpm lint:fix      # oxlint with auto-fix
```

No test framework is configured.

## Architecture

- **Next.js 16 + React 19** app using the App Router (`src/app/`).
- Single page app — `page.tsx` renders `<RoomPlanner>`, the sole feature component.
- `src/components/RoomPlanner.tsx` contains all room planner logic:
    - **State**: floor grid (`boolean[][]`), furniture items, active tool, rotation.
    - **Floor plan panel**: CSS-grid of clickable cells for paint/erase/furniture-place tools.
    - **Isometric panel** (`IsoRoomCanvas`): HTML5 Canvas drawn each frame via `drawScene()`. Handles pointer drag to move furniture with collision checking.
- Styling is plain CSS in `src/app/globals.css` (CSS custom properties, no Tailwind in the main app). Fonts: Space Grotesk (UI) and Fraunces (display) via `next/font/google`.

### Local `isometric-city` package

`packages/isometric-city` is a **git submodule** (from `amilich/isometric-city`) linked as a local file dependency (`file:./packages/isometric-city`). It is transpiled via `next.config.js` (`transpilePackages`).

The room planner imports only two things from it:

- `gridToScreen` / `screenToGrid` — isometric coordinate conversion functions from `@isocity/components/game/utils`
- `TILE_WIDTH` / `TILE_HEIGHT` — tile dimension constants from `@isocity/components/game/types`

### Path aliases (tsconfig)

- `@/*` → `./src/*`
- `@isocity/*` → `./packages/isometric-city/src/*`

## Furniture system

Furniture is defined in `FURNITURE_CATALOG` inside `RoomPlanner.tsx`. Each piece has grid dimensions (`w`/`h`), a visual height for the isometric box, and color palette (top/side/front faces). Pieces are rendered as colored isometric cuboids on the canvas. Collision detection prevents overlapping placement.
