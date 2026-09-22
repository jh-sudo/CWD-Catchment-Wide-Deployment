import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGetRosterOfficers } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { CATCHMENT_BG } from "@/components/RosterListView";
import { Loader2, Save, Play, Settings, ShieldAlert, AlertCircle, Check, ChevronsUpDown, X, History, Pencil, Trash2 } from "lucide-react";

const DEFAULT_PATTERN = [
  "CP1", "KG1", "BU1", "PJ1", "WK1",
  "CP2", "KG2", "BU2", "PJ2", "WK2",
  "CP3", "KG3", "BU3", "PJ3", "WK3",
  "CP4", "KG4", "BU4", "PJ4", "BU5",
];

interface PHBuilderConfig {
  pattern: string[];
  consecutivePH: boolean;
  sameHolidayPreviousYear: boolean;
  excludedOfficers: string[];
  startYear: number;
}

interface PHBuilderPreset {
  id: string;
  name: string;
  config: PHBuilderConfig;
  updatedAt: string;
}

interface PatternDragPreview {
  unit: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export function PHBuilder() {
  const [config, setConfig] = useState<PHBuilderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState<PHBuilderPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [draggedPatternIndex, setDraggedPatternIndex] = useState<number | null>(null);
  const [dragOverPatternIndex, setDragOverPatternIndex] = useState<number | null>(null);
  const [patternDragPreview, setPatternDragPreview] = useState<PatternDragPreview | null>(null);
  const patternDragActiveRef = useRef(false);
  const patternDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patternContainerRef = useRef<HTMLDivElement>(null);
  const draggedPatternIndexRef = useRef<number | null>(null);
  const dragOverPatternIndexRef = useRef<number | null>(null);
  const latestPatternPointerRef = useRef({ x: 0, y: 0 });
  const patternAutoScrollSpeedRef = useRef(0);
  const patternAutoScrollFrameRef = useRef<number | null>(null);
  const [running, setRunning] = useState<"pattern" | "exceptions" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [changes, setChanges] = useState<any[] | null>(null);

  const { data: officersData } = useGetRosterOfficers();
  const officers = useMemo(() => {
    if (!officersData) return [];
    return [...(officersData as any[])].sort((a, b) => a.name.localeCompare(b.name));
  }, [officersData]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, presetsRes] = await Promise.all([
        fetch("/api/ph-roster-ref/builder-config", { credentials: "include" }),
        fetch("/api/ph-roster-ref/builder-presets", { credentials: "include" }),
      ]);
      const data = await configRes.json();
      const presetsData = await presetsRes.json();
      if (!configRes.ok) throw new Error(data.error || "Failed to load PH Builder settings");
      if (!data || !Array.isArray(data.pattern)) {
        throw new Error("PH Builder settings returned an invalid response");
      }
      setConfig({
        pattern: data.pattern.length >= 6 ? data.pattern : DEFAULT_PATTERN,
        consecutivePH: data.consecutivePH !== false,
        sameHolidayPreviousYear: data.sameHolidayPreviousYear !== false,
        excludedOfficers: Array.isArray(data.excludedOfficers) ? data.excludedOfficers : [],
        startYear: Number(data.startYear) || 2027,
      });
      setPresets(presetsRes.ok && Array.isArray(presetsData.presets) ? presetsData.presets : []);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to load PH Builder settings." });
      setConfig({
        pattern: DEFAULT_PATTERN,
        consecutivePH: true,
        sameHolidayPreviousYear: true,
        excludedOfficers: [],
        startYear: 2027,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (draggedPatternIndex === null) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [draggedPatternIndex]);

  useEffect(() => () => {
    if (patternDragTimerRef.current) clearTimeout(patternDragTimerRef.current);
    if (patternAutoScrollFrameRef.current !== null) cancelAnimationFrame(patternAutoScrollFrameRef.current);
  }, []);

  const handleSave = async () => {
    if (!config) return;
    const defaultName = `${config.startYear} PH Settings`;
    const name = window.prompt("Name these settings so you can choose them again later:", defaultName)?.trim();
    if (!name) return;
    setSaving(true);
    setMessage(null);
    setChanges(null);
    try {
      const res = await fetch("/api/ph-roster-ref/builder-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save settings");
      setConfig(data.config);
      setPresets(Array.isArray(data.presets) ? data.presets : presets);
      setSelectedPresetId(data.preset?.id ?? "");
      setMessage({ ok: true, text: `"${name}" saved as a reusable preset and set as the current default settings.` });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Failed to save config." });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadPreset = () => {
    const preset = presets.find(item => item.id === selectedPresetId);
    if (!preset) {
      setMessage({ ok: false, text: "Choose previously saved settings first." });
      return;
    }
    setConfig({
      ...preset.config,
      pattern: [...preset.config.pattern],
      excludedOfficers: [...preset.config.excludedOfficers],
    });
    setChanges(null);
    setMessage({ ok: true, text: `"${preset.name}" loaded. Review it, then run the builder when ready.` });
  };

  const handleRenamePreset = async () => {
    const preset = presets.find(item => item.id === selectedPresetId);
    if (!preset) return;
    const name = window.prompt("Rename these saved settings:", preset.name)?.trim();
    if (!name || name === preset.name) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/ph-roster-ref/builder-presets/${encodeURIComponent(preset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename settings");
      setPresets(Array.isArray(data.presets) ? data.presets : presets);
      setMessage({ ok: true, text: `"${preset.name}" renamed to "${name}".` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to rename settings." });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async () => {
    const preset = presets.find(item => item.id === selectedPresetId);
    if (!preset) return;
    if (!window.confirm(`Delete the saved settings "${preset.name}"? Your current builder configuration will not change.`)) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/ph-roster-ref/builder-presets/${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete settings");
      setPresets(Array.isArray(data.presets) ? data.presets : presets.filter(item => item.id !== preset.id));
      setSelectedPresetId("");
      setMessage({ ok: true, text: `"${preset.name}" deleted. Your current builder configuration was not changed.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to delete settings." });
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async () => {
    if (!config) throw new Error("Builder settings are unavailable");
    const res = await fetch("/api/ph-roster-ref/builder-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save config");
    setConfig(data.config);
    return data.config as PHBuilderConfig;
  };

  const handleRunExceptions = async () => {
    if (!config) return;
    setRunning("exceptions");
    setMessage(null);
    setChanges(null);
    try {
      const res = await fetch("/api/ph-roster-ref/builder-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run replacement");
      setMessage({ ok: true, text: `Exceptions updated: ${data.changedCount} assignments changed. Added exceptions were replaced and removed exceptions were restored to the roster.` });
      setChanges(data.changes);
      loadConfig(); // Refresh just in case
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Failed to run replacement." });
    } finally {
      setRunning(null);
    }
  };

  const handleRunPattern = async () => {
    if (!config) return;
    const confirmed = window.confirm(
      `Generate all ${config.startYear} PH assignments from this ${config.pattern.length}-team pattern? This replaces the entire year's PH roster and applies the selected staff exceptions.`,
    );
    if (!confirmed) return;
    setRunning("pattern");
    setMessage(null);
    setChanges(null);
    try {
      const saved = await saveConfig();
      const res = await fetch("/api/ph-roster-ref/auto-allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetYear: saved.startYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run the new pattern");
      setMessage({
        ok: true,
        text: `New pattern complete: rebuilt all ${saved.startYear} PH assignments across ${data.generatedCount} dates.`,
      });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Failed to run the new pattern." });
    } finally {
      setRunning(null);
    }
  };

  const movePatternUnit = (fromIndex: number, toIndex: number) => {
    if (!config || fromIndex === toIndex) return;
    const newPattern = [...config.pattern];
    const [movedUnit] = newPattern.splice(fromIndex, 1);
    newPattern.splice(toIndex, 0, movedUnit);
    setConfig({ ...config, pattern: newPattern });
  };

  const updatePatternDropTarget = (clientX: number, clientY: number) => {
    if (!patternContainerRef.current) return;
    const cards = patternContainerRef.current.querySelectorAll<HTMLElement>("[data-pattern-index]");
    let nextTarget: number | null = null;
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      if (
        clientX >= rect.left && clientX < rect.right
        && clientY >= rect.top && clientY < rect.bottom
      ) {
        nextTarget = Number(card.dataset.patternIndex);
      }
    });
    if (nextTarget !== null && nextTarget !== dragOverPatternIndexRef.current) {
      dragOverPatternIndexRef.current = nextTarget;
      setDragOverPatternIndex(nextTarget);
    }
  };

  const stopPatternAutoScroll = () => {
    patternAutoScrollSpeedRef.current = 0;
    if (patternAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(patternAutoScrollFrameRef.current);
      patternAutoScrollFrameRef.current = null;
    }
  };

  const updatePatternAutoScroll = (clientY: number) => {
    const edgeSize = 72;
    const distanceFromTop = Math.max(0, edgeSize - clientY);
    const distanceFromBottom = Math.max(0, clientY - (window.innerHeight - edgeSize));
    patternAutoScrollSpeedRef.current = distanceFromTop > 0
      ? -Math.max(3, Math.round(distanceFromTop / 5))
      : distanceFromBottom > 0
        ? Math.max(3, Math.round(distanceFromBottom / 5))
        : 0;

    if (patternAutoScrollSpeedRef.current === 0) {
      stopPatternAutoScroll();
      return;
    }
    if (patternAutoScrollFrameRef.current !== null) return;

    const scrollStep = () => {
      if (!patternDragActiveRef.current || patternAutoScrollSpeedRef.current === 0) {
        patternAutoScrollFrameRef.current = null;
        return;
      }
      window.scrollBy({ top: patternAutoScrollSpeedRef.current, behavior: "auto" });
      const pointer = latestPatternPointerRef.current;
      updatePatternDropTarget(pointer.x, pointer.y);
      patternAutoScrollFrameRef.current = requestAnimationFrame(scrollStep);
    };
    patternAutoScrollFrameRef.current = requestAnimationFrame(scrollStep);
  };

  const toggleExcludedOfficer = (name: string) => {
    if (!config) return;
    const current = config.excludedOfficers;
    const isExcluded = current.includes(name);
    let newExcluded = [...current];
    if (isExcluded) {
      newExcluded = newExcluded.filter(n => n !== name);
    } else {
      newExcluded.push(name);
    }
    setConfig({ ...config, excludedOfficers: newExcluded });
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!config) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left Column: Pattern & Settings */}
        <div className="xl:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Rotation Pattern
              </CardTitle>
              <CardDescription>
                 Drag and drop each catchment into its required position. Each active team appears once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2" ref={patternContainerRef}>
                {config.pattern.map((unit, i) => (
                  <div
                    key={`${unit}-${i}`}
                    data-pattern-index={i}
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5 rounded-md",
                      dragOverPatternIndex === i && draggedPatternIndex !== null && draggedPatternIndex !== i
                        ? "rounded-lg bg-blue-100/70 ring-4 ring-blue-600 ring-offset-2 dark:bg-blue-950/60"
                        : "",
                    )}
                  >
                    <span className="text-center text-[11px] font-bold text-foreground sm:text-xs">
                      <span className="hidden sm:inline">Position </span>{i + 1}
                    </span>
                    <div
                      className={cn(
                        "relative z-0 flex min-h-12 cursor-grab touch-none select-none items-stretch overflow-hidden rounded-md border border-border bg-card shadow-sm transition-[transform,box-shadow,filter] duration-150 active:cursor-grabbing",
                        draggedPatternIndex === i
                          ? "opacity-25"
                          : "hover:-translate-y-0.5 hover:shadow-md",
                      )}
                      style={{ backgroundColor: CATCHMENT_BG[unit.slice(0, 2)] ?? "#F5F5F5" }}
                      title="Hold anywhere to drag and reorder"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const element = event.currentTarget;
                        const rect = element.getBoundingClientRect();
                        const startX = event.clientX;
                        const startY = event.clientY;
                        latestPatternPointerRef.current = { x: startX, y: startY };
                        element.setPointerCapture(event.pointerId);
                        patternDragTimerRef.current = setTimeout(() => {
                          const latestPointer = latestPatternPointerRef.current;
                          patternDragActiveRef.current = true;
                          draggedPatternIndexRef.current = i;
                          dragOverPatternIndexRef.current = i;
                          setDraggedPatternIndex(i);
                          setDragOverPatternIndex(i);
                          setPatternDragPreview({
                            unit,
                            x: latestPointer.x,
                            y: latestPointer.y,
                            offsetX: startX - rect.left,
                            offsetY: startY - rect.top,
                            width: rect.width,
                            height: rect.height,
                          });
                        }, 250);
                      }}
                      onPointerMove={(event) => {
                        latestPatternPointerRef.current = { x: event.clientX, y: event.clientY };
                        if (!patternDragActiveRef.current || !patternContainerRef.current) return;
                        setPatternDragPreview(preview => preview ? {
                          ...preview,
                          x: event.clientX,
                          y: event.clientY,
                        } : preview);
                        updatePatternDropTarget(event.clientX, event.clientY);
                        updatePatternAutoScroll(event.clientY);
                      }}
                      onPointerUp={() => {
                        if (patternDragTimerRef.current) {
                          clearTimeout(patternDragTimerRef.current);
                          patternDragTimerRef.current = null;
                        }
                        if (
                          patternDragActiveRef.current
                          && draggedPatternIndexRef.current !== null
                          && dragOverPatternIndexRef.current !== null
                          && draggedPatternIndexRef.current !== dragOverPatternIndexRef.current
                        ) {
                          movePatternUnit(draggedPatternIndexRef.current, dragOverPatternIndexRef.current);
                        }
                        patternDragActiveRef.current = false;
                        stopPatternAutoScroll();
                        draggedPatternIndexRef.current = null;
                        dragOverPatternIndexRef.current = null;
                        setDraggedPatternIndex(null);
                        setDragOverPatternIndex(null);
                        setPatternDragPreview(null);
                      }}
                      onPointerCancel={() => {
                        if (patternDragTimerRef.current) {
                          clearTimeout(patternDragTimerRef.current);
                          patternDragTimerRef.current = null;
                        }
                        patternDragActiveRef.current = false;
                        stopPatternAutoScroll();
                        draggedPatternIndexRef.current = null;
                        dragOverPatternIndexRef.current = null;
                        setDraggedPatternIndex(null);
                        setDragOverPatternIndex(null);
                        setPatternDragPreview(null);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-center px-1 py-2 sm:px-3">
                        <span className="truncate text-xs font-bold text-slate-950 sm:text-sm">
                          {unit}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {patternDragPreview && (
                <div
                  className="pointer-events-none fixed z-[100] flex items-center justify-center rounded-lg border-4 border-blue-700 px-3 py-2 text-base font-extrabold text-slate-950 shadow-[0_18px_45px_rgba(29,78,216,0.55)] ring-8 ring-blue-500/40"
                  style={{
                    left: patternDragPreview.x - patternDragPreview.offsetX,
                    top: patternDragPreview.y - patternDragPreview.offsetY,
                    width: patternDragPreview.width,
                    height: patternDragPreview.height,
                    backgroundColor: CATCHMENT_BG[patternDragPreview.unit.slice(0, 2)] ?? "#F5F5F5",
                    transform: "scale(1.14)",
                  }}
                >
                  {patternDragPreview.unit}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Rules & Parameters</CardTitle>
              <CardDescription>
                Set the start year and strict allocation constraints.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-2 max-w-xs">
                <Label htmlFor="startYear">Roster Year</Label>
                <Input
                  id="startYear"
                  type="number"
                  min={2027}
                  max={2035}
                  value={config.startYear}
                  onChange={(e) => setConfig({ ...config, startYear: parseInt(e.target.value) || 2027 })}
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="consecutivePH"
                    checked={config.consecutivePH}
                    onCheckedChange={(c) => setConfig({ ...config, consecutivePH: !!c })}
                  />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="consecutivePH">Prevent consecutive PH duties</Label>
                    <p className="text-sm text-muted-foreground">
                       Hard rule: staff will not be assigned two public holidays in a row.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="sameHolidayPreviousYear"
                    checked={config.sameHolidayPreviousYear}
                    onCheckedChange={(c) => setConfig({ ...config, sameHolidayPreviousYear: !!c })}
                  />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="sameHolidayPreviousYear">Prevent same holiday as previous year</Label>
                    <p className="text-sm text-muted-foreground">
                       Best-effort rule: avoid the exact same holiday as last year, but never break the consecutive-PH rule to achieve it.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Exclusions & Actions */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                Staff Exceptions
              </CardTitle>
              <CardDescription>
                Select staff to exclude from the roster. They will be replaced by the lowest-count eligible staff.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StaffMultiSelect
                officers={officers}
                selected={config.excludedOfficers}
                onToggle={toggleExcludedOfficer}
              />

              <div className="flex flex-wrap gap-1.5 min-h-[60px] p-3 border rounded-md bg-muted/20">
                {config.excludedOfficers.length === 0 ? (
                  <span className="text-sm text-muted-foreground italic">No staff selected.</span>
                ) : (
                  config.excludedOfficers.map(name => (
                    <Badge key={name} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-1">
                      {name}
                      <button
                        onClick={() => toggleExcludedOfficer(name)}
                        className="rounded-full hover:bg-muted p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-950/60">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-blue-950 dark:text-blue-100">Run Builder</CardTitle>
              <CardDescription className="text-blue-900 dark:text-blue-200">
                Choose whether to rebuild the whole year or replace exceptions only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 text-sm font-medium text-blue-950 bg-blue-100 border border-blue-300 p-3 rounded-md dark:text-blue-100 dark:bg-blue-900/80 dark:border-blue-600">
                <p className="rounded-md border border-blue-300 bg-white/70 p-3 leading-relaxed dark:border-blue-600 dark:bg-blue-950/60">
                  <strong className="block mb-1">Generation Order</strong>
                  Hari Raya (HR) assignments are balloted first. The remaining public holidays are then assigned according to the rotation pattern and selected rules.
                </p>
                <div className="space-y-2 leading-relaxed">
                  <p><strong>New Pattern:</strong> rebuilds every PH assignment for the selected year.</p>
                  <p><strong>Exception Changes:</strong> preserves the roster, replaces duties for newly excluded officers, and restores balanced duties when an officer is removed from the exception list.</p>
                </div>
              </div>

              {message && (
                <div className={cn(
                  "p-3 rounded-md text-sm flex gap-2 items-start",
                  message.ok
                    ? "bg-green-100 text-green-950 border border-green-500 dark:bg-green-950 dark:text-green-100 dark:border-green-500"
                    : "bg-red-100 text-red-950 border border-red-500 dark:bg-red-950 dark:text-red-100 dark:border-red-500"
                )}>
                  {message.ok ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <div>{message.text}</div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2 pt-0">
              <div className="w-full rounded-md border border-blue-300 bg-white/70 p-3 dark:border-blue-600 dark:bg-blue-950/50">
                <Label htmlFor="savedPHSettings" className="mb-2 block text-blue-950 dark:text-blue-100">
                  Previously Saved Settings
                </Label>
                <div className="flex gap-2">
                  <select
                    id="savedPHSettings"
                    value={selectedPresetId}
                    onChange={(event) => setSelectedPresetId(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    disabled={saving || running !== null || presets.length === 0}
                  >
                    <option value="">{presets.length === 0 ? "No saved settings yet" : "Choose saved settings…"}</option>
                    {presets.map(preset => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadPreset}
                    disabled={!selectedPresetId || saving || running !== null}
                  >
                    Load
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRenamePreset}
                    disabled={!selectedPresetId || saving || running !== null}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                    onClick={handleDeletePreset}
                    disabled={!selectedPresetId || saving || running !== null}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full border-slate-500 bg-white text-slate-950 hover:bg-slate-100 dark:border-slate-400 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                onClick={handleSave}
                disabled={saving || running !== null}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Current Settings
              </Button>
              <Button
                className="w-full bg-blue-700 text-white hover:bg-blue-800 focus-visible:ring-blue-500 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400"
                onClick={handleRunPattern}
                disabled={saving || running !== null}
              >
                {running === "pattern" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2 fill-current" />}
                Run New Pattern (Whole Year)
              </Button>
              <Button
                className="w-full bg-indigo-800 text-white hover:bg-indigo-900 focus-visible:ring-indigo-500 dark:bg-indigo-400 dark:text-slate-950 dark:hover:bg-indigo-300"
                onClick={handleRunExceptions}
                disabled={saving || running !== null}
              >
                {running === "exceptions" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
                Apply Exception Changes
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Changes list */}
      {changes && changes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <History className="h-5 w-5" />
              Replacement Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Holiday</th>
                    <th className="px-4 py-2.5 font-medium">Unit / Shift</th>
                    <th className="px-4 py-2.5 font-medium">Original</th>
                    <th className="px-4 py-2.5 font-medium">Replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 tabular-nums">{change.date}</td>
                      <td className="px-4 py-2.5">{change.holiday}</td>
                      <td className="px-4 py-2.5">{change.subCatchment} - {change.shift}</td>
                      <td className="px-4 py-2.5 line-through text-muted-foreground">{change.from}</td>
                      <td className="px-4 py-2.5 font-medium text-blue-700">{change.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StaffMultiSelect({ officers, selected, onToggle }: { officers: any[], selected: string[], onToggle: (name: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          Select officers...
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search staff..." />
          <CommandList>
            <CommandEmpty>No staff found.</CommandEmpty>
            <CommandGroup>
              {officers.map((officer) => (
                <CommandItem
                  key={officer.id}
                  value={officer.name}
                  onSelect={() => {
                    onToggle(officer.name);
                  }}
                >
                  <div className={cn(
                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                    selected.includes(officer.name) ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                  )}>
                    <Check className="h-3 w-3" />
                  </div>
                  <span>{officer.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{officer.unitCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
