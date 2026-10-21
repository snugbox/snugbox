"use client";

import React, { useCallback, useRef, useState } from "react";
import type { FloorPlanData, Room } from "@/types/floorplan";
import type { FurnitureItem, FurnitureType, Rotation, ViewRotation } from "@/types/furniture";
import {
    DEFAULT_HEIGHT,
    DEFAULT_WIDTH,
    FURNITURE_CATALOG,
    ROTATION_TO_ORIENTATION,
    SPRITE_BASE_MAP,
} from "@/data/furniture-catalog";
import { SAMPLE_PRESETS, type SamplePreset } from "@/data/sample-presets";
import { createFloor } from "@/utils/grid";
import { autoFurnish, buildItem, canPlaceItem } from "@/utils/furniture";
import { useSpriteImages } from "@/hooks/useSpriteImages";
import { SpritePreview } from "@/components/SpritePreview";
import { IsoRoomCanvas } from "@/components/IsoRoomCanvas";

export default function RoomPlanner() {
    const [grid, setGrid] = useState<boolean[][]>(() => createFloor(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    const [items, setItems] = useState<FurnitureItem[]>(() => [
        buildItem("sofa", 2, 2, 0),
        buildItem("table", 5, 3, 0),
        buildItem("bed", 7, 2, 0),
        buildItem("plant", 1, 5, 0),
    ]);
    const [activeFurniture, setActiveFurniture] = useState<FurnitureType>("sofa");
    const [rotation, setRotation] = useState<Rotation>(0);
    const [viewRotation, setViewRotation] = useState<ViewRotation>(0);
    const [status, setStatus] = useState<string>(
        "Drag furniture in the isometric view to move it.",
    );
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [baseGrid, setBaseGrid] = useState<boolean[][] | null>(() =>
        createFloor(DEFAULT_WIDTH, DEFAULT_HEIGHT),
    );

    const [hasPlan, setHasPlan] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [furnishing, setFurnishing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const lastFileRef = useRef<File | null>(null);

    const spriteImages = useSpriteImages(SPRITE_BASE_MAP);

    const aiFurnish = useCallback(async (targetGrid: boolean[][], targetRooms: Room[]) => {
        if (targetRooms.length === 0) return;
        setFurnishing(true);
        setStatus("Designing interior layout with AI…");
        try {
            const res = await fetch("/api/furnish-rooms", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ grid: targetGrid, rooms: targetRooms }),
            });
            const data = await res.json();
            if (!res.ok || !Array.isArray(data.furniture) || data.furniture.length === 0) {
                // Fallback to algorithmic auto-furnish
                const fallback = autoFurnish(targetGrid, targetRooms);
                setItems(fallback);
                setStatus(
                    `AI furnish unavailable — placed ${fallback.length} items algorithmically.`,
                );
                return;
            }
            const placed: FurnitureItem[] = (
                data.furniture as Array<{ type: FurnitureType; x: number; y: number }>
            ).map((f) => buildItem(f.type, f.x, f.y, 0));
            setItems(placed);
            setSelectedItemId(null);
            setStatus(`AI designed interior with ${placed.length} furniture items!`);
        } catch {
            const fallback = autoFurnish(targetGrid, targetRooms);
            setItems(fallback);
            setStatus(`AI furnish failed — placed ${fallback.length} items algorithmically.`);
        } finally {
            setFurnishing(false);
        }
    }, []);

    const onFloorPlanParsed = useCallback(
        (data: FloorPlanData, furnish = true) => {
            setHasPlan(true);
            setGrid(data.grid);
            setRooms(data.rooms);
            setBaseGrid(data.grid);
            setSelectedItemId(null);

            if (furnish && data.rooms.length > 0) {
                // Use simple auto-furnish immediately, then kick off AI furnish in the background
                const quick = autoFurnish(data.grid, data.rooms);
                setItems(quick);
                setStatus(`Floor plan loaded — designing interior with AI…`);
                // Fire-and-forget AI furnish (replaces items when done)
                aiFurnish(data.grid, data.rooms);
            } else {
                setItems([]);
                setStatus("Floor plan loaded! Use AI Furnish or drop furniture manually.");
            }
        },
        [aiFurnish],
    );

    const readFileAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
        });

    const handleAnalyze = useCallback(
        async (file: File) => {
            lastFileRef.current = null;
            const isPdf =
                file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
            if (!file.type.startsWith("image/") && !isPdf) {
                setUploadError("Choose a floor plan image or PDF.");
                return;
            }
            if (file.size > 15 * 1024 * 1024) {
                setUploadError("Choose a file smaller than 15 MB.");
                return;
            }
            lastFileRef.current = file;
            setUploading(true);
            setUploadError(null);
            try {
                let dataUrl = await readFileAsDataUrl(file);
                if (isPdf && !dataUrl.startsWith("data:application/pdf;")) {
                    dataUrl = dataUrl.replace(/^data:[^;]*;/, "data:application/pdf;");
                }
                const res = await fetch("/api/parse-floorplan", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image: dataUrl }),
                });
                const data = await res.json();
                if (!res.ok) {
                    setUploadError(data.error || "Analysis failed.");
                    return;
                }
                onFloorPlanParsed(data as FloorPlanData);
            } catch {
                setUploadError("Network error. Please try again.");
            } finally {
                setUploading(false);
            }
        },
        [onFloorPlanParsed],
    );

    const handleTryAgain = useCallback(() => {
        if (lastFileRef.current) handleAnalyze(lastFileRef.current);
    }, [handleAnalyze]);

    const handleFiles = useCallback(
        (files: FileList | null) => {
            if (files?.[0]) void handleAnalyze(files[0]);
        },
        [handleAnalyze],
    );

    const handleAIFurnish = useCallback(() => {
        if (rooms.length === 0) {
            setStatus("No rooms detected. Upload a floor plan or load a sample first.");
            return;
        }
        aiFurnish(grid, rooms);
    }, [grid, rooms, aiFurnish]);

    const handleQuickFurnish = useCallback(() => {
        if (rooms.length === 0) {
            setStatus("No rooms detected. Upload a floor plan or load a sample first.");
            return;
        }
        const furnished = autoFurnish(grid, rooms);
        setItems(furnished);
        setSelectedItemId(null);
        setStatus(`Quick-furnished ${furnished.length} items across ${rooms.length} rooms.`);
    }, [grid, rooms]);

    const handleLoadPreset = useCallback(
        (preset: SamplePreset) => {
            onFloorPlanParsed(preset.data, true);
            setUploadError(null);
        },
        [onFloorPlanParsed],
    );

    const handlePlaceAt = useCallback(
        (x: number, y: number) => {
            const candidate = buildItem(activeFurniture, x, y, rotation);
            if (canPlaceItem(grid, items, candidate)) {
                setItems((prev) => [...prev, candidate]);
                setSelectedItemId(candidate.id);
                setStatus("Placed furniture. Drag to move.");
            } else {
                setStatus("Cannot place there. Try another tile.");
            }
        },
        [activeFurniture, grid, items, rotation],
    );

    const clearFurniture = useCallback(() => {
        setItems([]);
        setSelectedItemId(null);
        setStatus("Cleared all furniture.");
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragOver(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLElement>) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
        },
        [handleFiles],
    );

    const handleUploadZoneClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            handleFiles(e.target.files);
            e.target.value = "";
        },
        [handleFiles],
    );

    const handleRotate = useCallback(() => {
        setRotation((prev) => ((prev + 90) % 360) as Rotation);
    }, []);

    const handleRotateView = useCallback(() => {
        setViewRotation((prev) => ((prev + 90) % 360) as ViewRotation);
    }, []);

    const handleMoveItem = useCallback((id: string, nextX: number, nextY: number) => {
        setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, x: nextX, y: nextY } : item)),
        );
    }, []);

    const handlePresetClick = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            const name = e.currentTarget.dataset.preset;
            const preset = SAMPLE_PRESETS.find((p) => p.name === name);
            if (preset) handleLoadPreset(preset);
        },
        [handleLoadPreset],
    );

    const handleFurnitureCardClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        const type = e.currentTarget.dataset.type as FurnitureType;
        if (type) setActiveFurniture(type);
    }, []);

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="upload-input"
                onChange={handleFileInputChange}
            />
            {!hasPlan ? (
                <section className="welcome-screen">
                    <div className="welcome-brand">
                        <span className="brand-mark">▦</span> snugbox
                    </div>
                    <div className="welcome-content">
                        <div className="welcome-kicker">YOUR SPACE, REIMAGINED</div>
                        <h1>
                            Bring your floor plan
                            <br />
                            <span>to life.</span>
                        </h1>
                        <p className="welcome-description">
                            Import a floor plan to see your space in 3D and make it your own.
                        </p>
                        <button
                            type="button"
                            disabled={uploading}
                            className={`welcome-dropzone ${dragOver ? "dragover" : ""}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={handleUploadZoneClick}
                            aria-label="Import floor plan image or PDF"
                        >
                            <span className="upload-icon" aria-hidden="true">
                                ↑
                            </span>
                            <strong>
                                {uploading ? "Creating your space…" : "Import floor plan"}
                            </strong>
                            <span>Choose an image or PDF, or drop it here</span>
                            <small>PNG, JPG, WEBP or PDF · up to 15 MB</small>
                            {uploading && (
                                <span className="spinner" aria-label="Analyzing floor plan" />
                            )}
                        </button>
                        {uploadError && (
                            <div className="welcome-error" role="alert">
                                <span>{uploadError}</span>
                                {lastFileRef.current && (
                                    <button
                                        type="button"
                                        onClick={handleTryAgain}
                                        disabled={uploading}
                                    >
                                        Try again
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="welcome-footer">A LITTLE ROOM FOR BIG IDEAS</div>
                </section>
            ) : (
                <section className="main">
                    <div className="panel">
                        <div className="planner-heading">
                            <h2>Assets</h2>
                            <button
                                type="button"
                                className="tool-button"
                                onClick={handleUploadZoneClick}
                                disabled={uploading}
                            >
                                {uploading ? "Importing…" : "Import another"}
                            </button>
                        </div>
                        {uploadError && (
                            <div className="upload-error">
                                <span>{uploadError}</span>
                                <button
                                    type="button"
                                    className="tool-button"
                                    onClick={handleTryAgain}
                                    disabled={uploading}
                                >
                                    Try Again
                                </button>
                            </div>
                        )}

                        <div className="preset-row">
                            <span className="preset-label">Quick start:</span>
                            {SAMPLE_PRESETS.map((preset) => (
                                <button
                                    key={preset.name}
                                    type="button"
                                    className="tool-button"
                                    data-preset={preset.name}
                                    onClick={handlePresetClick}
                                >
                                    {preset.name}
                                </button>
                            ))}
                        </div>

                        <div className="furniture-list">
                            {Object.entries(FURNITURE_CATALOG).map(([key, data]) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`furniture-card ${activeFurniture === key ? "active" : ""}`}
                                    data-type={key}
                                    onClick={handleFurnitureCardClick}
                                >
                                    <SpritePreview
                                        type={key as FurnitureType}
                                        images={spriteImages}
                                        rotation={activeFurniture === key ? rotation : 0}
                                    />
                                    <strong>{data.label}</strong>
                                    <div className="note">
                                        {data.w}x{data.h} tiles
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="tool-row">
                            <button className="tool-button" onClick={handleRotate} type="button">
                                Rotate {rotation}° ({ROTATION_TO_ORIENTATION[rotation]})
                            </button>
                        </div>

                        <div className="actions">
                            <button
                                className="action-button accent"
                                onClick={handleAIFurnish}
                                disabled={furnishing || rooms.length === 0}
                                type="button"
                            >
                                {furnishing ? (
                                    <>
                                        <span className="spinner" /> Designing…
                                    </>
                                ) : (
                                    "AI Furnish"
                                )}
                            </button>
                            <button
                                className="action-button"
                                onClick={handleQuickFurnish}
                                type="button"
                            >
                                Quick Furnish
                            </button>
                            <button
                                className="action-button"
                                onClick={clearFurniture}
                                type="button"
                            >
                                Clear Furniture
                            </button>
                        </div>
                        <p className="note">
                            Tip: click in the isometric view to place furniture. Drag items to move
                            them.
                        </p>
                    </div>

                    <div className="panel panel-iso">
                        <h2>Isometric Room</h2>
                        <div className="tool-row">
                            <button
                                className="tool-button"
                                onClick={handleRotateView}
                                type="button"
                            >
                                Rotate View {viewRotation}°
                            </button>
                        </div>
                        <IsoRoomCanvas
                            grid={grid}
                            baseGrid={baseGrid}
                            rooms={rooms}
                            items={items}
                            spriteImages={spriteImages}
                            viewRotation={viewRotation}
                            onMoveItem={handleMoveItem}
                            onPlaceItem={handlePlaceAt}
                            selectedItemId={selectedItemId}
                            onSelectItem={setSelectedItemId}
                        />
                        <div className="status">
                            {status} Shift-drag or right-click to pan, scroll to zoom.
                        </div>
                    </div>
                </section>
            )}
        </>
    );
}
