import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FloorPlanData, Room, RoomType } from "@/types/floorplan";

const ROOM_TYPES: RoomType[] = [
    "bedroom",
    "living_room",
    "kitchen",
    "bathroom",
    "hallway",
    "office",
];

const DEFAULT_COLS = 16;
const DEFAULT_ROWS = 12;

function buildPrompt(cols: number, rows: number): string {
    return `You are analyzing a 2D floor plan image. Convert it into a ${cols}×${rows} boolean grid and a list of detected rooms.

STEP-BY-STEP INSTRUCTIONS:

1. ANALYZE THE IMAGE
   • Identify the outer walls / boundary of the building or apartment.
   • Identify interior walls that divide the space into rooms.
   • Recognize each room from labels, furniture icons, or architectural conventions:
     - Bed → bedroom, toilet/shower → bathroom, stove/counter → kitchen,
       sofa/TV area → living_room, desk → office, narrow passage → hallway.

2. BUILD THE GRID (exactly ${rows} rows × ${cols} columns)
   • grid is a 2-D boolean array: grid[row][col].
   • true = walkable interior floor space.
   • false = wall, outside the building, or non-walkable structural element.
   • Map the floor plan proportionally so the building fills most of the ${cols}×${rows} grid.
   • PRESERVE the real shape. If the plan is L-shaped, T-shaped, or has cutouts, the grid must reflect that. Do NOT fill the entire grid as a solid rectangle.
   • Outer boundary cells where the exterior is should be false.
   • Interior partition walls between rooms should be false when the resolution allows.
   • A normal floor plan should have roughly 40-80% true cells.

3. DETECT ROOMS
   • For every distinct room produce an object:
     { "type": "<room_type>", "label": "<name>", "x": <col>, "y": <row>, "w": <width>, "h": <height> }
   • type must be one of: ${ROOM_TYPES.join(", ")}.
   • label is a short human-readable name like "Master Bedroom" or "Kitchen".
   • x, y are 0-indexed top-left grid coordinates of the room's bounding rectangle.
   • w, h are width and height in cells.
   • Room rectangles must stay within the grid.
   • Most cells inside the room rectangle should be true in the grid.

EXAMPLE OUTPUT (for a small 8×6 grid with 2 rooms):
{"grid":[[false,false,false,false,false,false,false,false],[false,true,true,true,false,true,true,false],[false,true,true,true,false,true,true,false],[false,true,true,true,false,true,true,false],[false,true,true,true,false,true,true,false],[false,false,false,false,false,false,false,false]],"rooms":[{"type":"living_room","label":"Living Room","x":1,"y":1,"w":3,"h":4},{"type":"bedroom","label":"Bedroom","x":5,"y":1,"w":2,"h":4}]}

Return ONLY a valid JSON object. No markdown, no code fences, no explanation.`;
}

function extractJsonFromText(text: string): string {
    const trimmed = text.trim();
    const codeBlock = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (codeBlock) return codeBlock[1].trim();
    return trimmed;
}

function validateRoom(room: unknown, grid: boolean[][], cols: number, rows: number): room is Room {
    if (!room || typeof room !== "object") return false;
    const r = room as Record<string, unknown>;
    if (!ROOM_TYPES.includes(r.type as RoomType)) return false;
    if (typeof r.label !== "string") return false;
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(w) ||
        !Number.isInteger(h)
    )
        return false;
    if (w < 1 || h < 1 || x < 0 || y < 0 || x + w > cols || y + h > rows) return false;

    let total = 0;
    let floorCount = 0;
    for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
            total++;
            if (grid[y + dy]?.[x + dx]) floorCount++;
        }
    }
    return total > 0 && floorCount / total >= 0.4;
}

function resampleGridServer(
    source: boolean[][],
    targetCols: number,
    targetRows: number,
): boolean[][] {
    const srcRows = source.length;
    const srcCols = source[0]?.length ?? 0;
    if (srcRows === 0 || srcCols === 0) {
        return Array.from({ length: targetRows }, () => Array(targetCols).fill(false));
    }
    return Array.from({ length: targetRows }, (_, y) => {
        const srcY = Math.min(srcRows - 1, Math.floor((y * srcRows) / targetRows));
        return Array.from({ length: targetCols }, (_, x) => {
            const srcX = Math.min(srcCols - 1, Math.floor((x * srcCols) / targetCols));
            return Boolean(source[srcY]?.[srcX]);
        });
    });
}

function validateAndNormalize(data: unknown, cols: number, rows: number): FloorPlanData {
    if (!data || typeof data !== "object") throw new Error("Invalid response: not an object");
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.grid)) throw new Error("Invalid response: missing or invalid grid");

    const rawGrid = d.grid as unknown[];
    let normalizedGrid: boolean[][];

    if (
        rawGrid.length === rows &&
        Array.isArray(rawGrid[0]) &&
        (rawGrid[0] as unknown[]).length === cols
    ) {
        normalizedGrid = rawGrid.map((row) => {
            if (!Array.isArray(row)) return Array(cols).fill(false) as boolean[];
            return row.map((cell) => Boolean(cell));
        });
    } else {
        const tempGrid: boolean[][] = rawGrid.map((row) => {
            if (!Array.isArray(row)) return Array(cols).fill(false);
            return (row as unknown[]).map((cell) => Boolean(cell));
        });
        normalizedGrid = resampleGridServer(tempGrid, cols, rows);
    }

    const rooms: Room[] = [];
    if (Array.isArray(d.rooms)) {
        for (const r of d.rooms) {
            if (validateRoom(r, normalizedGrid, cols, rows)) rooms.push(r as Room);
        }
    }

    return { grid: normalizedGrid, rooms };
}

function gridFloorRatio(grid: boolean[][]): number {
    let total = 0;
    let floor = 0;
    for (const row of grid) {
        for (const cell of row) {
            total++;
            if (cell) floor++;
        }
    }
    return total > 0 ? floor / total : 0;
}

async function callGemini(
    apiKey: string,
    mimeType: string,
    base64Data: string,
    cols: number,
    rows: number,
): Promise<FloorPlanData> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const prompt = buildPrompt(cols, rows);

    const result = await model.generateContent([
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt },
    ]);

    const response = result.response;
    if (!response) throw new Error("No response from model");

    const rawText = response.text();
    if (!rawText) throw new Error("Empty response from model");

    const jsonStr = extractJsonFromText(rawText);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        throw new Error(`Model did not return valid JSON: ${jsonStr.slice(0, 300)}`);
    }

    return validateAndNormalize(parsed, cols, rows);
}

async function callGeminiWithRetry(
    apiKey: string,
    mimeType: string,
    base64Data: string,
    cols: number,
    rows: number,
): Promise<FloorPlanData> {
    let lastError: Error | undefined;

    try {
        const first = await callGemini(apiKey, mimeType, base64Data, cols, rows);
        if (gridFloorRatio(first.grid) >= 0.1) return first;
    } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
    }

    try {
        const second = await callGemini(apiKey, mimeType, base64Data, cols, rows);
        if (gridFloorRatio(second.grid) >= 0.1) return second;
        throw new Error("Floor plan grid is almost empty after 2 attempts");
    } catch (err) {
        throw lastError ?? (err instanceof Error ? err : new Error(String(err)));
    }
}

export async function POST(request: Request) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === "your-key-here") {
            return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
        }

        const body = await request.json();
        const dataUri = body?.image;
        if (
            typeof dataUri !== "string" ||
            !/^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,/.test(dataUri)
        ) {
            return NextResponse.json(
                { error: "Choose a PNG, JPG, WEBP, GIF, or PDF floor plan." },
                { status: 400 },
            );
        }

        const cols = Math.min(Math.max(Number(body?.cols) || DEFAULT_COLS, 4), 48);
        const rows = Math.min(Math.max(Number(body?.rows) || DEFAULT_ROWS, 3), 36);

        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        const mimeType = match![1];
        const base64Data = match![2];

        const floorPlan = await callGeminiWithRetry(apiKey, mimeType, base64Data, cols, rows);

        return NextResponse.json(floorPlan);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Parse failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
