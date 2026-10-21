# Iso Room Planner

An isometric room planner that turns floor plan images into interactive 3D views. Upload a floor plan, and the app parses it with AI, renders it as an isometric scene, and lets you furnish rooms by dragging furniture from a catalog.

## Features

- **AI floor plan parsing** — upload a floor plan image and get a structured grid with detected rooms
- **Isometric 3D view** — live canvas rendering with color-coded rooms, walls, and labels
- **Furniture catalog** — place sofas, beds, tables, chairs, and more with collision detection
- **Drag-and-drop** — move furniture around in the isometric view
- **Auto-furnish** — AI-powered or algorithmic furniture placement by room type
- **Preset floor plans** — sample layouts to get started quickly

## Getting Started

### Prerequisites

- Node.js 20.9+
- pnpm 10.32.1
- A [Google Gemini API key](https://ai.google.dev/) (used for floor plan parsing and auto-furnish)

### Environment Setup

Copy the example env file and add your API key:

```bash
cp .env.example .env.local
```

Then fill in your key in `.env.local`:

```
GEMINI_API_KEY=your_key_here
```

> **Note:** Never commit `.env.local`. It is gitignored by default.

### Install and Run

```bash
git submodule update --init --recursive
pnpm install
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

To open it from another device, run `pnpm dev:network` on the host machine and
visit `http://<host-ip>:3000` from that device. Use the host's reachable IP
address, not `0.0.0.0`. On a Mac using Wi-Fi, `ipconfig getifaddr en0` usually
prints its local network IP. The host firewall must allow incoming connections
to port 3000. If the host is reachable only through SSH, forward the port instead:

```bash
ssh -L 3000:localhost:3000 user@host
```

Then open [http://localhost:3000](http://localhost:3000) on your own machine.

### Other Commands

```bash
pnpm build         # production build
pnpm lint          # run oxlint
pnpm lint:fix      # run oxlint with auto-fix
```

## Tech Stack

- Next.js 16 / React 19 (App Router)
- HTML5 Canvas for isometric rendering
- Google Gemini for vision-based floor plan parsing and furniture placement
- TypeScript

## Acknowledgments

- Furniture assets by [Kenney](https://kenney.nl/assets/furniture-kit) (CC0 1.0)
- Isometric engine based on [isometric-city](https://github.com/amilich/isometric-city) by amilich (MIT License)
